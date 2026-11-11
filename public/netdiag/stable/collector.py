#!/usr/bin/env python3
"""Pinned CFSM diagnostics 1.2.0: non-root ICMP + UDP route, no throughput tests."""
import argparse
import concurrent.futures
import fcntl
import hashlib
import http.client
import importlib.util
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

VERSION = '1.2.0'
ORIGIN = 'https://monitor.nnot.de'
TARGETS = {'cu': '36.248.48.211', 'ct': '218.85.157.99', 'cm': '211.138.151.161'}
MAX_BODY = 131072


def log(event, **values):
    print(json.dumps({'component': 'cfsm-netdiag', 'event': event, **values}), flush=True)


def public_v4(value):
    try:
        ip = ipaddress.ip_address(value)
        return ip.version == 4 and ip.is_global and not ip.is_multicast
    except (ValueError, TypeError):
        return False


def ipv4_connect(address, timeout=10, source_address=None, **kwargs):
    error = None
    for family, kind, proto, _, endpoint in socket.getaddrinfo(address[0], address[1], socket.AF_INET, socket.SOCK_STREAM):
        sock = socket.socket(family, kind, proto)
        try:
            sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(endpoint)
            return sock
        except OSError as exc:
            error = exc
            sock.close()
    raise error or OSError('no_ipv4_address')


class IPv4TLS(http.client.HTTPSConnection):
    def connect(self):
        self._create_connection = ipv4_connect
        super().connect()


class IPv4Handler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        return self.do_open(IPv4TLS, request, context=self._context)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, 'redirect_refused', headers, fp)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), IPv4Handler(), NoRedirect())


def json_request(url, headers=None, body=None, timeout=8):
    parsed = urllib.parse.urlsplit(url)
    allowed = {'monitor.nnot.de', 'stat.ripe.net', 'ipwho.is'}
    if parsed.scheme != 'https' or parsed.hostname not in allowed or parsed.username or parsed.password or parsed.port not in (443, None):
        raise ValueError('endpoint_not_allowed')
    h = {'Accept': 'application/json', 'User-Agent': 'CFSM-Netdiag/' + VERSION, **(headers or {})}
    data = None if body is None else json.dumps(body, separators=(',', ':')).encode()
    if data is not None:
        h['Content-Type'] = 'application/json'
    with OPENER.open(urllib.request.Request(url, data=data, headers=h), timeout=timeout) as r:
        if urllib.parse.urlsplit(r.url).netloc != parsed.netloc:
            raise ValueError('cross_origin_redirect')
        raw = r.read(MAX_BODY + 1)
        if len(raw) > MAX_BODY:
            raise ValueError('response_too_large')
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError('invalid_json_object')
        return result


def parse_config(filename):
    p = pathlib.Path(filename)
    st = p.stat()
    if p.is_symlink() or st.st_uid != os.getuid() or st.st_mode & 0o077 or st.st_size > 32768:
        raise ValueError('unsafe_agent_config')
    values = {}
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1].replace('\\"', '"')
        values[key.strip()] = value
    server, secret = values.get('SERVER_ID', ''), values.get('SECRET', '')
    url = urllib.parse.urlsplit(values.get('WORKER_URL', ''))
    if not re.fullmatch(r'[A-Za-z0-9-]{1,80}', server) or not 20 <= len(secret) <= 512:
        raise ValueError('invalid_agent_credentials')
    if url.scheme != 'https' or url.hostname != 'monitor.nnot.de' or url.path.rstrip('/') != '/update' or url.port not in (None, 443) or url.username or url.password or url.query:
        raise ValueError('unexpected_worker_url')
    return server, secret


def validate_config(data):
    rows = data.get('targets')
    if data.get('schema_version') != 2 or not isinstance(rows, list) or len(rows) != 3:
        raise ValueError('incompatible_cloud_version')
    out = []
    for key, address in TARGETS.items():
        selected = [r for r in rows if r.get('key') == key]
        if len(selected) != 1 or selected[0].get('host') != address or selected[0].get('mode') != 'icmp' or selected[0].get('port') != 0:
            raise ValueError('target_not_allowlisted')
        out.append({'key': key, 'host': address, 'port': 0})
    return out


def parse_ping(stdout, returncode=0):
    counts = re.search(r'(\d+) packets transmitted,\s*(\d+) (?:packets )?received', stdout)
    sent, received = (int(counts[1]), int(counts[2])) if counts else (0, 0)
    if not 0 <= received <= sent <= 5:
        raise ValueError('invalid_ping_counts')
    summary = re.search(r'(?:rtt|round-trip) min/avg/max/(?:mdev|stddev) = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)', stdout)
    values = [float(summary[i]) for i in range(1, 5)] if summary and received else [None] * 4
    return {'sent': sent, 'received': received, 'min_ms': values[0], 'avg_ms': values[1], 'max_ms': values[2], 'mdev_ms': values[3], 'status': 'ok' if received else 'unreachable'}


def ping_target(ip):
    ping = shutil.which('ping', path='/usr/bin:/bin:/usr/sbin:/sbin')
    empty = {'sent': 0, 'received': 0, 'min_ms': None, 'avg_ms': None, 'max_ms': None, 'mdev_ms': None}
    if not ping:
        return {**empty, 'status': 'tool_missing'}
    try:
        p = subprocess.run([ping, '-4', '-n', '-c', '5', '-i', '0.4', '-W', '2', '-w', '12', '--', ip], capture_output=True, timeout=15, check=False, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
        stderr = p.stderr[:1024].decode(errors='replace').lower()
        if 'permitted' in stderr or 'permission' in stderr:
            return {**empty, 'status': 'permission_denied'}
        return parse_ping(p.stdout[:8192].decode(errors='replace'), p.returncode)
    except subprocess.TimeoutExpired as exc:
        return parse_ping((exc.stdout or b'')[:8192].decode(errors='replace'), 1)
    except (OSError, ValueError):
        return {**empty, 'status': 'error'}


def parse_trace(output):
    hops = []
    for line in output.splitlines():
        m = re.match(r'^\s*(\d{1,2})\s+(.+)$', line)
        if not m:
            continue
        ttl = int(m[1])
        if ttl < 1 or ttl > 30 or (hops and ttl <= hops[-1]['ttl']):
            continue
        ip = None
        for candidate in re.findall(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])', m[2]):
            try:
                if ipaddress.ip_address(candidate).version == 4:
                    ip = candidate
                    break
            except ValueError:
                pass
        samples = [float(v) for v in re.findall(r'([\d.]+)\s*ms', m[2])][:3]
        annotation = re.search(r'![A-Za-z0-9<>]+', m[2])
        hops.append({'ttl': ttl, 'ip': ip, 'asns': [], 'rtts_ms': [x for x in samples if 0 <= x <= 30000], 'annotation': annotation[0] if annotation else ''})
    return hops


def trace_target(target):
    started = time.monotonic()
    result = {**target, 'target_ip': target['host'], 'status': 'partial', 'hops': [], 'icmp': ping_target(target['host']), 'error': None}
    tool = shutil.which('traceroute', path='/usr/bin:/bin:/usr/sbin:/sbin')
    if not tool:
        result.update(status='tool_missing', error='traceroute_not_installed')
    else:
        try:
            p = subprocess.run([tool, '-4', '-n', '-m', '30', '-q', '1', '-N', '3', '-w', '1.2', '-z', '0.05', '--', target['host'], '60'], capture_output=True, timeout=45, check=False, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
            result['hops'] = parse_trace(p.stdout[:32768].decode(errors='replace'))
            if p.returncode:
                error = p.stderr[:1024].decode(errors='replace').lower()
                result.update(status='permission_denied' if 'permission' in error or 'permitted' in error else 'error', error='traceroute_failed')
        except subprocess.TimeoutExpired as exc:
            result['hops'] = parse_trace((exc.stdout or b'')[:32768].decode(errors='replace'))
            result.update(status='timeout', error='traceroute_timeout')
        except OSError:
            result.update(status='error', error='traceroute_failed')
    result['reached'] = any(h['ip'] == target['host'] for h in result['hops'])
    if result['reached']:
        result['status'] = 'complete'
    result['duration_ms'] = round((time.monotonic() - started) * 1000)
    return result


def read_json(path):
    try:
        if path.is_symlink() or path.stat().st_size > 262144:
            return {}
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, data):
    fd, filename = tempfile.mkstemp(prefix='.diag-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(data, stream, separators=(',', ':'), ensure_ascii=True)
        os.chmod(filename, 0o600)
        os.replace(filename, path)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def enrich(routes, state):
    now = int(time.time())
    cache = read_json(state / 'hop-cache-v2.json')
    cache = {k: v for k, v in cache.items() if public_v4(k) and isinstance(v, dict) and isinstance(v.get('expires'), int) and v['expires'] > now}
    addresses = list(dict.fromkeys(h['ip'] for r in routes for h in r['hops'] if public_v4(h['ip'])))
    missing = [ip for ip in addresses if ip not in cache][:32]
    geo_candidates = list(dict.fromkeys(ip for r in routes for ip in [h['ip'] for h in r['hops'] if public_v4(h['ip'])][-3:]))[:9]
    def lookup(ip):
        out = {'asns': [], 'geo': None, 'expires': now + 3600}
        try:
            raw = json_request('https://stat.ripe.net/data/network-info/data.json?' + urllib.parse.urlencode({'resource': ip}), timeout=4)
            values = raw.get('data', {}).get('asns', [])
            out['asns'] = [int(x) for x in values[:4] if not isinstance(x, bool) and str(x).isdigit() and 0 < int(x) <= 4294967295]
        except (OSError, ValueError, AttributeError, TypeError):
            pass
        if ip in geo_candidates:
            try:
                raw = json_request('https://ipwho.is/' + ip, timeout=4)
                if raw.get('success') is True and raw.get('ip') == ip:
                    conn = raw.get('connection') if isinstance(raw.get('connection'), dict) else {}
                    out['geo'] = {k: str(raw.get(k) or '')[:60] for k in ('country', 'region', 'city')}
                    out['geo']['isp'] = str(conn.get('isp') or conn.get('org') or '')[:90]
            except (OSError, ValueError, AttributeError, TypeError):
                pass
        if out['asns'] or out['geo']:
            out['expires'] = now + 7 * 86400
        return ip, out
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for ip, info in pool.map(lookup, missing):
            cache[ip] = info
    for route in routes:
        for hop in route['hops']:
            info = cache.get(hop['ip'], {})
            hop['asns'] = info.get('asns', [])
            if info.get('geo'):
                hop['geo'] = info['geo']
    if len(cache) > 512:
        cache = dict(sorted(cache.items(), key=lambda pair: pair[1]['expires'], reverse=True)[:512])
    write_json(state / 'hop-cache-v2.json', cache)


def run(config_file, state_dir):
    if os.geteuid() == 0:
        raise ValueError('refusing_root_execution')
    state = pathlib.Path(state_dir).expanduser()
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    if state.is_symlink() or state.stat().st_uid != os.getuid():
        raise ValueError('unsafe_state_directory')
    os.chmod(state, 0o700)
    lock_path = state / 'run-stable.lock'
    if lock_path.is_symlink():
        raise ValueError('unsafe_lock')
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log('already_running')
            return
        previous = read_json(state / 'last-stable-success.json')
        elapsed = time.time() - float(previous.get('at', 0))
        if 0 <= elapsed < 600:
            log('cooldown')
            return
        server, secret = parse_config(config_file)
        headers = {'Authorization': 'Bearer ' + secret, 'X-CFSM-Server-ID': server}
        targets = validate_config(json_request(ORIGIN + '/api/netdiag/config-stable?id=' + urllib.parse.quote(server), headers=headers))
        report = {'schema_version': 2, 'version': VERSION, 'run_id': str(uuid.uuid4()), 'started_at': int(time.time()*1000), 'routes': []}
        for target in targets:
            route = trace_target(target)
            report['routes'].append(route)
            log('route_finished', key=target['key'], status=route['status'], received=route['icmp']['received'])
        enrich(report['routes'], state)
        write_json(state / 'last-stable-report.json', report)
        reply = json_request(ORIGIN + '/api/netdiag/report-stable', headers=headers, body=report, timeout=12)
        if reply.get('accepted') is not True:
            raise ValueError('report_not_accepted')
        write_json(state / 'last-stable-success.json', {'at': time.time(), 'run_id': report['run_id']})
        log('report_accepted', version=VERSION)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(pathlib.Path.home()/'.cf-probe/config.conf'))
    parser.add_argument('--state', default=str(pathlib.Path.home()/'.cfsm-netdiag'))
    parser.add_argument('--version', action='version', version=VERSION)
    args = parser.parse_args()
    try:
        run(args.config, args.state)
        return 0
    except urllib.error.HTTPError as exc:
        log('failed', error='http_' + str(exc.code))
    except Exception as exc:
        log('failed', error=re.sub(r'[^A-Za-z0-9_]', '_', str(exc) if isinstance(exc, ValueError) else type(exc).__name__)[:80])
    return 1


if __name__ == '__main__':
    sys.exit(main())
