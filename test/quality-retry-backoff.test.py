#!/usr/bin/env python3
"""Guard sidecar retry backoff for mainland and international connectivity failures."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('quality',ROOT/'public'/'quality'/'collector.py')
quality=importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)

class RetryBackoffTests(unittest.TestCase):
    def test_failed_probes_wait_instead_of_running_every_15_minutes(self):
        seen=[]
        def failed_probe(kind,*args):
            seen.append(kind)
            return False
        with tempfile.TemporaryDirectory() as temp:
            with (patch.object(quality,'STATE',Path(temp)),
                  patch.object(quality,'creds',return_value=('0'*36,'fake-secret')),
                  patch.object(quality,'request',return_value={'schema_version':1,'schedule':{'enabled':True,'requested':{}}}),
                  patch.object(quality,'probe',side_effect=failed_probe),
                  patch.dict(os.environ,{'CFSM_QUALITY_FORCE':''})):
                self.assertEqual(quality.run(),1)
                self.assertEqual(seen,['ip','net'])
                state=json.loads((Path(temp)/'last-run.json').read_text())
                self.assertEqual(state['ip_retry']['failures'],1)
                self.assertEqual(state['net_retry']['failures'],1)
                self.assertEqual(quality.run(),0)
                self.assertEqual(seen,['ip','net'])

    def test_new_admin_request_overrides_backoff_once(self):
        seen=[]
        requests={'ip':1,'net':0}
        def failed_probe(kind,*args):
            seen.append(kind)
            return False
        def configuration(*args):
            return {'schema_version':1,'schedule':{'enabled':True,'requested':requests}}
        with tempfile.TemporaryDirectory() as temp:
            with (patch.object(quality,'STATE',Path(temp)),
                  patch.object(quality,'creds',return_value=('0'*36,'fake-secret')),
                  patch.object(quality,'request',side_effect=configuration),
                  patch.object(quality,'probe',side_effect=failed_probe),
                  patch.dict(os.environ,{'CFSM_QUALITY_FORCE':''})):
                self.assertEqual(quality.run(),1)
                requests['ip']=2
                self.assertEqual(quality.run(),1)
                self.assertEqual(seen,['ip','net','ip'])
                self.assertEqual(quality.run(),0)
                self.assertEqual(seen,['ip','net','ip'])

    def test_successful_probes_clear_retry_state(self):
        def successful_probe(kind,server,secret,state,*args):
            state[kind]=1_000_000_000_000_000
            return True
        with tempfile.TemporaryDirectory() as temp:
            state={'ip_retry':{'failures':4,'until':1,'request_id':0}}
            (Path(temp)/'last-run.json').write_text(json.dumps(state))
            with (patch.object(quality,'STATE',Path(temp)),
                  patch.object(quality,'creds',return_value=('0'*36,'fake-secret')),
                  patch.object(quality,'request',return_value={'schema_version':1,'schedule':{'enabled':True,'requested':{}}}),
                  patch.object(quality,'probe',side_effect=successful_probe),
                  patch.dict(os.environ,{'CFSM_QUALITY_FORCE':''})):
                self.assertEqual(quality.run(),0)
                final=json.loads((Path(temp)/'last-run.json').read_text())
                self.assertNotIn('ip_retry',final)
                self.assertIn('ip',final)
                self.assertIn('net',final)

if __name__=='__main__':
    unittest.main()
