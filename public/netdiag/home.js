import {nqShort,nqFull,nqNameInfo} from './nq-ui.js';
// Frozen AnotherLuminaPlus adapter: compact cards; full reports in native server detail.
const ORDER=['cu','ct','cm'];
const NAMES={cu:'福州联通',ct:'福州电信',cm:'福州移动'};
const A={9929:'联通精品网 9929',4837:'联通 169 骨干',10099:'联通国际 CUG',4809:'电信 CN2',4134:'电信 163 骨干',58453:'移动国际 CMI',58807:'移动国际 CMI',9808:'移动 CMNET',174:'Cogent',1299:'Arelion',2914:'NTT',3257:'GTT',3356:'Lumen',6453:'TATA'};
const T={unknown:'未知',pending:'待接入',yes:'是',no:'否',na:'未返回',unavailable:'不可用',quality:'IP 质量',basic:'基础信息',type:'IP 类型',risk:'风险指标',factor:'风险因子',route:'回程路由',history:'历史记录',detail:'IP / 路由详情',refresh:'刷新展示',update:'更新 IP 信息',source:'数据来源',operator:'运营商',country:'国家 / 地区',city:'城市',proxy:'代理',hosting:'机房',abuser:'滥用标记',time:'检测时间',current:'最新结果',check:'查看',noData:'暂无检测记录',loading:'正在读取诊断数据…',failure:'读取失败',stale:'历史结果',conflict:'来源不一致',viewReport:'完整报告',allHops:'完整跳点',masked:'内网跳点（已隐藏）',oldTarget:'旧目标记录，不参与现在的线路判断',login:'请先登录监控后台',noFlags:'基础数据源不提供风险判断',geoHint:'IP 地理信息仅供参考，不代表路由器的确切物理位置',caveat:'不同数据源的评分不能直接平均；未知不等于安全，机房不等于恶意',traceHint:'UDP traceroute 与 ICMP 是不同测试；* 只表示本跳未响应，不能直接当作终端丢包',noExtra:'未启用：流媒体 / AI 解锁、邮件、批量 DNSBL 测试。未测试不显示为通过。',extra:'其他检测范围',staleWarning:'IP、目标或时间已变更，以下为历史观测，不应当作当前状态'};
const STATUS={complete:'已完成',partial:'部分可见',timeout:'探测超时',dns_error:'DNS 失败',tool_missing:'缺少工具',permission_denied:'权限不足',unavailable:T.unavailable,error:'检测失败',ok:'正常'};
export function getHomeQuality(q){const available=(q?.providers||[]).filter(p=>p.status==='ok');const flag=k=>{const v=available.filter(p=>typeof p.flags?.[k]==='boolean');return{value:!v.length?null:new Set(v.map(p=>p.flags[k])).size>1?'mixed':v[0].flags[k],source:v.map(p=>p.provider).join(', ')};};return{available,availableCount:available.length,info:available.find(p=>p.asn||p.operator)||null,risk:available.find(p=>typeof p.risk==='number')||null,flags:{proxy:flag('proxy'),vpn:flag('vpn'),hosting:flag('hosting'),tor:flag('tor')}};}
export const getHomeRoutes=r=>ORDER.map(key=>({key,label:NAMES[key],data:r?.routes?.find(x=>x.key===key)||null}));
export const homeRouteSummary=r=>!r?T.pending:r.stale?T.stale:STATUS[r.status]||T.unknown;
export const readableAsn=n=>A[Number(n)]||'AS'+n;
export function readableLine(r){const line=r?.line||r;if(!r)return T.pending;const seq=(line.segments||[]).filter(s=>s.known).map(s=>readableAsn(s.asn));if(seq.length)return seq.slice(0,5).join(' → ');const labels=line.labels||line.lines||[];return labels.length?labels.map(s=>{const m=s.match(/AS\s?(\d+)/i);return m&&A[+m[1]]?A[+m[1]]:s;}).slice(0,5).join(' → '):T.unknown;}
export function routeEndpointStatus(r){return r?.reached?'目标已响应':'目标未确认到达';}
export function parseRoute(path,hash=''){const source=hash.startsWith('#/')?hash.slice(1):path;const m=source.match(/^\/(?:server|instance)\/([^/?#]+)\/?(?:[?#].*)?$/);try{return m?decodeURIComponent(m[1]):null;}catch{return null;}}
const str=x=>x===null||x===undefined||x===''?T.unknown:String(x);
const ms=x=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(1)+' ms':'—';
const when=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(x)):T.noData;
const bool=x=>x===true?T.yes:x===false?T.no:T.na;
function el(tag,cls='',...kids){const n=document.createElement(tag);if(cls)n.className=cls;for(const k of kids.flat())if(k!==null&&k!==undefined)n.append(k instanceof Node?k:document.createTextNode(String(k)));return n;}
function a(href,label,cls=''){const n=el('a',cls,label);n.href=href;return n;}
function button(label,handler){const n=el('button','cfnd-btn',label);n.type='button';n.addEventListener('click',handler);return n;}
function table(headers,rows){const n=el('table','cfnd-table',el('thead','',el('tr','',...headers.map(x=>el('th','',x)))));n.append(el('tbody','',...rows.map(row=>el('tr','',...row.map(x=>el('td','',x))))));return el('div','cfnd-table-scroll',n);}
function section(num,title,...content){return el('section','cfnd-section',el('h3','cfnd-section-title',el('span','cfnd-num',num),title),...content);}
function flagBadge(name,f){const b=el('span','cfnd-badge',name+': '+(f.value==='mixed'?T.conflict:bool(f.value)));if(f.source)b.title=f.source;if(f.value==='mixed'||f.value===true)b.classList.add('cfnd-warn');return b;}
function summaryCard(s){
  const n=el('section','cfnd-inline cfnd-nq-integrated card-metric-section');
  n.dataset.cfndServer=s.id;
  n.append(nqShort(s.nq));
  const routes=el('div','cfnd-summary-routes');
  for(const {key,label} of getHomeRoutes(s.route)){
    const live=s.live?.rows?.find(r=>r.key===key);
    const value=typeof live?.value==='number'?live.value.toFixed(0)+'ms':'—';
    const loss=typeof live?.loss==='number'?live.loss+'% loss':'丢包未知';
    const row=el('div','cfnd-summary-route',el('span','cfnd-carrier',label),el('span','cfnd-path',value+' · '+loss));
    row.title=label+' 由原始主探针实时检测，与每周 NQ 不同频率';
    routes.append(row);
  }
  n.append(routes,a('/server/'+encodeURIComponent(s.id)+'#network-report','查看 NQ 详情 ›','cfnd-detail-link'));
  return n;
}
function sourceMatrix(q){
  const providers=q?.providers||[];
  if(!providers.length)return el('p','cfnd-muted',T.noData);
  const fields=[['ASN',p=>p.asn],[T.operator,p=>p.operator],[T.country,p=>[p.country,p.country_code,p.region].filter(Boolean).join(' / ')],[T.city,p=>p.city],[T.type,p=>p.network_type],[T.time,p=>when(p.checked_at)]];
  return table([T.source,...providers.map(p=>p.provider)],fields.map(([label,value])=>[label,...providers.map(p=>p.status==='ok'?str(value(p)):T.unavailable)]).concat([[T.source+' status',...providers.map(p=>p.status==='ok'?(p.coverage==='basic'?T.noFlags:'OK'):p.error||T.unavailable)]]));
}
function scores(q){return el('div','cfnd-score-grid',...(q?.providers||[]).map(p=>{const n=el('article','cfnd-score-card',el('strong','',p.provider));const v=p.status==='ok'&&typeof p.risk==='number'?p.risk:null;n.append(el('div','cfnd-score',v===null?'—':v,el('small','',v===null?'': '/100')));if(v!==null){const progress=el('progress','');progress.max=100;progress.value=v;progress.setAttribute('aria-label',p.provider+' '+T.risk);n.append(progress);}n.append(el('span','cfnd-muted',p.status!=='ok'?p.error||T.unavailable:p.coverage==='basic'?T.noFlags:T.risk));if(p.network_abuse_score)n.append(el('p','cfnd-muted','网段滥用比例: '+p.network_abuse_score));if(typeof p.confidence==='number')n.append(el('p','cfnd-muted','Confidence: '+p.confidence));n.append(el('p','cfnd-muted',when(p.checked_at)));return n;}));}
function factors(q){const ps=q?.providers||[];const defs=[['proxy',T.proxy],['vpn','VPN'],['tor','Tor'],['hosting',T.hosting],['abuser',T.abuser],['anonymous','Anonymous'],['compromised','Compromised'],['scraper','Scraper'],['crawler','Crawler'],['mobile','Mobile'],['bogon','Bogon']];return table([T.factor,...ps.map(p=>p.provider)],defs.map(([key,label])=>[label,...ps.map(p=>p.status==='ok'?bool(p.flags?.[key]):T.unavailable)]));}
function routeReport(target,r,live){
  const root=el('article','cfnd-route-report',el('div','cfnd-route-title',el('h4','',target.label),el('span','cfnd-badge',r?STATUS[r.status]||r.status:T.pending)));
  root.append(el('p','cfnd-endpoint','VPS → '+target.host+' · ICMP / UDP traceroute'));
  if(live)root.append(el('p','cfnd-muted','主探针 ICMP: '+ms(live.value)+' · Loss '+(typeof live.loss==='number'?live.loss+'%':'—')));
  if(!r){root.append(el('p','cfnd-muted',T.pending));return root;}
  if(r.target_matches===false)root.append(el('p','cfnd-banner',T.oldTarget+' ('+r.host+')'));
  root.append(el('p','cfnd-route-chain',readableLine(r)));
  const p=r.icmp,t=r.tcp;const rows=p?[[ 'ICMP',p.sent+' / '+p.received,ms(p.avg_ms),ms(p.min_ms),ms(p.max_ms),ms(p.mdev_ms),p.loss_pct===null?'—':p.loss_pct+'%']]:t?[[ 'TCP',str(t.attempts)+' / '+str(t.successes),ms(t.median_ms),ms(t.min_ms),ms(t.max_ms),ms(t.jitter_ms),'—']]:[];
  if(rows.length)root.append(table(['方式','Sent / OK','AVG / P50','MIN','MAX','MDEV / Variation','ICMP Loss'],rows));
  root.append(el('p','cfnd-muted',routeEndpointStatus(r)+' · '+(r.method||'UDP traceroute')));
  const hops=(r.hops||[]).map(h=>[h.ttl,h.private&&!h.ip?T.masked:h.ip||'*',(h.asns||[]).map(x=>'AS'+x).join(', ')||T.unknown,(h.asns||[]).map(readableAsn).join(' / ')||h.geo?.isp||T.unknown,[h.geo?.country,h.geo?.region,h.geo?.city].filter(Boolean).join(' / ')||T.unknown,(h.rtts_ms||[]).map(ms).join(' / ')||'*',h.annotation||'']);
  root.append(table(['TTL','IP','ASN',T.operator,T.country,'RTT','Note'],hops),el('p','cfnd-muted',T.geoHint));return root;
}
export function renderReport(root,data,actions={}){
  const s=data.server,q=s.quality,r=s.route;root.replaceChildren();root.className='cfnd-report';root.id='network-report';
  const heading=el('header','cfnd-report-heading',el('div','',el('h2','',T.viewReport),el('p','cfnd-muted',(s.name||'')+' · '+str(s.ip)+' · '+data.release)));
  const controls=el('div','cfnd-controls');if(actions.refresh)controls.append(button(T.refresh,actions.refresh));// NQ is only scheduled once per week; display refresh never starts heavy tests.if(actions.install&&data.can_refresh)controls.append(button('复制每周 NQ 安装命令',actions.install));heading.append(controls);root.append(heading);
  const overview=[['IPv4',str(s.ip_v4)],['IPv6',str(s.ip_v6)],['NQ 最新运行',when(s.nq?.checked_at)],
    ['主探针上报',when(s.ip_seen_at)],['主探针模式',str(s.live?.mode)]];
  root.append(el('div','cfnd-nq-native-info',...overview.map(([label,value])=>el('span','cfnd-nq-native-pair',
    el('b','',label),el('span','',value)))));
  root.append(section('01','完整 NodeQuality · 每周五北京时间 21:00',nqFull(s.nq,s.nq_full)));
  root.append(section('02','福州三网实时与原有回程记录',
    ...(data.targets||[]).map(t=>routeReport(t,r?.routes?.find(x=>x.key===t.key),s.live?.rows?.find(x=>x.key===t.key))),
    el('p','cfnd-muted','主探针 ICMP 继续实时统计。单独路由组件已切换为每周完整 NQ；下方旧回程跳点可能是历史数据。')));
  const history=(data.history||[]).map(h=>[when(h.created_at),h.kind==='nq'?'完整 NQ':h.kind==='quality'?'旧 IP 风险':T.route,
    str(h.ip),STATUS[h.status]||h.status,actions.select?button(T.check,()=>actions.select(h.id)):T.unknown]);
  root.append(section('03','每周 NQ / 旧诊断历史',
    history.length?table([T.time,'Type','IP','Status',T.check],history):el('p','cfnd-muted',T.noData)));
  root.append(el('p','cfnd-muted','完整 NQ 包含 HardwareQuality、IPQuality、NetQuality 和回程路由检测。大规模测速和硬件基准仅在周五 21:00 运行；实时资源监控始终由原主探针提供。'));
}
async function request(path,body){const headers={Accept:'application/json'};try{const token=localStorage.getItem('jwt_token');if(token)headers.Authorization='Bearer '+token;}catch{}if(body){headers['Content-Type']='application/json';headers['X-CFSM-Netdiag']='1';}const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);try{const r=await fetch('/api/netdiag/'+path,{method:body?'POST':'GET',headers,credentials:'same-origin',cache:'no-store',redirect:'error',signal:c.signal,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(r.status===401?T.login:data.error||'HTTP '+r.status);return data;}finally{clearTimeout(timer);}}
function setTitleIp(title,server){
  if(!title||!server.ip)return;
  let ip=title.parentElement?.querySelector(':scope > .cfnd-title-ip');
  if(!ip){ip=el('span','cfnd-title-ip');title.after(ip);if(/^H[1-6]$/.test(title.tagName))title.classList.add('cfnd-native-title');else title.parentElement?.classList.add('cfnd-title-row');}
  if(ip.textContent!==server.ip)ip.textContent=server.ip;ip.title=server.ip;ip.dataset.cfndServer=server.id;
  const old=title.parentElement?.querySelector(':scope > .cfnd-nq-name-info');const current=nqNameInfo(server);
  if(current){if(old)old.replaceWith(current);else ip.after(current);}else if(old)old.remove();
}
export function startAdapter(){
  if(location.pathname.startsWith('/netdiag'))return;
  let summaries=new Map(),queued=false,loading=false,detailLoading=false,detailKey='',routeKey='',report=null,last=0,homeGeneration=0,detailError='',retryAt=0;
  async function refreshHome(){if(loading||document.hidden)return;loading=true;try{const data=await request('home');summaries=new Map((data.servers||[]).map(s=>[s.id,s]));homeGeneration++;last=Date.now();schedule();}catch(e){console.info('[CFSM] diagnostic summaries unavailable');}finally{loading=false;}}
  async function refreshDetail(id,run=''){
    const key=id+':'+run;if(detailLoading||key===detailKey||Date.now()<retryAt)return;detailLoading=true;detailError='';
    try{const data=await request('detail?id='+encodeURIComponent(id)+(run?'&run='+encodeURIComponent(run):''));if(parseRoute(location.pathname,location.hash)!==id)return;report=data;detailKey=key;schedule();}catch(e){detailKey='';detailError=e.message;retryAt=Date.now()+30000;}finally{detailLoading=false;schedule();}
  }
  function sync(){
    const id=parseRoute(location.pathname,location.hash),newKey=id||'home';
    if(routeKey!==newKey){routeKey=newKey;report=null;detailKey='';detailError='';retryAt=0;document.querySelectorAll('.cfnd-report').forEach(n=>n.remove());}
    if(id){
      const s=summaries.get(id)||report?.server;const title=document.querySelector('main h1,main h2,#root h1');if(s&&title)setTitleIp(title,s);
      if(!report){if(detailError){let error=document.querySelector('.cfnd-report');const parent=document.querySelector('main')||document.querySelector('#root');if(parent&&!error){error=el('section','cfnd-report',el('p','cfnd-banner',detailError),button(T.refresh,()=>{retryAt=0;detailError='';void refreshDetail(id);}));parent.append(error);}}void refreshDetail(id);return;}
      let host=document.querySelector('.cfnd-report');const parent=document.querySelector('main')||document.querySelector('#root');if(!parent)return;
      if(!host){host=el('section','cfnd-report');parent.append(host);}
      if(host.dataset.record===detailKey)return;
      renderReport(host,report,{refresh:()=>{detailKey='';retryAt=0;void refreshDetail(id);},install:()=>copyInstall(host),select:run=>{detailKey='';void refreshDetail(id,run);}});host.dataset.record=detailKey;
      return;
    }
    const cards=document.querySelectorAll('article.server-card[id^="node-card-"],article.compact-node-card[id^="node-card-"],a.node-list-row[id^="node-card-"]');
    for(const card of cards){
      const sid=card.id.slice('node-card-'.length),s=summaries.get(sid);if(!s)continue;
      const title=card.querySelector('.server-card-title-link,.compact-node-title,.mini-node-title,.node-list-name')||card.querySelector('a[href^="/server/"]');if(title)setTitleIp(title,s);
      const isList=card.matches('a.node-list-row'),parent=isList?card.querySelector('.node-list-node-text'):card.matches('.compact-node-card')?card:card.querySelector('.server-card-stack');if(!parent)continue;
      let current=parent.querySelector(':scope > .cfnd-inline,:scope > .cfnd-list-summary');if(current?.dataset.generation===String(homeGeneration))continue;
      const next=isList?el('span','cfnd-list-summary',[s.nq?.info?.asn,s.nq?.scores?.find(p=>p.score!==null)?.source,'NQ '+(s.nq?.status||'待检测')].filter(Boolean).join(' · ')):summaryCard(s);
      next.dataset.generation=String(homeGeneration);if(current)current.replaceWith(next);else parent.append(next);
    }
  }
  function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;if(!document.hidden)sync();},150);}
  new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.cfnd-inline,.cfnd-report,.cfnd-title-ip,.cfnd-list-summary')))schedule();}).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',schedule);window.addEventListener('hashchange',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden){schedule();if(Date.now()-last>240000)void refreshHome();}});
  setInterval(()=>{if(!document.hidden){void refreshHome();if(report){detailKey='';void refreshDetail(report.server.id);}}},300000);
  void refreshHome();schedule();
}
async function copyInstall(root){
  const base='/netdiag/nq/';
  try{
    const response=await fetch(base+'manifest.json',{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw Error('manifest_unavailable');
    const manifest=await response.json();
    if(manifest.version!=='1.0.0'||!/^[a-f0-9]{64}$/.test(manifest.install_sha256))throw Error('invalid_nq_manifest');
    const code="bash <<'CFSM_WEEKLY_NQ'\nset -euo pipefail\nf=$(mktemp)\ntrap 'rm -f \"$f\"' EXIT\ncurl -q -4fsSL --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 90 https://monitor.nnot.de"+base+"install.sh -o \"$f\"\nprintf '%s  %s\\n' '"+manifest.install_sha256+"' \"$f\" | sha256sum -c -\nbash \"$f\" install\nCFSM_WEEKLY_NQ";
    let box=root.querySelector('.cfnd-install-command');
    if(!box){box=el('pre','cfnd-install-command');root.append(box);}
    box.textContent=code;
    try{await navigator.clipboard.writeText(code);}catch{}
  }catch(e){alert(e.message);}
}
export async function mountStandalone(root){
  const shell=el('div','cfnd-standalone'),nav=el('nav','cfnd-standalone-nav',a('/','← 监控首页')),select=el('select','cfnd-server-select'),content=el('section','cfnd-report');shell.append(nav,content);root.replaceChildren(shell);content.textContent=T.loading;
  let id=new URL(location.href).searchParams.get('server')||'';
  async function load(run=''){try{const data=await request('detail?id='+encodeURIComponent(id)+(run?'&run='+encodeURIComponent(run):''));renderReport(content,data,{refresh:()=>load(),install:()=>copyInstall(content),select:load});}catch(e){content.replaceChildren(el('p','cfnd-banner',e.message),a('/admin#/admin',T.login));}}
  try{const data=await request('home');for(const s of data.servers||[]){const option=el('option','',s.name+' '+(s.ip||''));option.value=s.id;select.append(option);}if(!data.servers?.some(s=>s.id===id))id=data.servers?.[0]?.id||'';select.value=id;select.addEventListener('change',()=>{id=select.value;void load();});nav.append(select);if(id)await load();else content.textContent=T.noData;}catch(e){content.textContent=e.message;}
}
if(typeof document!=='undefined')startAdapter();
