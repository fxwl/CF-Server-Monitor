// Compact, source-attributed diagnostics use the existing AnotherLuminaPlus typography
// and color tokens. Never turn a missing source response into a zero/clean score.
const STATUS={catalog:['片库可访问','ok'],originals_only:['仅自制剧迹象','warn'],reachable:['网页可达','neutral'],login_required:['需账号验证','neutral'],restricted:['地区限制','bad'],challenge:['挑战 / 拒绝','warn'],unknown:['无法判断','unknown'],network_error:['网络失败','bad']};
const FLAGS=[['proxy','代理'],['vpn','VPN'],['hosting','机房'],['tor','Tor'],['abuser','滥用'],['anonymous','匿名'],['compromised','被控'],['scraper','爬虫'],['crawler','Crawler'],['mobile','移动网络'],['bogon','保留地址']];
const safe=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100?x:null;
const ns=(tag,cls='',str='')=>{const n=document.createElement(tag);n.className=cls;if(str!==null)n.textContent=String(str);return n;};
const part=(text,cls='')=>ns('span',cls,text);
const metric=(v,suffix='')=>v===null||v===undefined?'—':String(v)+suffix;
function band(value,label,mini=false){
 const wrap=ns('div',mini?'cfnd-risk-meter mini':'cfnd-risk-meter');const rail=ns('div','cfnd-risk-rail'),fill=ns('i','cfnd-risk-fill');
 const n=safe(value);if(n!==null){fill.style.width=n+'%';rail.append(fill);}else rail.classList.add('cfnd-empty');
 rail.setAttribute('role','img');rail.setAttribute('aria-label',label+': '+(n===null?'未知':n+'/100'));
 wrap.append(rail,part(n===null?'—':n+'/100','cfnd-risk-number'));return wrap;
}
function statusTone(status){return STATUS[status]?.[1]||'unknown';}
function grouped(media,kind){
 return (media?.services||[]).filter(x=>x.category===kind);
}
export function compactRisk(quality){
 const ps=(quality?.providers||[]).filter(p=>p.status==='ok');
 const scored=ps.filter(p=>safe(p.risk)!==null);
 const wrap=ns('div','cfnd-compact-risk');
 if(scored.length){for(const p of scored.slice(0,2)){
   const row=ns('div','cfnd-compact-metric');
   row.append(part(p.provider,'cfnd-caption'),band(p.risk,p.provider,true));
   wrap.append(row);
 }}else{const row=ns('div','cfnd-compact-metric');row.append(part('风险评分','cfnd-caption'),band(null,'无可用评分',true));wrap.append(row);}
 const keys=['proxy','vpn','hosting'];const values=keys.map(k=>({k,arr:ps.map(p=>p.flags?.[k]).filter(v=>typeof v==='boolean')}));
 const matrix=ns('div','cfnd-compact-factors');
 for(const {k,arr} of values){const word=FLAGS.find(f=>f[0]===k)?.[1]||k;
   const v=!arr.length?'—':arr.some(Boolean)&&arr.some(x=>x===false)?'冲突':arr[0]?'已标记':'未标记';
   const tone=v==='已标记'||v==='冲突'?'warn':v==='未标记'?'ok':'unknown';
   const item=ns('span','cfnd-factor-small '+tone,word+' '+v);item.title=ps.filter(p=>typeof p.flags?.[k]==='boolean').map(p=>p.provider+': '+p.flags[k]).join('\n')||'来源未返回';matrix.append(item);
 }
 wrap.append(matrix);
 return wrap;
}
export function compactMedia(media){
 const wrap=ns('div','cfnd-compact-media');
 for(const [kind,label] of [['media','流媒体'],['ai','AI']]){
   const items=grouped(media,kind),row=ns('div','cfnd-compact-media-row');
   const cat=part(label,'cfnd-caption'),bar=ns('div','cfnd-segment-rail');
   for(const x of items){const seg=ns('i','cfnd-segment '+statusTone(x.status));seg.title=x.name+': '+(STATUS[x.status]?.[0]||'未知');bar.append(seg);}
   if(!items.length){bar.classList.add('cfnd-empty');bar.append(ns('i','cfnd-segment unknown'));}
   const avail=items.filter(x=>x.status==='catalog').length,reachable=items.filter(x=>x.status==='reachable'||x.status==='login_required').length;
   const count=part(!items.length?'待检测':avail?avail+' 项有片库信号':reachable?reachable+' 项可达':'无可确认项','cfnd-caption cfnd-right');
   row.append(cat,bar,count);wrap.append(row);
 }return wrap;
}
export function metaInline(server){
 const p=(server.quality?.providers||[]).find(x=>x.status==='ok'&&(x.asn||x.operator||x.city));
 const values=[p?.asn,p?.operator,p?.city||p?.country].filter(Boolean);
 if(!values.length)return null;const node=ns('span','cfnd-native-info',values.slice(0,3).join(' · '));
 node.title='IP 数据源: '+p.provider;node.dataset.cfndServer=server.id;return node;
}
export function riskVisual(quality){
 const root=ns('div','cfnd-risk-native');
 if(!quality?.providers?.length){root.append(ns('p','cfnd-muted','尚无 IP 风险检测记录'));return root;}
 const scored=quality.providers.filter(p=>p.status==='ok');
 const grid=ns('div','cfnd-risk-source-grid');
 for(const p of quality.providers){const unit=ns('div','cfnd-risk-source'),header=ns('div','cfnd-risk-source-head');
   header.append(part(p.provider,'cfnd-source-name'),part(p.status==='ok'?'已获取':(p.error||'查询不可用'),'cfnd-source-state'));
   unit.append(header);
   if(safe(p.risk)!==null)unit.append(band(p.risk,p.provider));
   else unit.append(ns('p','cfnd-muted','无独立风险评分（不可视为 0 分）'));
   const fields=[p.asn,p.operator,p.network_type].filter(Boolean).join(' · ');
   if(fields)unit.append(part(fields,'cfnd-source-info'));
   if(p.network_abuse_score)unit.append(part('网段滥用比例 '+p.network_abuse_score,'cfnd-source-info'));
   grid.append(unit);
 }
 root.append(grid);
 if(!scored.some(p=>safe(p.risk)!==null))root.append(ns('p','cfnd-muted','风险平台没有返回可比较的分数，图表不会显示虚构的“安全值”。'));
 return root;
}
export function factorVisual(quality){
 const root=ns('div','cfnd-matrix-scroll'),t=ns('table','cfnd-factor-matrix');t.setAttribute('aria-label','各数据源风险因子');
 const head=ns('tr');head.append(ns('th','','风险项目'));for(const p of quality?.providers||[])head.append(ns('th','',p.provider));t.append(head);
 for(const [key,label] of FLAGS){const tr=ns('tr');tr.append(ns('th','',label));
   for(const p of quality?.providers||[]){const x=p.status==='ok'?p.flags?.[key]:null;
     const td=ns('td');const chip=ns('span','cfnd-factor-cell '+(x===true?'warn':x===false?'ok':'unknown'),x===true?'已标记':x===false?'未标记':'未知');chip.title=p.provider+' · '+label;td.append(chip);tr.append(td);
   }t.append(tr);
 }root.append(t);return root;
}
export function mediaVisual(media){
 const root=ns('div','cfnd-media-native');
 if(!media){root.append(ns('p','cfnd-muted','等待 VPS 安装诊断 1.3.0 后上报。'));return root;}
 if(media.stale)root.append(ns('p','cfnd-banner','这是历史出口的检测结果，不代表当前 IP 可用性。'));
 for(const [kind,label] of [['media','流媒体'],['ai','AI 服务']]){
   const rows=grouped(media,kind),hdr=ns('div','cfnd-media-heading');
   hdr.append(ns('strong','',label),part(rows.length+' 项检查','cfnd-caption'));root.append(hdr);
   const graph=ns('div','cfnd-media-chart');
   for(const x of rows){
     const tone=statusTone(x.status),block=ns('div','cfnd-media-item'),state=STATUS[x.status]?.[0]||'未知';
     block.append(ns('span','cfnd-media-dot '+tone),part(x.name,'cfnd-media-name'),part(state,'cfnd-media-state '+tone),part(x.region||'','cfnd-media-region'));
     block.title='HTTP '+metric(x.http_code)+' · '+(x.reason||'无原因')+' · 仅验证此 VPS IPv4 出口';graph.append(block);
   }root.append(graph);
 }
 root.append(ns('p','cfnd-muted','“网页可达”“需要登录”不等于完整解锁。Netflix 片库信号也不保证实际播放；403、429 可由反机器人策略导致。仅测试 VPS IPv4 出口，未测 IPv6、代理分流或账号权限。'));
 return root;
}
export function miniRouteChart(route,targets,live){
 const root=ns('div','cfnd-route-visual');
 for(const t of targets||[]){
   const r=route?.routes?.find(x=>x.key===t.key),m=live?.rows?.find(x=>x.key===t.key);
   const row=ns('div','cfnd-route-visual-row'),label=ns('span','cfnd-route-carrier',t.label);
   const rail=ns('div','cfnd-route-rail');
   const n=typeof m?.loss==='number'&&m.loss>=0&&m.loss<=100?m.loss:null;
   const fill=ns('i','cfnd-route-fill');if(n!==null)fill.style.width=(100-n)+'%';else rail.classList.add('cfnd-empty');rail.append(fill);
   const caption=part(n===null?'未上报':metric(m?.value,' ms')+' / '+n+'% 丢包','cfnd-caption');
   row.append(label,rail,caption);row.title=r?.line?.summary||'路径未确认';root.append(row);
 }return root;
}