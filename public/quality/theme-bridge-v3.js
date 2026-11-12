/* CFSM quality adapter for the pinned AnotherLuminaPlus React theme. */
(() => {
  'use strict';
  if (window.__cfsmAnotherLuminaQualityV3) return;
  window.__cfsmAnotherLuminaQualityV3 = true;

  const REFRESH_MS = 300000;
  const MISSING = '—';
  const disabled = new Set();
  let home = {};
  let revision = 0;
  let scheduleTimer = null;
  const detailCache = new Map();
  const detailPending = new Set();

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }
  function normalized(value) {
    if (value === null || value === undefined || value === '' || value === 'null') return MISSING;
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  function when(ts) {
    if (!ts || !Number.isFinite(Number(ts))) return MISSING;
    return new Date(Number(ts)).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }
  function compactValue(object, preferred) {
    if (!object || typeof object !== 'object') return '';
    for (const key of preferred) {
      const value = object[key];
      if (value != null && value !== '' && value !== 'null') return String(value);
    }
    const first = Object.values(object).find(value => value != null && value !== '' && value !== 'null');
    return first == null ? '' : String(first);
  }
  function chip(label, value, status) {
    const element = node('span', 'cfsmq-chip' + (status ? ' cfsmq-' + status : ''));
    element.append(node('b', '', label + ' '), node('span', '', value));
    return element;
  }
  function summaryRow(label, entries) {
    if (!entries.length) return null;
    const row = node('div', 'cfsmq-summary-row');
    row.append(node('span', 'cfsmq-summary-label', label));
    const content = node('div', 'cfsmq-summary-values');
    for (const entry of entries) {
      const part = node('span', 'cfsmq-summary-entry' + (entry.state ? ' cfsmq-state-' + entry.state : ''));
      part.append(node('b', '', entry.name), node('span', '', normalized(entry.value)));
      content.append(part);
    }
    row.append(content);
    return row;
  }
  // Keep original institution names and raw scores. No synthesized IP category or score.
  function qualitySummary(info) {
    const wrap = node('div', 'cfsmq-compact');
    const usage = Object.entries(info.usage || {}).map(([name, value]) => ({ name, value }));
    const scores = Object.entries(info.scores || {}).map(([name, value]) => ({ name, value }));
    const media = Object.entries(info.media || {}).map(([name, value]) => {
      const status = String(value?.Status || '');
      return {
        name: name === 'Youtube' ? 'YouTube' : name === 'AmazonPrimeVideo' ? 'Prime Video' : name,
        value: (status || MISSING) + (value?.Region ? ' ' + value.Region : ''),
        state: status.includes('解锁') ? 'good' : /屏蔽|失败|限制/.test(status) ? 'bad' : ''
      };
    });
    for (const row of [
      summaryRow('用途', usage),
      summaryRow('评分', scores),
      summaryRow('解锁', media)
    ]) if (row) wrap.append(row);
    wrap.title = 'IPQuality：各机构原始检测值 · ' + when(info.created_at);
    return wrap;
  }
  function cardUuid(card) {
    const id = card.id || '';
    return id.startsWith('node-card-') ? id.slice(10) : '';
  }
  function renderCard(card, info) {
    const oldIp = card.querySelector('.cfsmq-card-ip');
    const oldSummary = card.querySelector('.cfsmq-compact, .cfsmq-card');
    if (!info || !info.ip) {
      oldIp?.remove();
      oldSummary?.remove();
      return;
    }
    const title = card.querySelector('.server-card-title-row, .compact-node-title-row, .node-list-node-head');
    if (title) {
      let ip = title.querySelector('.cfsmq-card-ip');
      if (!ip) {
        ip = node('span', 'cfsmq-card-ip');
        ip.title = 'IPQuality 检测出口 IPv4';
        title.append(ip);
      }
      if (ip.textContent !== info.ip) ip.textContent = info.ip;
    }
    if (card.classList.contains('node-list-row')) return;
    if (oldSummary?.classList.contains('cfsmq-compact') && oldSummary.dataset.revision === String(revision)) return;
    const summary = qualitySummary(info);
    summary.dataset.revision = String(revision);
    if (oldSummary) oldSummary.replaceWith(summary);
    else {
      const stack = card.querySelector('.server-card-stack');
      const compactChips = card.querySelector('.compact-node-chip-row');
      if (stack) stack.append(summary);
      else if (compactChips) compactChips.after(summary);
      else {
        const body = card.querySelector('.server-card-content');
        if (body) body.append(summary);
        else card.append(summary);
      }
    }
  }
  function addPairs(parent, rows) {
    const grid = node('div', 'cfsmq-pairs');
    for (const [name, value] of rows) {
      const row = node('div', 'cfsmq-pair');
      row.append(node('span', '', name), node('strong', '', normalized(value)));
      grid.append(row);
    }
    parent.append(grid);
  }
  function addTable(parent, headers, rows) {
    const scroller = node('div', 'cfsmq-scroll');
    const table = node('table', 'cfsmq-table');
    const thead = node('thead');
    const tr = node('tr');
    headers.forEach(label => tr.append(node('th', '', label)));
    thead.append(tr);
    const tbody = node('tbody');
    rows.forEach(values => {
      const row = node('tr');
      values.forEach(value => row.append(node('td', '', normalized(value))));
      tbody.append(row);
    });
    table.append(thead, tbody);
    scroller.append(table);
    parent.append(scroller);
  }
  function block(parent, title, opened) {
    const element = node('details', 'cfsmq-block');
    if (opened) element.open = true;
    element.append(node('summary', '', title));
    parent.append(element);
    return element;
  }
  function raw(parent, value, label) {
    const disclosure = block(parent, label || '查看原始检测数据', false);
    const pre = node('pre', 'cfsmq-raw');
    pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    disclosure.append(pre);
  }
  const factorItems = [
    ['CountryCode', '国家'], ['Proxy', '代理'], ['Tor', 'Tor'],
    ['VPN', 'VPN'], ['Server', '机房'], ['Abuser', '滥用'], ['Robot', '机器人']
  ];
  function addRiskTable(parent, factors) {
    const keys = [...new Set(factorItems.flatMap(([key]) => Object.keys(factors[key] || {})))];
    const wrapper = node('div', 'cfsmq-scroll cfsmq-risk-scroll');
    const table = node('table', 'cfsmq-table cfsmq-risk-table');
    const head = node('thead');
    const header = node('tr');
    for (const text of ['检测来源', ...factorItems.map(([, label]) => label)]) header.append(node('th', '', text));
    head.append(header);
    table.append(head);
    const body = node('tbody');
    for (const source of keys) {
      const row = node('tr');
      row.append(node('th', 'cfsmq-source', source));
      for (const [key] of factorItems) {
        const value = factors[key]?.[source];
        const cell = node('td', typeof value === 'boolean' ? 'cfsmq-state-' + (value ? 'bad' : 'good') : '', value === true ? '是' : value === false ? '否' : normalized(value));
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    wrapper.append(table);
    parent.append(wrapper);
  }
  function pane(parent, title, opts = {}) {
    const element = node('section', 'cfsmq-pane' + (opts.wide ? ' cfsmq-wide' : ''));
    const h = node('div', 'cfsmq-pane-title');
    h.append(node('h3', '', title));
    if (opts.note) h.append(node('span', '', opts.note));
    element.append(h);
    parent.append(element);
    return element;
  }
  function titleBar(section, name, meta) {
    const header = node('header', 'instance-panel-header');
    const headings = node('div', 'instance-panel-headings');
    const row = node('div', 'instance-panel-title-row');
    row.append(node('h2', 'instance-panel-title', name));
    headings.append(row);
    if (meta) headings.append(node('p', 'instance-panel-description', meta));
    header.append(headings);
    section.append(header);
  }
  function addScoreChart(parent, history, scores) {
    const sorted = [...(history || [])].sort((a, b) => Number(a.at) - Number(b.at));
    const parse = x => {
      if (x == null || x === '' || x === 'null') return null;
      const n = Number(String(x).replace('%', '').trim());
      return Number.isFinite(n) ? n : null;
    };
    const providerNames = [...new Set([...Object.keys(scores || {}), ...sorted.flatMap(item => Object.keys(item.scores || {}))])];
    const samples = providerNames.map(name => ({
      name, points: sorted.map((item, i) => ({ i, raw: item.scores?.[name], value: parse(item.scores?.[name]) })).filter(point => point.value !== null)
    })).filter(series => series.points.length);
    if (!sorted.length || !samples.length) {
      parent.append(node('p', 'cfsmq-muted', '暂无有效的评分历史数据'));
      return;
    }
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#e11d48', '#06b6d4', '#6366f1', '#e879f9'];
    const maxValue = Math.max(100, ...samples.flatMap(s => s.points.map(p => p.value)));
    const top = Math.ceil(maxValue / 10) * 10;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cfsmq-chart');
    svg.setAttribute('viewBox', '0 0 780 178');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '各机构原始 IP 风险评分历史折线图，无综合评分');
    const svgElem = (tag, attrs, text) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
      if (text != null) el.textContent = text;
      svg.append(el);
      return el;
    };
    const x = i => sorted.length < 2 ? 50 : 44 + i / (sorted.length - 1) * 716;
    const y = n => 145 - Math.max(0, Math.min(top, n)) / top * 125;
    for (const v of [0, 0.5, 1]) {
      const py = y(v * top);
      svgElem('line', { x1: 44, x2: 760, y1: py, y2: py, stroke: 'currentColor', 'stroke-opacity': '.13', 'stroke-dasharray': '3 5' });
      svgElem('text', { x: 7, y: py + 4, fill: 'currentColor', 'fill-opacity': '.65', 'font-size': 11 }, String(Math.round(v * top)));
    }
    samples.forEach((s, index) => {
      const stroke = colors[index % colors.length];
      const points = s.points.map(point => [x(point.i), y(point.value)]);
      if (points.length > 1) svgElem('path', { d: points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), fill: 'none', stroke, 'stroke-width': '2.1', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      points.forEach(([px, py], i) => {
        const el = svgElem('circle', { cx: px, cy: py, r: 3.5, fill: stroke, stroke: 'var(--surface-a,#fff)', 'stroke-width': 1.5 });
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = s.name + '：' + normalized(s.points[i].raw) + ' · ' + when(sorted[s.points[i].i].at);
        el.append(title);
      });
    });
    parent.append(svg);
    if (sorted.length === 1) parent.append(node('p', 'cfsmq-muted', '目前只有一次检测记录，后续按每周检测更新趋势；单次评分以原始值显示。'));
    const legend = node('div', 'cfsmq-legend');
    samples.forEach((series, index) => {
      const item = node('span', 'cfsmq-legend-item');
      const dot = node('i');
      dot.style.background = colors[index % colors.length];
      item.append(dot, node('span', '', series.name));
      legend.append(item);
    });
    parent.append(legend);
  }
  function sortedRoutes(routes) {
    const carrierOrder = { 联通: 0, 电信: 1, 移动: 2 };
    return [...(routes || [])].sort((a, b) => {
      const aCity = /^(福州|福建)/.test(a.city || '') ? -1 : 0;
      const bCity = /^(福州|福建)/.test(b.city || '') ? -1 : 0;
      if (aCity !== bCity) return aCity - bCity;
      if (a.city !== b.city) return String(a.city).localeCompare(String(b.city), 'zh-CN');
      return (carrierOrder[a.carrier] ?? 9) - (carrierOrder[b.carrier] ?? 9);
    });
  }
  function addRoutes(parent, data) {
    if (!Array.isArray(data?.routes) || !data.routes.length) {
      parent.append(node('p', 'cfsmq-muted', '暂无独立逐跳路由结果'));
      return;
    }
    const list = node('div', 'cfsmq-route-list');
    for (const route of sortedRoutes(data.routes)) {
      const disclosure = node('details', 'cfsmq-route-item');
      const line = String(route.text || '').split('\n')[0] || '';
      const routeHint = /Unknown|NoData/i.test(line) ? '线路暂未识别' :
        line.replace(String(route.city || '') + ' ' + String(route.carrier || ''), '').trim() || '查看原始线路结果';
      const summary = node('summary', 'cfsmq-route-heading');
      summary.append(node('strong', '', normalized(route.city) + ' · ' + normalized(route.carrier)), node('small', '', routeHint), node('span', '', '查看逐跳'));
      disclosure.append(summary, node('pre', 'cfsmq-route-text', route.text || '本次未提供逐跳数据'));
      list.append(disclosure);
    }
    parent.append(list);
    if (data.route_text) raw(parent, data.route_text, '查看完整 NetQuality 路由原文');
  }
  function detailSection(id, data) {
    if (!data || data.disabled || (!data.ip && !data.net)) return null;
    const ip = data.ip?.report || {};
    const net = data.net?.report || {};
    const top = node('section', 'instance-panel cfsmq-detail cfsmq-detail-top');
    top.id = 'cfsmq-detail-' + id + '-top';
    titleBar(top, 'IP 基础属性与风险因子', 'IPQuality · ' + when(data.ip?.created_at));
    if (data.ip) {
      const info = ip.Info || {};
      const layout = node('div', 'cfsmq-lead-grid');
      const basics = node('div', 'instance-info-group cfsmq-basic');
      basics.append(node('div', 'instance-info-group-title', 'IP 基础属性'));
      const pairs = [
        ['出口 IP', data.ip.ip || ip.Head?.IP], ['ASN', info.ASN],
        ['机构', info.Organization], ['IP 属性', info.Type],
        ['国家／地区', info.Region?.Name], ['城市', info.City?.Name],
        ['注册地', info.RegisteredRegion?.Name], ['时区', info.TimeZone]
      ];
      pairs.forEach(([label, value]) => {
        const row = node('div', 'instance-info-item');
        row.append(node('span', 'instance-info-label', label), node('span', 'instance-info-value', normalized(value)));
        basics.append(row);
      });
      const risks = node('div', 'instance-info-group cfsmq-risk');
      const factorSources = new Set(factorItems.flatMap(([key]) => Object.keys(ip.Factor?.[key] || {})));
      risks.append(node('div', 'instance-info-group-title', '风险因子 · ' + factorSources.size + ' 家检测来源'));
      addRiskTable(risks, ip.Factor || {});
      layout.append(basics, risks);
      top.append(layout);
    } else top.append(node('p', 'cfsmq-muted', '尚无 IPQuality 报告'));

    const bottom = node('section', 'instance-panel cfsmq-detail cfsmq-detail-bottom');
    bottom.id = 'cfsmq-detail-' + id + '-bottom';
    const last = Math.max(Number(data.ip?.created_at) || 0, Number(data.net?.created_at) || 0);
    titleBar(bottom, 'IP 与网络检测详情', '最近更新：' + when(last) + ' · 自动检测周期 7 天 · 各机构原始结果');
    const content = node('div', 'cfsmq-detail-content');
    bottom.append(content);
    if (data.ip) {
      const usage = ip.Type?.Usage || {};
      const company = ip.Type?.Company || {};
      const scores = ip.Score || {};
      const agencies = [...new Set([...Object.keys(usage), ...Object.keys(company), ...Object.keys(scores)])];
      const provider = pane(content, 'IP 用途与归属机构', { note: '全部机构，原始判定' });
      addTable(provider, ['机构', '用途', '企业属性'], agencies.map(key => [key, usage[key], company[key]]));
      const recent = pane(content, '最新一次风险评分', { note: when(data.ip.created_at) });
      addTable(recent, ['评分来源', '原始评分'], Object.entries(scores));
      const trend = pane(content, '各机构评分历史', { wide: true, note: '仅绘制各机构原始分值，不计算综合分' });
      addScoreChart(trend, data.history || [], scores);
      const media = pane(content, '流媒体与 AI 解锁', { wide: true, note: '全部平台' });
      addTable(media, ['平台', '状态', '区域', '解锁类型'], Object.entries(ip.Media || {}).map(([name, v]) => [name, v?.Status, v?.Region, v?.Type]));
      const email = pane(content, '邮件服务和 DNS 黑名单', { wide: true });
      const mail = ip.Mail || {};
      const chips = node('div', 'cfsmq-mail-grid');
      Object.entries(mail).filter(([key]) => key !== 'DNSBlacklist').forEach(([key, value]) => chips.append(chip(key, normalized(value), value ? 'good' : 'bad')));
      email.append(chips);
      if (mail.DNSBlacklist) addPairs(email, Object.entries(mail.DNSBlacklist).map(([key, value]) => ['DNS · ' + key, value]));
    }
    if (data.net) {
      const bgp = pane(content, 'NetQuality · BGP / ASN', { note: '自治系统和上游网络' });
      addPairs(bgp, Object.entries(net.BGP || {}));
      const local = pane(content, '本地网络与 TCP 配置');
      addPairs(local, Object.entries(net.Local || {}));
      const link = pane(content, '运营商与连接关系', { wide: true });
      addTable(link, ['ASN', '机构', '连接类型'], (net.Connectivity || []).map(x =>
        [x.ASN, x.Org, x.IsTarget ? '本机' : x.IsUpstream ? '上游' : x.IsTier1 ? 'Tier 1' : '互联']
      ));
      const routes = pane(content, '回程路由 · 各运营商逐跳', { wide: true, note: '联通 → 电信 → 移动；未识别线路不作推断' });
      addRoutes(routes, data.net);
      const delay = pane(content, '国内地区三网延迟', { wide: true });
      const byProvince = (net.Delay || []).flatMap(item => ['CU','CT','CM'].map(carrier => {
        const value = item[carrier]?.Average;
        return value !== null && value !== undefined && value !== '' && value !== 'null' && Number.isFinite(Number(value))
          ? [item.Name || item.Code, {CU:'联通',CT:'电信',CM:'移动'}[carrier], Number(value).toFixed(1) + ' ms'] : null;
      }).filter(Boolean));
      byProvince.sort((a,b) => (/福|闽/.test(a[0]) ? -1 : 0) - (/福|闽/.test(b[0]) ? -1 : 0));
      if (byProvince.length) addTable(delay, ['地区', '运营商', '平均延迟'], byProvince);
      else delay.append(node('p', 'cfsmq-muted', '本次 NetQuality 报告没有有效的地区延迟数据'));
      raw(delay, net.Delay || [], '查看全部地区延迟原始值');
      const network = pane(content, '测速与国际互联', { wide: true });
      raw(network, net.Speedtest || [], '查看国内测速原始明细');
      raw(network, net.Transfer || [], '查看国际互联原始明细');
    }
    const reports = pane(content, '检测原始报告', { wide: true, note: '完整保留，不省略' });
    if (data.ip) raw(reports, ip, '展开 IPQuality 原始报告');
    if (data.net) raw(reports, net, '展开 NetQuality 原始报告');
    return { top, bottom };
  }
  // Always mount a visible detail section, even when the API request fails.
  // The upstream React theme dynamically replaces its own page children, so avoid
  // assuming that a previously inserted sibling will survive a route rerender.
  const detailErrors = new Map();
  function detailIdFromLocation() {
    const candidates = [location.pathname, location.hash && location.hash.replace(/^#/, '')];
    for (const value of candidates) {
      if (typeof value !== 'string') continue;
      const match = value.match(/(?:^|\/)(?:server|instance)\/([a-f0-9-]{20,80})(?=\/|$|\?|#)/i);
      if (match) return match[1];
    }
    return '';
  }
  function detailTarget() {
    const info = document.querySelector('.instance-info-groups');
    const infoPanel = info && info.closest('section.instance-panel, section');
    if (infoPanel) return { anchor: infoPanel, before: false };
    const chart = document.querySelector('.instance-chart-stack');
    if (chart) return { anchor: chart, before: true };
    const section = document.querySelector('#root section.instance-panel');
    if (section) return { anchor: section, before: false };
    return null;
  }
  function detailPlaceholder(id) {
    const section = node('section', 'instance-panel cfsmq-detail cfsmq-detail-top');
    section.id = 'cfsmq-detail-' + id + '-top';
    const error = detailErrors.get(id);
    titleBar(section, 'IP 基础属性与风险因子', error ? '检测数据暂不可用' : '正在读取 IPQuality 与 NetQuality 报告');
    const msg = node('div', 'cfsmq-placeholder');
    msg.append(node('span', '', error ? '加载失败：' + error : '正在加载独立检测结果…'));
    if (error) {
      const retry = node('button', 'cfsmq-retry', '重试');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        detailErrors.delete(id);
        detailCache.delete(id);
        queueSync();
        void fetchDetail(id);
      });
      msg.append(retry);
    }
    section.append(msg);
    return section;
  }
  async function fetchDetail(id) {
    if (detailCache.has(id) || detailPending.has(id) || detailErrors.has(id)) return;
    detailPending.add(id);
    queueSync();
    try {
      const response = await fetch('/api/quality/detail?id=' + encodeURIComponent(id), {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw Error('HTTP ' + response.status + (data?.error ? ': ' + data.error : ''));
      if (!data || data.server_id !== id) throw Error('invalid detail response');
      detailCache.set(id, data);
      detailErrors.delete(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      detailErrors.set(id, message);
      console.warn('[CFSM Quality Theme] detail unavailable:', error);
    } finally {
      detailPending.delete(id);
      queueSync();
    }
  }
  function sync() {
    document.querySelectorAll('[id^="node-card-"]').forEach(card => {
      const id = cardUuid(card);
      if (id) renderCard(card, disabled.has(id) ? null : home[id] && home[id].ip);
    });
    const id = detailIdFromLocation();
    if (!id || disabled.has(id)) {
      document.querySelectorAll('.cfsmq-detail').forEach(element => element.remove());
      return;
    }
    const target = detailTarget();
    if (!target) return;
    if (!detailCache.has(id) && !detailPending.has(id) && !detailErrors.has(id)) void fetchDetail(id);
    const data = detailCache.get(id);
    const signature = data
      ? 'ready:' + String(data.ip?.id || data.ip?.created_at || '') + ':' + String(data.net?.id || data.net?.created_at || '')
      : detailErrors.has(id) ? 'error:' + detailErrors.get(id) : 'loading';
    const info = document.querySelector('.instance-info-groups')?.closest('section.instance-panel, section');
    const anchor = info || target.anchor;
    const topBefore = !!info || target.before;
    const topExisting = document.getElementById('cfsmq-detail-' + id + '-top');
    const bottomExisting = document.getElementById('cfsmq-detail-' + id + '-bottom');
    const topCorrect = topExisting?.dataset.cfsmqSignature === signature &&
      (topBefore ? topExisting.nextElementSibling === anchor : topExisting.previousElementSibling === anchor);
    const bottomCorrect = !data || (bottomExisting?.dataset.cfsmqSignature === signature && bottomExisting.previousElementSibling === anchor);
    if (topCorrect && bottomCorrect) return;
    let sections;
    try {
      sections = data ? detailSection(id, data) : null;
    } catch (error) {
      console.warn('[CFSM Quality Theme] failed to render detail:', error);
      detailErrors.set(id, '报告渲染异常：' + (error?.message || String(error)));
      detailCache.delete(id);
    }
    const top = sections?.top || detailPlaceholder(id);
    const bottom = sections?.bottom;
    top.dataset.cfsmqSignature = signature;
    if (bottom) bottom.dataset.cfsmqSignature = signature;
    document.querySelectorAll('.cfsmq-detail').forEach(element => element.remove());
    if (topBefore) anchor.before(top);
    else anchor.after(top);
    if (bottom) anchor.after(bottom);
  }
  function queueSync() {
    if (scheduleTimer !== null) return;
    scheduleTimer = setTimeout(() => {
      scheduleTimer = null;
      sync();
    }, 100);
  }
  async function refreshHome() {
    try {
      const response = await fetch('/api/quality/home', {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json();
      if (!data || !data.servers || typeof data.servers !== 'object') throw Error('invalid home response');
      home = data.servers;
      disabled.clear();
      (data.disabled_server_ids || []).forEach(id => disabled.add(id));
      revision += 1;
      queueSync();
    } catch (error) {
      console.warn('[CFSM Quality Theme] summary unavailable:', error);
    }
  }
  function init() {
    const root = document.getElementById('root') || document.body;
    new MutationObserver(queueSync).observe(root, { childList: true, subtree: true });
    queueSync();
    void refreshHome();
    setInterval(refreshHome, REFRESH_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
