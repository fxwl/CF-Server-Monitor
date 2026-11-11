import importlib.util
import pathlib
import tempfile
import unittest
import unittest.mock as mock
import os
import subprocess
import urllib.error
import json

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collector', ROOT/'public/netdiag/collector.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CollectorTest(unittest.TestCase):
    def config(self, directory, extra=''):
        p=pathlib.Path(directory)/'config.conf'
        p.write_text('SERVER_ID="server-1"\nSECRET="this-is-a-long-test-secret-only"\nWORKER_URL="https://monitor.nnot.de/update"\n'+extra)
        p.chmod(0o600)
        return p
    def test_config_not_executed(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.config(d,'NAME="$(touch /tmp/never-execute-netdiag)"\n')
            with mock.patch.object(m.subprocess,'run',side_effect=AssertionError('no shell')):
                server,secret,url=m.parse_config(p)
                self.assertEqual(server,'server-1');self.assertEqual(url,'https://monitor.nnot.de')
    def test_config_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.config(d);p.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'mode_600'):m.parse_config(p)
    def test_wrong_worker_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.config(d,'WORKER_URL="https://attacker.invalid/update"\n')
            with self.assertRaisesRegex(ValueError,'unexpected_worker_url'):m.parse_config(p)
    def test_refuses_root(self):
        with mock.patch.object(m.os,'geteuid',return_value=0):
            with self.assertRaisesRegex(ValueError,'root'):m.run('unused','unused')
    def test_order_allowlist(self):
        targets=[{'key':k,'host':next(iter(m.ALLOWED[k]))[0],'port':next(iter(m.ALLOWED[k]))[1]} for k in reversed(m.ORDER)]
        self.assertEqual([x['key'] for x in m.validate_targets({'schema_version':1,'targets':targets})],list(m.ORDER))
        targets[0]['host']='127.0.0.1'
        with self.assertRaisesRegex(ValueError,'allowlisted'):m.validate_targets({'schema_version':1,'targets':targets})
    def test_ip_filters(self):
        for ip in ['10.0.0.1','169.254.169.254','127.0.0.1','224.0.0.1','::1',None,'x']:self.assertFalse(m.public_v4(ip))
        self.assertTrue(m.public_v4('94.24.39.45'))
    def test_parse_silent_private_and_destination_hops(self):
        sample='traceroute to 36.248.48.210, 30 hops max\n 1  10.0.0.1  0.125 ms\n 2  *\n 3  218.105.2.1  38.5 ms !X\n 4  36.248.48.210  39.0 ms\n'
        hops=m.parse_trace(sample)
        self.assertEqual(len(hops),4);self.assertEqual(hops[1]['ip'],None);self.assertEqual(hops[2]['annotation'],'!X');self.assertEqual(hops[3]['ip'],'36.248.48.210')
    def test_missing_tool_does_not_elevate(self):
        with mock.patch.object(m,'resolve_v4',return_value='36.248.48.210'),mock.patch.object(m,'tcp_sample',return_value={'attempts':3,'successes':3,'median_ms':40}):
            r=m.trace_target({'key':'cu','host':'36.248.48.210','port':80},None)
            self.assertEqual(r['status'],'tool_missing');self.assertEqual(r['tcp']['successes'],3)
    def test_trace_uses_no_shell_no_capability(self):
        result=subprocess.CompletedProcess([],0,b' 1  36.248.48.210  38.0 ms\n',b'')
        with mock.patch.object(m,'resolve_v4',return_value='36.248.48.210'),mock.patch.object(m,'tcp_sample',return_value={}),mock.patch.object(m.subprocess,'run',return_value=result) as run:
            r=m.trace_target({'key':'cu','host':'36.248.48.210','port':80},'/usr/bin/traceroute')
            args,kwargs=run.call_args;self.assertEqual(args[0][0],'/usr/bin/traceroute');self.assertNotIn('-T',args[0]);self.assertNotIn('sudo',args[0]);self.assertFalse(kwargs.get('shell',False));self.assertEqual(kwargs['timeout'],45);self.assertEqual(r['status'],'complete')
    def test_permission_failure_recorded(self):
        result=subprocess.CompletedProcess([],1,b'',b'Operation not permitted')
        with mock.patch.object(m,'resolve_v4',return_value='36.248.48.210'),mock.patch.object(m,'tcp_sample',return_value={}),mock.patch.object(m.subprocess,'run',return_value=result):
            self.assertEqual(m.trace_target({'key':'cu','host':'36.248.48.210','port':80},'/usr/bin/traceroute')['status'],'permission_denied')
    def test_timeout_retains_partial_hops(self):
        error=subprocess.TimeoutExpired([],45,output=b' 1  8.8.8.8  8 ms\n')
        with mock.patch.object(m,'resolve_v4',return_value='36.248.48.210'),mock.patch.object(m,'tcp_sample',return_value={}),mock.patch.object(m.subprocess,'run',side_effect=error):
            r=m.trace_target({'key':'cu','host':'36.248.48.210','port':80},'/usr/bin/traceroute')
            self.assertEqual(r['status'],'timeout');self.assertEqual(len(r['hops']),1)
    def test_redirect_refused_before_sending_credentials(self):
        handler=m.NoRedirect()
        req=m.urllib.request.Request('https://monitor.nnot.de/api/netdiag/config',headers={'Authorization':'Bearer TEST'})
        with self.assertRaises(urllib.error.HTTPError):handler.redirect_request(req,None,302,'redirect',{},'https://attacker.invalid/')
    def test_corrupt_cache_is_safe(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'bad.json';p.write_text('[]');self.assertEqual(m.read_json(p,{}),{})
            p.write_text('{bad}');self.assertEqual(m.read_json(p,{}),{})
    def test_private_hops_not_queried(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(m,'json_request',side_effect=AssertionError('no external request')):
            routes=[{'hops':[{'ip':'10.0.0.1','asns':[]},{'ip':None,'asns':[]}]}]
            m.enrich_asns(routes,pathlib.Path(d));self.assertEqual(routes[0]['hops'][0]['asns'],[])
    def test_asn_lookup_errors_remain_unknown(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(m,'json_request',side_effect=OSError('unavailable')):
            routes=[{'hops':[{'ip':'8.8.8.8','asns':[]}]}]
            m.enrich_asns(routes,pathlib.Path(d));self.assertEqual(routes[0]['hops'][0]['asns'],[])
    def test_atomic_state_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'state.json';m.write_json(p,{'ok':True});self.assertEqual(p.stat().st_mode&0o777,0o600);self.assertTrue(json.loads(p.read_text())['ok'])

if __name__=='__main__':unittest.main()
