import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

path=pathlib.Path(__file__).resolve().parents[1]/'public/netdiag/nq/runner.py'
spec=importlib.util.spec_from_file_location('runner',path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class WeeklyNQTests(unittest.TestCase):
    def test_full_four_sections_required_for_success(self):
        self.assertEqual(len(m.PARTS),4)
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            for p in m.PARTS:
                (root/(p+'.json')).write_text(json.dumps({'Head':{'Version':'pinned'},'Media':{'Netflix':{'Status':'Yes'}}}))
            self.assertEqual(sum(x is not None for x in m.capture(root).values()),4)
            (root/'hardware_quality.json').write_text('garbled json')
            self.assertEqual(sum(x is not None for x in m.capture(root).values()),3)
    def test_preserves_full_source_json(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            (root/'ip_quality.json').write_text('{"Score":{"IPQS":"null"},"Media":{"ChatGPT":{"Status":"No"}}}')
            result=m.capture(root)
            self.assertEqual(result['ip_quality']['Score']['IPQS'],'null')
            self.assertEqual(result['ip_quality']['Media']['ChatGPT']['Status'],'No')
    def test_malicious_redirect_and_proxy_are_disabled(self):
        self.assertEqual(m.URL,'https://monitor.nnot.de')
        self.assertEqual(m.REV,'a92fca6c0067df29ddd03fdc2fee6f3000f64545')
        self.assertTrue(m.NO_REDIRECT if hasattr(m,'NO_REDIRECT') else isinstance(m.OPENER.handlers[-1],object))
    def test_no_script_runs_during_import(self):
        source=path.read_text()
        self.assertIn("subprocess.run(['bash',str(SCRIPT),'-4','-D',str(WORK)]",source)
        self.assertIn("b'y\\ny\\ny\\ny\\n'",source)
        self.assertIn("server,token=config()",source)
        self.assertNotIn("api.nodequality.com",source)
    def test_does_not_attempt_root_required_work_as_normal_user(self):
        with mock.patch.object(m.os,'geteuid',return_value=1000):
            with self.assertRaisesRegex(ValueError,'requires_root'):m.make_state()
    def test_missing_file_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(all(v is None for v in m.capture(pathlib.Path(d)).values()))

if __name__=='__main__':unittest.main()
