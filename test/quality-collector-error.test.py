import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cfsm_quality_collector', BASE/'public'/'quality'/'collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class ErrorLoggingTests(unittest.TestCase):
    def test_http_403_logs_diagnostics_without_secret_or_body(self):
        headers={'Server':'cloudflare','CF-Ray':'abc123-FRA','Content-Type':'text/html; charset=UTF-8'}
        err=urllib.error.HTTPError('https://monitor.nnot.de/api/quality/config',403,'Forbidden',headers,io.BytesIO(b'<html>hidden</html>'))
        output=io.StringIO()
        with patch.object(collector.OPENER,'open',side_effect=err):
            with contextlib.redirect_stdout(output):
                with self.assertRaises(urllib.error.HTTPError):
                    collector.request('/api/quality/config','00000000-0000-0000-0000-000000000000','sample-secret-NEVER-LOG')
        obj=json.loads(output.getvalue())
        self.assertEqual(obj['event'],'api_http_error')
        self.assertEqual(obj['status'],403)
        self.assertEqual(obj['cf_ray'],'abc123-FRA')
        self.assertEqual(obj['content_type'],'text/html')
        self.assertNotIn('sample-secret-NEVER-LOG',output.getvalue())
        self.assertNotIn('hidden',output.getvalue())

    def test_error_logger_cannot_shadow_exception_details(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            collector.note('fatal',error='HTTPError',detail='HTTP Error 403')
        self.assertEqual(json.loads(output.getvalue())['error'],'HTTPError')

if __name__ == '__main__':
    unittest.main()
