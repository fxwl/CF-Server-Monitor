import { isIP } from 'node:net';

const KINDS = new Set(['ip', 'net']);
const MAX_BYTES = 460000;
const RETENTION = 40;
const DEFAULTS = Object.freeze({ enabled: true, ip_hours: 168, net_hours: 168 });
const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
});
class QualityError extends Error { constructor(message, status=400) {super(message);this.status=status;} }
const goodId = value => typeof value === 'string' && /^[\da-f-]{20,80}$/i.test(value);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const clean = x => obj(x) ? x : {};
const validHours = v => Number.isInteger(v) && v >= 1 && v <= 720;
const bool = x => x === true || x === false;
const bounded = (x, max=100) => typeof x === 'string' ? x.slice(0,max) : null;
// Configured CN region OR authenticated Cloudflare CN ingress disables diagnostics.
const countryCode = x => typeof x === 'string' ? x.trim().toUpperCase() : '';
const isDomestic = (region,observed) => countryCode(region)==='CN'||countryCode(observed)==='CN';

export function validateDiagnosticReport(x, sourceIp, now=Date.now()) {
  if (!obj(x) || x.schema_version !== 1 || !KINDS.has(x.kind) || !goodId(x.run_id)) throw new QualityError('invalid_report');
  if (!Number.isInteger(x.started_at) || x.started_at > now+120000 || x.started_at < now-14*86400000) throw new QualityError('invalid_timestamp');
  if (!obj(x.report) || !obj(x.report.Head)) throw new QualityError('invalid_report_body');
  const isIp = x.kind === 'ip';
  if (isIp && (!obj(x.report.Info) || !obj(x.report.Score) || !obj(x.report.Factor))) throw new QualityError('invalid_ip_quality');
  if (!isIp && (!obj(x.report.BGP) || !obj(x.report.Local) || !Array.isArray(x.report.Connectivity))) throw new QualityError('invalid_net_quality');
  const reported = x.report.Head.IP;
  if (typeof reported !== 'string' || isIP(reported) === 0) throw new QualityError('report_ip_missing');
  if (sourceIp && isIP(sourceIp) && reported.toLowerCase() !== sourceIp.toLowerCase()) throw new QualityError('report_source_ip_mismatch',403);
  const routeText = isIp ? null : typeof x.route_text === 'string' ? x.route_text.slice(0,135000) : null;
  const routes = !isIp && Array.isArray(x.routes) ? x.routes.slice(0,9).map(r => ({
    city: bounded(r?.city,40), carrier: bounded(r?.carrier,40), text: bounded(r?.text,16000)
  })).filter(r => r.city && r.carrier) : [];
  return {kind:x.kind,run_id:x.run_id,started_at:x.started_at,ip:reported,
    source_country:typeof x.source_country==='string' && /^[A-Z]{2}$/.test(x.source_country) ? x.source_country : null,
    report:x.report,route_text:routeText,routes};
}

export async function ensureQualityTables(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS cfsm_quality_runs (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('ip','net')), created_at INTEGER NOT NULL, source_ip TEXT, payload TEXT NOT NULL)"),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cfsm_quality_runs ON cfsm_quality_runs(server_id,kind,created_at DESC)'),
    db.prepare('CREATE TABLE IF NOT EXISTS cfsm_quality_options (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  ]);
}
const rowValue = row => {
  if (!row) return null;
  try { return { ...JSON.parse(row.payload), id:row.id, created_at:row.created_at, source_ip:row.source_ip }; }
  catch { return null; }
};
const makeHome = record => {
  if (!record) return null;
  const r=clean(record.report);
  return { created_at:record.created_at, ip:record.ip,
    usage:clean(clean(r.Type).Usage), company:clean(clean(r.Type).Company), scores:clean(r.Score),
    media:clean(r.Media) };
};
const isVisible = (server,admin) => admin || ![true,1,'1','true'].includes(server.is_hidden);
const hasSiteAccess = (settings,admin) => admin || settings.is_public === 'true' || settings.is_public === true;
const safeServer = async(db,id) => {
  if (!goodId(id)) throw new QualityError('invalid_server_id');
  const s=await db.prepare('SELECT id,name,is_hidden,region FROM servers WHERE id=?').bind(id).first();
  if (!s) throw new QualityError('server_not_found',404);
  return s;
};
async function agentAuth(request, env) {
  const id=request.headers.get('X-CFSM-Server-ID');
  const raw=request.headers.get('Authorization')||'';
  const token=raw.startsWith('Bearer ') ? raw.slice(7):'';
  if (!env.API_SECRET || !token || token.length > 1024) throw new QualityError('unauthorized',401);
  const toHash = async s => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await toHash(token),b=await toHash(env.API_SECRET);
  let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];
  if(different) throw new QualityError('unauthorized',401);
  const server=await safeServer(env.DB,id);
  const source=request.headers.get('CF-Connecting-IP')||null;
  return { id, server, source: source && isIP(source) ? source : null };
}
async function readPayload(request) {
  const n=Number(request.headers.get('Content-Length'));
  if(Number.isFinite(n)&&n>MAX_BYTES)throw new QualityError('payload_too_large',413);
  const chunks=[];let size=0;
  if(!request.body) throw new QualityError('empty_body');
  const reader=request.body.getReader();
  try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new QualityError('payload_too_large',413);chunks.push(value); } }
  finally {reader.releaseLock();}
  const all=new Uint8Array(size);let cursor=0;for(const chunk of chunks){all.set(chunk,cursor);cursor+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{throw new QualityError('invalid_json');}
}
const lookupOpts = async(db,key) => {
  const row=await db.prepare('SELECT value FROM cfsm_quality_options WHERE key=?').bind(key).first();
  try {return row ? JSON.parse(row.value) : null;} catch{return null;}
};
// Remember Cloudflare-authenticated country for nodes without a configured region.
async function rememberObservedCountry(db,id,country){
  if(!countryCode(country))return;
  const key='country:'+id;
  if(await lookupOpts(db,key)===country)return;
  await db.prepare('INSERT INTO cfsm_quality_options(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(country)).run();
}
async function domesticServerIds(db,servers){
  const rows=await db.prepare("SELECT key,value FROM cfsm_quality_options WHERE key LIKE 'country:%'").all();
  const observed=new Map();
  for(const row of rows.results||[]){
    if(typeof row.key!=='string'||!row.key.startsWith('country:'))continue;
    try{observed.set(row.key.slice(8),JSON.parse(row.value));}catch{}
  }
  return servers.filter(s=>isDomestic(s.region,observed.get(s.id))).map(s=>s.id);
}
export async function qualitySchedule(db,id,region=null,sourceCountry=null) {
  const global=await lookupOpts(db,'global');
  const local=await lookupOpts(db,'server:'+id);
  const v={...DEFAULTS,...clean(global),...clean(local)};
  const [ipr,nr,recordedCountry]=await Promise.all([lookupOpts(db,'request:'+id+':ip'),lookupOpts(db,'request:'+id+':net'),lookupOpts(db,'country:'+id)]);
  const domestic=isDomestic(region,sourceCountry)||isDomestic(null,recordedCountry);
  return {enabled:!domestic&&v.enabled!==false,skip_reason:domestic?'country_cn':null,ip_hours:validHours(v.ip_hours)?v.ip_hours:DEFAULTS.ip_hours,net_hours:validHours(v.net_hours)?v.net_hours:DEFAULTS.net_hours,requested:{ip:typeof ipr==='number'?ipr:0,net:typeof nr==='number'?nr:0}};
}
async function qualityUpload(request,env){
  const {id,source,server}=await agentAuth(request,env);
  await ensureQualityTables(env.DB);
  if(isDomestic(server.region,request.cf?.country)||isDomestic(null,await lookupOpts(env.DB,'country:'+id)))
    throw new QualityError('domestic_quality_disabled',409);
  const raw=await readPayload(request),now=Date.now(),report=validateDiagnosticReport(raw,source,now);
  const identifier=`${id}:${report.kind}:${report.run_id}`;
  const existing=await env.DB.prepare('SELECT id FROM cfsm_quality_runs WHERE id=?').bind(identifier).first();
  if(existing) return {accepted:true,duplicate:true};
  const recent=await env.DB.prepare('SELECT created_at FROM cfsm_quality_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT 1').bind(id,report.kind).first();
  if(recent && now-recent.created_at<30000)throw new QualityError('report_cooldown',429);
  const commands=[
    env.DB.prepare('INSERT OR IGNORE INTO cfsm_quality_runs(id,server_id,kind,created_at,source_ip,payload) VALUES(?,?,?,?,?,?)').bind(identifier,id,report.kind,now,source,JSON.stringify(report)),
    env.DB.prepare('DELETE FROM cfsm_quality_runs WHERE id IN (SELECT id FROM cfsm_quality_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT -1 OFFSET ?)').bind(id,report.kind,RETENTION)
  ];
  await env.DB.batch(commands);
  return {accepted:true,duplicate:false,kind:report.kind,at:now};
}
async function qualityHome(env,settings,admin){
  const servers=await env.DB.prepare('SELECT id,is_hidden,region FROM servers ORDER BY sort_order ASC').all();
  const permitted=(servers.results||[]).filter(s=>isVisible(s,admin));
  const disabled=await domesticServerIds(env.DB,permitted);
  const excluded=new Set(disabled);
  const ids=new Set(permitted.filter(s=>!excluded.has(s.id)).map(s=>s.id));
  const rows=await env.DB.prepare("SELECT r.server_id,r.kind,r.payload,r.created_at,r.source_ip,r.id FROM cfsm_quality_runs r WHERE r.id=(SELECT x.id FROM cfsm_quality_runs x WHERE x.server_id=r.server_id AND x.kind=r.kind ORDER BY x.created_at DESC LIMIT 1) LIMIT 500").all();
  const result={};
  for(const row of rows.results||[]){
    if(!ids.has(row.server_id))continue;
    const key=row.server_id;
    if(!result[key])result[key]={};
    if(!result[key][row.kind])result[key][row.kind]=makeHome(rowValue(row));
  }
  return {servers:result,disabled_server_ids:disabled};
}
async function qualityDetail(env,id,admin){
  const server=await safeServer(env.DB,id);
  if(!isVisible(server,admin))throw new QualityError('server_not_found',404);
  if(isDomestic(server.region,await lookupOpts(env.DB,'country:'+id)))
    return {server_id:id,ip:null,net:null,history:[],disabled:true};
  const rows=await env.DB.prepare('SELECT id,kind,created_at,source_ip,payload FROM cfsm_quality_runs WHERE server_id=? ORDER BY created_at DESC LIMIT 90').bind(id).all();
  const items={ip:null,net:null},history=[];
  for(const row of rows.results||[]){
    const data=rowValue(row);
    if(!data)continue;
    if(!items[row.kind])items[row.kind]=data;
    if(row.kind==='ip'&&history.length<40)history.push({id:data.id,at:data.created_at,scores:clean(data.report?.Score)});
  }
  return {server_id:id,ip:items.ip,net:items.net,history};
}
async function updateOptions(request,env){
  const data=await readPayload(request);
  if(!obj(data)||!['global','server'].includes(data.scope))throw new QualityError('invalid_scope');
  const key=data.scope==='global'?'global':'server:'+data.id;
  if(data.scope==='server')await safeServer(env.DB,data.id);
  if(!bool(data.enabled)||!validHours(data.ip_hours)||!validHours(data.net_hours))throw new QualityError('invalid_schedule');
  const value=JSON.stringify({enabled:data.enabled,ip_hours:data.ip_hours,net_hours:data.net_hours});
  await env.DB.prepare('INSERT INTO cfsm_quality_options(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();
  return {saved:true};
}
async function optionsDetail(env){
  const [g,s,servers]=await Promise.all([lookupOpts(env.DB,'global'),env.DB.prepare("SELECT key,value FROM cfsm_quality_options WHERE key LIKE 'server:%'").all(),env.DB.prepare('SELECT id,region FROM servers').all()]);
  const overrides={};for(const row of s.results||[])try{overrides[row.key.slice(7)]=JSON.parse(row.value);}catch{}
  return {global:{...DEFAULTS,...clean(g)},overrides,disabled_server_ids:await domesticServerIds(env.DB,servers.results||[])};
}
export async function handleIndependentQuality(request,env,loadSettings,checkAuth){
  const u=new URL(request.url),path=u.pathname;
  const paths=new Set(['/api/quality/home','/api/quality/detail','/api/quality/report','/api/quality/config','/api/quality/settings','/api/quality/request']);
  if(!paths.has(path))return null;
  try {
    const now=Date.now();
    if(path==='/api/quality/report' && request.method==='POST')return json(await qualityUpload(request,env));
    if(path==='/api/quality/config' && request.method==='GET'){
      const {id,source,server}=await agentAuth(request,env);await ensureQualityTables(env.DB);
      // request.cf country belongs to the authenticated Cloudflare ingress,
      // never to an untrusted custom header.
      const c=countryCode(request.cf?.country);
      const country=/^[A-Z]{2}$/.test(c)?c:null;
      if(country)await rememberObservedCountry(env.DB,id,country);
      return json({schema_version:1,schedule:await qualitySchedule(env.DB,id,server.region,country),now,
        source_ipv4:source && isIP(source)===4 ? source : null,source_country:country});
    }
    if(!['GET','POST'].includes(request.method))throw new QualityError('method_not_allowed',405);
    const settings=await loadSettings(env.DB),admin=await checkAuth(request,env,settings);
    if(path==='/api/quality/request'){
      if(!admin || request.method!=='POST')throw new QualityError('unauthorized',401);
      await ensureQualityTables(env.DB);
      const data=await readPayload(request);if(!goodId(data?.id)||!KINDS.has(data?.kind))throw new QualityError('invalid_request');
      const server=await safeServer(env.DB,data.id);
      if(isDomestic(server.region,await lookupOpts(env.DB,'country:'+data.id)))
        throw new QualityError('domestic_quality_disabled',409);
      const at=Date.now(),key='request:'+data.id+':'+data.kind;
      await env.DB.prepare('INSERT INTO cfsm_quality_options(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(at)).run();
      return json({requested:true,kind:data.kind,at});
    }
    if(path==='/api/quality/settings'){
      if(!admin)throw new QualityError('unauthorized',401);
      await ensureQualityTables(env.DB);
      if(request.method==='POST')return json(await updateOptions(request,env));
      if(request.method==='GET')return json(await optionsDetail(env));
      throw new QualityError('method_not_allowed',405);
    }
    if(!hasSiteAccess(settings,admin))throw new QualityError('unauthorized',401);
    if(request.method!=='GET')throw new QualityError('method_not_allowed',405);
    await ensureQualityTables(env.DB);
    if(path==='/api/quality/home')return json(await qualityHome(env,settings,admin));
    if(path==='/api/quality/detail')return json(await qualityDetail(env,u.searchParams.get('id'),admin));
    throw new QualityError('not_found',404);
  }catch(e){return json({error:e instanceof QualityError?e.message:'quality_internal_error'},e instanceof QualityError?e.status:500);}
}
