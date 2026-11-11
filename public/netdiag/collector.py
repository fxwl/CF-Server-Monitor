#!/usr/bin/env python3
"""Non-root, bounded IPv4 route collector. No shell commands, remote shell, or speed test."""
import argparse
import concurrent.futures
import fcntl
import ipaddress
import json
import os
import pathlib
import re
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = '1.1.0'
MAX_HOPS = 30
MAX_RESPONSE = 131072
ALLOWED = {
    'cu': {('36.248.48.210', 80), ('36.250.1.90', 8080)},
    'ct': {('fj-fuzhou-ct-v4.ip.zstaticcdn.com', 80), ('fj-fuzhou-ct-v4.ip.zstaticcdn.com', 443), ('203.55.129.248', 80)},
    'cm': {('csfw.fj.chinamobile.com', 8080)},
}
ORDER = ('cu', 'ct', 'cm')


def log(event, **fields):
    print(json.dumps({'component': 'cfsm-netdiag', 'event': event, **fields}, ensure_ascii=True), flush=True)


def public_v4(value):
    try:
        ip = ipaddress.ip_address(value)
        return ip.version == 4 and ip.is_global and not ip.is_multicast
    except (ValueError, TypeError):
        return False


def json_request(url, body=None, headers=None, timeout=9):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        raise ValueError('https_required')
    request_headers = {'Accept': 'application/json', 'User-Agent': 'CFSM-Network-Diagnostics/' + VERSION}
    request_headers.update(headers or {})
    data = None if body is None else json.dumps(body, separators=(',', ':')).encode()
    if data is not None:
        request_headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=data, headers=request_headers)
    with OPENER.open(request, timeout=timeout) as response:
        # Do not accept redirects to an unrelated origin, especially on authenticated requests.
        if urllib.parse.urlsplit(response.url).netloc != parsed.netloc:
            raise ValueError('cross_origin_redirect')
        raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError('response_too_large')
        return json.loads(raw)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, 'redirect_refused', headers, fp)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def parse_config(path):
    path = pathlib.Path(path)
    stat = path.stat()
    if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('config_must_be_owned_by_current_user_and_mode_600')
    if stat.st_size > 32768:
        raise ValueError('config_too_large')
    values = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1].replace('\\"', '"')
        values[key.strip()] = value
    server_id = values.get('SERVER_ID', '')
    secret = values.get('SECRET', '')
    url = urllib.parse.urlsplit(values.get('WORKER_URL', ''))
    if not re.fullmatch(r'[A-Za-z0-9-]{1,80}', server_id) or not 20 <= len(secret) <= 512:
        raise ValueError('invalid_agent_credentials')
    if url.scheme != 'https' or url.hostname != 'monitor.nnot.de' or url.username or url.password or url.port not in (None, 443) or url.path.rstrip('/') != '/update' or url.query:
        raise ValueError('unexpected_worker_url')
    return server_id, secret, 'https://monitor.nnot.de'


def validate_targets(config):
    if config.get('schema_version') != 1 or not isinstance(config.get('targets'), list) or len(config['targets']) != 3:
        raise ValueError('invalid_server_configuration')
    result = []
    for key in ORDER:
        entries = [t for t in config['targets'] if t.get('key') == key]
        if len(entries) != 1:
            raise ValueError('invalid_carrier_set')
        target = entries[0]
        if (target.get('host'), target.get('port')) not in ALLOWED[key]:
            raise ValueError('target_not_allowlisted')
        result.append({'key': key, 'host': target['host'], 'port': target['port']})
    return result


def resolve_v4(host):
    if public_v4(host):
        return host
    if not any(host == h for endpoints in ALLOWED.values() for h, _ in endpoints):
        raise ValueError('target_not_allowlisted')
    getent = shutil.which('getent')
    if getent:
        try:
            result = subprocess.run([getent, 'ahostsv4', host], capture_output=True, timeout=5, check=False, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'RES_OPTIONS': 'attempts:1 timeout:2'})
            for line in result.stdout[:8192].decode(errors='replace').splitlines():
                ip = line.split()[0] if line.split() else ''
                if public_v4(ip):
                    return ip
        except (subprocess.TimeoutExpired, OSError):
            pass
    data = json_request('https://cloudflare-dns.com/dns-query?' + urllib.parse.urlencode({'name': host, 'type': 'A'}), headers={'Accept': 'application/dns-json'}, timeout=5)
    for answer in data.get('Answer', []):
        if answer.get('type') == 1 and public_v4(answer.get('data', '')):
            return answer['data']
    raise ValueError('no_public_ipv4_answer')


def tcp_sample(ip, port):
    """Bounded NQ/TQ-inspired TCP handshake sampling; no data transfer or raw sockets."""
    times = []
    for _ in range(5):
        started = time.monotonic()
        try:
            with socket.create_connection((ip, port), timeout=2):
                times.append(round((time.monotonic() - started) * 1000, 3))
        except OSError:
            pass
    jitter = statistics.median(abs(times[i] - times[i-1]) for i in range(1, len(times))) if len(times) > 1 else None
    return {'attempts': 5, 'successes': len(times),
            'median_ms': statistics.median(times) if times else None,
            'min_ms': min(times) if times else None, 'max_ms': max(times) if times else None,
            'jitter_ms': jitter}


def parse_trace(output):
    hops = []
    for line in output.splitlines():
        found = re.match(r'^\s*(\d{1,2})\s+(.*)$', line)
        if not found:
            continue
        ttl = int(found[1])
        if not 1 <= ttl <= MAX_HOPS or hops and ttl <= hops[-1]['ttl']:
            continue
        tail = found[2]
        matches = re.findall(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])', tail)
        address = None
        for candidate in matches:
            try:
                if ipaddress.ip_address(candidate).version == 4:
                    address = candidate
                    break
            except ValueError:
                continue
        times = [float(x) for x in re.findall(r'(\d+(?:\.\d+)?)\s*ms', tail)][:3]
        annotation = re.search(r'![A-Za-z0-9<>]+', tail)
        hops.append({'ttl': ttl, 'ip': address, 'rtts_ms': [x for x in times if 0 <= x <= 30000], 'asns': [], 'annotation': annotation[0] if annotation else ''})
    return hops


def trace_target(target, traceroute):
    started = time.monotonic()
    result = {**target, 'target_ip': None, 'status': 'error', 'reached': False, 'hops': [], 'tcp': {'attempts': 0, 'successes': 0, 'median_ms': None}, 'duration_ms': 0, 'error': None}
    try:
        try:
            ip = resolve_v4(target['host'])
            result['target_ip'] = ip
        except Exception:
            result.update(status='dns_error', error='dns_lookup_failed')
            return result
        result['tcp'] = tcp_sample(ip, target['port'])
        if not traceroute:
            result.update(status='tool_missing', error='traceroute_not_installed')
            return result
        # Ordinary UDP traceroute requires no capabilities. No TCP raw mode or sudo fallback.
        command = [traceroute, '-4', '-n', '-m', str(MAX_HOPS), '-q', '1', '-N', '3', '-w', '1.2', '-z', '0.05', '--', ip, '60']
        try:
            completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, check=False, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
            stdout = completed.stdout[:32768].decode(errors='replace')
            stderr = completed.stderr[:1024].decode(errors='replace')
            result['hops'] = parse_trace(stdout)
            result['reached'] = any(h['ip'] == ip for h in result['hops'])
            if completed.returncode != 0:
                denied = 'permitted' in stderr.lower() or 'permission' in stderr.lower()
                result.update(status='permission_denied' if denied else 'error', error='traceroute_permission_denied' if denied else 'traceroute_failed')
            else:
                result['status'] = 'complete' if result['reached'] else 'partial'
        except subprocess.TimeoutExpired as exc:
            result['hops'] = parse_trace((exc.stdout or b'')[:32768].decode(errors='replace'))
            result.update(status='timeout', error='traceroute_timeout')
        except OSError:
            result.update(status='error', error='traceroute_failed')
        return result
    finally:
        result['duration_ms'] = round((time.monotonic() - started) * 1000)


def read_json(path, default):
    try:
        if path.stat().st_size > 262144:
            return default
        value = json.loads(path.read_text())
        return value if isinstance(value, type(default)) else default
    except (OSError, ValueError):
        return default


def write_json(path, data):
    fd, temp = tempfile.mkstemp(prefix='.netdiag-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(data, handle, separators=(',', ':'), ensure_ascii=True)
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def enrich_asns(routes, state):
    cache_path = state / 'asn-cache.json'
    now = int(time.time())
    cache = read_json(cache_path, {})
    cache = {k: v for k, v in cache.items() if public_v4(k) and isinstance(v, dict) and isinstance(v.get('expires'), int) and v['expires'] > now}
    addresses = list(dict.fromkeys(h['ip'] for r in routes for h in r['hops'] if h['ip'] and public_v4(h['ip'])))
    missing = [ip for ip in addresses if ip not in cache][:48]

    def lookup(ip):
        try:
            response = json_request('https://stat.ripe.net/data/network-info/data.json?' + urllib.parse.urlencode({'resource': ip}), timeout=5)
            values = response.get('data', {}).get('asns', [])
            result = []
            for value in values[:4]:
                if isinstance(value, bool):
                    continue
                number = int(value)
                if 1 <= number <= 4294967295:
                    result.append(number)
            return ip, {'asns': result, 'expires': now + (7 * 86400 if result else 3600)}
        except (ValueError, TypeError, AttributeError, OSError, urllib.error.URLError):
            return ip, {'asns': [], 'expires': now + 3600}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for ip, info in pool.map(lookup, missing):
            cache[ip] = info
    for route in routes:
        for hop in route['hops']:
            hop['asns'] = cache.get(hop['ip'], {}).get('asns', [])
    if len(cache) > 1024:
        cache = dict(sorted(cache.items(), key=lambda item: item[1]['expires'], reverse=True)[:1024])
    write_json(cache_path, cache)


def enrich_geos(routes, state):
    """Small, cached public-hop geo sample. API geolocation is indicative, not proof of route locality."""
    cache_path = state / 'geo-cache.json'
    now = int(time.time())
    cache = read_json(cache_path, {})
    cache = {k: v for k, v in cache.items()
             if public_v4(k) and isinstance(v, dict) and isinstance(v.get('expires'), int)
             and v['expires'] > now}
    candidates = []
    for route in routes:
        public_hops = [h['ip'] for h in route['hops'] if h.get('ip') and public_v4(h['ip'])]
        if not public_hops:
            continue
        # Sample near-origin, mid-path, and destination rather than bulk geolocating every hop.
        shortlist = [public_hops[0], public_hops[len(public_hops)//2]] + public_hops[-3:]
        for ip in shortlist:
            if ip not in candidates:
                candidates.append(ip)
    missing = [ip for ip in candidates if ip not in cache][:12]

    def lookup(ip):
        try:
            raw = json_request('https://ipwho.is/' + urllib.parse.quote(ip, safe=''), timeout=6)
            if raw.get('success') is not True or raw.get('ip') != ip:
                raise ValueError('geo_provider_invalid')
            conn = raw.get('connection') if isinstance(raw.get('connection'), dict) else {}
            geo = {key: str(raw.get(key) or '')[:60] for key in ('country','region','city')}
            geo['isp'] = str(conn.get('isp') or conn.get('org') or '')[:90]
            return ip, {'geo': geo, 'expires': now + 7*86400}
        except (ValueError, TypeError, AttributeError, OSError, urllib.error.URLError):
            return ip, {'geo': None, 'expires': now + 3600}

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for ip, info in pool.map(lookup, missing):
            cache[ip] = info
    for route in routes:
        for hop in route['hops']:
            if hop.get('ip') in cache and isinstance(cache[hop['ip']].get('geo'), dict):
                hop['geo'] = cache[hop['ip']]['geo']
    if len(cache) > 512:
        cache = dict(sorted(cache.items(),key=lambda item:item[1]['expires'],reverse=True)[:512])
    write_json(cache_path, cache)


def run(config_path, state_path):
    if os.geteuid() == 0:
        raise ValueError('refusing_to_run_as_root')
    state = pathlib.Path(state_path).expanduser()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state.is_symlink() or state.stat().st_uid != os.getuid():
        raise ValueError('unsafe_state_directory')
    os.chmod(state, 0o700)
    with (state / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log('already_running')
            return
        last = read_json(state / 'last-success.json', {})
        if time.time() - float(last.get('time', 0)) < 600:
            log('cooldown', seconds=600)
            return
        server_id, secret, origin = parse_config(config_path)
        headers = {'Authorization': 'Bearer ' + secret, 'X-CFSM-Server-ID': server_id}
        config = json_request(origin + '/api/netdiag/config?' + urllib.parse.urlencode({'id': server_id}), headers=headers)
        targets = validate_targets(config)
        report = {'schema_version': 1, 'version': VERSION, 'run_id': str(uuid.uuid4()), 'started_at': int(time.time() * 1000), 'routes': []}
        tool = shutil.which('traceroute', path='/usr/bin:/bin:/usr/sbin:/sbin')
        for target in targets:
            result = trace_target(target, tool)
            report['routes'].append(result)
            log('route_finished', carrier=target['key'], status=result['status'], hops=len(result['hops']))
        enrich_asns(report['routes'], state)
        enrich_geos(report['routes'], state)
        write_json(state / 'last-report.json', report)
        response = json_request(origin + '/api/netdiag/report', body=report, headers=headers, timeout=12)
        if not response.get('accepted'):
            raise ValueError('report_not_accepted')
        write_json(state / 'last-success.json', {'time': time.time(), 'run_id': report['run_id']})
        log('report_accepted', run_id=report['run_id'], version=VERSION)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(pathlib.Path.home() / '.cf-probe/config.conf'))
    parser.add_argument('--state', default=str(pathlib.Path.home() / '.cfsm-netdiag'))
    parser.add_argument('--version', action='version', version=VERSION)
    args = parser.parse_args()
    try:
        run(args.config, args.state)
    except urllib.error.HTTPError as exc:
        log('failed', error='http_' + str(exc.code))
        return 1
    except Exception as exc:
        # Never dump credential-bearing URLs, config contents, or request headers.
        known = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        log('failed', error=re.sub(r'[^A-Za-z0-9_]', '_', known)[:100])
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
