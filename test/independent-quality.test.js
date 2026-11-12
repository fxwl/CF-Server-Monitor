import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiagnosticReport, handleIndependentQuality } from '../src/quality/independent-quality.js';

const id = 'b791a352-ef74-4c57-99cb-ae880ca9d018';
const now=Date.now();
const ipReport = () => ({
  schema_version:1,kind:'ip',run_id:id,started_at:now,
  report:{Head:{IP:'203.0.113.18'},Info:{Region:{Code:'ZZ'}},Score:{IPQS:'null',ipapi:'0,39%'},Factor:{Proxy:{IPQS:null},Tor:{IPQS:false}},Media:{ChatGPT:{Status:'解锁',Region:'',Type:'原生'}}}
});
const netReport = () => ({
  schema_version:1,kind:'net',run_id:id,started_at:now,
  report:{Head:{IP:'203.0.113.18'},BGP:{ASN:'64512'},Local:{TCPSendBuffer:'4096 16384 4194304'},Connectivity:[{ASN:64512}]},
  routes:[{city:'北京',carrier:'联通',text:'Unknown -> NoData'}],route_text:'完整观测报告'
});
test('IPQuality report preserves heterogeneous source values verbatim',()=>{
 const out=validateDiagnosticReport(ipReport(),'203.0.113.18',now);
 assert.equal(out.report.Score.ipapi,'0,39%');
 assert.equal(out.report.Score.IPQS,'null');
 assert.equal(out.report.Factor.Tor.IPQS,false);
 assert.equal(out.report.Media.ChatGPT.Region,'');
});
test('NetQuality retains original BGP, TCP and route observation',()=>{
 const out=validateDiagnosticReport(netReport(),'203.0.113.18',now);
 assert.equal(out.report.Local.TCPSendBuffer,'4096 16384 4194304');
 assert.equal(out.routes[0].text,'Unknown -> NoData');
 assert.equal(out.route_text,'完整观测报告');
});
test('cross-source spoofed IP is rejected',()=>{
 assert.throws(()=>validateDiagnosticReport(ipReport(),'198.51.100.91',now),/report_source_ip_mismatch/);
});
test('unexpected kind and outdated times rejected',()=>{
 assert.throws(()=>validateDiagnosticReport({...ipReport(),kind:'nq'},null,now),/invalid_report/);
 assert.throws(()=>validateDiagnosticReport({...ipReport(),started_at:now-20*86400000},null,now),/invalid_timestamp/);
});
test('domestic source country is retained without allowing arbitrary values',()=>{
  assert.equal(validateDiagnosticReport({...ipReport(),source_country:'CN'},null,now).source_country,'CN');
  assert.equal(validateDiagnosticReport({...ipReport(),source_country:'CN\nHeader: injected'},null,now).source_country,null);
});
test('malformed shell data rejected',()=>{
 assert.throws(()=>validateDiagnosticReport({...netReport(),report:{Head:{IP:'203.0.113.18'}}},null,now),/invalid_net_quality/);
});

const fakeQualityDB = {
  batch: async() => [],
  prepare(sql) {
    return {
      bind(...params) { this.params=params;return this; },
      async first() { return sql.includes('FROM servers') ? {id,name:'Test VPS',is_hidden:0} : null; }
    };
  }
};
test('authenticated quality config returns Cloudflare-observed IPv4',async()=>{
  const url='https://monitor.nnot.de/api/quality/config';
  const env={API_SECRET:'quality-test-secret-123456789',DB:fakeQualityDB};
  const headers={
    'Authorization':'Bearer quality-test-secret-123456789',
    'X-CFSM-Server-ID':id,
    'CF-Connecting-IP':'1.1.1.1'
  };
  const request=new Request(url,{headers});
  Object.defineProperty(request,'cf',{value:{country:'CN'}});
  const r=await handleIndependentQuality(request,env,
    async()=>{throw Error('unexpected config settings query')},
    async()=>{throw Error('unexpected admin auth')});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.schema_version,1);
  assert.equal(data.source_ipv4,'1.1.1.1');
  assert.equal(data.source_country,'CN');
  assert.equal(data.schedule.enabled,true);
});
test('quality config excludes IPv6 and does not expose source without valid auth',async()=>{
  const url='https://monitor.nnot.de/api/quality/config';
  const env={API_SECRET:'quality-test-secret-123456789',DB:fakeQualityDB};
  const headers={
    'Authorization':'Bearer quality-test-secret-123456789',
    'X-CFSM-Server-ID':id,'CF-Connecting-IP':'2001:db8::1'
  };
  const ok=await handleIndependentQuality(new Request(url,{headers}),env,async()=>null,async()=>false);
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).source_ipv4,null);
  headers.Authorization='Bearer incorrect-secret';
  const bad=await handleIndependentQuality(new Request(url,{headers}),env,async()=>null,async()=>false);
  assert.equal(bad.status,401);
  assert.equal('source_ipv4' in await bad.json(),false);
});
