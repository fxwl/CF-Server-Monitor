import contextlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cfsm_quality_collector',BASE/'public'/'quality'/'collector.py')
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
SERVER_ID='00000000-0000-0000-0000-000000000000'
SECRET='sample-secret-NEVER-LOG'

class CurlTransportTests(unittest.TestCase):
    def fake_curl(self,status=200,response=None):
        response=response if response is not None else {'schema_version':1,'schedule':{'enabled':True}}
        def fake_run(cmd,**kwargs):
            self.assertEqual(cmd[0],'/usr/bin/curl')
            self.assertIn('--ipv4',cmd)
            self.assertIn('--noproxy',cmd)
            self.assertEqual(cmd[cmd.index('--noproxy')+1],'*')
            self.assertIn('--config',cmd)
            self.assertEqual(cmd[cmd.index('--config')+1],'-')
            self.assertNotIn(SECRET,str(cmd))
            config=kwargs['input'].decode('utf-8')
            self.assertIn('Authorization: Bearer '+SECRET,config)
            self.assertNotIn('\nheader = "Injected:',config)
            headers=Path(cmd[cmd.index('--dump-header')+1])
            output=Path(cmd[cmd.index('--output')+1])
            headers.write_text('HTTP/2 '+str(status)+'\nServer: cloudflare\nCF-Ray: abc123-LAX\nContent-Type: application/json; charset=utf-8\n')
            output.write_text(json.dumps(response))
            if '--data-binary' in cmd:
                payload=Path(cmd[cmd.index('--data-binary')+1][1:])
                self.assertTrue(payload.is_file())
                self.assertEqual(payload.stat().st_mode & 0o777,0o600)
                self.assertEqual(json.loads(payload.read_text())['kind'],'ip')
            return SimpleNamespace(returncode=0,stdout=str(status).encode(),stderr=b'')
        return fake_run

    def test_get_config_accepts_200_and_keeps_auth_header_out_of_argv(self):
        with patch.object(collector.subprocess,'run',side_effect=self.fake_curl()):
            x=collector.request('/api/quality/config',SERVER_ID,SECRET)
        self.assertEqual(x['schema_version'],1)

    def test_report_upload_posts_json_from_private_file(self):
        with patch.object(collector.subprocess,'run',side_effect=self.fake_curl(response={'accepted':True})):
            x=collector.request('/api/quality/report',SERVER_ID,SECRET,payload={'kind':'ip','report':{}})
        self.assertTrue(x['accepted'])

    def test_http_403_reports_safe_error_fields(self):
        response={'type':'error','error_code':1010,'error_name':'cloudflare_block','error_category':'security','detail':'SECRET RESPONSE CONTENT'}
        output=io.StringIO()
        with patch.object(collector.subprocess,'run',side_effect=self.fake_curl(403,response)):
            with contextlib.redirect_stdout(output):
                with self.assertRaises(collector.QualityHTTPError) as err:
                    collector.request('/api/quality/config',SERVER_ID,SECRET)
        self.assertEqual(err.exception.status,403)
        line=json.loads(output.getvalue().strip())
        self.assertEqual(line['event'],'api_http_error')
        self.assertEqual(line['cf_ray'],'abc123-LAX')
        self.assertEqual(line['error_code'],'1010')
        self.assertNotIn(SECRET,output.getvalue())
        self.assertNotIn('SECRET RESPONSE CONTENT',output.getvalue())

    def test_invalid_secret_header_injection_rejected(self):
        with self.assertRaises(ValueError):
            collector.request('/api/quality/config',SERVER_ID,'abc\nInjected: bad')

    def test_error_logger_cannot_shadow_exception_details(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            collector.note('fatal',error='QualityHTTPError',detail='HTTP Error 403')
        self.assertEqual(json.loads(output.getvalue())['error'],'QualityHTTPError')

if __name__=='__main__':
    unittest.main()
