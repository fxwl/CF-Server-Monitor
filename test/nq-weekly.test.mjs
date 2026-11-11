import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {NQ_REVISION,NQ_CRON,NQ_PARTS,validateNQReport,summarizeNQ,ensureNQSchema,saveNQ,latestNQ,nqHistory} from '../src/netdiag/nq-service.js';
import {handleStableApi} from '../src/netdiag/stable-service.js';
import {ensureSchema} from '../src/netdiag/service.js';
const IP='94.24.39.45';
class DB {
 constructor(){this.sql=new DatabaseSync(':memory:');}
 prepare(sql){const db=this;return{sql,args:[],bind(...args){this.args=args;return this;},
 async first(){return db.sql.prepare(sql).get(...this.args)||null;},
 async all(){return{results:db.sql.prepare(sql).all(...this.args)};},
 async run(){const x=db.sql.prepare(sql).run(...this.args);return{meta:{changes:Number(x.changes)}};}}}
 async batch(cmds){this.sql.exec('BEGIN');try{const r=cmds.map(x=>{const a=this.sql.prepare(x.sql).run(...x.args);return{meta:{changes:Number(a.changes)}};});this.sql.exec('COMMIT');return r;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
async function setup(){const DBx=new DB();DBx.sql.exec("CREATE TABLE servers(id TEXT PRIMARY KEY,name TEXT,region TEXT,sort_order INTEGER,history_partition_id INTEGER,ping_mode TEXT,is_hidden INTEGER);CREATE TABLE metrics_history(id INTEGER PRIMARY KEY,server_id TEXT,ip_v4 TEXT,ip_v6 TEXT,timestamp INTEGER,ping_cu REAL,ping_ct REAL,ping_cm REAL,loss_cu REAL,loss_ct REAL,loss_cm REAL);");
 DBx.sql.prepare('INSERT INTO servers VALUES(?,?,?,?,?,?,?)').run('server-1','Spain','ES',0,0,'icmp',0);
 DBx.sql.prepare('INSERT INTO metrics_history VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1,'server-1',IP,'',Date.now(),195,218,240,0,0,0);
 await ensureSchema(DBx);return{DB:DBx,API_SECRET:'secret-for-test-only-not-prod-123456789'};}
const deps={loadSettings:async()=>({is_public:'true'}),checkAuth:async r=>r.headers.get('Authorization')==='Bearer admin'};
function body(){return{schema_version:4,script_revision:NQ_REVISION,run_id:crypto.randomUUID(),ip:IP,started_at:Date.now(),
 sections:{ip_quality:{Info:{ASN:'198454',Organization:'Example ISP',City:{Name:'Cartama'},Region:{Name:'Spain'}},
  Score:{IPQS:'null',SCAMALYTICS:'21',ipapi:'0.47%',AbuseIPDB:'0'},Factor:{Proxy:{IPQS:false,IPinfo:null},VPN:{IPQS:false}},
  Media:{Netflix:{Status:'Yes',Region:'ES',Type:'Native'},ChatGPT:{Status:'Block',Region:'',Type:''}},
  Mail:{DNSBlacklist:{Total:440,Clean:439,Blacklisted:1}}},
  net_quality:{BGP:{ASN:'198454',Organization:'Example ISP'},Local:{TCPCongestionControl:'bbr',QueueDiscipline:'fq'},
   Delay:[{Code:'FJ',Name:'闽',CT:{Average:'218'},CU:{Average:'195'},CM:{Average:'240'}}]},
  hardware_quality:{OS:{name:'Debian 13',architecture:'x86_64'}},
  backroute_trace:{Route:['AS9929','AS4837']}}
};}
function request(path,{token=null,body=null}={}){const headers={Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json','X-CFSM-Server-ID':'server-1','CF-Connecting-IP':IP}:{})};
 return new Request('https://monitor.nnot.de/api/netdiag/'+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});}
test('weekly NQ uses exact Asia/Shanghai Friday 21:00 and a frozen upstream revision',()=>{
 assert.equal(NQ_CRON,'Fri *-*-* 21:00:00 Asia/Shanghai');
 assert.equal(NQ_REVISION,'a92fca6c0067df29ddd03fdc2fee6f3000f64545');
 assert.deepEqual(NQ_PARTS,['hardware_quality','ip_quality','net_quality','backroute_trace']);
 const installer=fs.readFileSync(new URL('../public/netdiag/nq/install.sh',import.meta.url),'utf8');
 assert.ok(installer.includes('OnCalendar=Fri *-*-* 21:00:00 Asia/Shanghai'));
 assert.ok(installer.includes('disable --now cfsm-netdiag.timer'));
});
test('quality keeps per-provider risk 0 distinct from null, and media with origins',()=>{
 const nq=validateNQReport(body(),IP);nq.created_at=Date.now();
 const view=summarizeNQ(nq);
 assert.equal(view.scores.find(x=>x.source==='IPQS').score,null);
 assert.equal(view.scores.find(x=>x.source==='SCAMALYTICS').score,21);
 assert.equal(view.scores.find(x=>x.source==='AbuseIPDB').score,0);
 assert.equal(view.scores.find(x=>x.source==='ipapi').score,0.47);
 assert.equal(view.media[0].name,'Netflix');
 assert.equal(view.media[0].status,'Yes');
 assert.equal(view.factors[0].providers[1].value,null);
 assert.equal(view.network.fujian_avg.cu,195);
});
test('NQ report rejects forged IP, future clock, wrong revision or empty reports',()=>{
 const b=body();assert.throws(()=>validateNQReport({...b,ip:'8.8.8.8'},IP),/nq_ip_mismatch/);
 assert.throws(()=>validateNQReport({...b,script_revision:'main'},IP),/invalid_nq_schema/);
 assert.throws(()=>validateNQReport({...b,started_at:Date.now()+86400000},IP),/invalid_nq_timestamp/);
 assert.throws(()=>validateNQReport({...b,sections:Object.fromEntries(NQ_PARTS.map(k=>[k,null]))},IP),/no_nq_sections/);
});
test('partial run retains sections and status instead of inventing tests',()=>{
 const b=body();b.sections.hardware_quality=null;b.sections.backroute_trace=null;
 const r=validateNQReport(b,IP);assert.equal(r.status,'partial');assert.equal(r.part_count,2);
 assert.equal(summarizeNQ({...r,created_at:Date.now()}).parts.hardware_quality,false);
});
test('D1 stores full report once, has bounded per-server history and preserves main data',async()=>{
 const env=await setup(),report=body();await ensureNQSchema(env.DB);
 assert.equal((await saveNQ(env.DB,'server-1',IP,report)).duplicate,false);
 assert.equal((await saveNQ(env.DB,'server-1',IP,report)).duplicate,true);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) c FROM netdiag_nq_runs').get().c,1);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) c FROM metrics_history').get().c,1);
 const row=await latestNQ(env.DB,'server-1');
 assert.equal(row.sections.ip_quality.Media.ChatGPT.Status,'Block');
 assert.equal((await nqHistory(env.DB,'server-1')).length,1);
});
test('public home gets NQ charts but raw serial or hardware JSON stays admin-only',async()=>{
 const env=await setup();await saveNQ(env.DB,'server-1',IP,body());
 const pub=await handleStableApi(request('home'),env,{},deps);
 assert.equal(pub.status,200);const data=await pub.json();
 assert.equal(data.servers[0].nq.info.asn,'198454');
 assert.equal(data.servers[0].nq.media[0].name,'Netflix');
 assert.equal(data.servers[0].live.rows[0].value,195);
 assert.equal(JSON.stringify(data).includes('backroute_trace'),true); // section-presence indicator, not raw data
 assert.ok(!JSON.stringify(data).includes('AS9929'));
 const detailPub=await (await handleStableApi(request('detail?id=server-1'),env,{},deps)).json();
 assert.equal(detailPub.server.nq_full,undefined);
 const detailAdmin=await (await handleStableApi(request('detail?id=server-1',{token:'admin'}),env,{},deps)).json();
 assert.equal(detailAdmin.server.nq_full.backroute_trace.Route[0],'AS9929');
 assert.equal(detailAdmin.history.some(x=>x.kind==='nq'),true);
});
test('private site denies anonymous access, using existing authentication',async()=>{
 const env=await setup();await saveNQ(env.DB,'server-1',IP,body());
 const privateDeps={...deps,loadSettings:async()=>({is_public:'false'})};
 assert.equal((await handleStableApi(request('home'),env,{},privateDeps)).status,401);
});
test('pinned NQ launcher disables report upload and checks both rootfs SHA256',()=>{
 const src=fs.readFileSync(new URL('../public/netdiag/nq/NodeQuality.sh',import.meta.url),'utf8');
 assert.ok(src.includes('CFSM_NQ_OUTPUT_DIR'));
 assert.ok(src.includes('sha256sum -c'));
 assert.ok(!src.includes('https://api.nodequality.com/api/v1/record'));
 assert.ok(src.includes('hardware_quality_json_filename'));
 assert.ok(src.includes('net_quality_json_filename'));
 assert.ok(src.includes('backroute_trace_json_filename'));
});
