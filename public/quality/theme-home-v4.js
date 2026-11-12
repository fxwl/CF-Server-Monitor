/* CFSM AnotherLuminaPlus: final compact homepage IP quality panel (reference: 2026-11-12 approved mockup). */
(() => {
  'use strict';
  if (window.__CFSMQualityHomeFinal4) return;
  window.__CFSMQualityHomeFinal4 = true;
  let servers = {};
  let blocked = new Set();
  let version = 0;
  let timer = null;
  const orderedProviders = ['IPinfo','ipregistry','ipapi','AbuseIPDB','IP2LOCATION','SCAMALYTICS','DBIP','IPQS'];
  const orderedMedia = ['TikTok','DisneyPlus','Netflix','Youtube','AmazonPrimeVideo','ChatGPT','Reddit'];
  const mediaLabels = {DisneyPlus:'Disney+',Youtube:'YouTube',AmazonPrimeVideo:'Prime Video'};
  const providerLabels = {SCAMALYTICS:'Scamalytics',DBIP:'DB-IP'};
  const maker = (tag,cls,value) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (value !== undefined) e.textContent = String(value);
    return e;
  };
  const valid = v => v !== null && v !== undefined && v !== '' && v !== 'null';
  const printable = v => valid(v) ? String(v) : '—';
  const key = str => String(str||'').replace(/[^a-z0-9]/ig,'').toLowerCase();
  function lookup(map,id) {
    if (!map || typeof map !== 'object') return null;
    const target = key(id);
    const actual = Object.keys(map).find(name => key(name) === target);
    return actual ? map[actual] : null;
  }
  function time(value) {
    const n = Number(value);
    if (!n) return '—';
    const d = new Date(n);
    const part = new Intl.DateTimeFormat('zh-CN',{
      timeZone:'Asia/Shanghai', month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false
    }).format(d);
    return part.replace(/[\/]/g,'-').replace(/\s+/g,' ');
  }
  function val(parent,text,kind) {
    const el = maker('span','cfsmq-home-val'+(kind?' cfsmq-is-'+kind:''),printable(text));
    parent.append(el);
    return el;
  }
  function usageTone(text) {
    if (/家宽|住宅|家庭|居民|ISP/i.test(String(text))) return 'good';
    if (/商业|商用/i.test(String(text))) return 'blue';
    return '';
  }
  function scoreTone(text) {
    if (!valid(text)) return '';
    const n = Number(String(text).replace('%','').replace(',','.'));
    if (Number.isFinite(n) && n === 0) return 'good';
    if (String(text).includes('%') && Number.isFinite(n) && n < 1) return 'good';
    return '';
  }
  function providerList(info) {
    const all = [...new Set([...Object.keys(info.usage||{}),...Object.keys(info.company||{}),...Object.keys(info.scores||{})].map(key))];
    const seen = new Set();
    return [...orderedProviders.map(key),...all].filter(k => { if(seen.has(k)) return false; seen.add(k); return true; });
  }
  function providerItem(info,k) {
    const row=maker('div','cfsmq-home-provider');
    const source=providerLabels[orderedProviders.find(p=>key(p)===k)] || 
      [...Object.keys(info.usage||{}),...Object.keys(info.scores||{})].find(n=>key(n)===k) || k;
    row.append(maker('span','cfsmq-home-provider-name',source));
    const values=maker('span','cfsmq-home-provider-values');
    const usage=lookup(info.usage,k),company=lookup(info.company,k),score=lookup(info.scores,k);
    val(values,usage,usageTone(usage));
    values.append(maker('span','cfsmq-separator','/'));
    val(values,company,usageTone(company));
    values.append(maker('span','cfsmq-separator','·'));
    val(values,score,scoreTone(score));
    row.append(values);
    return row;
  }
  function mediaItem(id,value) {
    const row=maker('div','cfsmq-home-media-item');
    row.append(maker('span','cfsmq-home-media-name',mediaLabels[id]||id));
    const status=String(value?.Status||'');
    const success=status.includes('解锁');
    const fail=/屏蔽|失败|限制|不支持/i.test(status);
    const label=success?'✓':fail?'×':'·';
    const tail=success
      ? [value?.Region,value?.Type].filter(valid).join('·')
      : status||'—';
    row.append(maker('span','cfsmq-home-media-status'+(success?' cfsmq-is-good':fail?' cfsmq-is-bad':''),
      label+' '+(tail||status||'—')));
    return row;
  }
  function panel(info) {
    const root=maker('section','cfsmq-home-final');
    const head=maker('div','cfsmq-home-top');
    head.append(maker('strong','','IP 质量'),maker('span','cfsmq-muted',time(info.created_at)));
    root.append(head);
    root.append(maker('div','cfsmq-home-hint','机构 · 用途/公司 · 风险评分'));
    const grid=maker('div','cfsmq-home-provider-grid');
    providerList(info).forEach(k=>grid.append(providerItem(info,k)));
    root.append(grid);
    const divider=maker('div','cfsmq-home-divider');
    root.append(divider);
    const media=info.media||{};
    const present=[...orderedMedia.filter(k=>Object.prototype.hasOwnProperty.call(media,k)),
      ...Object.keys(media).filter(k=>!orderedMedia.includes(k))];
    const count=present.filter(k=>String(media[k]?.Status||'').includes('解锁')).length;
    const mediaHead=maker('div','cfsmq-home-media-head');
    mediaHead.append(maker('strong','','流媒体 / AI 解锁'),maker('span','cfsmq-muted',count+'/'+present.length));
    root.append(mediaHead);
    const mediaGrid=maker('div','cfsmq-home-media-grid');
    present.forEach(k=>mediaGrid.append(mediaItem(k,media[k])));
    root.append(mediaGrid);
    return root;
  }
  function updateCards(){
    document.querySelectorAll('[id^="node-card-"]').forEach(card=>{
      const id=(card.id||'').slice(10);
      const info=!blocked.has(id)?servers[id]?.ip:null;
      const old=card.querySelector('.cfsmq-home-final');
      const oldIp=card.querySelector('.cfsmq-card-ip');
      if(!info||!info.ip){ old?.remove();oldIp?.remove();return; }
      const heading=card.querySelector('.server-card-title-row,.compact-node-title-row,.node-list-node-head');
      if(heading){
        let ip=heading.querySelector('.cfsmq-card-ip');
        if(!ip){ ip=maker('small','cfsmq-card-ip');ip.title='检测出口 IPv4';heading.append(ip); }
        if(ip.textContent!==info.ip)ip.textContent=info.ip;
      }
      if(card.classList.contains('node-list-row'))return;
      if(old?.dataset?.ver===String(version))return;
      const next=panel(info);
      next.dataset.ver=String(version);
      if(old)old.replaceWith(next);
      else {
        const stack=card.querySelector('.server-card-stack');
        const tags=card.querySelector('.compact-node-chip-row');
        const body=card.querySelector('.server-card-content');
        if(stack)stack.after(next);
        else if(tags)tags.after(next);
        else (body||card).append(next);
      }
    });
  }
  function debounce(){
    if(timer!==null)return;
    timer=setTimeout(()=>{timer=null;updateCards();},100);
  }
  async function refresh(){
    try{
      const response=await fetch('/api/quality/home',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw Error('HTTP '+response.status);
      const result=await response.json();
      if(!result?.servers||typeof result.servers!=='object')throw Error('invalid data');
      servers=result.servers;
      blocked=new Set(result.disabled_server_ids||[]);
      version++;
      debounce();
    }catch(e){ console.warn('[CFSM Quality] home:',e); }
  }
  function init(){
    const root=document.getElementById('root')||document.body;
    new MutationObserver(debounce).observe(root,{childList:true,subtree:true});
    debounce();
    void refresh();
    setInterval(refresh,300000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
