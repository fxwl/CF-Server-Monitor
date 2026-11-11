// Native NQ/CFSM chart elements. All content uses text nodes, never upstream HTML.
// Large raw four-section JSON is only rendered for authenticated administrators.
const e=(tag,cls='',value)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(value!==undefined&&value!==null)x.textContent=String(value);return x;};
const stamp=t=>t?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t)):'—';
const title=(tag,text,cls)=>e(tag,cls,text);
const score=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null;
const real=x=>x===null||x===undefined||x===''?'未知':String(x);
function lineMeter(value,caption){
 const row=e('div','cfnd-nq-meter'),label=e('span','cfnd-nq-meter-label',caption),rail=e('div','cfnd-nq-meter-rail'),fill=e('i','cfnd-nq-meter-fill');
 if(score(value)!==null){fill.style.width=value+'%';rail.append(fill);}else rail.classList.add('unmeasured');
 rail.title=caption+': '+(score(value)!==null?value+'/100':'无可用分数');
 row.append(label,rail,e('span','cfnd-nq-meter-value',score(value)!==null?value+'/100':'—'));return row;
}
function mediaColor(status){
 switch(String(status).toLowerCase()){
  case 'yes':case 'native':case 'full':return 'good';
  case 'block':case 'no':case 'failed':return 'bad';
  case 'partial':case 'original':return 'warn';
  default:return 'unknown';
 }
}
function nqMeta(nq){
 const info=nq?.info||{};
 const fields=[info.asn,info.operator,info.city||info.country].filter(Boolean);
 return fields.join(' · ');
}
export function nqShort(nq){
 const root=e('div','cfnd-nq-native');
 if(!nq){root.append(e('div','cfnd-nq-hint','NQ 待首轮周五 21:00 运行'));return root;}
 if(nq.stale)root.append(e('div','cfnd-nq-hint','NQ 历史结果 · 可能不是当前 IP'));
 const scores=(nq.scores||[]).filter(x=>score(x.score)!==null);
 for(const v of scores.slice(0,3))root.append(lineMeter(v.score,v.source));
 if(!scores.length)root.append(lineMeter(null,'NQ 风险'));
 const media=(nq.media||[]).slice(0,12);
 const line=e('div','cfnd-nq-media');
 line.append(e('span','cfnd-nq-media-title','流媒体 / AI'));
 for(const m of media){
  const dot=e('span','cfnd-nq-media-dot '+mediaColor(m.status));
  dot.title=m.name+': '+real(m.status)+(m.region?' ('+m.region+')':'');
  dot.setAttribute('aria-label',dot.title);line.append(dot);
 }
 if(!media.length)line.append(e('span','cfnd-nq-hint','未测'));
 root.append(line);
 root.append(e('span','cfnd-nq-last','NQ '+stamp(nq.checked_at)+' · 每周五 21:00'));
 return root;
}
export function nqNameInfo(server){
 const info=nqMeta(server?.nq);
 return info?e('span','cfnd-nq-name-info',info):null;
}
function group(title,body){
 const sec=e('div','cfnd-nq-group');sec.append(e('h4','cfnd-nq-group-name',title),body);return sec;
}
function grid(entries,max=18){
 const box=e('div','cfnd-nq-kv-grid');
 for(const [k,v] of entries.slice(0,max)){
   const cell=e('div','cfnd-nq-kv');
   cell.append(e('span','cfnd-nq-label',k),e('span','cfnd-nq-value',real(v)));box.append(cell);
 }
 return box;
}
function factorTable(nq){
 const root=e('div','cfnd-nq-factor-wrap');
 for(const f of nq.factors||[]){
   const row=e('div','cfnd-nq-factor-row');
   row.append(e('span','cfnd-nq-factor-name',f.name));
   const chips=e('div','cfnd-nq-factor-chips');
   for(const p of f.providers||[]){
      const state=p.value===true?'risk':p.value===false?'clear':'unknown';
      const chip=e('span','cfnd-nq-factor '+state,p.source+': '+(p.value===true?'已标记':p.value===false?'未标记':'未知'));
      chips.append(chip);
   }row.append(chips);root.append(row);
 }
 if(!(nq.factors||[]).length)root.append(e('p','cfnd-nq-hint','暂无风险因子'));
 return root;
}
function mediaGrid(nq){
 const root=e('div','cfnd-nq-service-grid');
 for(const m of nq.media||[]){
   const unit=e('div','cfnd-nq-service');
   unit.append(e('span','cfnd-nq-service-dot '+mediaColor(m.status)),e('span','cfnd-nq-service-name',m.name),
      e('span','cfnd-nq-service-status',real(m.status)),e('span','cfnd-nq-service-region',m.region||'—'));
   unit.title=m.type?m.type:'来源: NodeQuality IPQuality';
   root.append(unit);
 }if(!(nq.media||[]).length)root.append(e('p','cfnd-nq-hint','尚未获得流媒体与 AI 检测'));
 return root;
}
function rawParts(sections){
 const box=e('div','cfnd-nq-raw');
 const names={ip_quality:'IPQuality 全部 JSON',net_quality:'NetQuality 全部 JSON',hardware_quality:'HardwareQuality 全部 JSON',backroute_trace:'回程路由全部 JSON'};
 for(const key of ['ip_quality','net_quality','hardware_quality','backroute_trace']){
   const d=e('details','cfnd-nq-raw-part'),summary=e('summary','',names[key]);
   d.append(summary);
   const pre=e('pre','cfnd-nq-pre',sections?.[key]?JSON.stringify(sections[key],null,2):'本轮未获得有效 JSON');
   d.append(pre);box.append(d);
 }return box;
}
export function nqFull(nq,raw){
 const root=e('div','cfnd-nq-full');
 if(!nq){root.append(e('p','cfnd-nq-hint','完整 NQ 尚无报告。周五 21:00（北京时间）自动运行，检测数据将按周保留历史。'));return root;}
 const meta=grid([['最近检测',stamp(nq.checked_at)],['本轮状态',nq.status==='complete'?'全部四项完成':'部分报告'],
  ['出口 IP',nq.ip],['ASN',nq.info?.asn],['运营商',nq.info?.operator],['地区',[nq.info?.country,nq.info?.city].filter(Boolean).join(' / ')],
  ['IP 类型',nq.info?.ip_type],['操作系统',nq.hardware?.os],['TCP 拥塞控制',nq.network?.congestion]]);
 root.append(group('NQ 基础信息',meta));
 if(nq.stale)root.append(e('p','cfnd-nq-warning','报告已超过 8 天，或服务器出口 IP 已变化；这是历史记录，不是当前状态。'));
 const bars=e('div','cfnd-nq-bars');
 for(const item of nq.scores||[])bars.append(lineMeter(item.score,item.source));
 if(!(nq.scores||[]).length)bars.append(e('p','cfnd-nq-hint','没有可用风险分数'));
 root.append(group('风险评分 · 各来源独立展示',bars));
 root.append(e('p','cfnd-nq-note','不同来源评分方法不同，不求平均值；未返回≠0 分或纯净。'));
 const typeEntries=[...(nq.usage||[]).map(x=>['用途 '+x.name,x.value]),...(nq.company||[]).map(x=>['企业 '+x.name,x.value])];
 root.append(group('IP 类型多来源比较',grid(typeEntries)));
 root.append(group('风险因子 · NQ 多数据库',factorTable(nq)));
 root.append(group('流媒体 / AI 解锁检测',mediaGrid(nq)));
 const mail=nq.mail||{};
 root.append(group('DNS 黑名单',grid([['查询总数',mail.dnsbl_total],['正常',mail.dnsbl_clean],['标记',mail.dnsbl_marked],['黑名单',mail.dnsbl_blacklisted]])));
 const n=nq.network||{},fj=n.fujian_avg||{};
 root.append(group('NetQuality 网络摘要',grid([['BGP ASN',n.asn],['BGP 运营商',n.organization],
    ['TCP 拥塞控制',n.congestion],['队列调度',n.qdisc],['福建省联通平均延迟',fj.cu===null?'未测':fj.cu+'ms'],
    ['福建省电信平均延迟',fj.ct===null?'未测':fj.ct+'ms'],['福建省移动平均延迟',fj.cm===null?'未测':fj.cm+'ms']])));
 root.append(e('p','cfnd-nq-note','福建省级延迟不等同于福州市级探针；实时福州数据仍以主监控 ICMP 为准。'));
 if(raw)root.append(group('原始完整报告（仅管理员）',rawParts(raw)));
 else root.append(e('p','cfnd-nq-note','登录管理员后可查看并复制四份完整原始 JSON。'));
 return root;
}
