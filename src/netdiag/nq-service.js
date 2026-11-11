import {DiagnosticError, publicIP, text, finite} from './core.js';

// Original NodeQuality (AGPL-3.0) is pinned. Do not silently update its payload.
export const NQ_REVISION='a92fca6c0067df29ddd03fdc2fee6f3000f64545';
export const NQ_SCHEMA=4;
export const NQ_PARTS=Object.freeze(['hardware_quality','ip_quality','net_quality','backroute_trace']);
export const NQ_CRON='Fri *-*-* 21:00:00 Asia/Shanghai';
export const NQ_DB=[
 'CREATE TABLE IF NOT EXISTS netdiag_nq_runs(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,created_at INTEGER NOT NULL,ip TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS idx_netdiag_nq_server_at ON netdiag_nq_runs(server_id,created_at DESC)'
];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
export async function ensureNQSchema(db){await db.batch(NQ_DB.map(sql=>db.prepare(sql)));}
const normalizeScore=v=>{
 if(v===null||v===undefined)return null;
 if(typeof v!=='string'&&typeof v!=='number')return null;
 const s=String(v).trim();if(!/^(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]+)?)(%)?$/.test(s))return null;
 const n=Number.parseFloat(s);return Number.isFinite(n)&&n>=0&&n<=100?n:null;
};
function asObj(v){return object(v)?v:{};}
function value(v,max=120){return typeof v==='boolean'?v:typeof v==='number'&&Number.isFinite(v)?v:text(v,max)||null;}
function values(o,max=50){return Object.entries(asObj(o)).slice(0,max).map(([name,v])=>({name:text(name,70),value:value(v)}));}
export function summarizeNQ(record,now=Date.now()){
 if(!record)return null;
 const q=asObj(record.sections?.ip_quality),info=asObj(q.Info),net=asObj(record.sections?.net_quality),hardware=asObj(record.sections?.hardware_quality);
 const city=asObj(info.City),reg=asObj(info.Region),scores=asObj(q.Score),type=asObj(q.Type),factor=asObj(q.Factor),media=asObj(q.Media),mail=asObj(q.Mail);
 const scoreValues=Object.entries(scores).slice(0,20).map(([source,v])=>({source:text(source,48),raw:value(v,48),score:normalizeScore(v)}));
 const factors=Object.entries(factor).slice(0,18).map(([name,providers])=>({
  name:text(name,70),providers:Object.entries(asObj(providers)).slice(0,22).map(([source,flag])=>({source:text(source,48),value:typeof flag==='boolean'?flag:null}))
 }));
 const mediaResults=Object.entries(media).slice(0,24).map(([name,m])=>{
  const p=asObj(m);return{name:text(name,72),status:text(p.Status,36)||'Unknown',region:text(p.Region,32)||null,type:text(p.Type,50)||null};
 });
 const smtp=asObj(mail.DNSBlacklist);
 const fjDelay=(Array.isArray(net.Delay)?net.Delay:[]).find(x=>x?.Code==='FJ'||x?.Name==='闽')||null;
 const delay={};if(fjDelay)for(const [key,label] of [['CU','cu'],['CT','ct'],['CM','cm']]){
  const avg=Number(fjDelay[key]?.Average);delay[label]=Number.isFinite(avg)&&avg>0&&avg<=30000?avg:null;
 }
 const bgp=asObj(net.BGP),local=asObj(net.Local),os=asObj(hardware.OS);
 return {record_id:record.record_id||null,ip:record.ip,checked_at:record.created_at,status:record.status,
  stale:record.stale===true||now-record.created_at>8*86400000,parts:Object.fromEntries(NQ_PARTS.map(k=>[k,!!record.sections?.[k]])),
  info:{asn:text(info.ASN||bgp.ASN,30)||null,operator:text(info.Organization||bgp.Organization,180)||null,
   country:text(reg.Name||bgp.Country,80)||null,city:text(city.Name,80)||null,ip_type:text(info.Type,90)||null},
  usage:values(type.Usage,14),company:values(type.Company,14),scores:scoreValues,
  factors,media:mediaResults,
  mail:{dnsbl_total:finite(smtp.Total,0,100000),dnsbl_clean:finite(smtp.Clean,0,100000),dnsbl_marked:finite(smtp.Marked,0,100000),
    dnsbl_blacklisted:finite(smtp.Blacklisted,0,100000)},
  network:{asn:text(bgp.ASN,30)||null,organization:text(bgp.Organization,180)||null,congestion:text(local.TCPCongestionControl,30)||null,
    qdisc:text(local.QueueDiscipline,40)||null,fuzhou_note:'NetQuality FJ is province-level; do not claim it is a Fuzhou city probe',fujian_avg:delay},
  hardware:{os:text(os.name,100)||null,architecture:text(os.architecture,36)||null}
 };
}
export function validateNQReport(body,ip,now=Date.now()){
 if(!object(body)||body.schema_version!==NQ_SCHEMA||body.script_revision!==NQ_REVISION)throw new DiagnosticError('invalid_nq_schema');
 if(!/^[0-9a-f]{8}-[0-9a-f-]{20,50}$/i.test(body.run_id||''))throw new DiagnosticError('invalid_nq_run_id');
 if(body.ip!==ip||!publicIP(ip))throw new DiagnosticError('nq_ip_mismatch',409);
 if(typeof body.started_at!=='number'||body.started_at>now+120000||body.started_at<now-8*86400000)throw new DiagnosticError('invalid_nq_timestamp');
 if(!object(body.sections))throw new DiagnosticError('invalid_nq_sections');
 const sections={};let count=0;
 for(const k of NQ_PARTS){
   const part=body.sections[k];
   if(part===null||part===undefined){sections[k]=null;continue;}
   if(!object(part)&&!Array.isArray(part))throw new DiagnosticError('invalid_nq_section');
   const size=JSON.stringify(part).length;
   if(size>270000)throw new DiagnosticError('nq_section_too_large',413);
   sections[k]=part;count++;
 }
 if(count===0)throw new DiagnosticError('no_nq_sections');
 const report={schema_version:NQ_SCHEMA,script_revision:NQ_REVISION,started_at:body.started_at,received_at:now,
  ip,sections,status:count===4?'complete':'partial',part_count:count,
  note:'Full NodeQuality JSON: provider scores and media status are attributed, not a safety/unlock guarantee.'};
 if(JSON.stringify(report).length>490000)throw new DiagnosticError('nq_payload_too_large',413);
 return report;
}
function decode(row){
 if(!row)return null;
 try{return {...JSON.parse(row.payload),record_id:row.id,created_at:row.created_at,ip:row.ip,status:row.status};}catch{return null;}
}
export async function latestNQ(db,id,now=Date.now()){
 const row=await db.prepare('SELECT id,created_at,ip,status,payload FROM netdiag_nq_runs WHERE server_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 1').bind(id,now+120000).first();
 return decode(row);
}
export async function nqHistory(db,id,now=Date.now()){
 const r=await db.prepare('SELECT id,created_at,ip,status FROM netdiag_nq_runs WHERE server_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 18').bind(id,now+120000).all();
 return (r.results||[]).map(x=>({...x,kind:'nq'}));
}
export async function findNQ(db,id,run,now=Date.now()){
 if(typeof run!=='string'||run.length>160)return null;
 return decode(await db.prepare('SELECT id,created_at,ip,status,payload FROM netdiag_nq_runs WHERE id=? AND server_id=? AND created_at<=?').bind(run,id,now+120000).first());
}
export async function saveNQ(db,id,ip,body,now=Date.now()){
 await ensureNQSchema(db);
 const report=validateNQReport(body,ip,now),runId=id+':nq:'+body.run_id;
 const writes=await db.batch([
  db.prepare('INSERT OR IGNORE INTO netdiag_nq_runs(id,server_id,created_at,ip,status,payload) VALUES(?,?,?,?,?,?)').bind(runId,id,now,ip,report.status,JSON.stringify(report)),
  db.prepare('DELETE FROM netdiag_nq_runs WHERE id IN (SELECT id FROM netdiag_nq_runs WHERE server_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 26)').bind(id)
 ]);
 return {accepted:true,duplicate:writes?.[0]?.meta?.changes===0,part_count:report.part_count,received_at:now};
}
