#!/usr/bin/env python3
"""CFSM full weekly NodeQuality runner. No public NodeQuality upload.
Run only from a reviewed root systemd oneshot unit, not from the web/API.
"""
import fcntl
import http.client
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION='1.0.0'
REV='a92fca6c0067df29ddd03fdc2fee6f3000f64545'
URL='https://monitor.nnot.de'
BASEDIR=Path('/var/lib/cfsm-nq')
REPORTS=BASEDIR/'reports'
WORK=BASEDIR/'work'
SCRIPT=Path('/opt/cfsm-nq/NodeQuality.sh')
PARTS=['hardware_quality','ip_quality','net_quality','backroute_trace']
MIN_FREE=6*1024**3
MAX_JSON=270000
MAX_LOG=4*1024**2
MAX_LOCAL=13

def stamp():
    return time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
def notice(event,**details):
    print(json.dumps({'event':event,'unit':'cfsm-nq','version':VERSION,**details},ensure_ascii=True),flush=True)
def config():
    account=pwd.getpwnam('cfsm')
    src=Path(account.pw_dir)/'.cf-probe/config.conf'
    st=src.stat()
    if src.is_symlink() or st.st_uid!=account.pw_uid or st.st_mode&0o077:
        raise ValueError('unsafe_cfsm_credentials')
    data={}
    for line in src.read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k,v=line.split('=',1);v=v.strip()
        if len(v)>=2 and v[0]==v[-1] and v[0] in ('"',"'"):
            v=v[1:-1]
        data[k.strip()]=v
    server=data.get('SERVER_ID','')
    token=data.get('SECRET','')
    if not (server and len(server)<90 and 20<=len(token)<512):
        raise ValueError('invalid_agent_credentials')
    return server,token

def ipv4_connect(address,timeout=20,source_address=None,**kwargs):
    err=None
    for fam,kind,proto,_,endpoint in socket.getaddrinfo(address[0],address[1],socket.AF_INET,socket.SOCK_STREAM):
        sock=socket.socket(fam,kind,proto)
        try:
            sock.settimeout(timeout)
            if source_address:sock.bind(source_address)
            sock.connect(endpoint)
            return sock
        except OSError as exc:
            err=exc;sock.close()
    raise err or OSError('ipv4_not_available')

class IPv4HTTPS(http.client.HTTPSConnection):
    def connect(self):
        self._create_connection=ipv4_connect
        super().connect()

class IPv4Handler(urllib.request.HTTPSHandler):
    def https_open(self,request):
        return self.do_open(IPv4HTTPS,request,context=self._context)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise urllib.error.HTTPError(req.full_url,code,'redirect_forbidden',headers,fp)

OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}),IPv4Handler(),NoRedirect())

def api(path,token,server,body=None):
    url=URL+path
    if urllib.parse.urlsplit(url).hostname!='monitor.nnot.de':
        raise ValueError('unexpected_api_host')
    headers={'Authorization':'Bearer '+token,'X-CFSM-Server-ID':server,'Accept':'application/json'}
    if body is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(url,data=json.dumps(body,separators=(',',':'),ensure_ascii=True).encode() if body is not None else None,headers=headers)
    with OPENER.open(req,timeout=45) as resp:
        if urllib.parse.urlsplit(resp.url).hostname!='monitor.nnot.de':
            raise ValueError('unexpected_api_redirect')
        data=resp.read(16384)
        if resp.read(1):raise ValueError('api_response_too_large')
        return json.loads(data)

def make_state():
    if os.geteuid()!=0:raise ValueError('requires_root_for_benchos')
    os.umask(0o077)
    for path in (BASEDIR,REPORTS,WORK):
        if path.is_symlink():raise ValueError('unsafe_state_symlink')
        path.mkdir(mode=0o700,parents=True,exist_ok=True)
        if path.stat().st_uid!=0:raise ValueError('unsafe_state_owner')
        path.chmod(0o700)
    if shutil.disk_usage(BASEDIR).free<MIN_FREE:raise ValueError('insufficient_disk_for_full_nq')
    if not SCRIPT.is_file() or SCRIPT.is_symlink():raise ValueError('missing_pinned_nodequality')

def capture(folder):
    found={}
    for key in PARTS:
        file=folder/(key+'.json')
        if not file.is_file() or file.is_symlink() or file.stat().st_size>MAX_JSON:
            found[key]=None
            continue
        try:
            value=json.loads(file.read_text(encoding='utf-8'))
            found[key]=value if isinstance(value,(dict,list)) else None
        except (UnicodeError,ValueError,OSError):
            found[key]=None
    return found

def trim():
    candidates=sorted((p for p in REPORTS.iterdir() if p.is_dir() and p.name.startswith('20') and not p.is_symlink()),key=lambda p:p.name,reverse=True)
    for path in candidates[MAX_LOCAL:]:shutil.rmtree(path)

def run():
    make_state()
    lock=BASEDIR/'weekly.lock'
    if lock.is_symlink():raise ValueError('unsafe_lock')
    with lock.open('a+') as fd:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            notice('already_running')
            return 1
        server,token=config()
        info=api('/api/netdiag/config-stable?id='+urllib.parse.quote(server),token,server)
        ip=info.get('public_ip')
        if not isinstance(ip,str) or '.' not in ip:
            raise ValueError('no_public_ipv4_from_monitor')
        runid=str(uuid.uuid4())
        now=int(time.time()*1000)
        folder=REPORTS/(stamp()+'-'+runid[:8])
        folder.mkdir(mode=0o700)
        env={'HOME':'/root','PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
             'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','CFSM_NQ_OUTPUT_DIR':str(folder),'TZ':'Asia/Shanghai'}
        log=folder/'nodequality.log'
        notice('full_nodequality_started',run_id=runid,at=now,expected_sections=4)
        timeout=9000
        status=1
        with log.open('wb') as out:
            try:
                p=subprocess.run(['bash',str(SCRIPT),'-4','-D',str(WORK)],
                    input=b'y\ny\ny\ny\n',stdout=out,stderr=subprocess.STDOUT,
                    timeout=timeout,cwd=str(WORK),env=env,check=False)
                status=p.returncode
            except subprocess.TimeoutExpired:
                status=124
        # NodeQuality's upstream post_cleanup intentionally exits 1 even on success.
        # Completion is defined by captured JSON files, never a terminal exit code.
        if log.stat().st_size>MAX_LOG:
            with log.open('rb+') as x:x.truncate(MAX_LOG)
        sections=capture(folder)
        count=sum(value is not None for value in sections.values())
        report={'schema_version':4,'script_revision':REV,'run_id':runid,'ip':ip,'started_at':now,'sections':sections}
        raw=json.dumps(report,ensure_ascii=True,separators=(',',':')).encode()
        report_file=folder/'report.json'
        report_file.write_bytes(raw);report_file.chmod(0o600)
        (folder/'status.json').write_text(json.dumps({'sections':count,'exit_code':status,'recorded_at':int(time.time()*1000)}))
        notice('local_report_saved',run_id=runid,sections=count,upstream_exit_code=status,bytes=len(raw))
        accepted=False
        if count:
            for attempt in range(1,4):
                try:
                    response=api('/api/netdiag/nq-report',token,server,report)
                    if response.get('accepted') is True:
                        accepted=True
                        notice('cloud_report_saved',run_id=runid,partial=count<4,sections=count)
                        break
                    raise ValueError('nq_not_accepted')
                except (OSError,ValueError,urllib.error.HTTPError) as exc:
                    notice('upload_retry',attempt=attempt,error=type(exc).__name__)
                    if attempt<3:time.sleep(3*attempt)
        trim()
        return 0 if accepted and count==4 else 2

if __name__=='__main__':
    try:sys.exit(run())
    except Exception as exc:
        notice('failed',reason=str(exc) if isinstance(exc,ValueError) else type(exc).__name__)
        sys.exit(1)
