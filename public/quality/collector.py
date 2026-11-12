#!/usr/bin/env python3
"""Independent, scheduled IPQuality + NetQuality probes for CFSM.
Runs as isolated cfsm-quality user. Never changes the live metrics probe.
"""
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import sys
import time
import uuid

BASE=Path('/opt/cfsm-quality')
STATE=Path('/var/lib/cfsm-quality')
URL='https://monitor.nnot.de'
CONF=Path('/etc/cfsm-quality/credentials.conf')
MAX_LOG=2*1024*1024
BASH='/usr/bin/bash'
IP_TIMEOUT=2700
NET_TIMEOUT=5400
ANSI=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
IP_SHA='8e685686e1df89119d9aeb182a9dedbc88da19e3'
NET_SHA='e91cd4963c2676da0e12bcece8ccb145e04a6735'

# Git blob IDs for the pinned upstream shell scripts (unmodified originals).
# Patch only a per-run copy: /opt/cfsm-quality/ip.sh and net.sh stay pristine.
VENDOR_BLOBS={
    'ip':'4dad5782d4095ed214b821951eba39353b5e0da4',
    'net':'3f53747f00e6a00fe39534280a1c1dc6b71abbad',
}
IPV4_COMPAT=r'''get_ipv4(){
IPV4=""
local endpoint response
# Prefer Cloudflare's authenticated observation of this probe's actual egress.
# This avoids inaccessible overseas public-IP endpoints on domestic VPSes.
if [[ ${CFSM_EGRESS_IPV4:-} =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]];then
IPV4="$CFSM_EGRESS_IPV4"
return 0
fi
# Determine the egress address as seen by Cloudflare (the report destination).
# Unlike the original scripts, never use protocol-less HTTP URLs.
response=$(curl $CurlARG -4 -fsSL --noproxy '*' --connect-timeout 4 --max-time 8 'https://www.cloudflare.com/cdn-cgi/trace' 2>/dev/null) || response=""
response=$(printf '%s\n' "$response"|awk -F= '$1=="ip"{print $2;exit}'|tr -d '\r\n')
if [[ $response =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]];then
IPV4="$response"
return 0
fi
# Fallback to validated HTTPS plaintext IP endpoints.
local API_NET=(
  "https://api.ipify.org"
  "https://ipv4.icanhazip.com"
  "https://ipinfo.io/ip"
  "https://checkip.amazonaws.com"
  "https://ident.me"
)
for endpoint in "${API_NET[@]}";do
response=$(curl $CurlARG -4 -sSL --noproxy '*' --proto '=https' --proto-redir '=https' --connect-timeout 4 --max-time 8 "$endpoint" 2>/dev/null) || continue
response=$(printf '%s' "$response"|tr -d '\r\n')
if [[ $response =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]];then
IPV4="$response"
return 0
fi
done
}
'''

def verified_source_ipv4(value):
    try:
        # Accept only globally routed IPv4 values from authenticated Worker config.
        ip=ipaddress.IPv4Address(value)
        return str(ip) if ip.is_global else None
    except (ValueError,TypeError):
        return None

def vendor_runtime_script(path,kind,folder):
    if path.is_symlink() or not path.is_file() or kind not in VENDOR_BLOBS:
        raise ValueError('missing_pinned_script_'+kind)
    source=path.read_bytes()
    digest=hashlib.sha1(b'blob '+str(len(source)).encode('ascii')+b'\0'+source).hexdigest()
    if digest!=VENDOR_BLOBS[kind]:
        raise ValueError('upstream_script_checksum_mismatch_'+kind)
    text=source.decode('utf-8')
    pattern=r'(?ms)^get_ipv4\(\)\{\n.*?^\}\n'
    original=re.search(pattern,text)
    if not original or 'API_NET=' not in original.group(0) or 'curl $CurlARG -s4' not in original.group(0):
        raise ValueError('upstream_ipv4_signature_changed_'+kind)
    patched,count=re.subn(pattern,lambda _:IPV4_COMPAT,text,count=1)
    if count!=1:raise ValueError('upstream_ipv4_patch_failed_'+kind)
    script=folder/(kind+'-runtime.sh')
    script.write_text(patched,encoding='utf-8')
    script.chmod(0o700)
    return script

def note(event,**extra):
    print(json.dumps({'event':event,**extra},ensure_ascii=False),flush=True)

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

# System curl requests are accepted by the Cloudflare-proxied production API.
# Never expose the bearer secret in process arguments, files, or logs.
CURL='/usr/bin/curl'

class QualityHTTPError(ValueError):
    def __init__(self,status):
        super().__init__('HTTP Error '+str(status))
        self.status=status

def curl_quote(value):
    if '\r' in value or '\n' in value:
        raise ValueError('invalid_http_header')
    return '"' + value.replace('\\','\\\\').replace('"','\\"') + '"'

def response_headers(path):
    headers={}
    for line in path.read_text(encoding='iso-8859-1').splitlines():
        if line.startswith('HTTP/'):
            headers={}
        elif ':' in line:
            key,val=line.split(':',1)
            headers[key.strip().lower()]=val.strip()
    return headers

def request(path,server,secret,payload=None):
    if not path.startswith('/api/quality/') or '?' in path:
        raise ValueError('invalid_api_path')
    if not re.fullmatch(r'[\da-fA-F-]{20,80}',server) or not secret:
        raise ValueError('invalid_credentials')
    options=[
        'header = '+curl_quote('Accept: application/json'),
        'header = '+curl_quote('Authorization: Bearer '+secret),
        'header = '+curl_quote('X-CFSM-Server-ID: '+server)
    ]
    if payload is not None:
        options.append('header = '+curl_quote('Content-Type: application/json'))
    # Temporary directory is mode 0700, removed after the HTTP request.
    with tempfile.TemporaryDirectory(prefix='cfsm-quality-http-') as tmp:
        location=Path(tmp)
        headers_file=location/'headers'
        body_file=location/'response'
        cmd=[CURL,'--silent','--show-error','--ipv4','--noproxy','*',
             '--connect-timeout','20','--max-time','70',
             '--proto','=https','--config','-',
             '--dump-header',str(headers_file),'--output',str(body_file),
             '--write-out','%{http_code}','--url',URL+path]
        if payload is not None:
            upload_file=location/'upload'
            upload_file.write_bytes(json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode('utf-8'))
            upload_file.chmod(0o600)
            cmd.extend(['--request','POST','--data-binary','@'+str(upload_file)])
        try:
            result=subprocess.run(cmd,input=('\n'.join(options)+'\n').encode('utf-8'),
                                  capture_output=True,timeout=80,check=False)
        except subprocess.TimeoutExpired:
            note('api_transport_error',endpoint=path,error='timeout')
            raise ValueError('curl_timeout')
        if result.returncode!=0:
            note('api_transport_error',endpoint=path,error='curl_exit',code=result.returncode)
            raise ValueError('curl_transport_error')
        try:
            status=int(result.stdout.decode('ascii').strip())
        except (UnicodeError,ValueError):
            raise ValueError('invalid_api_http_status')
        headers=response_headers(headers_file) if headers_file.is_file() else {}
        if not body_file.is_file() or body_file.stat().st_size>131072:
            raise ValueError('api_response_too_large')
        content=body_file.read_bytes()
        if status<200 or status>=300:
            content_type=headers.get('content-type','').split(';',1)[0].lower()
            api_error=None
            error_code=None
            error_category=None
            if content_type=='application/json':
                try:
                    parsed=json.loads(content)
                    if isinstance(parsed,dict):
                        api_error=str(parsed.get('error') or parsed.get('error_name') or '')[:100]
                        error_code=str(parsed.get('error_code') or '')[:32]
                        error_category=str(parsed.get('error_category') or '')[:50]
                except (UnicodeError,ValueError):
                    pass
            note('api_http_error',endpoint=path,status=status,
                 server=headers.get('server','')[:60],
                 cf_ray=headers.get('cf-ray','')[:100],
                 cf_mitigated=headers.get('cf-mitigated','')[:60],
                 content_type=content_type[:70],api_error=api_error,
                 error_code=error_code,error_category=error_category)
            raise QualityHTTPError(status)
        try:
            parsed=json.loads(content)
        except (UnicodeError,ValueError):
            raise ValueError('invalid_api_json')
        if not isinstance(parsed,dict):
            raise ValueError('invalid_api_response')
        return parsed

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

def probe(kind,server,secret,state,source_ipv4=None):
    path=BASE/('ip.sh' if kind=='ip' else 'net.sh')
    if not path.exists() or path.is_symlink():raise ValueError('missing_pinned_script_'+kind)
    ts=int(time.time()*1000)
    folder=STATE/('run-'+kind+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'))
    folder.mkdir(mode=0o700)
    script=vendor_runtime_script(path,kind,folder)
    json_file=folder/(kind+'.json')
    args=[BASH,str(script),'-4','-p','-f','-n','-o',str(json_file)]
    if kind=='net':args.append('-R')
    result=None
    probe_env={**os.environ,'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'Asia/Shanghai'}
    if source_ipv4:
        probe_env['CFSM_EGRESS_IPV4']=source_ipv4
    else:
        probe_env.pop('CFSM_EGRESS_IPV4',None)
    try:
        result=subprocess.run(args,capture_output=True,timeout=IP_TIMEOUT if kind=='ip' else NET_TIMEOUT,cwd=str(folder),env=probe_env,check=False)
    except subprocess.TimeoutExpired as ex:
        note('probe_timeout',kind=kind)
        result=ex
    output=clean_log((result.stdout or b'').decode('utf-8','replace')+'\n'+(result.stderr or b'').decode('utf-8','replace'))
    (folder/'console.log').write_text(output,encoding='utf-8')
    if not json_file.is_file() or json_file.stat().st_size>280000:
        note('probe_missing_json',kind=kind,exit_code=getattr(result,'returncode',124))
        return False
    if json_file.stat().st_size==0:
        reason='ipv4_detection_failed' if ('IPV4不可用' in output or 'IPv4 is not available' in output) else 'no_json_output'
        note('probe_empty_json',kind=kind,reason=reason,exit_code=getattr(result,'returncode',124))
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
        except (ValueError,OSError) as exc:
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
        # Source IP is reported by the Worker only after successful bearer auth.
        source_ipv4=verified_source_ipv4(config.get('source_ipv4'))
        if source_ipv4: note('edge_ipv4_selected',ip=source_ipv4)
        else: note('edge_ipv4_unavailable')
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
            request_id=int(triggered.get(kind) or 0)
            forced=request_id>int(state.get(kind+'_request') or 0)
            due=now-int(state.get(kind) or 0)>=hours*3600000
            if not (forced or due):continue
            # Do not re-run failing international probes every 15 minutes.
            # A fresh admin request is still allowed to override cooldown.
            retry=state.get(kind+'_retry') or {}
            if not isinstance(retry,dict):retry={}
            previous_request=int(retry.get('request_id') or 0)
            retry_until=int(retry.get('until') or 0)
            new_force=forced and request_id>previous_request
            if now<retry_until and not new_force and os.environ.get('CFSM_QUALITY_FORCE')!='1':
                note('probe_retry_wait',kind=kind,seconds_left=(retry_until-now+999)//1000)
                continue
            note('probe_start',kind=kind,forced=forced)
            if probe(kind,server,secret,state,source_ipv4):
                if forced:state[kind+'_request']=request_id
                state.pop(kind+'_retry',None)
                write_state(state)
            else:
                failed=True
                failures=min(8,max(0,int(retry.get('failures') or 0))+1)
                retry_delay=min(3600000*(2**(failures-1)),8*3600000)
                state[kind+'_retry']={'failures':failures,'until':int(time.time()*1000)+retry_delay,
                                      'request_id':request_id}
                write_state(state)
                note('probe_retry_scheduled',kind=kind,failures=failures,retry_minutes=retry_delay//60000)
        cleanup()
        return 1 if failed else 0

if __name__=='__main__':
    try:sys.exit(run())
    except Exception as e:
        note('fatal',error=type(e).__name__,detail=str(e)[:120] if isinstance(e,ValueError) else None)
        sys.exit(1)
