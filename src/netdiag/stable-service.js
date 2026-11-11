import {DiagnosticError,publicIP,text,finite,limitedJson,secretEqual,validateReport,routeChanges,fingerprint,classifyRoute} from './core.js';
import {ensureSchema} from './service.js';

export const RELEASE='2.8.7-fuzhou.20261111.1';
export const COLLECTOR='1.2.0';
export const STABLE_TARGETS=Object.freeze([
  {key:'cu',label:'\u798f\u5dde\u8054\u901a',host:'36.248.48.211',port:0,mode:'icmp'},
  {key:'ct',label:'\u798f\u5dde\u7535\u4fe1',host:'218.85.157.99',port:0,mode:'icmp'},
  {key:'cm',label:'\u798f\u5dde\u79fb\u52a8',host:'211.138.151.161',port:0,mode:'icmp'}
]);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const hidden=s=>[true,1,'1','true'].includes(s.is_hidden);
const visible=(s,admin)=>admin||!hidden(s);
export const validTime=(value,now=Date.now())=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=now+120000;
const decode=row=>{try{return row?{...JSON.parse(row.payload),record_id:row.id,created_at:row.created_at,ip:row.ip,status:row.status}:null;}catch{return null;}};
function idCheck(id){if(!/^[a-zA-Z0-9-]{1,80}$/.test(id||''))throw new DiagnosticError('invalid_server_id');return id;}
async function serverById(db,id){idCheck(id);const s=await db.prepare('SELECT * FROM servers WHERE id=?').bind(id).first();if(!s)throw new DiagnosticError('server_not_found',404);return s;}
async function latestMetrics(db,s,now){
  const part=Number(s.history_partition_id), cols='ip_v4,ip_v6,timestamp,ping_cu,ping_ct,ping_cm,loss_cu,loss_ct,loss_cm';
  if(Number.isInteger(part)&&part>0&&part<=900)return await db.prepare(`SELECT ${cols} FROM metrics_history WHERE id>=? AND id<=? AND server_id=? AND timestamp<=? ORDER BY id DESC LIMIT 1`).bind(part*10000000000000,part*10000000000000+991231235959,s.id,now+120000).first()||{};
  return await db.prepare(`SELECT ${cols} FROM metrics_history WHERE server_id=? AND timestamp<=? ORDER BY timestamp DESC LIMIT 1`).bind(s.id,now+120000).first()||{};
}
async function last(db,id,kind,now){return decode(await db.prepare('SELECT id,created_at,ip,status,payload FROM netdiag_runs WHERE server_id=? AND kind=? AND created_at<=? ORDER BY created_at DESC LIMIT 1').bind(id,kind,now+120000).first());}
function publicAddress(m){return publicIP(m.ip_v4)?m.ip_v4:publicIP(m.ip_v6)?m.ip_v6:null;}
function stale(record,ip,now){return !!record&&(!validTime(record.created_at,now)||record.ip!==ip||now-record.created_at>26*3600000);}
export function sanitizeRoute(record,{admin=false,targets=STABLE_TARGETS}={}){
  if(!record)return null;
  const output={record_id:record.record_id,created_at:record.created_at,ip:record.ip,status:record.status,version:text(record.version,40),changes:record.changes||[],routes:[]};
  for(const t of targets){
    const r=record.routes?.find(x=>x.key===t.key);
    if(!r){output.routes.push({...t,status:'pending',hops:[],line:classifyRoute({hops:[]}),target_matches:false});continue;}
    const hops=(Array.isArray(r.hops)?r.hops:[]).slice(0,30).map(h=>({ttl:h.ttl,ip:admin||publicIP(h.ip)?h.ip:null,private:!!h.private||!!h.ip&&!publicIP(h.ip),
      asns:publicIP(h.ip)&&Array.isArray(h.asns)?h.asns:[],rtts_ms:Array.isArray(h.rtts_ms)?h.rtts_ms.filter(v=>typeof v==='number'&&v>=0&&v<=30000).slice(0,3):[],
      annotation:text(h.annotation,24),geo:publicIP(h.ip)&&h.geo?{country:text(h.geo.country,60),region:text(h.geo.region,60),city:text(h.geo.city,60),isp:text(h.geo.isp,90),source:text(h.geo.source||'ipwho.is',40)}:null}));
    const line=classifyRoute({hops});
    output.routes.push({key:t.key,label:t.label,host:text(r.host,100),port:r.port,method:r.method||'udp-unprivileged',status:r.status,reached:r.reached===true,
      target_ip:r.target_ip,target_matches:r.host===t.host&&r.target_ip===t.host,expected_target:t.host,hops,line,
      icmp:r.icmp||null,tcp:r.tcp||null,error:text(r.error,100)||null,duration_ms:r.duration_ms});
  }
  return output;
}
export function sanitizeQuality(record){
  if(!record)return null;
  return {record_id:record.record_id,created_at:record.created_at,ip:record.ip,status:record.status,changes:record.changes||[],
    providers:(Array.isArray(record.providers)?record.providers:[]).slice(0,8).map(p=>({provider:text(p.provider,40),status:p.status,coverage:text(p.coverage,24),error:text(p.error,80)||null,
      ip:text(p.ip,45),asn:text(p.asn,60),operator:text(p.operator,160),network_type:text(p.network_type,60)||null,
      country:text(p.country,80),country_code:text(p.country_code,8),region:text(p.region,80),city:text(p.city,80),
      risk:finite(p.risk,0,100),confidence:finite(p.confidence,0,100),network_abuse_score:text(p.network_abuse_score,80)||null,
      flags:Object.fromEntries(['proxy','vpn','tor','hosting','abuser','anonymous','compromised','scraper','crawler','mobile','bogon'].map(k=>[k,typeof p.flags?.[k]==='boolean'?p.flags[k]:null])),
      checked_at:p.checked_at,source:text(p.source,200),score_note:text(p.score_note,300)}))};
}
async function summary(db,s,admin,now,full=false){
  const [m,q,r]=await Promise.all([latestMetrics(db,s,now),last(db,s.id,'quality',now),last(db,s.id,'route',now)]);
  const ip=publicAddress(m),quality=sanitizeQuality(q),route=sanitizeRoute(r,{admin});
  if(quality)quality.stale=stale(q,ip,now);if(route)route.stale=stale(r,ip,now)||route.routes.some(x=>!x.target_matches);
  if(!full&&route)route.routes=route.routes.map(x=>({key:x.key,label:x.label,host:x.host,target_ip:x.target_ip,target_matches:x.target_matches,status:x.status,reached:x.reached,
    line:x.line,icmp:x.icmp,tcp:x.tcp,visible_count:x.hops.filter(h=>h.ip).length}));
  return{id:s.id,name:text(s.name,120),region:text(s.region,20),ip,ip_v4:publicIP(m.ip_v4)?m.ip_v4:null,ip_v6:publicIP(m.ip_v6)?m.ip_v6:null,ip_seen_at:m.timestamp||null,
    live:{at:m.timestamp||null,mode:s.ping_mode||'icmp',rows:STABLE_TARGETS.map(t=>({key:t.key,label:t.label,value:finite(m['ping_'+t.key],0,30000),loss:finite(m['loss_'+t.key],0,100)}))},quality,route};
}
async function agentAccess(request,env,id){
  const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]||'';
  if(!await secretEqual(env.API_SECRET,token))throw new DiagnosticError('unauthorized',401);
  const server=await serverById(env.DB,id),m=await latestMetrics(env.DB,server,Date.now());
  const ip=request.headers.get('CF-Connecting-IP');
  if(!publicIP(ip))throw new DiagnosticError('source_ip_required',403);
  const known=[m.ip_v4,m.ip_v6].filter(publicIP);
  if(known.length&&!known.includes(ip))throw new DiagnosticError('server_source_ip_mismatch',403);
  return {server,ip};
}
export function validateStableReport(body,now=Date.now()){
  if(body?.schema_version!==2||body.version!==COLLECTOR)throw new DiagnosticError('unsupported_report_schema');
  if(!Array.isArray(body.routes))throw new DiagnosticError('invalid_report');
  const adapted={...body,schema_version:1,routes:body.routes?.map(r=>({...r,port:0,tcp:{attempts:0,successes:0,median_ms:null}}))};
  const valid=validateReport(adapted,STABLE_TARGETS,now);
  valid.schema_version=2;valid.version=COLLECTOR;
  valid.reported_started_at=validTime(body.started_at,now)?body.started_at:now;
  for(const r of valid.routes){
    const src=body.routes.find(x=>x.key===r.key),p=src.icmp||{};
    if(r.target_ip!==r.host)throw new DiagnosticError('unexpected_target_ip');
    const sent=p.sent,received=p.received;
    if(!Number.isInteger(sent)||sent<0||sent>5||!Number.isInteger(received)||received<0||received>sent)throw new DiagnosticError('invalid_icmp_counts');
    const vals=['min_ms','avg_ms','max_ms','mdev_ms'].map(k=>finite(p[k],0,30000));
    if(vals[0]!==null&&vals[2]!==null&&vals[0]>vals[2])throw new DiagnosticError('invalid_icmp_range');
    r.icmp={sent,received,loss_pct:sent?Math.round((sent-received)/sent*10000)/100:null,min_ms:received?vals[0]:null,avg_ms:received?vals[1]:null,max_ms:received?vals[2]:null,mdev_ms:received?vals[3]:null,status:['ok','unreachable','permission_denied','tool_missing','error'].includes(p.status)?p.status:'error'};
    r.tcp=null;
  }
  return valid;
}
async function acceptStableReport(request,env){
  const id=idCheck(request.headers.get('X-CFSM-Server-ID')),{ip}=await agentAccess(request,env,id);
  const now=Date.now(),report=validateStableReport(await limitedJson(request),now),runId=id+':'+report.run_id;
  const duplicate=await env.DB.prepare('SELECT id FROM netdiag_runs WHERE id=? AND server_id=?').bind(runId,id).first();
  if(duplicate)return {accepted:true,duplicate:true};
  const lock=await env.DB.prepare('INSERT INTO netdiag_locks(key,expires_at) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE netdiag_locks.expires_at<=? RETURNING key').bind('report:'+id,now+600000,now).all();
  if(!lock.results?.length)throw new DiagnosticError('report_cooldown',429);
  try{
    report.changes=routeChanges(await last(env.DB,id,'route',now),report);
    report.status=report.routes.every(r=>r.reached)?'complete':report.routes.some(r=>r.hops.some(h=>h.ip))?'partial':'unavailable';
    report.fingerprint=await fingerprint(report.routes.map(r=>[r.key,r.host,r.hops.map(h=>[h.ttl,h.ip,h.asns])]));
    await env.DB.batch([
      env.DB.prepare('INSERT INTO netdiag_runs(id,server_id,kind,created_at,ip,status,payload) VALUES(?,?,?,?,?,?,?)').bind(runId,id,'route',now,ip,report.status,JSON.stringify(report)),
      env.DB.prepare('DELETE FROM netdiag_runs WHERE id IN (SELECT id FROM netdiag_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT -1 OFFSET 60)').bind(id,'route')
    ]);
    return {accepted:true,version:COLLECTOR,received_at:now};
  }catch(e){await env.DB.prepare('DELETE FROM netdiag_locks WHERE key=?').bind('report:'+id).run();throw e;}
}
export async function handleStableApi(request,env,ctx,deps){
  const url=new URL(request.url),path=url.pathname;
  if(!['/api/netdiag/home','/api/netdiag/detail','/api/netdiag/config-stable','/api/netdiag/report-stable','/api/netdiag/release'].includes(path))return null;
  try{
    if(path==='/api/netdiag/release'&&request.method==='GET')return json({release:RELEASE,collector:COLLECTOR,auto_update:false,upstream:'2.8.7',target_order:STABLE_TARGETS.map(t=>t.key)});
    if(path==='/api/netdiag/config-stable'&&request.method==='GET'){
      await agentAccess(request,env,idCheck(url.searchParams.get('id')));
      return json({schema_version:2,version:COLLECTOR,targets:STABLE_TARGETS,interval_hours:12,max_hops:30});
    }
    if(path==='/api/netdiag/report-stable'&&request.method==='POST'){await ensureSchema(env.DB);return json(await acceptStableReport(request,env));}
    if(request.method!=='GET')throw new DiagnosticError('method_not_allowed',405);
    const settings=await deps.loadSettings(env.DB),admin=await deps.checkAuth(request,env,settings);
    if(!admin&&settings.is_public!=='true'&&settings.is_public!==true)throw new DiagnosticError('unauthorized',401);
    await ensureSchema(env.DB);const now=Date.now();
    if(path==='/api/netdiag/home'){
      const rows=await env.DB.prepare('SELECT * FROM servers ORDER BY sort_order LIMIT 100').all();
      return json({release:RELEASE,generated_at:now,order:STABLE_TARGETS.map(t=>t.key),targets:STABLE_TARGETS,servers:await Promise.all((rows.results||[]).filter(s=>visible(s,admin)).map(s=>summary(env.DB,s,admin,now)))});
    }
    const s=await serverById(env.DB,idCheck(url.searchParams.get('id')));if(!visible(s,admin))throw new DiagnosticError('server_not_found',404);
    const data=await summary(env.DB,s,admin,now,true);
    const records=await env.DB.prepare('SELECT id,kind,created_at,ip,status FROM netdiag_runs WHERE server_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 20').bind(s.id,now+120000).all();
    const run=url.searchParams.get('run');
    if(run){
      if(run.length>180)throw new DiagnosticError('invalid_record_id');
      const row=await env.DB.prepare('SELECT id,kind,created_at,ip,status,payload FROM netdiag_runs WHERE id=? AND server_id=? AND created_at<=?').bind(run,s.id,now+120000).first();
      if(!row)throw new DiagnosticError('record_not_found',404);
      data[row.kind]=row.kind==='route'?sanitizeRoute(decode(row),{admin}):sanitizeQuality(decode(row));
      data.viewing_history=true;
    }
    return json({release:RELEASE,generated_at:now,server:data,targets:STABLE_TARGETS,history:records.results||[],can_refresh:!!admin,
      capabilities:{speedtest:false,remote_shell:false,media_unlock:false,mail_probe:false,dnsbl_bulk:false}});
  }catch(e){return json({error:e instanceof DiagnosticError?e.code:'diagnostic_service_error'},e instanceof DiagnosticError?e.status:500);}
}
