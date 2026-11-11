import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {publicIP,finite,tri,asns,selectedTargets,TARGETS,LABELS,ORDER,normalizeProxycheck,normalizeIpapi,normalizeIpwho,normalizeIpinfo,qualityEvidence,validateReport,classifyRoute,routeChanges,limitedJson,secretEqual} from '../src/netdiag/core.js';
import {ensureSchema,handleNetworkAPI,refreshQuality,maintain,summarizeHomeServer} from '../src/netdiag/service.js';
import {getHomeQuality,getHomeRoutes,homeRouteSummary,readableAsn,readableLine,routeEndpointStatus} from '../public/netdiag/home.js';

const IP='94.24.39.45';
const SECRET='test-only-not-a-production-credential-123456789';
class D1 {
  constructor(){this.sqlite=new DatabaseSync(':memory:');}
  prepare(sql){const db=this;return {sql,args:[],bind(...args){this.args=args;return this;},async first(){return db.sqlite.prepare(sql).get(...this.args)||null;},async all(){return {success:true,results:db.sqlite.prepare(sql).all(...this.args)};},async run(){const r=db.sqlite.prepare(sql).run(...this.args);return{success:true,meta:{changes:Number(r.changes)}};}};}
  async batch(statements){this.sqlite.exec('BEGIN');try{const out=[];for(const s of statements){const r=this.sqlite.prepare(s.sql).run(...s.args);out.push({success:true,meta:{changes:Number(r.changes)}});}this.sqlite.exec('COMMIT');return out;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
async function setup(){const db=new D1();db.sqlite.exec('CREATE TABLE servers(id TEXT PRIMARY KEY,name TEXT,region TEXT,sort_order INTEGER,history_partition_id INTEGER DEFAULT 0);CREATE TABLE metrics_history(id INTEGER PRIMARY KEY,server_id TEXT,ip_v4 TEXT,ip_v6 TEXT,timestamp INTEGER,cpu REAL,net_rx REAL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);');db.sqlite.prepare('INSERT INTO servers(id,name,region,sort_order) VALUES(?,?,?,?)').run('server-1','Demo','ES',0);db.sqlite.prepare('INSERT INTO servers(id,name,region,sort_order) VALUES(?,?,?,?)').run('server-2','Second','DE',1);db.sqlite.prepare('INSERT INTO metrics_history VALUES(?,?,?,?,?,?,?)').run(1,'server-1',IP,'0',Date.now(),12.5,123456);db.sqlite.prepare('INSERT INTO metrics_history VALUES(?,?,?,?,?,?,?)').run(2,'server-2','62.84.164.140','0',Date.now(),3,34567);db.sqlite.prepare('INSERT INTO settings VALUES(?,?)').run('site_options','{"is_public":"false"}');await ensureSchema(db);return {DB:db,API_SECRET:SECRET};}
const SYS={custom_ct_name:LABELS.cu,custom_ct:'36.248.48.210:80',custom_cu_name:LABELS.ct,custom_cu:'fj-fuzhou-ct-v4.ip.zstaticcdn.com:80',custom_cm_name:LABELS.cm,custom_cm:'csfw.fj.chinamobile.com:8080'};
const deps={loadSettings:async()=>SYS,checkAuth:async r=>r.headers.get('Authorization')==='Bearer admin-test'};
function request(path,options={}){const {admin=true,agent=false,server='server-1',source=IP,body,origin='https://monitor.nnot.de',headers={},...extra}=options;return new Request('https://monitor.nnot.de'+path,{method:body===undefined?'GET':'POST',...extra,headers:{...(admin?{Authorization:'Bearer admin-test'}:{}),...(agent?{Authorization:'Bearer '+SECRET,'X-CFSM-Server-ID':server,'CF-Connecting-IP':source}:{}),Origin:origin,'X-CFSM-Netdiag':'1','Content-Type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});}
function report(){return{schema_version:1,version:'1.0.0',run_id:crypto.randomUUID(),started_at:Date.now(),routes:TARGETS.map((t,i)=>({...t,target_ip:i===0?t.host:i===1?'203.55.129.248':'112.48.173.86',status:'partial',hops:[{ttl:1,ip:'10.0.0.1',asns:[9929],rtts_ms:[1],annotation:''},{ttl:2,ip:'218.105.2.1',asns:[9929],rtts_ms:[38],annotation:''}],tcp:{attempts:3,successes:3,median_ms:39},duration_ms:100}))};}
function providerMock(){const calls=[];const fetcher=async(url,options={})=>{
  calls.push({url,options});const endpoint=new URL(url),host=endpoint.hostname;
  const ip=host==='proxycheck.io'?decodeURIComponent(endpoint.pathname.split('/').at(-1))
    :host==='ipwho.is'?decodeURIComponent(endpoint.pathname.slice(1))
    :host==='ipinfo.io'?decodeURIComponent(endpoint.pathname.split('/')[1])
    :options.body?JSON.parse(options.body).q:endpoint.searchParams.get('q');
  if(host==='proxycheck.io')return Response.json({status:'ok',[ip]:{network:{asn:'AS198454',organisation:'Example ISP',type:'Business'},location:{country_name:'Spain',country_code:'ES',region_name:'Andalucia',city_name:'Cartama'},detections:{risk:0,confidence:90,proxy:false,vpn:false,hosting:false}}});
  if(host==='ipwho.is')return Response.json({ip,success:true,country:'Spain',country_code:'ES',region:'Andalucia',city:'Cartama',connection:{asn:198454,org:'Example ISP',isp:'Example ISP'}});
  if(host==='ipinfo.io')return Response.json({ip,org:'AS198454 Example ISP',country:'ES',region:'Andalucia',city:'Cartama'});
  return Response.json({ip,company_name:'Example ISP',asn_num:198454,asn_org:'Example ISP',cc:'ES',is_proxy:false,is_vpn:false,is_datacenter:null});
};return{calls,fetcher};}

for(const ip of ['127.0.0.1','10.0.0.5','172.16.4.2','192.168.1.1','169.254.169.254','100.64.0.1','198.18.1.2','192.0.2.8','198.51.100.2','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1','2001:db8::1','fe80::1','fc00::1','example.com','94.24.39.45%eth0'])test('non-public target rejected '+ip,()=>assert.equal(publicIP(ip),false));
test('public addresses accepted',()=>{assert.equal(publicIP(IP),true);assert.equal(publicIP('2606:4700:4700::1111'),true);});
test('null, boolean and empty values are not risk scores',()=>{for(const v of [null,undefined,'',true,false,{},[],'n/a'])assert.equal(finite(v),null);assert.equal(finite(0),0);assert.equal(finite('33'),33);assert.equal(tri('false'),null);assert.deepEqual(asns([true,9929,'4837',9929]),[9929,4837]);});
test('preserves CU/CT/CM semantics despite swapped storage slots',()=>{const t=selectedTargets(SYS);assert.deepEqual(t.map(x=>x.key),ORDER);assert.equal(t[0].metricKey,'ct');assert.equal(t[1].metricKey,'cu');assert.equal(t[0].host,'36.248.48.210');});
test('ignores arbitrary targets in settings',()=>{const t=selectedTargets({...SYS,custom_ct:'169.254.169.254:80'});assert.equal(t[0].host,TARGETS[0].host);});
test('proxycheck provider risk and missing flags stay distinct',()=>{const r=normalizeProxycheck({status:'warning',[IP]:{network:{asn:'AS198454'},location:{},detections:{risk:33,hosting:true,proxy:false}}},IP);assert.equal(r.risk,33);assert.equal(r.flags.proxy,false);assert.equal(r.flags.vpn,null);assert.equal(r.flags.hosting,true);assert.equal(r.warning,'provider_warning');});
test('provider failures are not clean results',()=>assert.throws(()=>normalizeProxycheck({status:'denied'},IP)));
test('ipapi minimal current and legacy schemas supported',()=>{const a=normalizeIpapi({ip:IP,company_name:'ISP',asn_num:198454,cc:'ES',is_proxy:false},IP);assert.equal(a.asn,'AS198454');assert.equal(a.operator,'ISP');assert.equal(a.country_code,'ES');assert.equal(a.flags.proxy,false);assert.equal(a.flags.vpn,null);assert.equal(a.risk,null);const b=normalizeIpapi({ip:IP,asn:'AS198454 ISP',company:'ISP',city:'Cartama'},IP);assert.equal(b.city,'Cartama');assert.equal(b.operator,'ISP');});
test('ipapi full response is normalized without inventing score',()=>{const p=normalizeIpapi({ip:IP,asn:{asn:9929,type:'isp'},company:{name:'ISP',abuser_score:'0.01'},location:{country:'Spain'},is_datacenter:false},IP);assert.equal(p.asn,'AS9929');assert.equal(p.network_abuse_score,'0.01');assert.equal(p.risk,null);});
test('line identification is evidence based',()=>{const r=validateReport(report(),TARGETS);assert.deepEqual(r.routes.map(t=>t.key),ORDER);assert.equal(r.routes[0].hops[0].asns.length,0);assert.match(r.routes[0].line.labels[0],/9929/);assert.match(r.routes[0].line.caveat,/不能直接证明/);assert.equal(classifyRoute({hops:[]}).confidence,'unknown');});
test('invalid payload fields and remote target changes rejected',()=>{const a=report();a.routes[0].host='127.0.0.1';assert.throws(()=>validateReport(a,TARGETS),/target_config_changed/);const b=report();b.routes[1].target_ip='169.254.169.254';assert.throws(()=>validateReport(b,TARGETS),/non_public/);const c=report();c.routes[0].hops[1].ttl=1;assert.throws(()=>validateReport(c,TARGETS),/hop_ttl/);});
test('incomplete observations never claim definitive route change',()=>{const a=report(),b=report();b.routes[0].hops[1].ip='218.105.2.2';assert.equal(routeChanges(a,b)[0].status,'observed_path_changed');b.routes[0].target_ip='36.250.1.90';assert.equal(routeChanges(a,b)[0].status,'target_changed');});
test('bounded JSON counts real body not just Content-Length',async()=>{await assert.rejects(()=>limitedJson(new Response('x'.repeat(100)),20),/payload_too_large/);await assert.rejects(()=>limitedJson(new Response('invalid')),/invalid_json/);assert.deepEqual(await limitedJson(Response.json({a:1})),{a:1});});
test('constant-time authenticated secret comparison',async()=>{assert.equal(await secretEqual(SECRET,SECRET),true);assert.equal(await secretEqual(SECRET,SECRET+'x'),false);assert.equal(await secretEqual('', ''),false);});
test('overview protected even if a public dashboard were enabled',async()=>{const env=await setup();const res=await handleNetworkAPI(request('/api/netdiag/overview',{admin:false}),env,{},deps);assert.equal(res.status,401);});
test('overview orders targets and exposes no secret',async()=>{const env=await setup();const res=await handleNetworkAPI(request('/api/netdiag/overview'),env,{},deps);const data=await res.json();assert.equal(res.status,200);assert.deepEqual(data.order,ORDER);assert.equal(data.servers[0].collector_installed,false);assert.equal(data.features.root_required,false);assert.ok(!JSON.stringify(data).includes(SECRET));});
test('POST admin endpoint enforces origin and custom header',async()=>{const env=await setup();const res=await handleNetworkAPI(request('/api/netdiag/refresh',{body:{server_id:'server-1'},origin:'https://attacker.invalid'}),env,{},deps);assert.equal(res.status,403);const missing=await handleNetworkAPI(request('/api/netdiag/refresh',{body:{server_id:'server-1'},headers:{'X-CFSM-Netdiag':''}}),env,{},deps);assert.equal(missing.status,403);});
test('agent config needs its token and registered source',async()=>{const env=await setup();const good=await handleNetworkAPI(request('/api/netdiag/config?id=server-1',{agent:true}),env,{},deps);assert.equal(good.status,200);assert.deepEqual((await good.json()).targets.map(x=>x.key),ORDER);const bad=await handleNetworkAPI(request('/api/netdiag/config?id=server-1',{agent:true,source:'8.8.8.8'}),env,{},deps);assert.equal(bad.status,403);});
test('reports are idempotent, scoped, bounded and rate limited',async()=>{const env=await setup();const body=report();const res=await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body}),env,{},deps);assert.equal(res.status,200);assert.equal((await res.json()).accepted,true);const duplicate=await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body}),env,{},deps);assert.equal((await duplicate.json()).duplicate,true);const retry=await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body:report()}),env,{},deps);assert.equal(retry.status,429);assert.equal(retry.headers.get('Retry-After'),'600');const second=await handleNetworkAPI(request('/api/netdiag/report',{agent:true,server:'server-2',source:'62.84.164.140',body}),env,{},deps);assert.equal(second.status,200);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM netdiag_runs').get().n,2);});
test('new features never delete CPU/traffic data or settings',async()=>{const env=await setup();const before=env.DB.sqlite.prepare('SELECT * FROM metrics_history').all();await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body:report()}),env,{},deps);const m=providerMock();await refreshQuality(env,'server-1',m.fetcher);assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM metrics_history').all(),before);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM servers').get().n,2);assert.equal(env.DB.sqlite.prepare('SELECT value FROM settings').get().value,'{"is_public":"false"}');});
test('IP quality makes four source queries and caches subsequent access',async()=>{const env=await setup();const m=providerMock();const first=await refreshQuality(env,'server-1',m.fetcher);assert.equal(first.result.status,'complete');assert.equal(first.result.providers[0].risk,0);assert.equal(m.calls.length,4);const again=await refreshQuality(env,'server-1',m.fetcher);assert.equal(again.cached,true);assert.equal(m.calls.length,4);assert.ok(m.calls[0].url.includes('ver=24-June-2026'));});
test('configured ipapi key uses JSON POST and never client response',async()=>{const env=await setup();env.NETDIAG_IPAPI_KEY='fake-provider-key';const m=providerMock();const result=await refreshQuality(env,'server-1',m.fetcher);const call=m.calls.find(x=>x.url.startsWith('https://api.ipapi.is'));assert.equal(call.options.method,'POST');assert.ok(!call.url.includes('fake-provider-key'));assert.equal(JSON.parse(call.options.body).key,'fake-provider-key');assert.ok(!JSON.stringify(result).includes('fake-provider-key'));});
test('external outages have unavailable states, not zero scores',async()=>{const env=await setup();const result=await refreshQuality(env,'server-1',async()=>new Response('busy',{status:429}));assert.equal(result.result.status,'unavailable');assert.ok(result.result.providers.every(p=>p.status==='unavailable'&&p.risk===undefined));});
test('daily source budgets prevent additional external requests',async()=>{const env=await setup();const day=new Date().toISOString().slice(0,10);env.DB.sqlite.prepare('INSERT INTO netdiag_budget VALUES(?,?,?)').run('proxycheck.io',day,80);env.DB.sqlite.prepare('INSERT INTO netdiag_budget VALUES(?,?,?)').run('ipapi.is',day,20);for(const name of ['ipwho.is','IPinfo'])env.DB.sqlite.prepare('INSERT INTO netdiag_budget VALUES(?,?,?)').run(name,day,40);let calls=0;const result=await refreshQuality(env,'server-1',async()=>{calls++;throw Error('must not fetch');});assert.equal(calls,0);assert.ok(result.result.providers.every(p=>p.error==='daily_budget_exhausted'));});
test('arbitrary IP lookup and stale IP input are rejected',async()=>{const env=await setup();await assert.rejects(()=>refreshQuality(env,'8.8.8.8'),/invalid_server_id/);env.DB.sqlite.prepare('UPDATE metrics_history SET timestamp=? WHERE server_id=?').run(Date.now()-3*86400000,'server-1');await assert.rejects(()=>refreshQuality(env,'server-1'),/agent_ip_stale/);});
test('route history reads only requested server and valid kind',async()=>{const env=await setup();await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body:report()}),env,{},deps);const res=await handleNetworkAPI(request('/api/netdiag/history?id=server-1&kind=route&limit=2.8'),env,{},deps);assert.equal(res.status,200);assert.equal((await res.json()).records.length,1);const bad=await handleNetworkAPI(request('/api/netdiag/history?id=server-1&kind=all'),env,{},deps);assert.equal(bad.status,400);});
test('maintenance retention touches only its own tables',async()=>{const env=await setup();env.DB.sqlite.prepare('INSERT INTO netdiag_runs VALUES(?,?,?,?,?,?,?)').run('old','server-1','route',Date.now()-40*86400000,IP,'partial','{}');const m=providerMock();await maintain(env,{fetch:m.fetcher});assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM netdiag_runs WHERE id=?').get('old').n,0);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM metrics_history').get().n,2);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM netdiag_runs WHERE kind='quality'").get().n,2);});
test('installer checksum and constraints match released collector',async()=>{const crypto=await import('node:crypto');const root=new URL('../public/netdiag/',import.meta.url);const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(new URL(file,root))).digest('hex');assert.equal(hash('collector.py'),manifest.collector_sha256);assert.equal(hash('install.sh'),manifest.install_sha256);const install=fs.readFileSync(new URL('install.sh',root),'utf8');assert.ok(install.includes("EXPECTED_COLLECTOR='"+manifest.collector_sha256+"'"));assert.ok(!install.includes('CapabilityBoundingSet='));assert.ok(!install.includes('systemctl restart cf-probe'));assert.ok(install.includes('NoNewPrivileges=yes'));});

test('uses the existing history primary-key partition without new indexes',async()=>{const env=await setup();env.DB.sqlite.prepare('UPDATE servers SET history_partition_id=1 WHERE id=?').run('server-1');env.DB.sqlite.prepare('UPDATE metrics_history SET id=? WHERE server_id=?').run(10261111123456,'server-1');const m=providerMock();const result=await refreshQuality(env,'server-1',m.fetcher);assert.equal(result.result.ip,IP);});

// Keep security headers on the diagnostic page; ASSETS resolves the directory index without a redirect loop.
test('diagnostic assets use selective Worker-first routing and a directory index',()=>{
  const config=fs.readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
  const entry=fs.readFileSync(new URL('../src/network-entry.js',import.meta.url),'utf8');
  assert.ok(config.includes('run_worker_first = ["/", "/netdiag", "/netdiag/*", "/api/netdiag/*"]'));
  assert.ok(entry.includes("const homepage=path==='/';"));
  assert.ok(entry.includes("src=\"/netdiag/assets/home.js\""));
  assert.ok(!entry.includes("e.prepend('<section"));
  assert.ok(entry.includes("file==='index.html'?'/netdiag/'"));
  assert.ok(entry.includes("path==='/netdiag/index.html'"));
});


test('homepage summary obeys site visibility without unlocking admin overview',async()=>{
  const env=await setup();
  const publicDeps={...deps,loadSettings:async()=>({...SYS,is_public:'true'})};
  const home=await handleNetworkAPI(request('/api/netdiag/home',{admin:false}),env,{},publicDeps);
  assert.equal(home.status,200);
  const body=await home.json();
  assert.deepEqual(body.order,['cu','ct','cm']);
  assert.equal(body.servers.length,2);
  assert.equal(body.servers[0].name,'Demo');
  assert.equal(body.servers[0].ip,IP);
  assert.equal(body.servers[0].route,null);
  assert.equal(body.servers[0].quality,null);
  const adminOverview=await handleNetworkAPI(request('/api/netdiag/overview',{admin:false}),env,{},publicDeps);
  assert.equal(adminOverview.status,401);
  assert.ok(!JSON.stringify(body).includes(SECRET));
  const privateHome=await handleNetworkAPI(request('/api/netdiag/home',{admin:false}),env,{},deps);
  assert.equal(privateHome.status,401);
});

test('homepage respects hidden servers for public viewers',async()=>{
  const env=await setup();
  env.DB.sqlite.exec("ALTER TABLE servers ADD COLUMN is_hidden TEXT DEFAULT '0'");
  env.DB.sqlite.prepare('UPDATE servers SET is_hidden=? WHERE id=?').run('1','server-2');
  const publicDeps={...deps,loadSettings:async()=>({...SYS,is_public:'true'})};
  const guest=await handleNetworkAPI(request('/api/netdiag/home',{admin:false}),env,{},publicDeps);
  assert.deepEqual((await guest.json()).servers.map(x=>x.id),['server-1']);
  const admin=await handleNetworkAPI(request('/api/netdiag/home'),env,{},publicDeps);
  assert.deepEqual((await admin.json()).servers.map(x=>x.id),['server-1','server-2']);
});

test('homepage includes carrier summaries but never reveals raw network trace hops',async()=>{
  const env=await setup();
  const p=providerMock();
  await refreshQuality(env,'server-1',p.fetcher);
  const reportBody=report();
  const accepted=await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body:reportBody}),env,{},deps);
  assert.equal(accepted.status,200);
  const home=await handleNetworkAPI(request('/api/netdiag/home'),env,{},deps);
  assert.equal(home.status,200);
  const body=await home.json();
  const server=body.servers[0];
  assert.equal(server.quality.providers.length,2);
  assert.equal(server.quality.providers[0].risk,0);
  assert.equal(server.quality.providers[0].flags.proxy,false);
  assert.equal(server.route.routes.length,3);
  assert.deepEqual(server.route.routes.map(x=>x.key),['cu','ct','cm']);
  assert.equal(server.route.routes[0].median_ms,39);
  assert.ok(server.route.routes[0].lines[0].includes('9929'));
  assert.ok(!JSON.stringify(server).includes('218.105.2.1'));
  assert.ok(!JSON.stringify(server).includes('hops'));
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM metrics_history').get().n,2);
});

test('homepage marks changed IP or old observations stale rather than treating them as current',()=>{
  const report={ip:IP,created_at:100,status:'complete',routes:[{key:'cu',status:'complete',reached:true,line:{labels:['CN2']},tcp:{median_ms:40}}]};
  const summary=summarizeHomeServer({id:'abc',name:'Demo',region:'DE'}, {ip:'62.84.164.140',seen_at:300}, null, report,1000);
  assert.equal(summary.route.stale,true);
  assert.equal(summary.route.routes[0].lines[0],'CN2');
  assert.equal(summary.route.routes[1].status,'pending');
  assert.deepEqual(Object.keys(summary.route.routes[0]).sort(),['change','confidence','key','lines','median_ms','reached','status'].sort());
});

test('homepage presentation keeps unknown flags distinct from false and preserves operator ordering',()=>{
  const data=getHomeQuality({providers:[
    {provider:'A',status:'ok',asn:'AS9929',risk:0,flags:{proxy:false,vpn:null,hosting:false}},
    {provider:'B',status:'ok',risk:null,flags:{proxy:true,hosting:null}}
  ]});
  assert.equal(data.risk.risk,0);
  assert.equal(data.flags.proxy.value,'mixed');
  assert.equal(data.flags.vpn.value,null);
  assert.equal(data.flags.hosting.value,false);
  assert.deepEqual(getHomeRoutes({routes:[{key:'cm',status:'complete'},{key:'cu',status:'partial'}]}).map(x=>x.key),['cu','ct','cm']);
  assert.equal(homeRouteSummary({stale:true,status:'complete'}),'历史结果');
});

test('NQ-inspired geo-only providers do not fabricate proxy or risk metrics',()=>{
  const a=normalizeIpwho({ip:IP,success:true,connection:{asn:198454,org:'Telecom Business'},city:'Cartama',country:'Spain',country_code:'ES'},IP);
  const b=normalizeIpinfo({ip:IP,org:'AS198454 Telecom Business',country:'ES',city:'Cartama'},IP);
  assert.equal(a.risk,null);assert.equal(b.risk,null);assert.equal(a.flags.proxy,null);
  assert.equal(qualityEvidence([a,b]).asn_agreement,'consistent');
  assert.equal(qualityEvidence([a,b]).flags.proxy.status,'unknown');
  assert.equal(qualityEvidence([{provider:'A',status:'ok',flags:{proxy:true}},{provider:'B',status:'ok',flags:{proxy:false}}]).flags.proxy.status,'disputed');
});
test('TQ-inspired TCP samples and public hop geo metadata are validated',()=>{
  const body=report();body.routes[0].tcp={attempts:5,successes:4,median_ms:159.1,min_ms:152,max_ms:169,jitter_ms:3.1};
  body.routes[0].hops[0].geo={city:'Fake private city'};
  body.routes[0].hops[1].geo={country:'China',region:'Fujian',city:'Fuzhou',isp:'China Unicom'};
  const route=validateReport(body,TARGETS).routes[0];
  assert.equal(route.tcp.success_pct,80);assert.equal(route.tcp.jitter_ms,3.1);
  assert.equal(route.hops[0].geo,null);assert.equal(route.hops[1].geo.city,'Fuzhou');
  assert.match(route.line.summary,/联通/);
  body.routes[0].tcp.successes=6;assert.throws(()=>validateReport(body,TARGETS),/invalid_tcp_counts/);
});
test('theme-specific deployment embeds in existing cards, not a top-level network dashboard',()=>{
  const entry=fs.readFileSync(new URL('../src/network-entry.js',import.meta.url),'utf8');
  const home=fs.readFileSync(new URL('../public/netdiag/home.js',import.meta.url),'utf8');
  assert.ok(home.includes('article.server-card[id^="node-card-"]'));
  assert.ok(home.includes('article.compact-node-card[id^="node-card-"]'));
  assert.ok(home.includes('a.node-list-row[id^="node-card-"]'));
  assert.ok(home.includes("card.querySelector('.server-card-stack')"));
  assert.ok(!entry.includes("e.prepend('<section"));
  assert.equal(readableAsn(9929),'联通精品网 9929');
  assert.match(readableLine({lines:['China Unicom AS9929']}),/联通精品网/);
  assert.equal(routeEndpointStatus({reached:false,status:'partial'}),'目标未确认到达');
});
test('public homepage hides private traceroute hops while retaining meaningful ASN and geo labels',async()=>{
  const env=await setup();await handleNetworkAPI(request('/api/netdiag/report',{agent:true,body:report()}),env,{},deps);
  const res=await handleNetworkAPI(request('/api/netdiag/home'),env,{},deps),body=await res.json();
  const route=body.servers[0].route.routes[0];
  assert.ok(route.visible_hops.length>0);
  assert.ok(route.visible_hops.every(h=>!h.ip.startsWith('10.')));
  assert.match(route.summary,/联通/);
});
