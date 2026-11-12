#!/usr/bin/env python3
"""Independent, scheduled IPQuality + NetQuality probes for CFSM.
Runs as the existing cfsm user. Never changes the live metrics probe.
"""
import datetime
import fcntl
import json
import os
import pwd
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE=Path('/opt/cfsm-quality')
STATE=Path('/var/lib/cfsm-quality')
URL='https://monitor.nnot.de'
USER_HOME=Path(pwd.getpwnam('cfsm').pw_dir)
CONF=USER_HOME/'.cf-probe/config.conf'
MAX_LOG=2*1024*1024
BASH='/usr/bin/bash'
IP_TIMEOUT=2700
NET_TIMEOUT=5400
ANSI=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
IP_SHA='8e685686e1df89119d9aeb182a9dedbc88da19e3'
NET_SHA='e91cd4963c2676da0e12bcece8ccb145e04a6735'

def note(message,**extra):
    print(json.dumps({'event':message,**extra},ensure_ascii=False),flush=True)

def creds():
    if CONF.is_symlink() or not CONF.is_file():
        raise ValueError('probe_config_missing')
    out={}
    for raw in CONF.read_text(encoding='utf-8').splitlines():
        line=raw.strip()
        if not line or line.startswith('#') or '=' not in line:continue
        k,v=line.split('=',1)
        v=v.strip().strip('"').strip("'")
        out[k.strip()]=v
    server=out.get('SERVER_ID','')
    secret=out.get('SECRET','')
    if not re.fullmatch(r'[\da-fA-F-]{20,80}',server) or len(secret)<16:
        raise ValueError('invalid_probe_config')
    return server,secret

def request(path,server,secret,payload=None):
    data=None if payload is None else json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    headers={'Accept':'application/json','Authorization':'Bearer '+secret,'X-CFSM-Server-ID':server}
    if payload is not None: headers['Content-Type']='application/json'
    req=urllib.request.Request(URL+path,data=data,headers=headers)
    with urllib.request.urlopen(req,timeout=45) as resp:
        body=resp.read(128*1024)
        if resp.read(1):raise ValueError('api_response_too_large')
    return json.loads(body)

def read_state():
    path=STATE/'last-run.json'
    try:
        x=json.loads(path.read_text())
        return x if isinstance(x,dict) else {}
    except (OSError,ValueError):return {}

def write_state(data):
    tmp=STATE/'last-run.tmp'
    tmp.write_text(json.dumps(data),encoding='utf-8')
    tmp.chmod(0o600)
    tmp.replace(STATE/'last-run.json')

def clean_log(text):
    # No ANSI, no private credentials. Preserve official report output as-is.
    s=ANSI.sub('',text)
    s=''.join(c for c in s if c in '\r\n\t' or c.isprintable())
    return s[-MAX_LOG:]

def routes_from_console(output):
    found={}
    current=None
    header=re.compile('^\\s*(北京|上海|广东|广州)\\s*(电信|联通|移动)\\s+(.*)$')
    hop=re.compile('^\\s*[0-9]+(?:-[0-9]+)?\\s+')
    for raw in output.replace(chr(13),chr(10)).splitlines():
        line=raw.strip()
        if not line: continue
        m=header.match(line)
        if m:
            city='广东' if m.group(1)=='广州' else m.group(1)
            current=(city,m.group(2))
            found[current]=[line]
        elif current and (line.startswith('地理路径：') or hop.match(line)):
            if len(found[current])<80:found[current].append(line)
    return [{'city':city,'carrier':carrier,'text':chr(10).join(found.get((city,carrier),[]))}
            for city in ('北京','上海','广东') for carrier in ('电信','联通','移动')]

def probe(kind,server,secret,state):
    path=BASE/('ip.sh' if kind=='ip' else 'net.sh')
    if not path.exists() or path.is_symlink():raise ValueError('missing_pinned_script_'+kind)
    ts=int(time.time()*1000)
    folder=STATE/('run-'+kind+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'))
    folder.mkdir(mode=0o700)
    json_file=folder/(kind+'.json')
    args=[BASH,str(path),'-4','-p','-f','-o',str(json_file)]
    if kind=='net':args.append('-R')
    result=None
    try:
        result=subprocess.run(args,capture_output=True,timeout=IP_TIMEOUT if kind=='ip' else NET_TIMEOUT,cwd=str(folder),env={**os.environ,'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'Asia/Shanghai'},check=False)
    except subprocess.TimeoutExpired as ex:
        note('probe_timeout',kind=kind)
        result=ex
    output=clean_log((result.stdout or b'').decode('utf-8','replace')+'\n'+(result.stderr or b'').decode('utf-8','replace'))
    (folder/'console.log').write_text(output,encoding='utf-8')
    if not json_file.is_file() or json_file.stat().st_size>280000:
        note('probe_missing_json',kind=kind,exit_code=getattr(result,'returncode',124))
        return False
    try:
        report=json.loads(json_file.read_text(encoding='utf-8'))
    except (ValueError,OSError):
        note('invalid_probe_json',kind=kind)
        return False
    if not isinstance(report,dict) or not isinstance(report.get('Head'),dict):
        note('invalid_probe_structure',kind=kind)
        return False
    payload={'schema_version':1,'kind':kind,'run_id':str(uuid.uuid4()),'started_at':ts,'report':report}
    if kind=='net':
        payload['route_text']=output[-105000:]
        payload['routes']=routes_from_console(output)
    report_file=folder/'report.json'
    report_file.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
    report_file.chmod(0o600)
    for attempt in range(3):
        try:
            response=request('/api/quality/report',server,secret,payload)
            if response.get('accepted') is True:
                state[kind]=int(time.time()*1000)
                note('report_accepted',kind=kind,bytes=report_file.stat().st_size)
                return True
        except (ValueError,OSError,urllib.error.HTTPError) as exc:
            note('report_upload_error',kind=kind,attempt=attempt+1,error=type(exc).__name__)
        time.sleep((attempt+1)*2)
    return False

def cleanup():
    dirs=sorted([d for d in STATE.iterdir() if d.is_dir() and d.name.startswith('run-')],key=lambda x:x.name,reverse=True)
    for d in dirs[12:]:
        for child in d.iterdir():
            if child.is_file() and not child.is_symlink():child.unlink()
        d.rmdir()

def run():
    os.umask(0o077)
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'collector.lock').open('a+') as handle:
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            note('already_running');return 0
        server,secret=creds()
        config=request('/api/quality/config',server,secret)
        schedule=config.get('schedule') or {}
        if schedule.get('enabled') is False:
            note('disabled');return 0
        state=read_state()
        triggered=schedule.get('requested') or {}
        now=int(time.time()*1000)
        failed=False
        for kind in ('ip','net'):
            hours=schedule.get(kind+'_hours',168)
            if not isinstance(hours,int) or not 1<=hours<=720:hours=168
            forced=int(triggered.get(kind) or 0)>int(state.get(kind+'_request') or 0)
            due=now-int(state.get(kind) or 0)>=hours*3600000
            if not (forced or due):continue
            if probe(kind,server,secret,state):
                if forced:state[kind+'_request']=int(triggered[kind])
                write_state(state)
            else:failed=True
        cleanup()
        return 1 if failed else 0

if __name__=='__main__':
    try:sys.exit(run())
    except Exception as e:
        note('fatal',error=type(e).__name__,message=str(e)[:120] if isinstance(e,ValueError) else None)
        sys.exit(1)
)
    hop=re.compile(r'^\s*\d+(?:-\d+)?\s+')
    found={}
    active=None
    for raw in output.replace('\r','\n').splitlines():
        line=raw.strip()
        if not line:continue
        matched=header.match(line)
        if matched:
            city='广东' if matched.group(1)=='广州' else matched.group(1)
            active=(city,matched.group(2))
            found[active]=[line]
        elif active and (line.startswith('地理路径：') or hop.match(line)):
            if len(found[active])<80:found[active].append(line)
    return [{'city':city,'carrier':carrier,'text':'\n'.join(found.get((city,carrier),[]))}
            for city in ('北京','上海','广东') for carrier in ('电信','联通','移动')]

def probe(kind,server,secret,state):
    path=BASE/('ip.sh' if kind=='ip' else 'net.sh')
    if not path.exists() or path.is_symlink():raise ValueError('missing_pinned_script_'+kind)
    ts=int(time.time()*1000)
    folder=STATE/('run-'+kind+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'))
    folder.mkdir(mode=0o700)
    json_file=folder/(kind+'.json')
    args=[BASH,str(path),'-4','-p','-f','-o',str(json_file)]
    if kind=='net':args.append('-R')
    result=None
    try:
        result=subprocess.run(args,capture_output=True,timeout=IP_TIMEOUT if kind=='ip' else NET_TIMEOUT,cwd=str(folder),env={**os.environ,'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'Asia/Shanghai'},check=False)
    except subprocess.TimeoutExpired as ex:
        note('probe_timeout',kind=kind)
        result=ex
    output=clean_log((result.stdout or b'').decode('utf-8','replace')+'\n'+(result.stderr or b'').decode('utf-8','replace'))
    (folder/'console.log').write_text(output,encoding='utf-8')
    if not json_file.is_file() or json_file.stat().st_size>280000:
        note('probe_missing_json',kind=kind,exit_code=getattr(result,'returncode',124))
        return False
    try:
        report=json.loads(json_file.read_text(encoding='utf-8'))
    except (ValueError,OSError):
        note('invalid_probe_json',kind=kind)
        return False
    if not isinstance(report,dict) or not isinstance(report.get('Head'),dict):
        note('invalid_probe_structure',kind=kind)
        return False
    payload={'schema_version':1,'kind':kind,'run_id':str(uuid.uuid4()),'started_at':ts,'report':report}
    if kind=='net':
        payload['route_text']=output[-105000:]
    report_file=folder/'report.json'
    report_file.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
    report_file.chmod(0o600)
    for attempt in range(3):
        try:
            response=request('/api/quality/report',server,secret,payload)
            if response.get('accepted') is True:
                state[kind]=int(time.time()*1000)
                note('report_accepted',kind=kind,bytes=report_file.stat().st_size)
                return True
        except (ValueError,OSError,urllib.error.HTTPError) as exc:
            note('report_upload_error',kind=kind,attempt=attempt+1,error=type(exc).__name__)
        time.sleep((attempt+1)*2)
    return False

def cleanup():
    dirs=sorted([d for d in STATE.iterdir() if d.is_dir() and d.name.startswith('run-')],key=lambda x:x.name,reverse=True)
    for d in dirs[12:]:
        for child in d.iterdir():
            if child.is_file() and not child.is_symlink():child.unlink()
        d.rmdir()

def run():
    os.umask(0o077)
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'collector.lock').open('a+') as handle:
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            note('already_running');return 0
        server,secret=creds()
        config=request('/api/quality/config',server,secret)
        schedule=config.get('schedule') or {}
        if schedule.get('enabled') is False:
            note('disabled');return 0
        state=read_state()
        triggered=schedule.get('requested') or {}
        now=int(time.time()*1000)
        failed=False
        for kind in ('ip','net'):
            hours=schedule.get(kind+'_hours',168)
            if not isinstance(hours,int) or not 1<=hours<=720:hours=168
            forced=int(triggered.get(kind) or 0)>int(state.get(kind+'_request') or 0)
            due=now-int(state.get(kind) or 0)>=hours*3600000
            if not (forced or due):continue
            if probe(kind,server,secret,state):
                if forced:state[kind+'_request']=int(triggered[kind])
                write_state(state)
            else:failed=True
        cleanup()
        return 1 if failed else 0

if __name__=='__main__':
    try:sys.exit(run())
    except Exception as e:
        note('fatal',error=type(e).__name__,message=str(e)[:120] if isinstance(e,ValueError) else None)
        sys.exit(1)
