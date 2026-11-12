import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiagnosticReport } from '../src/quality/independent-quality.js';

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
test('malformed shell data rejected',()=>{
 assert.throws(()=>validateDiagnosticReport({...netReport(),report:{Head:{IP:'203.0.113.18'}}},null,now),/invalid_net_quality/);
});
