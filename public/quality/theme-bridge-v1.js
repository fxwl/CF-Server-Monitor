/* CFSM quality adapter for the pinned AnotherLuminaPlus React theme. */
(() => {
  'use strict';
  if (window.__cfsmAnotherLuminaQualityV1) return;
  window.__cfsmAnotherLuminaQualityV1 = true;

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
  function qualitySummary(info) {
    const wrap = node('div', 'cfsmq-card');
    const header = node('div', 'cfsmq-card-head');
    header.append(node('strong', '', 'IP 质量'), node('small', '', when(info.created_at)));
    wrap.append(header);
    const chips = node('div', 'cfsmq-chips');
    const type = compactValue(info.usage, ['IPinfo', 'ipregistry', 'ipapi']);
    const scores = Object.entries(info.scores || {})
      .filter(([, value]) => value != null && value !== '' && value !== 'null')
      .slice(0, 3);
    if (type) chips.append(chip('IP 类型', type));
    for (const [key, value] of scores) chips.append(chip(key, normalized(value)));
    for (const name of ['ChatGPT', 'Netflix', 'TikTok']) {
      const service = info.media && info.media[name];
      if (!service || !service.Status) continue;
      const ok = String(service.Status).includes('解锁');
      chips.append(chip(name, normalized(service.Status) + (service.Region ? ' ' + service.Region : ''), ok ? 'good' : 'bad'));
    }
    if (chips.children.length === 0) chips.append(chip('检测', '已有报告'));
    wrap.append(chips);
    return wrap;
  }
  function cardUuid(card) {
    const id = card.id || '';
    return id.startsWith('node-card-') ? id.slice(10) : '';
  }
  function renderCard(card, info) {
    const previousIp = card.querySelector('.cfsmq-card-ip');
    const previous = card.querySelector('.cfsmq-card');
    if (!info || !info.ip) {
      if (previousIp) previousIp.remove();
      if (previous) previous.remove();
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
    const isList = card.classList.contains('node-list-row');
    if (isList) return;
    if (previous && previous.dataset.revision === String(revision)) return;
    const summary = qualitySummary(info);
    summary.dataset.revision = String(revision);
    if (previous) previous.replaceWith(summary);
    else {
      const anchor = card.querySelector('.server-card-meta-grid, .compact-node-chip-row');
      const stack = card.querySelector('.server-card-stack, .compact-node-card-content');
      if (anchor) anchor.after(summary);
      else if (stack) stack.append(summary);
      else card.append(summary);
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
  function detailSection(id, data) {
    if (!data || data.disabled || (!data.ip && !data.net)) return null;
    const section = node('section', 'instance-panel cfsmq-detail');
    section.id = 'cfsmq-detail-' + id;
    const header = node('header', 'instance-panel-header');
    const headings = node('div', 'instance-panel-headings');
    const titleRow = node('div', 'instance-panel-title-row');
    titleRow.append(node('h2', 'instance-panel-title', 'IP 质量与网络检测'));
    headings.append(titleRow);
    const last = Math.max(Number(data.ip?.created_at) || 0, Number(data.net?.created_at) || 0);
    headings.append(node('p', 'cfsmq-detail-time', '最近检测：' + when(last) + ' · 自动检测每 7 天一次'));
    header.append(headings);
    section.append(header);
    const grid = node('div', 'cfsmq-detail-grid');
    section.append(grid);

    if (data.ip) {
      const report = data.ip.report || {};
      const info = report.Info || {};
      const basic = block(grid, 'IP 基础属性', true);
      addPairs(basic, [
        ['出口 IP', data.ip.ip || report.Head?.IP], ['ASN', info.ASN],
        ['机构', info.Organization], ['IP 属性', info.Type],
        ['国家/地区', info.Region?.Name], ['城市', info.City?.Name],
        ['注册地', info.RegisteredRegion?.Name], ['时区', info.TimeZone]
      ]);
      const sources = block(grid, 'IP 类型、归属与风险评分', true);
      const usage = report.Type?.Usage || {};
      const company = report.Type?.Company || {};
      const scores = report.Score || {};
      const providers = [...new Set([...Object.keys(usage), ...Object.keys(company), ...Object.keys(scores)])];
      addTable(sources, ['来源', '使用类型', '企业类型', '风险评分'], providers.map(key =>
        [key, usage[key], company[key], scores[key]]
      ));
      const factors = report.Factor || {};
      const factorNames = ['Proxy', 'Tor', 'VPN', 'Server', 'Abuser', 'Robot'];
      const factorSources = [...new Set(factorNames.flatMap(key => Object.keys(factors[key] || {})))];
      const factorBox = block(grid, '代理 / VPN / 机房 / 滥用风险因子', false);
      addTable(factorBox, ['来源', '代理', 'Tor', 'VPN', '服务器', '滥用', '机器人'], factorSources.map(key =>
        [key, ...factorNames.map(name => factors[name]?.[key])]
      ));
      const mediaBox = block(grid, '流媒体与应用解锁', true);
      addTable(mediaBox, ['平台', '状态', '区域', '类型'], Object.entries(report.Media || {}).map(([name, value]) =>
        [name, value?.Status, value?.Region, value?.Type]
      ));
      const mail = block(grid, '邮件服务与 DNS 黑名单', false);
      const mailReport = report.Mail || {};
      addPairs(mail, Object.entries(mailReport).filter(([key]) => key !== 'DNSBlacklist'));
      if (mailReport.DNSBlacklist) {
        addPairs(mail, Object.entries(mailReport.DNSBlacklist).map(([key, value]) => ['DNS ' + key, value]));
      }
      if (Array.isArray(data.history) && data.history.length > 0) {
        const history = block(grid, 'IP 风险评分历史', false);
        addTable(history, ['检测时间', '评分'], data.history.slice(0, 40).map(item => [when(item.at), Object.entries(item.scores || {}).map(([k, v]) => k + ': ' + normalized(v)).join(' · ')]));
      }
    }

    if (data.net) {
      const report = data.net.report || {};
      const bgp = block(grid, 'NetQuality · BGP / ASN', true);
      addPairs(bgp, Object.entries(report.BGP || {}).map(([key, value]) => [key, value]));
      const local = block(grid, '本地网络 / TCP 参数', true);
      addPairs(local, Object.entries(report.Local || {}).map(([key, value]) => [key, value]));
      const links = block(grid, '运营商和上游连接关系', false);
      addTable(links, ['ASN', '机构', '节点角色'], (report.Connectivity || []).map(item =>
        [item.ASN, item.Org, item.IsTarget ? '本机' : item.IsUpstream ? '上游' : item.IsTier1 ? 'Tier 1' : '互联']
      ));
      const paths = block(grid, '回程路由 / 逐跳信息', false);
      if (Array.isArray(data.net.routes) && data.net.routes.length) {
        for (const route of data.net.routes) {
          const sub = block(paths, normalized(route.city) + ' · ' + normalized(route.carrier), false);
          sub.append(node('pre', 'cfsmq-raw', route.text || '暂无路由信息'));
        }
      }
      if (data.net.route_text) raw(paths, data.net.route_text, '完整 NetQuality 路由文本');
      const delay = block(grid, '省级三网延迟', false);
      const values = (report.Delay || []).flatMap(item =>
        ['CT', 'CU', 'CM'].map(carrier => {
          const v = item[carrier]?.Average;
          return v === 'null' || v == null ? null : [item.Name || item.Code, carrier, String(v) + ' ms'];
        }).filter(Boolean)
      );
      if (values.length) addTable(delay, ['省份', '运营商', '平均延迟'], values);
      else delay.append(node('p', 'cfsmq-muted', '本次报告没有有效的省级延迟数据'));
      raw(delay, report.Delay || [], '全部延迟原始数据');
      const speed = block(grid, '国内测速 / 国际互联', false);
      raw(speed, report.Speedtest || [], '国内测速明细');
      raw(speed, report.Transfer || [], '国际互联明细');
    }
    return section;
  }
  async function fetchDetail(id) {
    if (detailCache.has(id) || detailPending.has(id)) return;
    detailPending.add(id);
    try {
      const response = await fetch('/api/quality/detail?id=' + encodeURIComponent(id), {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json();
      if (!data || data.server_id !== id) throw Error('invalid detail response');
      detailCache.set(id, data);
    } catch (error) {
      console.warn('[CFSM Quality Theme] detail unavailable:', error);
    } finally {
      detailPending.delete(id);
      queueSync();
    }
  }
  function sync() {
    const cards = document.querySelectorAll('[id^="node-card-"]');
    cards.forEach(card => {
      const id = cardUuid(card);
      if (!id) return;
      renderCard(card, disabled.has(id) ? null : home[id] && home[id].ip);
    });
    const match = location.pathname.match(/^\/(?:server|instance)\/([a-f0-9-]{20,80})\/?$/i);
    const panel = document.querySelector('.instance-info-groups')?.closest('section.instance-panel');
    if (!match || !panel) {
      document.querySelectorAll('.cfsmq-detail').forEach(element => element.remove());
      return;
    }
    const id = match[1];
    if (!detailCache.has(id)) {
      void fetchDetail(id);
      return;
    }
    const data = detailCache.get(id);
    const existing = document.querySelector('#cfsmq-detail-' + id);
    if (existing && existing.previousElementSibling === panel) return;
    document.querySelectorAll('.cfsmq-detail').forEach(element => element.remove());
    const detail = detailSection(id, data);
    if (detail) panel.after(detail);
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
