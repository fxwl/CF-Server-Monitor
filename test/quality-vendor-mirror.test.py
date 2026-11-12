#!/usr/bin/env python3
"""Ensure China-friendly first-party vendor mirrors retain reviewed upstream bytes."""
import hashlib
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
VENDOR=ROOT/'public'/'quality'/'vendor'
LOCK={'ip.sh':'4dad5782d4095ed214b821951eba39353b5e0da4',
      'net.sh':'3f53747f00e6a00fe39534280a1c1dc6b71abbad'}

class VendorMirrorTests(unittest.TestCase):
    def test_pinned_scripts_are_verbatim_upstream(self):
        for filename,expected in LOCK.items():
            with self.subTest(filename=filename):
                data=(VENDOR/filename).read_bytes()
                digest=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
                self.assertEqual(digest,expected)
                p=subprocess.run(['bash','-n',str(VENDOR/filename)],capture_output=True,text=True)
                self.assertEqual(p.returncode,0,p.stderr)

    def test_agpl_attribution_is_retained(self):
        self.assertIn('GNU AFFERO GENERAL PUBLIC LICENSE',(VENDOR/'LICENSE').read_text())
        self.assertIn('xykt/IPQuality',(VENDOR/'README.md').read_text())
        self.assertIn('xykt/NetQuality',(VENDOR/'README.md').read_text())

    def test_installer_prefers_verified_first_party_sources(self):
        text=(ROOT/'public'/'quality'/'install.sh').read_text()
        self.assertIn('https://monitor.nnot.de/quality/vendor/$name',text)
        for expected in LOCK.values():self.assertIn(expected,text)
        self.assertIn('CFSM_QUALITY_TRY_NEXTTRACE_GITHUB',text)
        self.assertIn('bash -n "$target"',text)

if __name__=='__main__':unittest.main()
