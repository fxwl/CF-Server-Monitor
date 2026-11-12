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

function qualityDB(region=''){
  const values=new Map(),server={id,name:'Test VPS',is_hidden:0,region};
  const reports=[{id:'saved',server_id:id,kind:'ip',source_ip:'1.1.1.1',created_at:now,payload:JSON.stringify({ip:'1.1.1.1',report:{Head:{IP:'1.1.1.1'},Info:{},Score:{}}})}];
  return {values,server,db:{
    async batch(){return[]},
    prepare(sql){return {
      params:[],
      bind(...p){this.params=p;return this},
      async first(){
        if(sql.includes('FROM servers WHERE id=?'))return server;
        if(sql.includes('SELECT value FROM cfsm_quality_options WHERE key=?'))
          return values.has(this.params[0])?{value:values.get(this.params[0])}:null;
        return null;
      },
      async all(){
        if(sql.includes("key LIKE 'country:%'"))
          return {results:[...values.entries()].filter(([k])=>k.startsWith('country:')).map(([key,value])=>({key,value}))};
        if(sql.includes("key LIKE 'server:%'"))return {results:[]};
        if(sql.includes('FROM servers'))return {results:[server]};
        if(sql.includes('FROM cfsm_quality_runs'))return {results:reports};
        return {results:[]};
      },
      async run(){
        if(sql.includes('INSERT INTO cfsm_quality_options'))values.set(this.params[0],this.params[1]);
        return {};
      }
    }}
  }};
}
const credentials={
  'Authorization':'Bearer quality-test-secret-123456789',
  'X-CFSM-Server-ID':id,
  'CF-Connecting-IP':'1.1.1.1'
};
const apiEnv=db=>({API_SECRET:'quality-test-secret-123456789',DB:db});
function agentConfig(country=null,headers=credentials){
  const req=new Request('https://monitor.nnot.de/api/quality/config',{headers});
  if(country)Object.defineProperty(req,'cf',{value:{country}});
  return req;
}
const settings=async()=>({is_public:'true'}),notAdmin=async()=>false,yesAdmin=async()=>true;
test('authenticated CN ingress skips both diagnostic kinds, stores CN, and suppresses stale data',async()=>{
  const {db,values}=qualityDB('');
  const env=apiEnv(db);
  const r=await handleIndependentQuality(agentConfig('CN'),env,settings,notAdmin);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.source_ipv4,'1.1.1.1');
  assert.equal(data.source_country,'CN');
  assert.equal(data.schedule.enabled,false);
  assert.equal(data.schedule.skip_reason,'country_cn');
  assert.equal(JSON.parse(values.get('country:'+id)),'CN');
  const home=await handleIndependentQuality(new Request('https://monitor.nnot.de/api/quality/home'),env,settings,notAdmin);
  const homeData=await home.json();
  assert.deepEqual(homeData.disabled_server_ids,[id]);
  assert.deepEqual(homeData.servers,{});
  const detail=await handleIndependentQuality(new Request('https://monitor.nnot.de/api/quality/detail?id='+id),env,settings,notAdmin);
  assert.equal((await detail.json()).disabled,true);
  const request=await handleIndependentQuality(new Request('https://monitor.nnot.de/api/quality/request',{
    method:'POST',body:JSON.stringify({id,kind:'ip'})
  }),env,settings,yesAdmin);
  assert.equal(request.status,409);
  assert.equal((await request.json()).error,'domestic_quality_disabled');
  const report=await handleIndependentQuality(new Request('https://monitor.nnot.de/api/quality/report',{
    method:'POST',headers:credentials,body:'{}'
  }),env,settings,notAdmin);
  assert.equal(report.status,409);
});
test('manually marked CN region skips even when Cloudflare observes a US exit',async()=>{
  const {db}=qualityDB('cn');
  const r=await handleIndependentQuality(agentConfig('US'),apiEnv(db),settings,notAdmin);
  const data=await r.json();
  assert.equal(data.schedule.enabled,false);
  assert.equal(data.schedule.skip_reason,'country_cn');
});
test('non-CN nodes remain enabled, and country updates reenable a moved node',async()=>{
  const {db}=qualityDB('');
  let r=await handleIndependentQuality(agentConfig('CN'),apiEnv(db),settings,notAdmin);
  assert.equal((await r.json()).schedule.enabled,false);
  r=await handleIndependentQuality(agentConfig('US'),apiEnv(db),settings,notAdmin);
  const data=await r.json();
  assert.equal(data.schedule.enabled,true);
  assert.equal(data.schedule.skip_reason,null);
  r=await handleIndependentQuality(new Request('https://monitor.nnot.de/api/quality/home'),apiEnv(db),settings,notAdmin);
  const home=await r.json();
  assert.deepEqual(home.disabled_server_ids,[]);
  assert.ok(home.servers[id].ip);
});
test('CN region is excluded before first quality config is fetched',async()=>{
  const {db}=qualityDB('CN');
  const r=await handleIndependentQuality(new Request('https://monitor.nnot.de/api/quality/home'),apiEnv(db),settings,notAdmin);
  assert.deepEqual((await r.json()).disabled_server_ids,[id]);
});
test('agent IPv6 fallback and invalid authentication are unchanged',async()=>{
  const {db}=qualityDB('US');
  const headers={...credentials,'CF-Connecting-IP':'2001:db8::1'};
  const ok=await handleIndependentQuality(agentConfig(null,headers),apiEnv(db),settings,notAdmin);
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).source_ipv4,null);
  headers.Authorization='Bearer incorrect-secret';
  const bad=await handleIndependentQuality(agentConfig(null,headers),apiEnv(db),settings,notAdmin);
  assert.equal(bad.status,401);
  assert.equal('source_ipv4' in await bad.json(),false);
});
