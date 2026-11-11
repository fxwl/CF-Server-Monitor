import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('stable',pathlib.Path(__file__).resolve().parents[1]/'public/netdiag/stable/collector.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class StableCollectorTest(unittest.TestCase):
    def test_fixed_icmp_target_allowlist(self):
        data={'schema_version':2,'targets':[{'key':k,'host':v,'port':0,'mode':'icmp'} for k,v in m.TARGETS.items()]}
        self.assertEqual([x['key'] for x in m.validate_config(data)],['cu','ct','cm'])
        data['targets'][0]['host']='127.0.0.1'
        with self.assertRaises(ValueError):m.validate_config(data)
    def test_ping_counts_and_round_trip_stats(self):
        sample='5 packets transmitted, 4 received, 20% packet loss, time 1800ms\nrtt min/avg/max/mdev = 42.000/44.000/46.000/2.000 ms\n'
        result=m.parse_ping(sample)
        self.assertEqual(result['sent'],5);self.assertEqual(result['received'],4);self.assertEqual(result['avg_ms'],44)
    def test_failed_ping_does_not_create_zero_latency(self):
        x=m.parse_ping('5 packets transmitted, 0 received, 100% packet loss, time 4ms')
        self.assertIsNone(x['avg_ms']);self.assertEqual(x['status'],'unreachable')
    def test_icmp_never_runs_as_root_or_uses_sudo(self):
        with mock.patch.object(m.os,'geteuid',return_value=0):
            with self.assertRaisesRegex(ValueError,'root'):m.run('unused','unused')
        p=subprocess.CompletedProcess([],1,b'5 packets transmitted, 0 received, 100% packet loss',b'')
        with mock.patch.object(m.shutil,'which',return_value='/usr/bin/ping'),mock.patch.object(m.subprocess,'run',return_value=p) as run:
            m.ping_target('36.248.48.211')
            args=run.call_args.args[0]
            self.assertNotIn('sudo',args);self.assertEqual(args[args.index('-c')+1],'5');self.assertEqual(run.call_args.kwargs['timeout'],15)
    def test_udp_trace_and_silent_hops(self):
        h=m.parse_trace(' 1  10.0.0.1  0.1 ms\n 2 *\n 3 36.248.48.211 44.0 ms !X\n')
        self.assertEqual(len(h),3);self.assertIsNone(h[1]['ip']);self.assertEqual(h[2]['annotation'],'!X')
    def test_config_cannot_execute_shell(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'config.conf';p.write_text('SERVER_ID="node-1"\nSECRET="test-only-secret-not-production-1234"\nWORKER_URL="https://monitor.nnot.de/update"\nNAME="$(echo DO_NOT_RUN)"\n');p.chmod(0o600)
            with mock.patch.object(m.subprocess,'run',side_effect=AssertionError):
                self.assertEqual(m.parse_config(p)[0],'node-1')
            p.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'unsafe'):m.parse_config(p)
    def test_private_hops_never_sent_to_geo_or_asn_services(self):
        with tempfile.TemporaryDirectory() as d,mock.patch.object(m,'json_request',side_effect=AssertionError):
            rows=[{'hops':[{'ip':'10.0.0.1','asns':[]},{'ip':None,'asns':[]}]}]
            m.enrich(rows,pathlib.Path(d));self.assertEqual(rows[0]['hops'][0]['asns'],[])
    def test_rejects_nonallowlisted_https_endpoints(self):
        with self.assertRaises(ValueError):m.json_request('https://attacker.invalid/')
    def test_atomic_state_is_private(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'state.json';m.write_json(p,{'a':1});self.assertEqual(p.stat().st_mode&0o777,0o600);self.assertEqual(m.read_json(p),{'a':1})
if __name__=='__main__':unittest.main()
