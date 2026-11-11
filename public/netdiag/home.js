// In-card network intelligence for the pinned AnotherLuminaPlus React theme.
// No new page-level panel. This module intentionally never modifies React state.
const ORDER=['cu','ct','cm'];
const NAMES={cu:'福州联通',ct:'福州电信',cm:'福州移动'};
const ROUTE_STATUS={complete:'已到达',partial:'部分可见',timeout:'探测超时',dns_error:'DNS 失败',permission_denied:'权限不足',tool_missing:'工具缺失',error:'探测失败'};
const AS_NAMES={
  9929:'联通精品网 9929',4837:'联通 169 骨干',10099:'联通国际 CUG',4809:'电信 CN2',
  4134:'电信 163 骨干',58453:'移动国际 CMI',58807:'移动国际 CMI',9808:'移动 CMNET',
  174:'Cogent 国际骨干',1299:'Arelion 国际骨干',2914:'NTT 国际骨干',
  3257:'GTT 国际骨干',3356:'Lumen 国际骨干',6453:'TATA 国际骨干'
};
export function getHomeQuality(quality){
  const available=(quality?.providers||[]).filter(p=>p?.status==='ok');
  const info=available.find(p=>p.asn||p.operator)||available[0]||null;
  const risk=available.find(p=>typeof p.risk==='number'&&Number.isFinite(p.risk))||null;
  const knownFlag=key=>{
    const votes=available.map(p=>({source:p.provider,value:p.flags?.[key]})).filter(v=>typeof v.value==='boolean');
    if(!votes.length)return {value:null,source:null};
    const values=new Set(votes.map(v=>v.value));
    return {value:values.size>1?'mixed':votes[0].value,source:votes.map(v=>v.source).join('、')};
  };
  return {available,info,risk,flags:{proxy:knownFlag('proxy'),vpn:knownFlag('vpn'),hosting:knownFlag('hosting'),tor:knownFlag('tor')},
    count:available.length};
}
export function getHomeRoutes(route){return ORDER.map(key=>({key,label:NAMES[key],data:route?.routes?.find(r=>r.key===key)||null}));}
export function homeRouteSummary(route){return !route?'待接入':route.stale?'历史结果':ROUTE_STATUS[route.status]||'等待数据';}
export function readableAsn(asn){const n=Number(asn);return AS_NAMES[n]||('AS'+n);}
export function readableLine(route){
  if(!route)return '待本机诊断组件上报';
  const asns=(route.segments||[]).filter(x=>x.known).map(x=>x.asn);
  if(asns.length)return [...new Set(asns)].slice(0,4).map(readableAsn).join(' → ');
  const labels=(route.lines||[]).map(x=>{
    const match=String(x).match(/AS\s?(\d{2,10})/i);
    return match&&AS_NAMES[Number(match[1])]?AS_NAMES[Number(match[1])]:String(x);
  });
  return labels.length?[...new Set(labels)].slice(0,4).join(' → '):'暂未识别骨干线路';
}
export function routeEndpointStatus(route){
  if(!route)return '待检测';
  if(route.status==='dns_error')return '目标解析失败';
  if(route.status==='tool_missing')return '缺少 traceroute';
  if(route.status==='permission_denied')return '路由工具权限不足';
  if(route.status==='timeout')return '路由探测超时';
  return route.reached?'目标已响应':'目标未确认到达';
}
const fmtTime=value=>{
  if(!value||!Number.isFinite(Number(value)))return '尚无记录';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(Number(value)));
};
const fmtMs=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(0)+'ms':'—';
function node(tag,cls='',...children){
  const el=document.createElement(tag);if(cls)el.className=cls;
  for(const x of children){if(x===null||x===undefined)continue;el.append(x instanceof Node?x:document.createTextNode(String(x)));}
  return el;
}
function span(cls,text){return node('span',cls,text);}
function badge(name,flag){
  const status=flag?.value===true?'是':flag?.value===false?'否':flag?.value==='mixed'?'来源冲突':'未知';
  const n=span('cfnd-badge '+(flag?.value==='mixed'?'cfnd-dispute':flag?.value===true?'cfnd-flagged':''),name+':'+status);
  if(flag?.source)n.title='检测数据源：'+flag.source;
  return n;
}
function qualityBlock(server,compact){
  const q=getHomeQuality(server.quality),wrap=node('div','cfnd-quality');
  const ip=span('cfnd-ip',server.ip||'公网 IP 待上报');
  wrap.append(node('div','cfnd-quality-head',span('cfnd-title','IP 质量'),ip));
  const info=q.info;
  const asn=[info?.asn,info?.operator].filter(Boolean).join(' · ');
  wrap.append(span('cfnd-info',asn||'ASN / 运营商：等待数据源'));
  if(!compact){
    const region=[info?.city,info?.country||info?.country_code].filter(Boolean).join(' · ');
    if(region)wrap.append(span('cfnd-info',region));
  }
  const line=node('div','cfnd-quality-flags');
  if(q.risk){
    const risk=span('cfnd-badge cfnd-risk',q.risk.provider+' 风险 '+q.risk.risk+'/100');
    risk.title='仅表示 '+q.risk.provider+' 自有算法；不能用于推断账号被封概率';
    line.append(risk);
  }else{
    const unknown=span('cfnd-badge','风险评分：未知');
    unknown.title='现有风险检测源不可用，不等于低风险或安全';
    line.append(unknown);
  }
  line.append(badge('代理',q.flags.proxy),badge('VPN',q.flags.vpn),badge('机房',q.flags.hosting));
  wrap.append(line);
  if(server.quality?.stale)wrap.append(span('cfnd-warning','IP 已变化或记录已过期'));
  return wrap;
}
function hopRow(h){
  const info=(h.asns||[]).map(readableAsn).join(' / ')||'未知运营商';
  const parts=[h.geo?.city,h.geo?.region,h.geo?.country].filter(Boolean);
  const place=[...new Set(parts)].join(' · ');
  const line=node('div','cfnd-hop');
  line.append(span('cfnd-hop-ttl',String(h.ttl).padStart(2,'0')),span('cfnd-hop-ip',h.ip||'*'),
    span('cfnd-hop-name',info));
  if(place)line.append(span('cfnd-hop-place',place));
  return line;
}
function carrierBlock(key,label,r,full){
  const row=node('div','cfnd-route-row');
  const top=node('div','cfnd-route-top');
  top.append(span('cfnd-carrier cfnd-'+key,label),span('cfnd-rtt','TCP '+fmtMs(r?.median_ms)));
  row.append(top,span('cfnd-chain',readableLine(r)));
  if(!r){row.append(span('cfnd-muted','等待本机检测'));return row;}
  const detail=node('details','cfnd-route-detail');
  const success=typeof r.success_pct==='number'?r.success_pct+'%':'未统计';
  const summary=node('summary','',span('cfnd-detail-label','连接成功率 '+success+' · '+routeEndpointStatus(r)),span('cfnd-detail-action','查看跳点'));
  detail.append(summary);
  const geoNote=node('div','cfnd-muted','方向：VPS → '+label+'。跳点位置来自 IP 地理库，可能偏差；* 代表中间路由器未响应，不等于终端丢包。');
  detail.append(geoNote);
  if(Array.isArray(r.visible_hops)&&r.visible_hops.length){
    const hops=node('div','cfnd-hop-list');
    for(const h of r.visible_hops)hops.append(hopRow(h));
    detail.append(hops);
  }else detail.append(span('cfnd-muted','没有可用的公网跳点；暂不能判断实际路由。'));
  row.append(detail);
  return row;
}
function buildFull(server){
  const root=node('section','cfnd-inline card-metric-section');root.dataset.cfndServer=server.id;
  root.setAttribute('aria-label','IP 质量与福州三网回程');
  root.append(qualityBlock(server,false));
  const heading=node('div','cfnd-heading',span('cfnd-title','福州三网回程'));
  heading.append(span('cfnd-sub',server.route?.stale?'历史数据':'联通 · 电信 · 移动'));
  root.append(heading);
  const routes=node('div','cfnd-routes');
  for(const {key,label,data} of getHomeRoutes(server.route))routes.append(carrierBlock(key,label,data,true));
  root.append(routes);
  root.append(span('cfnd-source-note','仅凭已响应跳点判断线路 · 不测试下载速度 · 检测 '+fmtTime(server.route?.checked_at)));
  return root;
}
function buildCompact(server){
  const root=node('section','cfnd-inline cfnd-compact');root.dataset.cfndServer=server.id;
  root.setAttribute('aria-label','IP 质量与福州三网回程');
  root.append(qualityBlock(server,true));
  const routes=node('div','cfnd-routes');
  for(const {key,label,data} of getHomeRoutes(server.route))routes.append(carrierBlock(key,label,data,false));
  root.append(routes);return root;
}
function buildList(server){
  const line=span('cfnd-list-summary','联通 '+fmtMs(server.route?.routes?.find(r=>r.key==='cu')?.median_ms)+
    ' / 电信 '+fmtMs(server.route?.routes?.find(r=>r.key==='ct')?.median_ms)+
    ' / 移动 '+fmtMs(server.route?.routes?.find(r=>r.key==='cm')?.median_ms));
  line.dataset.cfndServer=server.id;
  const q=getHomeQuality(server.quality);
  line.title=[q.info?.asn,q.info?.operator, ...getHomeRoutes(server.route).map(({label,data})=>label+': '+readableLine(data))].filter(Boolean).join('\n');
  return line;
}
function inHomepage(){return location.pathname==='/'&&(!location.hash||/^#\/?$/.test(location.hash));}
function init(){
  let lookup=new Map(),scheduled=false,pending=false,lastRefresh=0;
  const sync=()=>{
    if(!inHomepage())return;
    const cards=document.querySelectorAll('article.server-card[id^="node-card-"],article.compact-node-card[id^="node-card-"],a.node-list-row[id^="node-card-"]');
    for(const card of cards){
      const id=card.id.slice('node-card-'.length),server=lookup.get(id);
      if(!server)continue;
      const list=card.matches('a.node-list-row'),compact=card.matches('.compact-node-card');
      const parent=list?card.querySelector('.node-list-node-text'):compact?card:card.querySelector('.server-card-stack');
      if(!parent)continue;
      if(parent.querySelector('.cfnd-inline,.cfnd-list-summary'))continue;
      parent.append(list?buildList(server):compact?buildCompact(server):buildFull(server));
    }
  };
  const schedule=()=>{
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;sync();});
  };
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  async function load(){
    if(pending||document.visibilityState==='hidden'||!inHomepage())return;
    pending=true;
    const controller=new AbortController(),kill=setTimeout(()=>controller.abort(),12000);
    try {
      const headers={Accept:'application/json'};
      try{const token=localStorage.getItem('jwt_token');if(token)headers.Authorization='Bearer '+token;}catch{}
      const r=await fetch('/api/netdiag/home',{headers,credentials:'same-origin',cache:'no-store',signal:controller.signal,redirect:'error'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      if(!Array.isArray(data.servers))throw new Error('Invalid server summary');
      lookup=new Map(data.servers.filter(s=>s&&typeof s.id==='string').map(s=>[s.id,s]));
      document.querySelectorAll('.cfnd-inline,.cfnd-list-summary').forEach(el=>el.remove());
      lastRefresh=Date.now();
      schedule();
    }catch(e){
      // Original dashboard keeps working if diagnostic APIs fail.
      console.info('[CFSM Netdiag] Homepage diagnostic data unavailable:',e?.message||'unknown');
    }finally{clearTimeout(kill);pending=false;}
  }
  void load();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>240000)void load();});
  window.addEventListener('popstate',()=>{schedule();if(inHomepage()&&Date.now()-lastRefresh>240000)void load();});
  setInterval(()=>{if(!document.hidden)void load();},5*60*1000);
}
if(typeof document!=='undefined')init();
