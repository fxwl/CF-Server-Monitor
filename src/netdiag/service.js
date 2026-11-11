import {VERSION,ORDER,LIMITS,DiagnosticError,publicIP,text,selectedTargets,validateReport,routeChanges,normalizeProxycheck,normalizeIpapi,limitedJson,secretEqual,fingerprint} from './core.js';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS netdiag_runs (id TEXT PRIMARY KEY,server_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('quality','route')),created_at INTEGER NOT NULL,ip TEXT,status TEXT NOT NULL,payload TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_netdiag_runs_server ON netdiag_runs(server_id,kind,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_netdiag_runs_time ON netdiag_runs(created_at)`,
  `CREATE TABLE IF NOT EXISTS netdiag_locks (key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS netdiag_budget (provider TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(provider,day))`
];
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
const decode=row=>{if(!row)return null;try{return {...JSON.parse(row.payload),record_id:row.id,created_at:row.created_at,status:row.status,ip:row.ip};}catch{return null;}};
export async function ensureSchema(db){await db.batch(SCHEMA.map(sql=>db.prepare(sql)));}
async function registered(db,id) {
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(id||''))throw new DiagnosticError('invalid_server_id');
  const server=await db.prepare('SELECT id,name,sort_order,region FROM servers WHERE id=?').bind(id).first();
  if(!server)throw new DiagnosticError('server_not_found',404);
  return server;
}
async function latestIP(db,id) {
  // Preserve upstream's primary-key partition optimization; do not add write-heavy indexes.
  const server=await db.prepare('SELECT history_partition_id FROM servers WHERE id=?').bind(id).first();
  const partition=Number(server?.history_partition_id);
  const row=Number.isInteger(partition)&&partition>0&&partition<=900
    ? await db.prepare('SELECT ip_v4,ip_v6,timestamp FROM metrics_history WHERE id>=? AND id<=? AND server_id=? ORDER BY id DESC LIMIT 1').bind(partition*10000000000000,partition*10000000000000+991231235959,id).first()
    : await db.prepare('SELECT ip_v4,ip_v6,timestamp FROM metrics_history WHERE server_id=? ORDER BY timestamp DESC LIMIT 1').bind(id).first();
  return {ip:publicIP(row?.ip_v4)?row.ip_v4:publicIP(row?.ip_v6)?row.ip_v6:null,seen_at:row?.timestamp||null};
}
async function lastRun(db,id,kind) {
  return decode(await db.prepare('SELECT id,created_at,status,ip,payload FROM netdiag_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT 1').bind(id,kind).first());
}
async function acquire(db,key,ttl,now=Date.now()) {
  const result=await db.prepare('INSERT INTO netdiag_locks(key,expires_at) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE netdiag_locks.expires_at<=? RETURNING key').bind(key,now+ttl,now).all();
  return result.results?.length===1;
}
async function reserveBudget(db,provider,max,now) {
  const day=new Date(now).toISOString().slice(0,10);
  const r=await db.prepare('INSERT INTO netdiag_budget(provider,day,count) VALUES(?,?,1) ON CONFLICT(provider,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(provider,day,max).all();
  return r.results?.length===1;
}
async function providerJSON(url,options={},fetcher=fetch) {
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),7000);
  try{
    const response=await fetcher(url,{...options,signal:abort.signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'CFSM-Network-Diagnostics/'+VERSION,...(options.headers||{})}});
    if(!response.ok)throw new DiagnosticError(response.status===429?'provider_rate_limited':'provider_http_'+response.status,502);
    return await limitedJson(response,LIMITS.upstream);
  }catch(e){if(e instanceof DiagnosticError)throw e;throw new DiagnosticError(e?.name==='AbortError'?'provider_timeout':'provider_unavailable',502);}
  finally{clearTimeout(timer);}
}
export async function lookupQuality(env,ip,fetcher=fetch,now=Date.now()) {
  if(!publicIP(ip))throw new DiagnosticError('public_ip_required');
  const providers=await Promise.all([
    (async()=>{
      try{
        if(!await reserveBudget(env.DB,'proxycheck.io',env.NETDIAG_PROXYCHECK_KEY?900:80,now))throw new DiagnosticError('daily_budget_exhausted');
        const key=env.NETDIAG_PROXYCHECK_KEY?`&key=${encodeURIComponent(env.NETDIAG_PROXYCHECK_KEY)}`:'';
        const raw=await providerJSON(`https://proxycheck.io/v3/${encodeURIComponent(ip)}?ver=24-June-2026&tag=0${key}`,{},fetcher);
        return normalizeProxycheck(raw,ip,now);
      }catch(e){return{provider:'proxycheck.io',status:'unavailable',checked_at:now,error:e.code||'provider_unavailable'};}
    })(),
    (async()=>{
      try{
        if(!await reserveBudget(env.DB,'ipapi.is',env.NETDIAG_IPAPI_KEY?900:20,now))throw new DiagnosticError('daily_budget_exhausted');
        const opts=env.NETDIAG_IPAPI_KEY?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:ip,key:env.NETDIAG_IPAPI_KEY})}:{};
        const url=env.NETDIAG_IPAPI_KEY?'https://api.ipapi.is/':`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`;
        return normalizeIpapi(await providerJSON(url,opts,fetcher),ip,now);
      }catch(e){return{provider:'ipapi.is',status:'unavailable',checked_at:now,error:e.code||'provider_unavailable'};}
    })()
  ]);
  const available=providers.filter(p=>p.status==='ok');
  return {ip,providers,status:available.length===providers.length?'complete':available.length?'partial':'unavailable',checked_at:now,
    notice:'Provider observations may disagree; absence of a flag is unknown, never a clean verdict. Hosting is not synonymous with malicious.'};
}
async function saveRun(db,id,serverId,kind,payload,now,ip) {
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO netdiag_runs(id,server_id,kind,created_at,ip,status,payload) VALUES(?,?,?,?,?,?,?)').bind(id,serverId,kind,now,ip||null,payload.status||'partial',JSON.stringify(payload)),
    db.prepare('DELETE FROM netdiag_runs WHERE id IN (SELECT id FROM netdiag_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT -1 OFFSET ?)').bind(serverId,kind,LIMITS.maxRuns)
  ]);
}
export async function refreshQuality(env,id,fetcher=fetch,now=Date.now()) {
  await registered(env.DB,id);
  const info=await latestIP(env.DB,id);
  if(!info.ip)throw new DiagnosticError('no_public_ip_reported',409);
  if(info.seen_at && now-info.seen_at>2*86400000)throw new DiagnosticError('agent_ip_stale',409);
  const previous=await lastRun(env.DB,id,'quality');
  const cacheMs=previous?.status==='unavailable'?3600000:12*3600000;
  if(previous&&previous.ip===info.ip&&now-previous.created_at<cacheMs)return {cached:true,result:previous};
  if(!await acquire(env.DB,'quality:'+id,60000,now))return {pending:true,result:previous};
  try{
    const result=await lookupQuality(env,info.ip,fetcher,now);
    result.changes=[];
    if(previous){
      if(previous.ip!==info.ip)result.changes.push('ip_changed');
      for(const item of result.providers){
        const before=previous.providers?.find(p=>p.provider===item.provider);
        if(item.status==='ok'&&before?.status==='ok'){
          if(item.asn&&before.asn&&item.asn!==before.asn)result.changes.push(item.provider+':asn_changed');
          if(item.risk!==null&&before.risk!==null&&item.risk!==before.risk)result.changes.push(item.provider+':risk_changed');
          if(JSON.stringify(item.flags)!==JSON.stringify(before.flags))result.changes.push(item.provider+':flags_changed');
        }
      }
    }
    const runId=crypto.randomUUID();await saveRun(env.DB,runId,id,'quality',result,now,info.ip);
    return {cached:false,result:{...result,record_id:runId,created_at:now}};
  }finally{await env.DB.prepare('DELETE FROM netdiag_locks WHERE key=?').bind('quality:'+id).run();}
}
async function agentAuth(request,env,id) {
  const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]||'';
  if(!await secretEqual(env.API_SECRET,token))throw new DiagnosticError('unauthorized',401);
  await registered(env.DB,id);
  const source=request.headers.get('CF-Connecting-IP');
  const known=await latestIP(env.DB,id);
  if(source&&known.ip&&source!==known.ip)throw new DiagnosticError('server_source_ip_mismatch',403);
  return source&&publicIP(source)?source:known.ip;
}
export async function acceptReport(request,env,targets) {
  const id=request.headers.get('X-CFSM-Server-ID')||'';
  const source=await agentAuth(request,env,id);
  const body=await limitedJson(request);
  const now=Date.now();const report=validateReport(body,targets,now);
  const duplicate=await env.DB.prepare('SELECT id FROM netdiag_runs WHERE id=? AND server_id=? AND kind=?').bind(id+':'+report.run_id,id,'route').first();
  if(duplicate)return {accepted:true,duplicate:true,id:report.run_id};
  if(!await acquire(env.DB,'report:'+id,10*60000,now))throw new DiagnosticError('report_cooldown',429);
  try{
    const previous=await lastRun(env.DB,id,'route');
    report.changes=routeChanges(previous,report);
    report.status=report.routes.every(r=>r.status==='complete')?'complete':report.routes.some(r=>r.hops.length)?'partial':'unavailable';
    report.fingerprint=await fingerprint(report.routes.map(r=>({key:r.key,target:r.target_ip,path:r.hops.map(h=>[h.ttl,h.ip,h.asns])})));
    await saveRun(env.DB,id+':'+report.run_id,id,'route',report,now,source);
    console.log(JSON.stringify({module:'netdiag',event:'report_accepted',server_id:id,run_id:report.run_id,status:report.status}));
    return {accepted:true,id:report.run_id,received_at:now};
  }catch(e){await env.DB.prepare('DELETE FROM netdiag_locks WHERE key=?').bind('report:'+id).run();throw e;}
}
export async function maintain(env,deps) {
  await ensureSchema(env.DB);const now=Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM netdiag_runs WHERE created_at<?').bind(now-LIMITS.retentionDays*86400000),
    env.DB.prepare('DELETE FROM netdiag_locks WHERE expires_at<?').bind(now-86400000),
    env.DB.prepare('DELETE FROM netdiag_budget WHERE day<?').bind(new Date(now-3*86400000).toISOString().slice(0,10))
  ]);
  const list=await env.DB.prepare("SELECT s.id,MAX(r.created_at) last_check FROM servers s LEFT JOIN netdiag_runs r ON r.server_id=s.id AND r.kind='quality' GROUP BY s.id ORDER BY COALESCE(MAX(r.created_at),0) ASC LIMIT 2").all();
  await Promise.all((list.results||[]).map(async s=>{try{await refreshQuality(env,s.id,deps?.fetch||fetch,now);}catch(e){console.warn(JSON.stringify({module:'netdiag',event:'scheduled_check_unavailable',server_id:s.id,code:e.code||'internal_error'}));}}));
}
export async function handleNetworkAPI(request,env,ctx,deps) {
  try{
    const url=new URL(request.url), path=url.pathname;
    if(request.method!=='GET'&&request.method!=='POST')throw new DiagnosticError('method_not_allowed',405);
    const isAgent=path==='/api/netdiag/report'||path==='/api/netdiag/config';
    if(!isAgent){
      const sys=await deps.loadSettings(env.DB);
      if(!await deps.checkAuth(request,env,sys))throw new DiagnosticError('unauthorized',401);
      if(request.method==='POST'){
        const origin=request.headers.get('Origin');
        if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('X-CFSM-Netdiag')!=='1')throw new DiagnosticError('invalid_request_origin',403);
      }
    }
    await ensureSchema(env.DB);
    if(path==='/api/netdiag/config'&&request.method==='GET'){
      await agentAuth(request,env,url.searchParams.get('id'));
      const sys=await deps.loadSettings(env.DB);
      return json({version:VERSION,schema_version:1,targets:selectedTargets(sys).map(({metricKey,...t})=>t),interval_hours:12,max_hops:30});
    }
    if(path==='/api/netdiag/report'&&request.method==='POST'){
      const sys=await deps.loadSettings(env.DB);
      return json(await acceptReport(request,env,selectedTargets(sys)));
    }
    if(path==='/api/netdiag/refresh'&&request.method==='POST'){
      const body=await limitedJson(request,1024);
      return json(await refreshQuality(env,body.server_id,deps.fetch||fetch));
    }
    if(path==='/api/netdiag/history'&&request.method==='GET'){
      const id=url.searchParams.get('id');await registered(env.DB,id);
      const kind=url.searchParams.get('kind')||'route';if(!['quality','route'].includes(kind))throw new DiagnosticError('invalid_kind');
      const limit=Math.min(20,Math.max(1,Math.floor(Number(url.searchParams.get('limit'))||10)));
      const rows=await env.DB.prepare('SELECT id,created_at,ip,status,payload FROM netdiag_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT ?').bind(id,kind,limit).all();
      return json({server_id:id,kind,records:(rows.results||[]).map(decode)});
    }
    if(path==='/api/netdiag/overview'&&request.method==='GET'){
      const sys=await deps.loadSettings(env.DB);
      const list=await env.DB.prepare('SELECT id,name,region,sort_order FROM servers ORDER BY sort_order LIMIT 100').all();
      const servers=await Promise.all((list.results||[]).map(async server=>{
        const [ip,quality,route]=await Promise.all([latestIP(env.DB,server.id),lastRun(env.DB,server.id,'quality'),lastRun(env.DB,server.id,'route')]);
        return {...server,ip:ip.ip,ip_seen_at:ip.seen_at,quality,route,collector_installed:!!route,route_stale:!route||Date.now()-route.created_at>26*3600000};
      }));
      return json({version:VERSION,generated_at:Date.now(),order:ORDER,targets:selectedTargets(sys),servers,limits:LIMITS,
        features:{speedtest:false,remote_shell:false,root_required:false,ipapi_full:!!env.NETDIAG_IPAPI_KEY,proxycheck_key:!!env.NETDIAG_PROXYCHECK_KEY}});
    }
    throw new DiagnosticError('not_found',404);
  }catch(e){
    const status=e instanceof DiagnosticError?e.status:500;
    const code=e instanceof DiagnosticError?e.code:'diagnostic_service_error';
    if(status>=500)console.warn(JSON.stringify({module:'netdiag',event:'request_failed',code}));
    return json({error:code},status,status===429?{'Retry-After':'600'}:{});
  }
}
