#!/usr/bin/env python3
"""Ensure China-friendly first-party vendor mirrors retain reviewed upstream bytes."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
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

    def test_auto_discovery_installer_waits_for_registered_id(self):
        # The real primary Go agent writes the SERVER_ID asynchronously after
        # receiving the authenticated /update response. No apt/network calls:
        # preflight validates credentials then exits.
        with tempfile.TemporaryDirectory() as work:
            root=Path(work)
            fakebin=root/'bin'
            fakebin.mkdir()
            fake_id=fakebin/'id'
            fake_id.write_text('#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else exec /usr/bin/id "$@"; fi\n')
            fake_id.chmod(0o755)
            config=root/'config.conf'
            secret='test-secret-1234567890'
            config.write_text(f'SERVER_ID=""\nSECRET="{secret}"\n')
            def register():
                time.sleep(0.3)
                config.write_text(f'SERVER_ID="b791a352-ef74-4c57-99cb-ae880ca9d018"\nSECRET="{secret}"\n')
            registration=threading.Thread(target=register)
            registration.start()
            env={**os.environ, 'PATH':str(fakebin)+os.pathsep+os.environ.get('PATH',''),
                 'CFSM_PROBE_CONFIG':str(config),
                 'CFSM_QUALITY_WAIT_FOR_REGISTRATION':'1',
                 'CFSM_QUALITY_PREFLIGHT_ONLY':'1'}
            try:
                result=subprocess.run(['bash',str(ROOT/'public'/'quality'/'install.sh')],
                                      env=env,capture_output=True,text=True,timeout=15)
            finally:
                registration.join()
            self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
            self.assertIn('preflight passed',result.stdout)

    def test_auto_discovery_without_wait_rejects_unbound_id(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work)
            fakebin=root/'bin'
            fakebin.mkdir()
            fake_id=fakebin/'id'
            fake_id.write_text('#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else exec /usr/bin/id "$@"; fi\n')
            fake_id.chmod(0o755)
            config=root/'config.conf'
            config.write_text('SERVER_ID=""\nSECRET="test-secret-1234567890"\n')
            env={**os.environ,'PATH':str(fakebin)+os.pathsep+os.environ.get('PATH',''),
                 'CFSM_PROBE_CONFIG':str(config),'CFSM_QUALITY_PREFLIGHT_ONLY':'1'}
            result=subprocess.run(['bash',str(ROOT/'public'/'quality'/'install.sh')],
                                  env=env,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,2,result.stdout+'\n'+result.stderr)
            self.assertIn('not registered',result.stderr)

if __name__=='__main__':unittest.main()
