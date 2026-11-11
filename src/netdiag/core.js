import { isIP } from 'node:net';

export const VERSION = '1.1.0';
export const ORDER = Object.freeze(['cu', 'ct', 'cm']);
export const LABELS = Object.freeze({cu:'\u798f\u5dde\u8054\u901a',ct:'\u798f\u5dde\u7535\u4fe1',cm:'\u798f\u5dde\u79fb\u52a8'});
export const TARGETS = Object.freeze([
  {key:'cu', label:LABELS.cu, host:'36.248.48.210', port:80},
  {key:'ct', label:LABELS.ct, host:'fj-fuzhou-ct-v4.ip.zstaticcdn.com', port:80},
  {key:'cm', label:LABELS.cm, host:'csfw.fj.chinamobile.com', port:8080}
]);
export const LIMITS = Object.freeze({body:65536, upstream:131072, maxHops:30, retentionDays:30, maxRuns:60, intervalHours:12});
export const ASN_LABELS = Object.freeze({
  9929:'联通精品网 AS9929',4837:'联通 169 骨干 AS4837',
  10099:'联通国际 CUG AS10099',4809:'电信 CN2 AS4809',
  4134:'电信 163 骨干 AS4134',58453:'移动国际 CMI AS58453',
  58807:'移动国际 CMI AS58807',9808:'中国移动 CMNET AS9808',
  174:'Cogent 国际骨干 AS174',1299:'Arelion 国际骨干 AS1299',2914:'NTT 国际骨干 AS2914',3257:'GTT 国际骨干 AS3257',3356:'Lumen 国际骨干 AS3356',6453:'TATA 国际骨干 AS6453'
});
export class DiagnosticError extends Error {
  constructor(code, status=400) { super(code); this.code=code; this.status=status; }
}
export const text = (value, max=200) => typeof value==='string' ? value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max) : '';
export const finite = (value, min=0, max=1e9) => (typeof value==='number'||typeof value==='string'&&value.trim()!=='') && Number.isFinite(Number(value)) && Number(value)>=min && Number(value)<=max ? Number(value) : null;
export const tri = value => typeof value==='boolean' ? value : null;
export function publicIP(value) {
  if (typeof value!=='string' || value.length>45 || value!==value.trim() || value.includes('%')) return false;
  const v=isIP(value);
  if(v===6) {
    const p=value.toLowerCase();
    return /^[23]/.test(p) && !/^2001:(db8|0)(:|$)/.test(p) && !p.startsWith('2002:');
  }
  if(v!==4) return false;
  const [a,b,c]=value.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0||a===192&&b===0&&c===2||a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
export function targetFor(key) {return TARGETS.find(t=>t.key===key);}
export function selectedTargets(settings={}) {
  // Older deployments swapped the first two slots to obtain CU/CT/CM display order.
  // Read names as well as slots; never confuse the carrier label with the wire key.
  const fields=['custom_ct','custom_cu','custom_cm'];
  return TARGETS.map(target=>{
    const field=fields.find(f=>settings[f+'_name']===target.label) || (target.key==='cu'?'custom_cu':target.key==='ct'?'custom_ct':'custom_cm');
    const configured=String(settings[field]||'');
    const allowed={cu:['36.248.48.210:80','36.250.1.90:8080'],ct:['fj-fuzhou-ct-v4.ip.zstaticcdn.com:80','fj-fuzhou-ct-v4.ip.zstaticcdn.com:443','203.55.129.248:80'],cm:['csfw.fj.chinamobile.com:8080']}[target.key];
    if(!allowed.includes(configured)) return {...target,metricKey:field.slice(7)};
    const pos=configured.lastIndexOf(':');
    return {...target,host:configured.slice(0,pos),port:Number(configured.slice(pos+1)),metricKey:field.slice(7)};
  });
}
export function asns(value) {
  if(!Array.isArray(value))return [];
  return [...new Set(value.map(v=>finite(v,1,4294967295)).filter(v=>Number.isInteger(v)))].slice(0,4);
}
export function classifyRoute(route) {
  const evidence=[];const seen=new Set();const sequence=[];
  for(const hop of route.hops||[]) {
    for(const asn of asns(hop.asns)) {
      if(sequence.at(-1)!==asn)sequence.push(asn);
      if(ASN_LABELS[asn]&&!seen.has(asn)) {seen.add(asn);evidence.push({asn,label:ASN_LABELS[asn],ttl:hop.ttl,ip:hop.ip});}
    }
  }
  const segments=sequence.map(asn=>({asn,label:ASN_LABELS[asn]||('AS'+asn),known:!!ASN_LABELS[asn]})).slice(0,24);
  const readable=segments.filter(x=>x.known).map(x=>x.label);
  return {labels:evidence.map(e=>e.label),evidence,as_path:sequence,segments,
    summary:readable.length?readable.slice(0,5).join(' → '):'暂未识别骨干线路',
    confidence:evidence.length?'observed':'unknown',
    caveat:'仅按实际响应跳点识别经过的运营商骨干，不代表全路径。隐藏跳点/不对称路由可能改变结果；AS4809 不能直接证明 CN2 GIA。'};
}
export async function fingerprint(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function routeChanges(previous,current) {
  return ORDER.map(key=>{
    const a=previous?.routes?.find(r=>r.key===key), b=current?.routes?.find(r=>r.key===key);
    if(!a||!b)return {key,status:'first_observation'};
    if(a.target_ip!==b.target_ip||a.host!==b.host||a.port!==b.port)return {key,status:'target_changed'};
    const signature=r=>JSON.stringify((r.hops||[]).map(h=>[h.ttl,h.ip,asns(h.asns)]));
    const valid=r=>['complete','partial','timeout'].includes(r.status)&&r.hops?.some(h=>h.ip);
    if(!valid(a)||!valid(b))return {key,status:'insufficient_data'};
    return {key,status:signature(a)===signature(b)?'unchanged':a.reached&&b.reached?'changed':'observed_path_changed'};
  });
}
export function normalizeProxycheck(raw,ip,now=Date.now()) {
  if(!raw || !['ok','warning'].includes(raw.status) || !raw[ip] || typeof raw[ip]!=='object')throw new DiagnosticError('provider_invalid_response',502);
  const r=raw[ip], n=r.network||{}, l=r.location||{}, d=r.detections||{};
  return {provider:'proxycheck.io',status:'ok',checked_at:now,warning:raw.status==='warning'?'provider_warning':null,
    ip,asn:text(n.asn,30),operator:text(n.organisation||n.provider),network_type:text(n.type,50)||null,
    country:text(l.country_name||l.country,80),country_code:text(l.country_code||l.isocode,8),region:text(l.region_name||l.region,80),city:text(l.city_name||l.city,80),
    risk:finite(d.risk,0,100),confidence:finite(d.confidence,0,100),
    flags:{proxy:tri(d.proxy),vpn:tri(d.vpn),tor:tri(d.tor),hosting:tri(d.hosting),anonymous:tri(d.anonymous),compromised:tri(d.compromised)},
    source:'https://proxycheck.io/api/',score_note:'Provider risk score, not a compromise probability or an account-ban guarantee.'};
}
export function normalizeIpapi(raw,ip,now=Date.now()) {
  if(!raw||raw.error||raw.ip!==ip)throw new DiagnosticError('provider_invalid_response',502);
  const keyed=raw.asn&&typeof raw.asn==='object';const a=keyed?raw.asn:{};const loc=raw.location||raw;
  const c=raw.company&&typeof raw.company==='object'?raw.company:{};
  return {provider:'ipapi.is',status:'ok',checked_at:now,coverage:keyed?'full':'basic',ip,
    asn:keyed?(a.asn?'AS'+a.asn:''):(finite(raw.asn_num,1,4294967295)?'AS'+raw.asn_num:text(raw.asn,160)),operator:text(c.name||raw.company_name||raw.company||a.org||raw.asn_org),network_type:text(c.type||a.type,50)||null,
    country:text(loc.country,80),country_code:text(loc.country_code||raw.cc,8),region:text(loc.state||loc.region,80),city:text(loc.city,80),
    network_abuse_score:text(c.abuser_score,80)||null,risk:null,
    flags:{proxy:tri(raw.is_proxy),vpn:tri(raw.is_vpn),tor:tri(raw.is_tor),hosting:tri(raw.is_datacenter),abuser:tri(raw.is_abuser)},
    source:'https://ipapi.is/developers.html',score_note:'Network abuse ratio is not a per-IP risk score. Response fields vary by provider tier. Missing flags remain unknown.'};
}

export function normalizeIpwho(raw,ip,now=Date.now()){
  if(!raw||raw.success!==true||raw.ip!==ip)throw new DiagnosticError('provider_invalid_response',502);
  const connection=raw.connection&&typeof raw.connection==='object'?raw.connection:{};
  const asn=finite(connection.asn,1,4294967295);
  return{provider:'ipwho.is',status:'ok',coverage:'basic',checked_at:now,ip,
    asn:asn===null?null:'AS'+asn,operator:text(connection.org||connection.isp,160)||null,
    network_type:null,country:text(raw.country,80)||null,country_code:text(raw.country_code,8)||null,
    region:text(raw.region,80)||null,city:text(raw.city,80)||null,risk:null,
    flags:{proxy:null,vpn:null,tor:null,hosting:null,abuser:null},
    source:'https://ipwho.is/',score_note:'仅提供 ASN/归属地；不提供代理或风险检测。'};
}
export function normalizeIpinfo(raw,ip,now=Date.now()){
  if(!raw||raw.ip!==ip||raw.error)throw new DiagnosticError('provider_invalid_response',502);
  const org=text(raw.org,160),match=org.match(/^AS(\d+)\s*(.*)$/i);
  return{provider:'IPinfo',status:'ok',coverage:'basic',checked_at:now,ip,
    asn:match?'AS'+match[1]:null,operator:(match?match[2]:org)||null,
    network_type:null,country:null,country_code:text(raw.country,8)||null,
    region:text(raw.region,80)||null,city:text(raw.city,80)||null,risk:null,
    flags:{proxy:null,vpn:null,tor:null,hosting:null,abuser:null},
    source:'https://ipinfo.io/',score_note:'免费版仅为 ASN/归属地信息，不能作为 IP 纯净度结论。'};
}
export function qualityEvidence(providers){
  const usable=(Array.isArray(providers)?providers:[]).filter(p=>p?.status==='ok');
  const fields=['proxy','vpn','tor','hosting','abuser'];
  const flags={};
  for(const key of fields){
    const votes=usable.filter(p=>typeof p.flags?.[key]==='boolean').map(p=>({source:p.provider,value:p.flags[key]}));
    flags[key]={status:!votes.length?'unknown':votes.some(v=>v.value)&&votes.some(v=>!v.value)?'disputed':votes[0].value?'flagged':'not_flagged',
      sources: votes};
  }
  const agreement=field=>{
    const set=[...new Set(usable.map(p=>field==='country'?text(p.country_code,8).toUpperCase():text(p.asn,40)).filter(Boolean))];
    return !set.length?'unknown':set.length>1?'disputed':'consistent';
  };
  return{sources_checked:usable.length,sources_total:Array.isArray(providers)?providers.length:0,flags,
    asn_agreement:agreement('asn'),country_agreement:agreement('country'),
    scores:usable.flatMap(p=>typeof p.risk==='number'?[{source:p.provider,value:p.risk,type:'provider_risk'}]:[]),
    note:'不同源的风险评分不可直接平均；未识别不等于无风险，数据源冲突需保留。'};
}

export function validateReport(body,targets,now=Date.now()) {
  if(!body||body.schema_version!==1||!/^[-a-zA-Z0-9]{16,80}$/.test(body.run_id||''))throw new DiagnosticError('invalid_report');
  if(!Array.isArray(body.routes)||body.routes.length!==3)throw new DiagnosticError('exactly_three_routes_required');
  const keys=body.routes.map(r=>r?.key);if(new Set(keys).size!==3||ORDER.some(k=>!keys.includes(k)))throw new DiagnosticError('invalid_carrier_order');
  const allowedStatus=['complete','partial','timeout','dns_error','permission_denied','tool_missing','error'];
  const routes=targets.map(target=>{
    const r=body.routes.find(x=>x.key===target.key);
    if(r.host!==target.host||r.port!==target.port)throw new DiagnosticError('target_config_changed',409);
    if(!allowedStatus.includes(r.status))throw new DiagnosticError('invalid_route_status');
    if(r.target_ip!==null&&r.target_ip!==undefined&&!(isIP(r.target_ip)===4&&publicIP(r.target_ip)))throw new DiagnosticError('non_public_target');
    if(!Array.isArray(r.hops)||r.hops.length>LIMITS.maxHops)throw new DiagnosticError('too_many_hops');
    let last=0;
    const hops=r.hops.map(h=>{
      if(!Number.isInteger(h.ttl)||h.ttl<=last||h.ttl>LIMITS.maxHops)throw new DiagnosticError('invalid_hop_ttl');last=h.ttl;
      if(h.ip!==null&&h.ip!==undefined&&isIP(h.ip)!==4)throw new DiagnosticError('invalid_hop_ip');
      if(!Array.isArray(h.rtts_ms)||h.rtts_ms.length>3)throw new DiagnosticError('invalid_rtt');
      const publicHop=publicIP(h.ip),geo=publicHop&&h.geo&&typeof h.geo==='object'?h.geo:null;
      return {ttl:h.ttl,ip:h.ip||null,rtts_ms:h.rtts_ms.map(x=>finite(x,0,30000)).filter(x=>x!==null),
        asns:publicHop?asns(h.asns):[],asn_source:publicHop&&h.asns?.length?'RIPE RIS via RIPEstat':null,
        geo:geo?{country:text(geo.country,60)||null,region:text(geo.region,60)||null,city:text(geo.city,60)||null,
          isp:text(geo.isp,90)||null,source:'ipwho.is'}:null,
        annotation:text(h.annotation,24),private:h.ip?!publicHop:false};
    });
    const reached=!!r.target_ip&&hops.some(h=>h.ip===r.target_ip);
    const tcp=r.tcp||{};const attempts=finite(tcp.attempts,0,8);const successes=finite(tcp.successes,0,8);
    const min=finite(tcp.min_ms,0,30000),max=finite(tcp.max_ms,0,30000),jitter=finite(tcp.jitter_ms,0,30000);
    if(attempts!==null&&!Number.isInteger(attempts)||successes!==null&&!Number.isInteger(successes)||attempts!==null&&successes!==null&&successes>attempts||min!==null&&max!==null&&min>max)throw new DiagnosticError('invalid_tcp_counts');
    const result={key:target.key,label:target.label,host:target.host,port:target.port,target_ip:r.target_ip||null,
      method:'udp-unprivileged',status:r.status==='complete'&&!reached?'partial':r.status,reached,hops,
      tcp:{attempts,successes,median_ms:finite(tcp.median_ms,0,30000),min_ms:min,max_ms:max,jitter_ms:jitter,
        success_pct:attempts>0&&successes!==null?Math.round(successes/attempts*1000)/10:null},
      error:text(r.error,100)||null,
      duration_ms:finite(r.duration_ms,0,240000)};
    result.line=classifyRoute(result);return result;
  });
  return {schema_version:1,version:text(body.version,32),run_id:body.run_id,reported_started_at:finite(body.started_at,0,now+86400000),
    received_at:now,routes,source:'Local non-root collector',note:'TCP connect latency and UDP traceroute measure different protocols. A silent intermediate hop is not end-to-end packet loss.'};
}
export async function limitedJson(streamOwner,max=LIMITS.body) {
  const length=Number(streamOwner.headers?.get('content-length'));
  if(Number.isFinite(length)&&length>max)throw new DiagnosticError('payload_too_large',413);
  if(!streamOwner.body)throw new DiagnosticError('empty_body');
  const reader=streamOwner.body.getReader();let size=0;const chunks=[];
  try { for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new DiagnosticError('payload_too_large',413);}chunks.push(value);} }
  finally {reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const part of chunks){data.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{throw new DiagnosticError('invalid_json');}
}
export async function secretEqual(expected,provided) {
  if(typeof expected!=='string'||!expected||typeof provided!=='string'||provided.length>512)return false;
  const key=await crypto.subtle.importKey('raw',crypto.getRandomValues(new Uint8Array(32)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(expected));
  return crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(provided));
}
