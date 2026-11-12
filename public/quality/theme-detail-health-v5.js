/* CFSM AnotherLuminaPlus overlay: server-detail health summary (总评 + 全量关键指标).
   Reads only values the theme already renders. Pair with theme-health-v5.css. */
(() => {
  'use strict';
  if (window.__CFSMDetailHealthV5) return;
  window.__CFSMDetailHealthV5 = true;

  const WARN = 75, BAD = 90;
  const LOAD_WARN = 1, LOAD_BAD = 2;      // 1 分钟负载 / 核数
  const QUOTA_WARN = 80, QUOTA_BAD = 95;
  const RANK = { ok: 0, warn: 1, bad: 2, off: 3 };
  const VERDICT = { ok: '运行正常', warn: '需要注意', bad: '存在异常', off: '节点离线' };
  let timer = null;

  const make = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const UNIT = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  const bytes = s => {
    const m = String(s).trim().match(/([\d.]+)\s*([KMGTP]?i?B)/i);
    return m ? Number(m[1]) * (UNIT[m[2].toUpperCase()] || 1) : NaN;
  };
  const ratio = text => {
    const [a, b] = String(text || '').split('/').map(bytes);
    return a >= 0 && b > 0 ? a / b * 100 : null;
  };
  const level = (v, w, b) => v === null || !Number.isFinite(v) ? '' : v >= b ? 'bad' : v >= w ? 'warn' : 'ok';
  const pct = v => v === null || !Number.isFinite(v) ? '—' : (v < 10 ? v.toFixed(1) : Math.round(v)) + '%';

  function rows(groups) {
    const map = {};
    groups.querySelectorAll('.instance-info-item').forEach(item => {
      const label = item.querySelector('.instance-info-label')?.textContent?.trim();
      if (!label) return;
      map[label] = {
        value: item.querySelector('.instance-info-value')?.textContent?.trim() || '',
        note: item.querySelector('.instance-info-note')?.textContent?.trim() || ''
      };
    });
    return map;
  }
  function cpuUsage() {
    for (const card of document.querySelectorAll('#root .instance-chart-card')) {
      if (!/CPU/i.test(card.querySelector('.instance-panel-subhead')?.textContent || '')) continue;
      const v = parseFloat(card.querySelector('.instance-series-stats .tabular')?.textContent || '');
      return Number.isFinite(v) ? v : null;
    }
    return null;
  }

  function collect(groups) {
    const r = rows(groups);
    const get = re => Object.keys(r).find(k => re.test(k));
    const statusKey = get(/^状态$|Status/i);
    const offline = statusKey ? /离线|offline/i.test(r[statusKey].value) : false;
    const cpuModel = r[get(/^CPU$/i)]?.value || '';
    const cores = Number((cpuModel.match(/\(x\s*(\d+)\)|(\d+)\s*(?:核|cores?)/i) || []).slice(1).find(Boolean)) || null;
    const loadText = r[get(/负载|Load/i)]?.value || '';
    const load1 = parseFloat(loadText);
    const uptime = r[get(/运行时长|Uptime/i)]?.value || '—';
    const swapText = r[get(/^Swap$/i)]?.value || '';
    const netKey = get(/实时网络|缓存网络|Network/i);
    const trafficKey = get(/本期流量|Traffic/i);
    const cpu = cpuUsage();
    const ram = ratio(r[get(/^内存$|^RAM$|Memory/i)]?.value);
    const disk = ratio(r[get(/^磁盘$|Disk/i)]?.value);
    const swap = /无|none/i.test(swapText) ? null : ratio(swapText);
    const quota = trafficKey ? ratio(r[trafficKey].note) : null;
    const loadPer = Number.isFinite(load1) && cores ? load1 / cores : null;

    const tiles = [
      { key: 'cpu', label: 'CPU 使用率', value: pct(cpu), sub: cores ? cores + ' 核' : cpuModel || '—', lv: level(cpu, WARN, BAD), why: 'CPU ' + pct(cpu) },
      { key: 'ram', label: '内存', value: pct(ram), sub: r[get(/^内存$|^RAM$|Memory/i)]?.value || '—', lv: level(ram, WARN, BAD), why: '内存 ' + pct(ram) },
      { key: 'disk', label: '磁盘', value: pct(disk), sub: r[get(/^磁盘$|Disk/i)]?.value || '—', lv: level(disk, WARN, BAD), why: '磁盘 ' + pct(disk) },
      { key: 'swap', label: 'Swap', value: swap === null ? (swapText ? '未启用' : '—') : pct(swap), sub: swapText || '—', lv: level(swap, WARN, BAD), why: 'Swap ' + pct(swap) },
      { key: 'load', label: '负载 / 核', value: loadPer === null ? (loadText.split(/[|·]/)[0]?.trim() || '—') : loadPer.toFixed(2), sub: loadText || '—', lv: level(loadPer, LOAD_WARN, LOAD_BAD), why: '负载 ' + (loadPer === null ? '' : loadPer.toFixed(2) + ' / 核') },
      { key: 'quota', label: '本期流量', value: quota === null ? '不限' : pct(quota), sub: trafficKey ? (r[trafficKey].note || r[trafficKey].value) : '—', lv: level(quota, QUOTA_WARN, QUOTA_BAD), why: '流量已用 ' + pct(quota) },
      { key: 'net', label: '实时网速', value: netKey ? r[netKey].value || '—' : '—', sub: offline ? '最后上报数据' : '上传 / 下载', lv: '', small: true },
      { key: 'up', label: '运行时长', value: uptime, sub: offline ? '离线' : '在线', lv: offline ? 'off' : 'ok', small: true }
    ];
    // IP 风险：复用 theme-detail-v5.js 生成的关键指标卡片颜色。
    const ipTiles = [...document.querySelectorAll('#root .cfsmq-tile')];
    if (ipTiles.length) {
      const worst = ipTiles.reduce((w, t) => {
        const l = t.classList.contains('is-bad') ? 'bad' : t.classList.contains('is-warn') ? 'warn' : w;
        return RANK[l] > RANK[w] ? l : w;
      }, 'ok');
      const flagged = ipTiles.filter(t => t.matches('.is-bad,.is-warn'))
        .map(t => t.querySelector('.cfsmq-tile-label')?.textContent).filter(Boolean);
      tiles.push({ key: 'ip', label: 'IP 质量', value: worst === 'ok' ? '良好' : worst === 'warn' ? '一般' : '较差',
        sub: flagged.join('、') || '各项检测正常', lv: worst, why: 'IP ' + (flagged.join('、') || '') });
    }
    let overall = offline ? 'off' : 'ok';
    const reasons = offline ? ['节点离线，以下为最后上报数据'] : [];
    for (const t of tiles) {
      if (t.lv !== 'warn' && t.lv !== 'bad') continue;
      if (!offline && RANK[t.lv] > RANK[overall]) overall = t.lv;
      reasons.push(t.why);
    }
    return { overall, reasons, tiles };
  }

  function render(groups) {
    const data = collect(groups);
    const sig = JSON.stringify(data);
    let box = document.querySelector('.cfsmh-detail');
    const prev = groups.previousElementSibling;
    const anchor = prev && prev.dataset.cfsmq === 'top' ? prev : groups;
    if (box && box.dataset.sig === sig && box.nextElementSibling === anchor) return;
    if (!box) box = make('section', 'cfsmh-detail');
    box.dataset.sig = sig;
    box.dataset.level = data.overall;
    box.setAttribute('aria-label', '服务器健康总评');
    box.replaceChildren();
    const head = make('div', 'cfsmh-detail-head');
    const title = make('div', 'cfsmh-detail-title');
    title.append(make('i'), make('strong', '', VERDICT[data.overall]));
    head.append(title, make('span', 'cfsmh-detail-why', data.reasons.join(' · ') || 'CPU、内存、磁盘、负载、流量均在正常范围'));
    box.append(head);
    const grid = make('div', 'cfsmh-detail-grid');
    for (const t of data.tiles) {
      const c = make('div', 'cfsmh-detail-tile' + (t.lv ? ' is-' + t.lv : '') + (t.small ? ' is-text' : ''));
      c.append(make('span', 'cfsmh-detail-label', t.label), make('strong', 'cfsmh-detail-value', t.value));
      const sub = make('small', 'cfsmh-detail-sub', t.sub);
      sub.title = t.sub;
      c.append(sub);
      grid.append(c);
    }
    box.append(grid);
    if (box.nextElementSibling !== anchor) anchor.before(box);
  }

  function run() {
    const groups = document.querySelector('#root .instance-info-groups');
    if (!groups) { document.querySelector('.cfsmh-detail')?.remove(); return; }
    render(groups);
  }
  const observer = new MutationObserver(() => {
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; observer.disconnect(); try { run(); } finally { watch(); } }, 400);
  });
  const watch = () => observer.observe(document.getElementById('root') || document.body,
    { childList: true, subtree: true, characterData: true });
  const init = () => { watch(); run(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();