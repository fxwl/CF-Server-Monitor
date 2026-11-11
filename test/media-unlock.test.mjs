import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MEDIA_IDS,MEDIA_VERSION,validateObservations,acceptObservations,sanitizeMedia,lastMedia,mediaHistory,ensureMediaSchema} from '../src/netdiag/media-service.js';
import {ensureSchema} from '../src/netdiag/service.js';
import {handleStableApi,STABLE_TARGETS,validateStableReport} from '../src/netdiag/stable-service.js';
const IP='94.24.39.45';
class DB{
 constructor(){this.sql=new DatabaseSync(':memory:');}
 prepare(query){const db=this;return{sql:query,args:[],bind(...args){this.args=args;return this;},async first(){return db.sql.prepare(query).get(...this.args)||null;},async all(){return{results:db.sql.prepare(query).all(...this.args)};},async run(){const x=db.sql.prepare(query).run(...this.args);return{meta:{changes:Number(x.changes)}};}};}
 async batch(stmts){this.sql.exec('BEGIN');try{const result=stmts.map(s=>{const x=this.sql.prepare(s.sql).run(...s.args);return{meta:{changes:Number(x.changes)}};});this.sql.exec('COMMIT');return result;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
async function fixture(){const DBx=new DB();DBx.sql.exec("CREATE TABLE servers(id TEXT PRIMARY KEY,name TEXT,region TEXT,sort_order INTEGER,history_partition_id INTEGER,ping_mode TEXT,is_hidden INTEGER);CREATE TABLE metrics_history(id INTEGER PRIMARY KEY,server_id TEXT,ip_v4 TEXT,ip_v6 TEXT,timestamp INTEGER,ping_cu REAL,ping_ct REAL,ping_cm REAL,loss_cu REAL,loss_ct REAL,loss_cm REAL);");
 DBx.sql.prepare('INSERT INTO servers VALUES(?,?,?,?,?,?,?)').run('server-1','Server','ES',0,0,'icmp',0);
 DBx.sql.prepare('INSERT INTO metrics_history VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1,'server-1',IP,'',Date.now(),120,180,210,0,0,0);
 await ensureSchema(DBx);return{DB:DBx,API_SECRET:'test-secret-has-enough-chars-long123'};}
function report(){const now=Date.now();return{schema_version:3,version:MEDIA_VERSION,run_id:crypto.randomUUID(),ip:IP,services:MEDIA_IDS.map(([id])=>({id,status:id==='netflix'?'catalog':id==='openai_api'?'login_required':'reachable',reason:id==='netflix'?'catalog_observed':id==='openai_api'?'auth_required':'page_accessible',http_code:id==='openai_api'?401:200,region:id==='netflix'?'ES':null,checked_at:now,latency_ms:105})),quality:{
 'ipwho.is':{raw:{success:true,ip:IP,country:'Spain',country_code:'ES',region:'Malaga',city:'Cartama',connection:{asn:198454,isp:'Example'}}},
 'proxycheck.io':{error:'rate_limited'},'ipapi.is':{error:'blocked'},'IPinfo':{error:'unavailable'}
}};}
test('11 allowlisted service IDs grouped into media and AI',()=>{assert.equal(MEDIA_IDS.length,11);assert.equal(MEDIA_IDS.filter(x=>x[2]==='ai').length,5);});
test('do not convert reachable websites into proven unlocks',()=>{const v=validateObservations(report(),IP);assert.equal(v.media.services.find(x=>x.id==='chatgpt').status,'reachable');assert.equal(v.media.services.find(x=>x.id==='netflix').status,'catalog');assert.equal(v.media.services.find(x=>x.id==='openai_api').status,'login_required');});
test('agent observations reject forged IP, forged target, extra service and region',()=>{
 let x=report();assert.throws(()=>validateObservations({...x,ip:'8.8.8.8'},IP),/ip_changed/);
 x=report();x.services[0].id='unapproved';assert.throws(()=>validateObservations(x,IP),/invalid_service/);
 x=report();x.services[0].region='E$';assert.throws(()=>validateObservations(x,IP),/invalid_service_region/);
 x=report();x.services[0].http_code=900;assert.throws(()=>validateObservations(x,IP),/invalid_http_code/);
});
test('provider responses are normalized, raw data discarded; 3 failed risk sources do not become clean scores',()=>{
 const result=validateObservations(report(),IP);assert.equal(result.quality.status,'partial');
 assert.equal(result.quality.providers.filter(x=>x.status==='ok').length,1);
 assert.equal(result.quality.providers.find(x=>x.provider==='ipwho.is').risk,null);
 assert.ok(!JSON.stringify(result).includes('raw'));
});
test('media inserts are idempotent and independent of 1.2 route history',async()=>{
 const env=await fixture();const b=report();await acceptObservations(env.DB,'server-1',IP,b);
 const second=await acceptObservations(env.DB,'server-1',IP,b);assert.equal(second.duplicate,true);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) c FROM netdiag_media_runs').get().c,1);
 assert.equal(env.DB.sql.prepare("SELECT COUNT(*) c FROM netdiag_runs WHERE kind='quality'").get().c,1);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) c FROM metrics_history').get().c,1);
 assert.equal((await mediaHistory(env.DB,'server-1')).length,1);
 const s=sanitizeMedia(await lastMedia(env.DB,'server-1'));assert.equal(s.services.length,11);
});
test('merged dashboard API shows quality and unlock without changing original metrics',async()=>{
 const env=await fixture();await acceptObservations(env.DB,'server-1',IP,report());
 const deps={loadSettings:async()=>({is_public:'true'}),checkAuth:async()=>false};
 const res=await handleStableApi(new Request('https://monitor.nnot.de/api/netdiag/home'),env,{},deps);
 assert.equal(res.status,200);const data=await res.json();
 assert.equal(data.servers[0].ip,IP);assert.equal(data.servers[0].media.services.length,11);
 assert.equal(data.servers[0].quality.providers.length,4);
 const detail=await handleStableApi(new Request('https://monitor.nnot.de/api/netdiag/detail?id=server-1'),env,{},deps);
 assert.equal(detail.status,200);assert.equal((await detail.json()).history.some(x=>x.kind==='media'),true);
});
test('old 1.2.0 route reports stay accepted with new stable backend',()=>{
 const now=Date.now();const body={schema_version:2,version:'1.2.0',run_id:crypto.randomUUID(),started_at:now,
 routes:STABLE_TARGETS.map(t=>({...t,target_ip:t.host,status:'partial',hops:[],icmp:{sent:5,received:0,status:'unreachable'}}))};
 assert.equal(validateStableReport(body).version,'1.2.0');
});
