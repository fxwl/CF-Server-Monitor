/* CFSM AnotherLuminaPlus overlay: per-card health verdict + homepage health strip.
   Reads only what the theme already renders (no extra API calls). */
(() => {
  'use strict';
  if (window.__CFSMHealthV5) return;
  window.__CFSMHealthV5 = true;

  const WARN = 75, BAD = 90;          // CPU / 内存 / 磁盘 阈值（%）
  const QUOTA_WARN = 80, QUOTA_BAD = 95; // 流量已用比例（%）
  const LEVEL = { ok: 0, warn: 1, bad: 2, off: 3 };
  const TEXT = { ok: '正常', warn: '注意', bad: '异常', off: '离线' };
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

  function readMetrics(card) {
    const out = {};
    card.querySelectorAll('.metric-item').forEach(item => {
      const label = item.querySelector('.text-\\[11px\\]')?.textContent?.trim() || '';
      const value = parseFloat(item.querySelector('.tabular .font-semibold')?.textContent || '');
      if (!Number.isFinite(value)) return;
      if (/CPU/i.test(label)) out.cpu = { name: 'CPU', v: value, el: item };
      else if (/内存|RAM|Mem/i.test(label)) out.ram = { name: '内存', v: value, el: item };
      else if (/磁盘|Disk/i.test(label)) out.disk = { name: '磁盘', v: value, el: item };
    });
    const usage = card.querySelector('.traffic-quota-usage')?.textContent || '';
    const [used, total] = usage.split('/').map(bytes);
    if (used >= 0 && total > 0) out.quota = { name: '流量', v: used / total * 100, el: card.querySelector('.traffic-quota') };
    return out;
  }

  function judge(card) {
    if (card.classList.contains('is-offline')) return { level: 'off', reasons: ['节点离线'] };
    const m = readMetrics(card);
    let level = 'ok';
    const reasons = [];
    for (const k of ['cpu', 'ram', 'disk', 'quota']) {
      const x = m[k];
      if (!x) continue;
      const [w, b] = k === 'quota' ? [QUOTA_WARN, QUOTA_BAD] : [WARN, BAD];
      const l = x.v >= b ? 'bad' : x.v >= w ? 'warn' : 'ok';
      x.el?.classList.toggle('cfsmh-warn', l === 'warn');
      x.el?.classList.toggle('cfsmh-bad', l === 'bad');
      if (l !== 'ok') {
        reasons.push(x.name + (k === 'quota' ? '已用 ' : ' ') + Math.round(x.v) + '%');
        if (LEVEL[l] > LEVEL[level]) level = l;
      }
    }
    return { level, reasons };
  }

  function badge(card, verdict) {
    const row = card.querySelector('.server-card-title-row,.compact-node-title-row');
    if (!row) return;
    let b = row.querySelector('.cfsmh-badge');
    if (!b) { b = make('span', 'cfsmh-badge'); row.append(b); }
    const label = TEXT[verdict.level];
    const title = verdict.reasons.join('、') || '各项指标正常';
    if (b.dataset.level !== verdict.level) { b.dataset.level = verdict.level; b.textContent = label; }
    if (b.title !== title) b.title = title;
    let why = card.querySelector('.cfsmh-why');
    if (verdict.reasons.length && verdict.level !== 'off') {
      if (!why) { why = make('div', 'cfsmh-why'); (card.querySelector('.server-card-header,.compact-node-header') || row).after(why); }
      if (why.textContent !== title) why.textContent = title;
      why.dataset.level = verdict.level;
    } else why?.remove();
  }

  function apply() {
    // Keep per-card health badges, but never render a homepage summary strip.
    document.querySelector('.cfsmh-strip')?.remove();
    const cards = [...document.querySelectorAll('[id^="node-card-"]')];
    for (const wrap of cards) {
      const card = wrap.matches('.server-card,.compact-node-card') ? wrap : (wrap.querySelector('.server-card,[class*="compact-node"]') || wrap);
      const v = judge(card);
      if (wrap.dataset.cfsmh !== v.level) wrap.dataset.cfsmh = v.level;
      badge(wrap, v);
      wrap.classList.remove('cfsmh-hidden');
    }
  }

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; observer.disconnect(); try { apply(); } finally { watch(); } }, 300);
  }
  const observer = new MutationObserver(schedule);
  const watch = () => observer.observe(document.getElementById('root') || document.body,
    { childList: true, subtree: true, characterData: true });
  function init() { watch(); schedule(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();