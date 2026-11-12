/* CFSM AnotherLuminaPlus: final server-detail integration based on user-approved CFSM detail HTML. */
(() => {
  'use strict';
  if(window.__CFSMQualityDetailFinal5)return;
  window.__CFSMQualityDetailFinal5=true;
  const cache=new Map();
  const pending=new Set();
  const errors=new Map();
  const views=new Map();
  const disabled=new Set();
  let throttle=null;
  let refreshTimeout=null;
  const factorFields=[
    ['Proxy','代理检测'],['Tor','Tor 匿名网络'],['VPN','VPN 检测'],
    ['Server','服务器特征'],['Abuser','滥用风险'],['Robot','机器人特征']
  ];
  const factorHeaders=[['CountryCode','地区'],...factorFields];
  const providerOrder=['IP2LOCATION','SCAMALYTICS','ipapi','AbuseIPDB','IPQS','DBIP'];
  const classifierOrder=['IPinfo','ipregistry','ipapi','AbuseIPDB','IP2LOCATION','SCAMALYTICS','IPQS','DBIP'];
  const factorOrder=['IP2LOCATION','ipapi','ipregistry','IPQS','SCAMALYTICS','ipdata','IPinfo','IPWHOIS','DBIP'];
  const mediaOrder=['TikTok','DisneyPlus','Netflix','Youtube','AmazonPrimeVideo','Reddit','ChatGPT'];
  const mediaLabels={DisneyPlus:'Disney+',Youtube:'YouTube',AmazonPrimeVideo:'Prime Video'};
  function el(tag,cls,value){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(value!==undefined && value!==null)n.textContent=String(value);
    return n;
  }
  const defined=v=>v!==undefined&&v!==null&&v!==''&&v!=='null';
  const val=v=>defined(v)?String(v):'—';
  const key=v=>String(v||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  function find(obj,id){
    const name=Object.keys(obj||{}).find(x=>key(x)===key(id));
    return name===undefined?null:obj[name];
  }
  function date(ts){
    if(!ts||!Number.isFinite(Number(ts)))return '—';
    return new Intl.DateTimeFormat('zh-CN',{
      timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
    }).format(new Date(Number(ts)));
  }
  function head(section,title,meta){
    const h=el('header','instance-panel-header');
    const labels=el('div','instance-panel-headings');
    const row=el('div','instance-panel-title-row');
    row.append(el('h2','instance-panel-title',title));
    labels.append(row);
    if(meta)labels.append(el('p','instance-panel-description',meta));
    h.append(labels);
    section.append(h);
    return section;
  }
  function textTone(v){
    if(v===true)return 'cfsmq-good';
    if(v===false)return 'cfsmq-good';
    if(typeof v==='string'&&/家宽|住宅|ISP/.test(v))return 'cfsmq-good';
    if(typeof v==='string'&&/商业/.test(v))return 'cfsmq-blue';
    return '';
  }
  function kv(parent,name,value,kind){
    const row=el('div','cfsmq-kv');
    row.append(el('span','',name),el('strong',kind||'',val(value)));
    parent.append(row);
    return row;
  }
  function infoBox(parent,title,cls){
    const p=el('div','cfsmq-infobox'+(cls?' '+cls:''));
    p.append(el('h3','',title));
    parent.append(p);
    return p;
  }
  function table(parent,headers,rows,kind){
    const wrap=el('div','cfsmq-table-wrap'+(kind?' '+kind:''));
    const tbl=el('table','cfsmq-table');
    const thead=el('thead'),heading=el('tr');
    headers.forEach(x=>heading.append(el('th','',x)));
    thead.append(heading);
    tbl.append(thead);
    const body=el('tbody');
    for(const values of rows){
      const tr=el('tr');
      values.forEach((x,i)=>{
        const raw=x&&typeof x==='object'&&Object.prototype.hasOwnProperty.call(x,'value')?x.value:x;
        const className=x&&typeof x==='object'&&Object.prototype.hasOwnProperty.call(x,'className')?x.className:'';
        const td=el('td',className,val(raw));
        if(kind==='cfsmq-matrix-wrap')td.dataset.label=headers[i];
        tr.append(td);
      });
      body.append(tr);
    }
    tbl.append(body);
    wrap.append(tbl);
    parent.append(wrap);
    return tbl;
  }
  function part(parent,title,cls){
    const n=el('div','cfsmq-part'+(cls?' '+cls:''));
    n.append(el('h3','',title));
    parent.append(n);
    return n;
  }
  function raw(parent,title,data){
    const details=el('details','cfsmq-raw-toggle');
    details.append(el('summary','',title));
    const pre=el('pre','cfsmq-raw',typeof data==='string'?data:JSON.stringify(data,null,2));
    details.append(pre);parent.append(details);
  }
  function order(keys,preferred){
    const originals=new Map();
    keys.forEach(name=>{if(!originals.has(key(name)))originals.set(key(name),name);});
    const result=[],seen=new Set();
    for(const name of [...preferred,...keys]){
      const normalized=key(name);
      if(!originals.has(normalized)||seen.has(normalized))continue;
      seen.add(normalized);
      result.push(preferred.find(x=>key(x)===normalized)||originals.get(normalized));
    }
    return result;
  }
  function keyMetrics(ip){
    const tiles=el('div','cfsmq-tiles');
    const tile=(label,value,tone,sub)=>{
      const t=el('div','cfsmq-tile'+(tone?' is-'+tone:''));
      t.append(el('span','cfsmq-tile-label',label),el('strong','cfsmq-tile-value',val(value)));
      if(sub)t.append(el('small','cfsmq-tile-sub',sub));
      tiles.append(t);
    };
    const factors=ip.Factor||{};
    let hit=0,total=0;
    for(const [id] of factorFields){
      const items=Object.values(factors[id]||{});
      hit+=items.filter(x=>x===true).length;
      total+=items.filter(x=>x===true||x===false).length;
    }
    tile('风险命中',total?hit+' / '+total:'—',!total?'':hit===0?'good':hit/total>0.2?'bad':'warn',
      '代理 / VPN / Tor 等检测项');
    const scores=Object.values(ip.Score||{}).map(numericScore).filter(n=>n!==null);
    const worst=scores.length?Math.max(...scores):null;
    tile('最高风险分',worst===null?'—':String(worst),worst===null?'':worst===0?'good':worst>=50?'bad':'warn',
      scores.length+' 个机构评分');
    const media=ip.Media||{};
    const keys=Object.keys(media);
    const ok=keys.filter(k=>String(media[k]?.Status||'').includes('解锁')).length;
    const okNames=keys.filter(k=>String(media[k]?.Status||'').includes('解锁')).map(k=>mediaLabels[k]||k);
    tile('流媒体 / AI',keys.length?ok+' / '+keys.length:'—',!keys.length?'':ok===keys.length?'good':ok?'warn':'bad',
      okNames.join('、')||'无解锁');
    const mail=ip.Mail||{},dns=mail.DNSBlacklist||{};
    const black=Number(dns.Blacklisted)||0,marked=Number(dns.Marked)||0;
    tile('DNS 黑名单',defined(dns.Total)?black+' / '+dns.Total:'—',!defined(dns.Total)?'':black?'bad':marked?'warn':'good',
      '标记 '+val(dns.Marked));
    const p25=mail.Port25;
    tile('25 端口',p25===true?'可用':p25===false?'封禁':val(p25),p25===true?'good':p25===false?'bad':'','邮件发信');
    return tiles;
  }
  function topRow(data){
    const ip=data.ip?.report||{};
    const info=ip.Info||{};
    const grid=el('div','cfsmq-approved-top');
    grid.dataset.cfsmq='top';
    const left=infoBox(grid,'IP 基础属性','cfsmq-basics');
    const columns=el('div','cfsmq-basic-columns');
    const a=el('div'),b=el('div');
    kv(a,'公网 IP',data.ip?.ip||ip.Head?.IP);
    kv(a,'IP 类型',info.Type);
    kv(a,'位置',[info.Region?.Name,info.City?.Name].filter(defined).join(' · '));
    kv(b,'ASN',defined(info.ASN)?'AS'+String(info.ASN).replace(/^AS/i,''):'—');
    kv(b,'运营商',info.Organization);
    kv(b,'注册地区',info.RegisteredRegion?.Code||info.RegisteredRegion?.Name);
    columns.append(a,b);left.append(columns);
    const right=infoBox(grid,'关键指标','cfsmq-key-box');
    right.append(keyMetrics(ip));
    return grid;
  }
  function numericScore(raw){
    if(!defined(raw))return null;
    const n=Number(String(raw).replace(',','.').replace('%','').trim());
    return Number.isFinite(n)?n:null;
  }
  function trendBlock(data){
    const container=el('div','cfsmq-trend');
    container.dataset.cfsmq='trend';
    const ip=data.ip?.report||{},scores=ip.Score||{};
    const rows=el('div','cfsmq-trend-head');
    rows.append(el('strong','','IP 风险评分历史'));
    const controls=el('div','cfsmq-trend-controls');
    controls.append(el('span','cfsmq-quiet','检测来源'));
    const select=el('select','cfsmq-score-select');
    const names=order([...Object.keys(scores),...(data.history||[]).flatMap(h=>Object.keys(h.scores||{}))],providerOrder);
    for(const name of names){
      const opt=el('option','',name);
      opt.value=name;
      select.append(opt);
    }
    controls.append(select);
    const current=el('span','cfsmq-current','本次：—');
    controls.append(current);
    rows.append(controls);container.append(rows);
    const layout=el('div','cfsmq-trend-layout');
    const chart=el('div','cfsmq-trend-plot');
    const latest=el('div','cfsmq-score-latest');
    const latestHead=el('div','cfsmq-score-latest-head');
    latestHead.append(el('b','','最新一次评分'),
      el('span','',data.ip?date(data.ip.created_at).slice(5,16):'—'));
    latest.append(latestHead);
    const scoresList=el('div','cfsmq-score-latest-rows');
    const buttons=new Map();
    for(const source of names){
      const button=el('button','cfsmq-score-row');
      button.type='button';
      button.title='查看 '+source+' 的评分历史';
      button.append(el('span','',source),el('strong',defined(find(scores,source))?'':'cfsmq-neutral',val(find(scores,source))));
      scoresList.append(button);
      buttons.set(source,button);
      button.addEventListener('click',()=>{select.value=source;draw();});
    }
    latest.append(scoresList);
    layout.append(chart,latest);
    container.append(layout);
    const history=(data.history||[]).slice().sort((a,b)=>Number(a.at)-Number(b.at));
    function draw(){
      const name=select.value;
      const rawScore=find(scores,name);
      current.textContent='本次：'+(defined(rawScore)?String(rawScore):'无结果');
      for(const [source,button] of buttons){
        const on=source===name;button.classList.toggle('is-active',on);
        button.setAttribute('aria-pressed',on?'true':'false');
      }
      chart.replaceChildren();
      const points=history.map((h,i)=>({i,at:h.at,score:numericScore(find(h.scores,name)),raw:find(h.scores,name)}))
        .filter(item=>item.score!==null);
      if(history.length<2){
        chart.append(el('div','cfsmq-no-trend','目前仅有 '+history.length+' 次检测，无趋势折线'));
        return;
      }
      if(points.length<2){
        chart.append(el('div','cfsmq-no-trend','该机构有效历史评分不足 2 次'));
        return;
      }
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 780 158');
      svg.setAttribute('role','img');svg.setAttribute('aria-label',name+' 的原始风险评分历史');
      const values=points.map(x=>x.score);
      const lo=Math.min(...values),hi=Math.max(...values);
      const pad=Math.max((hi-lo)*.2,hi===lo?1:0.1);
      const min=Math.max(0,lo-pad),max=Math.max(hi+pad,min+1);
      function shape(tag,attrs,text){
        const n=document.createElementNS('http://www.w3.org/2000/svg',tag);
        for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
        if(text!==undefined)n.textContent=text;
        svg.append(n);return n;
      }
      const x=i=>40+i/Math.max(1,history.length-1)*710;
      const y=v=>132-(v-min)/(max-min)*106;
      for(let i=0;i<3;i++){
        const value=min+i*(max-min)/2;
        shape('line',{x1:40,y1:y(value),x2:750,y2:y(value),stroke:'currentColor','stroke-opacity':'.13'});
        shape('text',{x:2,y:y(value)+4,'font-size':11,fill:'currentColor'},value.toFixed(value<1?2:0));
      }
      shape('polyline',{points:points.map(p=>x(p.i)+','+y(p.score)).join(' '),fill:'none',stroke:'#6386bc','stroke-width':2.3,'stroke-linejoin':'round'});
      for(const p of points){
        const circ=shape('circle',{cx:x(p.i),cy:y(p.score),r:4,fill:'#6386bc'});
        const t=document.createElementNS('http://www.w3.org/2000/svg','title');
        t.textContent=date(p.at)+' · '+val(p.raw);
        circ.append(t);
      }
      chart.append(svg);
    }
    select.addEventListener('change',draw);
    if(names.length)select.value=names[0];
    draw();
    const info=el('div','cfsmq-stamp',data.ip?'IPQuality · '+date(data.ip.created_at):'IPQuality · 无记录');
    container.append(info);
    return container;
  }
  function ipQuality(data,id){
    const report=data.ip?.report||{};
    const box=head(el('section','instance-panel cfsmq-final-section'),'IPQuality · IP 质量检测',
      '最新结果 '+date(data.ip?.created_at)+(report.Head?.Version?' · '+report.Head.Version:''));
    box.id='cfsmq-ipquality-'+id;
    box.dataset.cfsmq='ipquality';
    const classifiers=part(box,'全部识别来源 · 用途 / 公司 / 风险值','cfsmq-plain-panel');
    const usage=report.Type?.Usage||{},company=report.Type?.Company||{},scores=report.Score||{};
    const providers=order([...Object.keys(usage),...Object.keys(company),...Object.keys(scores)],classifierOrder);
    table(classifiers,['机构','用途','公司','风险原值'],providers.map(source=>{
      const type=find(usage,source),business=find(company,source),score=find(scores,source);
      return [
        {value:source,className:'cfsmq-source-name'},
        {value:type,className:textTone(type)},
        {value:business,className:textTone(business)},
        {value:score,className:'cfsmq-score-value'}
      ];
    }));
    return box;
  }
  function routeRows(raw){
    const lines=String(raw||'').split(/\r?\n/);
    const hop=lines.slice(1).map(line=>{
      const match=line.match(/^\s*(\d+(?:-\d+)?)\s+(\d+(?:\.\d+)?)ms\s+(\S+)\s*(.*)$/);
      return match?[match[1],match[3],match[2]+' ms',match[4]||'—']:null;
    }).filter(Boolean);
    return {lines,hops:hop};
  }
  function netQuality(data,id){
    const report=data.net?.report||{},bgp=report.BGP||{},local=report.Local||{};
    const box=head(el('section','instance-panel cfsmq-final-section'),'NetQuality · 网络质量检测',
      date(data.net?.created_at)+(report.Head?.Version?' · '+report.Head.Version:''));
    box.id='cfsmq-netquality-'+id;box.dataset.cfsmq='netquality';
    const triple=el('div','cfsmq-three');
    const bgpBox=part(triple,'BGP 信息','cfsmq-plain-panel');
    kv(bgpBox,'ASN / 组织',(defined(bgp.ASN)?'AS'+String(bgp.ASN).replace(/^AS/i,''):'—')+' · '+val(bgp.Organization));
    kv(bgpBox,'前缀 / 注册局',(defined(bgp.Prefix)?'/'+bgp.Prefix:'—')+' · '+val(bgp.RIR));
    kv(bgpBox,'IP 总量 / 活跃',val(bgp.IPinTotal)+' / '+val(bgp.IPActive));
    kv(bgpBox,'邻居总量 / 活跃',val(bgp.NeighborinTotal)+' / '+val(bgp.NeighborActive));
    kv(bgpBox,'IX / 上游 / Peers',val(bgp.IXCount)+' / '+val(bgp.UpstreamsCount)+' / '+val(bgp.PeersCount));
    const localBox=part(triple,'本地网络','cfsmq-plain-panel');
    kv(localBox,'NAT',local.NATDescribe);
    kv(localBox,'映射 / 端口',val(local.Mapping)+' · '+val(local.Port));
    kv(localBox,'Hairpin',local.Hairpin);
    kv(localBox,'TCP 拥塞控制',local.TCPCongestionControl);
    kv(localBox,'队列算法',local.QueueDiscipline);
    const buffers=el('div','cfsmq-tcp');
    buffers.append(el('h4','','TCP 缓冲区原始参数'));
    kv(buffers,'接收',local.TCPReceiveBuffer);
    kv(buffers,'发送',local.TCPSendBuffer);
    localBox.append(buffers);
    const links=report.Connectivity||[];
    const carriers=part(triple,'运营商连接（'+links.length+'）','cfsmq-plain-panel');
    const scroll=el('div','cfsmq-connection-scroll');
    table(scroll,['ASN','名称','脚本标识'],links.map(row=>[
      row.ASN?'AS'+String(row.ASN).replace(/^AS/i,''):'—',row.Org,
      row.IsTarget?'本机':row.IsUpstream?'上游标记':row.IsTier1?'Tier 1 标记':'其他标记'
    ]));
    carriers.append(scroll);
    box.append(triple);
    const routes=Array.isArray(data.net?.routes)?data.net.routes:[];
    const heading=el('div','cfsmq-section-label','三网回程路由 · NextTrace（共 '+routes.length+' 条）');
    box.append(heading);
    const routePanel=el('div','cfsmq-plain-panel cfsmq-routes');
    const routeHead=el('div','cfsmq-route-head');
    const cities=[...new Set(routes.map(r=>r.city).filter(Boolean))];
    routeHead.append(el('strong','',cities.length?cities.join(' / ')+' · 电信、联通、移动':'三网回程记录'),
      el('small','',routes.length?'逐条显示脚本识别结果':'暂无回程记录'));
    routePanel.append(routeHead);
    for(const route of routes){
      const record=el('details','cfsmq-route-item');
      const {lines,hops}=routeRows(route.text);
      const first=String(lines[0]||'');
      const routeName=first.replace(/^\s*\S+\s+\S+\s*/, '').trim();
      const kind=/Unknown|NoData/i.test(routeName)?'Unknown → NoData':routeName||'未识别';
      const summary=el('summary','cfsmq-route-summary');
      summary.append(el('span','cfsmq-route-place',val(route.city)),
        el('span','cfsmq-route-carrier',val(route.carrier)),
        el('span','cfsmq-neutral',kind),
        el('span','cfsmq-route-last',hops.length?'最后记录跳点 '+hops[hops.length-1][2]:'无有效跳点'),
        el('span','cfsmq-route-action','展开逐跳'));
      record.append(summary);
      const content=el('div','cfsmq-route-body');
      const geo=lines.find(x=>x.includes('地理路径'))||'地理路径：— 自治系统路径：—';
      content.append(el('p','cfsmq-quiet',geo));
      if(hops.length)table(content,['跳数','IP','延迟','原报告标注'],hops,'cfsmq-hop-wrap');
      else content.append(el('p','cfsmq-quiet','没有可解析的逐跳记录'));
      raw(content,'查看原始路由记录',route.text||'—');
      record.append(content);
      routePanel.append(record);
    }
    box.append(routePanel);
    return box;
  }
  function placeholder(id,message,retry){
    const top=el('div','cfsmq-approved-top cfsmq-placeholder');
    top.dataset.cfsmq='top';
    const one=infoBox(top,'IP 基础属性与风险因子','');
    one.append(el('p','cfsmq-quiet',message));
    if(retry){
      const btn=el('button','cfsmq-retry','重新加载');
      btn.type='button';
      btn.addEventListener('click',()=>{
        errors.delete(id);cache.delete(id);views.delete(id);
        request(id);schedule();
      });
      one.append(btn);
    }
    return top;
  }
  function routeId(){
    for(const value of [location.pathname,location.hash.replace(/^#/,'')]){
      const match=String(value).match(/(?:^|\/)(?:server|instance)\/([a-f0-9-]{20,80})(?=\/|$|\?|#)/i);
      if(match)return match[1];
    }
    return '';
  }
  async function request(id){
    if(cache.has(id)||errors.has(id)||pending.has(id))return;
    pending.add(id);
    try{
      const res=await fetch('/api/quality/detail?id='+encodeURIComponent(id),
        {cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
      const data=await res.json().catch(()=>null);
      if(!res.ok)throw Error('HTTP '+res.status+(data?.error?' '+data.error:''));
      if(data?.server_id!==id)throw Error('检测接口响应不匹配');
      cache.set(id,data);
      if(data.disabled)disabled.add(id);
      views.delete(id);
    }catch(e){
      errors.set(id,e?.message||String(e));
      views.delete(id);
      console.warn('[CFSM quality] detail request:',e);
    }finally{
      pending.delete(id);schedule();
    }
  }
  function removeOld(){
    document.querySelectorAll('[data-cfsmq="top"],[data-cfsmq="trend"],[data-cfsmq="ipquality"],[data-cfsmq="netquality"]').forEach(x=>x.remove());
  }
  function sync(){
    const id=routeId();
    if(!id||disabled.has(id)){removeOld();return;}
    const info=document.querySelector('#root .instance-info-groups');
    const stack=document.querySelector('#root .instance-chart-stack');
    if(!info)return;
    if(!cache.has(id)&&!errors.has(id)&&!pending.has(id))void request(id);
    const data=cache.get(id);
    if(!views.has(id)){
      try{
        views.set(id,data?.ip||data?.net ? {
          top:data.ip?topRow(data):placeholder(id,'尚无 IPQuality 报告',false),
          trend:data.ip?trendBlock(data):null,
          ip:data.ip?ipQuality(data,id):null,
          net:data.net?netQuality(data,id):null
        }:{
          top:placeholder(id,errors.has(id)?'检测加载失败：'+errors.get(id):'正在读取 IPQuality / NetQuality 检测报告…',errors.has(id)),
          trend:null,ip:null,net:null
        });
      }catch(e){
        console.warn('[CFSM quality] detail render:',e);
        views.set(id,{top:placeholder(id,'检测模块渲染失败：'+(e?.message||String(e)),true),trend:null,ip:null,net:null});
      }
    }
    const view=views.get(id);
    document.querySelectorAll('[data-cfsmq]').forEach(x=>{
      if(x!==view.top && x!==view.trend && x!==view.ip && x!==view.net)x.remove();
    });
    if(view.top.nextElementSibling!==info)info.before(view.top);
    if(!stack)return;
    const load=stack.querySelector('.instance-chart-grid')?.closest('section.instance-panel')||
      stack.querySelector(':scope > section.instance-panel');
    if(!load)return;
    if(view.trend&&view.trend.parentElement!==load)load.append(view.trend);
    if(view.ip&&view.ip.previousElementSibling!==load)load.after(view.ip);
    const original=[...stack.children].filter(n=>n!==view.ip&&n!==view.net&&!n.dataset?.cfsmq);
    const ping=original.find(n=>n!==load);
    const after=ping||view.ip||load;
    if(view.net&&view.net.previousElementSibling!==after)after.after(view.net);
  }
  function schedule(){
    if(throttle!==null)return;
    throttle=setTimeout(()=>{throttle=null;sync();},110);
  }
  function init(){
    const root=document.getElementById('root')||document.body;
    new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
    schedule();
    // React may reuse a node across client-side navigation without a DOM mutation.
    window.addEventListener('popstate',schedule);
    window.addEventListener('hashchange',schedule);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();