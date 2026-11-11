// Theme-independent homepage summary. No raw trace hops or remote commands.
const ORDER = ['cu', 'ct', 'cm'];
const LABELS = {cu:'福州联通', ct:'福州电信', cm:'福州移动'};
const ROUTE_STATUS = {complete:'已完成',partial:'部分结果',timeout:'超时',dns_error:'DNS 失败',permission_denied:'权限不足',tool_missing:'缺少工具',error:'探测失败',pending:'待接入',unavailable:'未取得路由'};

export function getHomeQuality(quality) {
  const available = (quality?.providers || []).filter(provider => provider?.status === 'ok');
  const info = available.find(provider => provider.asn || provider.operator) || available[0] || null;
  const risk = available.find(provider => typeof provider.risk === 'number' && Number.isFinite(provider.risk)) || null;
  const knownFlag = key => {
    const reported = available.map(provider => ({source: provider.provider, value: provider.flags?.[key]})).filter(entry => typeof entry.value === 'boolean');
    if (!reported.length) return {value:null, source:null};
    if (new Set(reported.map(entry => entry.value)).size > 1) return {value:'mixed', source:reported.map(entry => entry.source).join('、')};
    return {value:reported[0].value, source:reported.map(entry => entry.source).join('、')};
  };
  return {info, risk, flags:{proxy:knownFlag('proxy'),vpn:knownFlag('vpn'),hosting:knownFlag('hosting')}, availableCount:available.length};
}

export function getHomeRoutes(route) {
  return ORDER.map(key => ({ key, label:LABELS[key], data:route?.routes?.find(item => item.key === key) || null }));
}

export function homeRouteSummary(route) {
  if (!route) return '待接入';
  if (route.stale) return '历史结果';
  return ROUTE_STATUS[route.status] || '待检测';
}

export function homeTime(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '尚无记录';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(Number(value)));
}

function e(tag, className='', ...children) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
function link(href, label, className='') {
  const a = e('a', className, label);
  a.href = href;
  return a;
}
function flagNode(label, status) {
  const type = status.value === true ? 'is-alert' : status.value === false ? 'is-known' : 'is-unknown';
  const wording = status.value === true ? '是' : status.value === false ? '否' : status.value === 'mixed' ? '来源不一致' : '未知';
  const pill = e('span', 'nd-flag ' + type, label + ': ' + wording);
  if (status.source) pill.title = '数据来源：' + status.source;
  return pill;
}
function card(server) {
  const quality = getHomeQuality(server.quality);
  const ip = server.ip || 'IP 未上报';
  const card = e('article', 'nd-card');
  const head = e('div','nd-card-head',e('div','nd-name',server.name || '未命名服务器'));
  head.append(e('span','nd-state '+(server.route && !server.route.stale?'is-ready':''),homeRouteSummary(server.route)));
  card.append(head);

  const info = e('div','nd-card-info',e('span','nd-ip',ip));
  if (quality.info) {
    info.append(e('span','nd-asn', [quality.info.asn,quality.info.operator].filter(Boolean).join(' · ') || 'ASN 待确认'));
    const location = [quality.info.city, quality.info.country].filter(Boolean).join(' · ');
    if (location) info.append(e('span','nd-location',location));
  } else {
    info.append(e('span','nd-muted','IP 信息尚未查询或数据源暂不可用'));
  }
  if (server.quality?.stale) info.append(e('span','nd-stale','IP 已变化或信息过期'));
  card.append(info);

  const riskRow = e('div','nd-risk-line');
  if (quality.risk) {
    const risk = Math.round(quality.risk.risk * 10) / 10;
    riskRow.append(e('span','nd-risk-score',quality.risk.provider + ' 风险指标 ' + risk + '/100'));
  } else {
    riskRow.append(e('span','nd-muted','风险指标：未知'));
  }
  if (quality.availableCount > 1) riskRow.append(e('span','nd-multi-source','多数据源 · 分开判读'));
  card.append(riskRow);
  card.append(e('div','nd-flags',flagNode('代理',quality.flags.proxy),flagNode('VPN',quality.flags.vpn),flagNode('机房',quality.flags.hosting)));

  const routes = e('div','nd-route-list');
  for (const {key,label,data} of getHomeRoutes(server.route)) {
    const line = e('div','nd-route');
    line.append(e('span','nd-carrier nd-carrier-'+key,label));
    const path = Array.isArray(data?.lines) && data.lines.length ? data.lines.join(' / ') : (data ? (ROUTE_STATUS[data.status] || '线路未识别') : '回程待接入');
    const txt = e('span','nd-route-path',path);
    txt.title = path;
    line.append(txt);
    const ms = data?.median_ms;
    const latency = typeof ms === 'number' && Number.isFinite(ms) ? ms.toFixed(0) + ' ms' : '—';
    line.append(e('span','nd-route-ms',latency));
    routes.append(line);
  }
  card.append(routes);

  const foot = e('div','nd-card-foot');
  foot.append(e('span','nd-last','IP '+homeTime(server.quality?.checked_at)+' · 回程 '+homeTime(server.route?.checked_at)));
  foot.append(link('/netdiag?server='+encodeURIComponent(server.id),'完整诊断 ›','nd-detail'));
  card.append(foot);
  return card;
}

function isDashboardRoute() {
  const hash = (location.hash || '').replace(/^#\/?/,'').toLowerCase();
  return !hash || hash === '/' || hash === 'dashboard' || hash.startsWith('dashboard?');
}

function mount() {
  const root = document.getElementById('cfsm-netdiag-home');
  if (!root) return;
  // Match the active site's actual background, not merely the OS color preference.
  const rgba = value => {
    const match = String(value || '').match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)$/);
    if (!match || (match[4] !== undefined && Number(match[4]) === 0)) return null;
    return [Number(match[1]),Number(match[2]),Number(match[3])];
  };
  const bg = rgba(getComputedStyle(document.body).backgroundColor) || rgba(getComputedStyle(document.documentElement).backgroundColor);
  if (bg && (bg[0]*0.2126 + bg[1]*0.7152 + bg[2]*0.0722) > 160) root.dataset.ndTheme = 'light';
  let loading = false;
  const box = e('div','nd-shell');
  const eyebrow = e('div','nd-eyebrow','NETWORK INTELLIGENCE  /  FUZHOU');
  const heading = e('div','nd-heading',eyebrow,e('h2','nd-title','福州线路 · 网络诊断'),e('p','nd-subtitle','福州联通 → 福州电信 → 福州移动 · 不进行带宽测速'));
  const actions = e('div','nd-actions');
  const status = e('span','nd-sync','');
  status.setAttribute('role','status');
  const refresh = e('button','nd-refresh','刷新展示');
  refresh.type = 'button';
  actions.append(status,refresh,link('/netdiag','查看完整报告 ›','nd-view-all'));
  box.append(e('header','nd-top',heading,actions));
  const grid = e('div','nd-grid',e('div','nd-empty','正在读取最新网络诊断记录…'));
  box.append(grid);
  const note = e('p','nd-note','ASN 与 IP 风险来自第三方数据源；不同来源可能不一致。路由标签仅表示可见跳点，不保证线路等级。');
  box.append(note);
  root.replaceChildren(box);

  async function load() {
    if (loading || document.visibilityState === 'hidden' || !isDashboardRoute()) return;
    loading = true;
    refresh.disabled = true;
    status.textContent = '读取中…';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const headers = {Accept:'application/json'};
      try { const token = localStorage.getItem('jwt_token'); if(token) headers.Authorization = 'Bearer '+token; } catch {}
      const response = await fetch('/api/netdiag/home', {headers,credentials:'same-origin',cache:'no-store',signal:abort.signal,redirect:'error'});
      if (!response.ok) {
        if (response.status === 401) throw new Error('请先登录管理后台查看私有诊断信息');
        throw new Error('读取失败（HTTP '+response.status+'）');
      }
      const result = await response.json();
      if (!Array.isArray(result.servers)) throw new Error('服务端响应格式错误');
      grid.replaceChildren(...(result.servers.length ? result.servers.map(card) : [e('div','nd-empty','当前没有可显示的 VPS')]));
      status.textContent = '更新于 '+homeTime(result.generated_at);
    } catch (err) {
      const message = err?.name === 'AbortError' ? '请求超时' : (err?.message || '暂无法获取诊断信息');
      if (!grid.querySelector('.nd-card')) {
        const empty = e('div','nd-empty',message);
        if (message.includes('登录')) empty.append(' ',link('/admin#/admin','前往登录','nd-detail'));
        grid.replaceChildren(empty);
      }
      status.textContent = '更新失败';
    } finally {
      clearTimeout(timer);
      refresh.disabled = false;
      loading = false;
    }
  }
  function syncVisibility() {root.hidden = !isDashboardRoute();if (!root.hidden) void load();}
  refresh.addEventListener('click',()=>void load());
  window.addEventListener('hashchange',syncVisibility);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void load();});
  setInterval(()=>{if(document.visibilityState==='visible')void load();},5*60*1000);
  syncVisibility();
}

if (typeof document !== 'undefined') mount();
