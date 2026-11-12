#!/usr/bin/env python3
"""Regression tests for the tiny, verified Worker-to-upstream IPv4 bridge."""
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
    def _run_minimal_bridge(self, ipv4, define_only=False):
        environment={'PATH':'/usr/bin:/bin','LC_ALL':'C','CFSM_EGRESS_IPV4':ipv4}
        code=collector.IPV4_COMPAT
        if not define_only:
            code+='\nget_ipv4\nprintf "IP=%s\n" "$IPV4"\n'
        return subprocess.run(['/bin/bash','--noprofile','--norc','-c',code],
                              capture_output=True,text=True,env=environment,timeout=5)

    def test_definition_is_minimal_and_parses(self):
        code=collector.IPV4_COMPAT
        self.assertLess(len(code),100)
        self.assertNotIn('curl',code)
        self.assertNotIn('awk',code)
        self.assertNotIn(' =~ ',code)
        self.assertNotIn('eval',code)
        self.assertEqual(self._run_minimal_bridge('1.1.1.1',define_only=True).returncode,0)
        self.assertEqual(self._run_minimal_bridge('1.1.1.1').stdout.strip(),'IP=1.1.1.1')

    def test_actual_worker_observed_ipv4_is_used_without_network(self):
        p=self._run_minimal_bridge('8.8.8.8')
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(p.stdout.strip(),'IP=8.8.8.8')

    def test_missing_edge_ipv4_does_not_call_external_ip_services(self):
        p=self._run_minimal_bridge('')
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(p.stdout.strip(),'IP=')

    def test_worker_source_ipv4_validation_is_in_python(self):
        for valid in ('1.1.1.1','8.8.8.8'):
            self.assertEqual(collector.verified_source_ipv4(valid),valid)
        for bad in ('10.0.0.1','127.0.0.1','192.168.1.1','2001:db8::1',
                    '123.249.124.999','0.0.0.0','',None):
            self.assertIsNone(collector.verified_source_ipv4(bad))

    def test_vendor_copy_is_patched_not_original(self):
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
            self.assertIn(b'CFSM_EGRESS_IPV4',generated.read_bytes())
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
