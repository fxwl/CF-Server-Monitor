import importlib.util
import pathlib
import unittest
from unittest import mock

p=pathlib.Path(__file__).resolve().parents[1]/'public/netdiag/releases/1.3.0/collector.py'
spec=importlib.util.spec_from_file_location('media_probe',p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def result(code,body='',location='',err=None):
    return {'http_code':code,'body':body,'location':location,'elapsed_ms':123,'error':err}

class MediaTest(unittest.TestCase):
    def test_order_and_pinned_version(self):
        self.assertEqual(m.VERSION,'1.3.0')
        self.assertEqual(len(m.MEDIA_IDS),11)
        self.assertEqual(m.MEDIA_IDS[0],'netflix')
    def test_netflix_two_titles_not_just_homepage(self):
        original=result(200,'<title>Netflix title</title>')
        licensed=result(200,'<title>Netflix: Breaking Bad</title>')
        self.assertEqual(m.interpret_media('netflix',original,licensed)['status'],'catalog')
        self.assertEqual(m.interpret_media('netflix',original,result(404))['status'],'originals_only')
    def test_network_error_cannot_become_unlocked(self):
        self.assertEqual(m.interpret_media('claude',result(0,err='network_failed'))['status'],'network_error')
        self.assertEqual(m.interpret_media('chatgpt',result(403))['status'],'challenge')
    def test_login_not_a_claim_of_unlocked_ai(self):
        self.assertEqual(m.interpret_media('openai_api',result(401))['status'],'login_required')
        self.assertEqual(m.interpret_media('gemini',result(200))['status'],'reachable')
    def test_explicit_region_notice(self):
        self.assertEqual(m.interpret_media('youtube',result(200,'Premium is not available in your country'))['status'],'restricted')
    def test_probes_are_fixed_and_v4_only(self):
        with self.assertRaises(ValueError):
            m.probe_https('https://127.0.0.1/')
        with self.assertRaises(ValueError):
            m.probe_https('https://attacker.invalid/')
        self.assertNotIn('sudo',p.read_text())
    def test_quality_source_urls_are_literal_allowlisted(self):
        self.assertEqual(len(m.QUALITY_SOURCES),4)
        self.assertTrue(all(x.startswith('https://') for x in m.QUALITY_SOURCES.values()))
        with mock.patch.object(m,'json_request',return_value={'ip':'94.24.39.45'}) as req:
            out=m.collect_quality('94.24.39.45')
            self.assertEqual(len(out),4)
            self.assertEqual(req.call_count,4)
    def test_no_public_lookup_for_private_source(self):
        with mock.patch.object(m,'json_request',side_effect=AssertionError):
            self.assertEqual(m.collect_quality('10.0.0.1')['IPinfo']['error'],'ip_missing')

if __name__=='__main__':unittest.main()
