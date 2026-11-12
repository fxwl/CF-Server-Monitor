#!/usr/bin/env python3
"""Test a narrowly scoped runtime fix for the two pinned NQ/IP scripts."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cfsm_quality_collector',BASE/'public'/'quality'/'collector.py')
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class UpstreamIPv4Tests(unittest.TestCase):
    def _exercise_bash(self,trace_value,plain_value,expected,egress_ipv4=None):
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root)
            bindir=directory/'bin'
            bindir.mkdir()
            curl=bindir/'curl'
            curl.write_text(
                '#!/bin/sh\n'
                'case " $* " in\n'
                '  *cdn-cgi/trace*) printf "%s\\n" "$TRACE_VALUE";;\n'
                '  *) printf "%s\\n" "$PLAIN_VALUE";;\n'
                'esac\n'
            )
            curl.chmod(0o755)
            env={**os.environ,'PATH':str(bindir)+':'+os.environ.get('PATH',''),
                 'TRACE_VALUE':trace_value,'PLAIN_VALUE':plain_value}
            if egress_ipv4 is not None:
                env['CFSM_EGRESS_IPV4']=egress_ipv4
            code=collector.IPV4_COMPAT+'\nCurlARG=""\nget_ipv4\nprintf "ip=%s\\n" "$IPV4"\n'
            p=subprocess.run(['/bin/bash','-c',code],capture_output=True,text=True,env=env,timeout=6)
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertEqual(p.stdout.strip(),'ip='+expected)

    def test_cloudflare_trace_is_preferred_and_validated(self):
        self._exercise_bash('fl=abc\nip=198.51.100.24\ncolo=LAX',
                            '203.0.113.42','198.51.100.24')

    def test_https_ip_endpoint_is_fallback(self):
        self._exercise_bash('error=blocked','203.0.113.42','203.0.113.42')

    def test_invalid_ipv4_not_accepted(self):
        self._exercise_bash('ip=redirect','HTTP/1.1 301 Moved Permanently','')

    def test_worker_observed_ipv4_does_not_require_external_services(self):
        self._exercise_bash('error=blocked','HTTP/1.1 403','123.249.124.176',
                            egress_ipv4='123.249.124.176')

    def test_worker_source_ipv4_must_be_globally_routed(self):
        self.assertEqual(collector.verified_source_ipv4('123.249.124.176'),'123.249.124.176')
        for addr in ('10.0.0.1','127.0.0.1','192.168.1.1','2001:db8::1','123.249.124.999',None):
            self.assertIsNone(collector.verified_source_ipv4(addr))

    def test_vendor_copy_is_patched_not_original(self):
        # Fake minimal original with the same signature as both pinned scripts.
        original=b'#!/bin/bash\nget_ipv4(){\nlocal API_NET=("ip.sb")\nresponse=$(curl $CurlARG -s4 --max-time 2 "$p")\n}\n'
        digest=hashlib.sha1(b'blob '+str(len(original)).encode()+b'\0'+original).hexdigest()
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root)
            path=directory/'ip.sh'
            path.write_bytes(original)
            work=directory/'work'
            work.mkdir()
            with patch.dict(collector.VENDOR_BLOBS,{'ip':digest}):
                generated=collector.vendor_runtime_script(path,'ip',work)
            self.assertEqual(path.read_bytes(),original)
            self.assertNotIn(b'--max-time 2',generated.read_bytes())
            self.assertIn(b'https://www.cloudflare.com/cdn-cgi/trace',generated.read_bytes())
            self.assertEqual(generated.stat().st_mode & 0o777,0o700)
            p=subprocess.run(['/bin/bash','-n',str(generated)],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)

    def test_netquality_runtime_copy_uses_bounded_retries_and_fallback(self):
        pinned=BASE/'public'/'quality'/'vendor'/'net.sh'
        with tempfile.TemporaryDirectory() as root:
            original=pinned.read_bytes()
            patched=collector.vendor_runtime_script(pinned,'net',Path(root)).read_text()
            self.assertEqual(pinned.read_bytes(),original)
            self.assertIn('local max_retries=2',patched)
            self.assertIn('cfsm_route_fallback "$domain" "$rnum" "$rmode"',patched)
            self.assertIn('timeout 35s traceroute',patched)
            syntax=Path(root)/'net-runtime.sh'
            syntax.write_text(patched)
            p=subprocess.run(['/bin/bash','-n',str(syntax)],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)

    def test_ip_only_fallback_has_real_hops_not_invented_asn_geo(self):
        with tempfile.TemporaryDirectory() as root:
            bindir=Path(root)
            tool=bindir/'traceroute'
            tool.write_text('#!/bin/sh\nprintf "traceroute to test\\n1 192.0.2.1 1.2 ms\\n2 198.51.100.2 22.3 ms\\n"\n')
            tool.chmod(0o755)
            env={**os.environ,'PATH':str(bindir)+':'+os.environ.get('PATH','')}
            code=collector.NET_ROUTE_FALLBACK+'\ncfsm_route_fallback test.example 2 1\n'
            proc=subprocess.run(['/bin/bash','-c',code],capture_output=True,text=True,env=env,timeout=8)
            self.assertEqual(proc.returncode,0,proc.stderr)
            self.assertIn('|2|1|1.2ms|192.0.2.1|-|-|-|',proc.stdout)
            self.assertIn('|2|2|22.3ms|198.51.100.2|-|-|-|',proc.stdout)

    def test_vendor_checksum_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root)
            path=directory/'ip.sh'
            path.write_text('not official content')
            with self.assertRaisesRegex(ValueError,'checksum_mismatch'):
                collector.vendor_runtime_script(path,'ip',directory)

if __name__=='__main__':
    unittest.main()
