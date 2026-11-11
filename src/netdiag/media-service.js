import {DiagnosticError,publicIP,normalizeProxycheck,normalizeIpapi,normalizeIpwho,normalizeIpinfo,qualityEvidence,text,finite} from './core.js';

export const MEDIA_IDS=Object.freeze([
 ['netflix','Netflix','media'],['disney','Disney+','media'],['youtube','YouTube Premium','media'],
 ['prime','Prime Video','media'],['spotify','Spotify','media'],['tiktok','TikTok','media'],
 ['chatgpt','ChatGPT','ai'],['openai_api','OpenAI API','ai'],['claude','Claude','ai'],
 ['gemini','Gemini','ai'],['grok','Grok','ai']
]);
export const MEDIA_VERSION='1.3.0';
const VALID=new Set(['catalog','originals_only','reachable','login_required','restricted','challenge','unknown','network_error']);
const REASONS=new Set(['catalog_observed','originals_only_signal','page_accessible','auth_required','regional_denial','anti_bot','network_failed','dns_failed','timeout','unknown_response','other_http','no_catalog_proof','provider_limited']);
const NORMALIZERS={'proxycheck.io':normalizeProxycheck,'ipapi.is':normalizeIpapi,'ipwho.is':normalizeIpwho,'IPinfo':normalizeIpinfo};
const SCHEMA=[
 'CREATE TABLE IF NOT EXISTS netdiag_media_runs(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,created_at INTEGER NOT NULL,ip TEXT,status TEXT NOT NULL,payload TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS idx_netdiag_media_server ON netdiag_media_runs(server_id,created_at DESC)'
];
export async function ensureMediaSchema(db){await db.batch(SCHEMA.map(sql=>db.prepare(sql)));}
const decode=row=>{if(!row)return null;try{return {...JSON.parse(row.payload),record_id:row.id,created_at:row.created_at,ip:row.ip,status:row.status};}catch{return null;}};
export async function lastMedia(db,id,now=Date.now()){return decode(await db.prepare('SELECT id,created_at,ip,status,payload FROM netdiag_media_runs WHERE server_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 1').bind(id,now+120000).first());}
export function validateObservations(body,expectedIP,now=Date.now()){
 if(!body||body.schema_version!==3||body.version!==MEDIA_VERSION||!/^[-a-zA-Z0-9]{16,80}$/.test(body.run_id||''))throw new DiagnosticError('invalid_media_report');
 if(!publicIP(expectedIP)||body.ip!==expectedIP)throw new DiagnosticError('ip_changed_recheck',409);
 if(!Array.isArray(body.services)||body.services.length!==MEDIA_IDS.length)throw new DiagnosticError('invalid_service_count');
 if(!body.quality||typeof body.quality!=='object'||Array.isArray(body.quality))throw new DiagnosticError('invalid_quality');
 const services=MEDIA_IDS.map(([id,name,category])=>{
   const matches=body.services.filter(r=>r&&r.id===id);
   if(matches.length!==1)throw new DiagnosticError('invalid_service_id');
   const r=matches[0];
   if(!VALID.has(r.status)||!REASONS.has(r.reason))throw new DiagnosticError('invalid_service_status');
   if(r.region!=null&&!/^[A-Z]{2}$/.test(r.region))throw new DiagnosticError('invalid_service_region');
   if(!Number.isInteger(r.http_code)||r.http_code<0||r.http_code>599)throw new DiagnosticError('invalid_http_code');
   return {id,name,category,status:r.status,reason:r.reason,http_code:r.http_code,region:r.region||null,
     checked_at:finite(r.checked_at,now-600000,now+120000)||now,latency_ms:finite(r.latency_ms,0,30000)};
 });
 const providers=Object.entries(NORMALIZERS).map(([name,fn])=>{
   const entry=body.quality[name];
   if(!entry||typeof entry!=='object'||Array.isArray(entry)||!Object.prototype.hasOwnProperty.call(entry,'raw'))
     return {provider:name,status:'unavailable',checked_at:now,error:text(entry?.error,64)||'no_response'};
   try{
     if(JSON.stringify(entry.raw).length>30000)throw new DiagnosticError('provider_payload_too_large');
     return fn(entry.raw,expectedIP,now);
   }catch(e){return {provider:name,status:'unavailable',checked_at:now,error:e.code||'invalid_provider_result'};}
 });
 return {media:{schema_version:3,version:MEDIA_VERSION,checked_at:now,source:'VPS IPv4 direct HTTPS',status:services.some(x=>x.status==='network_error')?'partial':'complete',services,
   note:'Page reachability is not confirmed streaming playback, account eligibility, or regional unlock. 403 may be an anti-bot challenge.'},
 quality:{ip:expectedIP,checked_at:now,providers,status:providers.every(x=>x.status==='ok')?'complete':providers.some(x=>x.status==='ok')?'partial':'unavailable',
   evidence:qualityEvidence(providers),source:'VPS IPv4 direct HTTPS',notice:'Missing or disputed risk data does not imply a clean IP.'}};
}
export async function acceptObservations(db,id,ip,body,now=Date.now()){
 await ensureMediaSchema(db);const {media,quality}=validateObservations(body,ip,now);
 const commands=[
 db.prepare('INSERT OR IGNORE INTO netdiag_media_runs(id,server_id,created_at,ip,status,payload) VALUES(?,?,?,?,?,?)').bind(id+':media:'+body.run_id,id,now,ip,media.status,JSON.stringify(media)),
 db.prepare('INSERT OR IGNORE INTO netdiag_runs(id,server_id,kind,created_at,ip,status,payload) VALUES(?,?,?,?,?,?,?)').bind(id+':quality:'+body.run_id,id,'quality',now,ip,quality.status,JSON.stringify(quality)),
 db.prepare('DELETE FROM netdiag_media_runs WHERE id IN (SELECT id FROM netdiag_media_runs WHERE server_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 40)').bind(id),
 db.prepare('DELETE FROM netdiag_runs WHERE id IN (SELECT id FROM netdiag_runs WHERE server_id=? AND kind=? ORDER BY created_at DESC LIMIT -1 OFFSET 60)').bind(id,'quality')
 ];
 const writes=await db.batch(commands);return {accepted:true,duplicate:writes?.[0]?.meta?.changes===0,version:MEDIA_VERSION,received_at:now};
}
export function sanitizeMedia(record){
 if(!record)return null;
 return {record_id:record.record_id,created_at:record.created_at,ip:record.ip,status:record.status,version:record.version,
 services:MEDIA_IDS.map(([id,name,category])=>{
   const r=record.services?.find(x=>x.id===id);
   return r?{id,name,category,status:VALID.has(r.status)?r.status:'unknown',reason:REASONS.has(r.reason)?r.reason:'unknown_response',
     http_code:finite(r.http_code,0,599),region:/^[A-Z]{2}$/.test(r.region||'')?r.region:null,checked_at:r.checked_at,latency_ms:finite(r.latency_ms,0,30000)}:
     {id,name,category,status:'unknown',reason:'unknown_response',region:null,http_code:null};
 })};
}
export async function mediaHistory(db,id,now=Date.now()){
 const r=await db.prepare('SELECT id,created_at,ip,status FROM netdiag_media_runs WHERE server_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 15').bind(id,now+120000).all();
 return (r.results||[]).map(x=>({...x,kind:'media'}));
}
export async function mediaRun(db,id,run,now=Date.now()){
 const r=await db.prepare('SELECT id,created_at,ip,status,payload FROM netdiag_media_runs WHERE id=? AND server_id=? AND created_at<=?').bind(run,id,now+120000).first();
 return sanitizeMedia(decode(r));
}