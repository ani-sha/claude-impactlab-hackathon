import { computeProject, computeHome, familyPrice, carryingPerMonth, money, DEFAULT_ASSUMPTIONS } from './engine.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };
const fmt = (v) => money(v);
const fmtK = (v) => money(v, { compact: true });
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const BAND_LABEL = { extremely_low: '30% AMI, extremely low', very_low: '50% AMI, very low', low: '80% AMI, lower income', moderate: '120% AMI, moderate' };
const BAND_SHORT = { extremely_low: '30% AMI', very_low: '50% AMI', low: '80% AMI', moderate: '120% AMI' };

const DEFAULT_STATE = () => ({
  juris: 'SANTA ANA', compare: 'BUENA PARK',
  homes: [{ count: 5, band: 'low', bedrooms: 3 }, { count: 3, band: 'moderate', bedrooms: 2 }],
  cost: { land: 360000, construction: 40000, fees: 50000 },
  rentWhileWaiting: 0, rate: null, enabled: {}, countUnconfirmed: false,
  assumptions: { ...DEFAULT_ASSUMPTIONS }, overrides: null, synthetic: false, tab: 0, gift: 25000,
});

let D = null;          // loaded data
let S = DEFAULT_STATE();
let R = null;          // last project result
const REG = new Map(); // source registry: key -> {label, value, tag, source, url, checked}

/* ---------------- boot ---------------- */
async function boot() {
  const get = (f) => fetch(`/data/${f}`).then((r) => r.json());
  const [income, timelines, programs, pmms, deal, map] = await Promise.all([get('income_limits.json'), get('city_timelines.json'), get('programs.json'), get('pmms.json'), get('synthetic_deal.json'), get('oc_map.json')]);
  D = { income, timelines, programs, pmms, deal, map };
  S.rate = pmms.latest.rate30;
  try { const t = localStorage.getItem('gs-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
  buildStatic();
  bind();
  bindStudio();
  render(true);
  drawSpark();
  buildSkyline();
  buildMap();
  fetch('/api/health').then((r) => r.json()).then((h) => {
    const p = $('#claudePill');
    p.textContent = h.claude ? `Claude: ${h.model}` : 'Claude: template mode';
    p.classList.toggle('on', h.claude);
    p.title = h.claude ? 'Memo and program reader call Claude' : 'Set ANTHROPIC_API_KEY in .env to turn on Claude';
  }).catch(() => { $('#claudePill').textContent = 'Claude: offline'; });
}

function buildStatic() {
  const cities = D.timelines.cities.slice().sort((a, b) => a.city.localeCompare(b.city));
  const opts = cities.map((c) => {
    const m = c.approval_to_permit;
    const tail = m.median != null ? ` · ${m.median} mo` : ' · no data';
    return `<option value="${c.juris_name}">${c.city}${tail}</option>`;
  }).join('');
  $('#city').innerHTML = opts;
  $('#compareCity').innerHTML = opts;
  buildPicker();
  const ag = $('#assumeGrid');
  const AS = [
    ['taxRate', 'Buyer property tax rate', 0.001], ['insuranceMo', 'Buyer insurance / mo', 10], ['hoaMo', 'HOA / mo', 10], ['utilitiesMo', 'Utilities / mo', 10],
    ['downPct', 'Down payment share', 0.01], ['acqRate', 'Acquisition loan rate', 0.0025], ['holdInsuranceMo', 'Holding insurance / mo', 10], ['mgmtMo', 'Management / mo', 10],
  ];
  ag.innerHTML = AS.map(([k, l, s]) => `<label>${l}<input type="number" step="${s}" data-assume="${k}"></label>`).join('');
}

/* ---------------- events ---------------- */
function bind() {
  $('#city').addEventListener('change', (e) => { S.juris = e.target.value; render(); });
  $('#compareCity').addEventListener('change', (e) => { S.compare = e.target.value; render(); });
  const num = (id, fn) => $(id).addEventListener('input', (e) => { fn(Number(e.target.value) || 0); render(); });
  num('#costLand', (v) => (S.cost.land = v));
  num('#costCons', (v) => (S.cost.construction = v));
  num('#costFees', (v) => (S.cost.fees = v));
  num('#rentWait', (v) => (S.rentWhileWaiting = v));
  $('#assumeGrid').addEventListener('input', (e) => { const k = e.target.dataset.assume; if (k) { S.assumptions[k] = Number(e.target.value); render(); } });
  $('#addRow').addEventListener('click', () => { S.homes.push({ count: 2, band: 'very_low', bedrooms: 2 }); render(true); });
  $('#homeRows').addEventListener('input', (e) => {
    const i = Number(e.target.closest('.home-row')?.dataset.i);
    const f = e.target.dataset.f;
    if (Number.isNaN(i) || !f) return;
    S.homes[i][f] = f === 'band' ? e.target.value : Math.max(f === 'count' ? 1 : 0, Number(e.target.value) || 0);
    render();
  });
  $('#homeRows').addEventListener('click', (e) => {
    if (!e.target.classList.contains('x')) return;
    const i = Number(e.target.closest('.home-row').dataset.i);
    if (S.homes.length > 1) { S.homes.splice(i, 1); S.tab = 0; render(true); }
  });
  $('#homeTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.tab = Number(b.dataset.i); render(); } });
  $('#countUnconf').addEventListener('change', (e) => { S.countUnconfirmed = e.target.checked; render(); });
  $('#programs').addEventListener('change', (e) => { const id = e.target.dataset.prog; if (id) { S.enabled[id] = e.target.checked; render(); } });
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  const rs = $('#rateSlider');
  rs.addEventListener('input', () => { S.rate = Number(rs.value); render(); });
  $$('[data-rate]').forEach((b) => b.addEventListener('click', () => { S.rate = Number(b.dataset.rate); render(); }));
  $('#board').addEventListener('click', (e) => { const r = e.target.closest('.brow'); if (r) setCity(r.dataset.j); });
  const gi = $('#gift'), gs = $('#giftSlider');
  gi.addEventListener('input', () => { S.gift = Number(gi.value) || 0; gs.value = S.gift; renderDonor(); });
  gs.addEventListener('input', () => { S.gift = Number(gs.value); gi.value = S.gift; renderDonor(); });
  $('#memoBtn').addEventListener('click', writeMemo);
  $('#copyMemo').addEventListener('click', () => { navigator.clipboard.writeText($('#memoOut').innerText); toast('Memo copied'); });
  $('#progBtn').addEventListener('click', draftProgram);
  $('#openSources').addEventListener('click', () => openDrawer());
  $('#closeSources').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gs-theme', next); } catch {}
  });
  // source popovers
  const pop = $('#pop');
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('.src, .src-link');
    if (!t) return;
    const s = REG.get(t.dataset.k);
    if (!s) return;
    pop.innerHTML = `<b>${s.label} <span class="tag ${s.tag}">${s.tag}</span></b>${s.source}${s.checked ? `<br><span style="opacity:.7">Checked ${s.checked}</span>` : ''}<br><span style="opacity:.7">Click for all sources</span>`;
    const r = t.getBoundingClientRect();
    pop.style.left = Math.min(window.innerWidth - 350, Math.max(8, r.left)) + 'px';
    pop.style.top = (r.bottom + 8 + 120 > window.innerHeight ? r.top - 8 - pop.offsetHeight : r.bottom + 8) + 'px';
    pop.classList.add('show');
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('.src, .src-link')) pop.classList.remove('show'); });
  document.addEventListener('click', (e) => { const t = e.target.closest('.src, .src-link'); if (t) { e.preventDefault(); openDrawer(t.dataset.k); } });
}

function applyPreset(name) {
  if (name === 'synthetic') {
    const c = D.deal.cost_to_create, p = D.deal.paid_by;
    S = { ...DEFAULT_STATE(), rate: S.rate, juris: S.juris, compare: S.compare, homes: [{ count: 1, band: 'low', bedrooms: 3 }],
      cost: { land: c.land_and_building_purchase.value, construction: c.construction_and_repairs.value, fees: c.fees_design_legal_sales.value },
      rentWhileWaiting: p.rent_earned_while_waiting.value,
      overrides: { familyPrice: p.family_price.value, timeCost: c.time_costs_while_waiting.value, subsidies: p.public_subsidies.value }, synthetic: true };
    toast('Organizers\' synthetic deal loaded. Expect $95,000 left to raise.');
  } else {
    S = { ...DEFAULT_STATE(), rate: D.pmms.latest.rate30 };
  }
  render(true);
}

/* ---------------- tween numbers ---------------- */
function tween(node, to, f = fmt, dur = 900) {
  if (!node) return;
  const from = Number(node.dataset.v ?? 0);
  node.dataset.v = to;
  if (from === to) { node.textContent = f(to); return; }
  const t0 = performance.now();
  cancelAnimationFrame(node._raf);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = f(from + (to - from) * e);
    if (k < 1) node._raf = requestAnimationFrame(step);
  };
  node._raf = requestAnimationFrame(step);
}

/* ---------------- render ---------------- */
function project(overrides = {}) {
  return computeProject({
    juris: S.juris, homes: S.homes, cost: S.cost, rate: S.rate, rentWhileWaiting: S.rentWhileWaiting,
    enabled: S.enabled, countUnconfirmed: S.countUnconfirmed, assumptions: S.assumptions,
    overrides: S.overrides || undefined, costTag: S.synthetic ? 'SYNTHETIC' : 'ASSUMPTION', ...overrides,
  }, D);
}

function render(structural = false) {
  const prev = R ? { ...R.per, juris: R.juris } : null;
  R = project();
  R.juris = S.juris;
  syncForm(structural);
  if (S.tab >= R.homes.length) S.tab = 0;
  buildRegistry();
  renderHero();
  renderWaterfall();
  renderPrograms();
  renderTime();
  renderBoard();
  renderRate();
  renderDonor();
  updatePicker();
  $('#srcCount').textContent = REG.size;
  if (prev) notifyChanges(prev);
}

function syncForm(structural) {
  $('#city').value = S.juris;
  $('#compareCity').value = S.compare;
  const setv = (id, v) => { const n = $(id); if (document.activeElement !== n) n.value = v; };
  setv('#costLand', S.cost.land); setv('#costCons', S.cost.construction); setv('#costFees', S.cost.fees); setv('#rentWait', S.rentWhileWaiting);
  $$('[data-assume]').forEach((n) => { if (document.activeElement !== n) n.value = S.assumptions[n.dataset.assume]; });
  $('#countUnconf').checked = S.countUnconfirmed;
  $('#syntheticBanner').classList.toggle('hidden', !S.synthetic);
  $$('[data-preset]').forEach((b) => b.classList.toggle('active', (b.dataset.preset === 'synthetic') === S.synthetic));
  if (structural || !$('#homeRows').children.length) {
    $('#homeRows').innerHTML = `<div class="home-legend"><span>Homes</span><span>Income band</span><span>Bedrooms</span><span></span></div>` + S.homes.map((h, i) => `
      <div class="home-row" data-i="${i}">
        <input type="number" min="1" value="${h.count}" data-f="count" aria-label="Number of homes">
        <select data-f="band" aria-label="Income band" title="${BAND_LABEL[h.band]}">${Object.entries(BAND_SHORT).map(([k, v]) => `<option value="${k}" ${k === h.band ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input type="number" min="0" max="7" value="${h.bedrooms}" data-f="bedrooms" aria-label="Bedrooms">
        <button class="x" title="Remove" ${S.homes.length < 2 ? 'disabled' : ''}>✕</button>
      </div>`).join('');
  }
  const w = R.wait;
  $('#cityHint').innerHTML = w.label === 'SOURCED'
    ? `Median <b>${w.months} months</b> approval to permit, from <b>${w.n}</b> state-reported projects${w.confidence === 'low' ? ' <span class="tag ASSUMPTION">LOW CONFIDENCE</span>' : ''}`
    : `Too few projects in state data. Using <b>${w.months} months</b> <span class="tag ASSUMPTION">ASSUMPTION</span>`;
  $('#rateSlider').value = S.rate;
}

function buildRegistry() {
  REG.clear();
  const inc = D.income.tables.state, h = R.homes[S.tab].result, w = R.wait;
  const add = (k, label, value, tag, source, url, checked) => REG.set(k, { label, value, tag, source, url, checked });
  const latest = D.pmms.latest;
  add('rate', '30-year mortgage rate', `${S.rate.toFixed(2)}%`, S.rate === latest.rate30 ? 'SOURCED' : 'ASSUMPTION',
    S.rate === latest.rate30 ? `Freddie Mac PMMS, week of ${latest.date}.` : `Slider value. Latest published: ${latest.rate30}% on ${latest.date} (Freddie Mac PMMS).`, D.pmms.source_url, D.pmms.checked);
  add('ami', 'Orange County area median income (4 persons)', fmt(inc.area_median_income_4p), 'SOURCED', `${inc.name}, revised ${inc.revision_date}, page ${inc.page}.`, inc.source_url, D.income.checked);
  add('apr', 'Projects joined from state records', D.timelines.projects_joined.toLocaleString(), 'SOURCED', `${D.timelines.rows_read.toLocaleString()} Orange County rows of HCD APR Table A2, joined across years. ${D.timelines.method}`, D.timelines.source_url, D.timelines.checked);
  add('statute', 'Affordable housing cost formula', h.fp.formula, 'SOURCED', `${h.fp.cite}: "${h.fp.quote}".`, D.income.statute.url, D.income.statute.checked);
  add('hh', 'Household size for the unit', `${h.fp.hh} people`, 'ASSUMPTION', D.income.statute.family_size_rule, null, null);
  add('family', 'Family price per home', fmt(R.per.family), S.overrides ? 'SYNTHETIC' : 'SOURCED',
    S.overrides ? 'Fixed at the organizers\' synthetic $285,000.' : `Computed: ${h.fp.cite} cap, HCD ${inc.revision_date} median income for ${h.fp.hh} people, ${S.rate}% rate, 30-year loan, minus buyer costs that are ASSUMPTIONs (tax ${(S.assumptions.taxRate * 100).toFixed(1)}%, insurance $${S.assumptions.insuranceMo}, HOA $${S.assumptions.hoaMo}, utilities $${S.assumptions.utilitiesMo}, ${Math.round(S.assumptions.downPct * 100)}% down).`, D.income.statute.url, D.income.checked);
  add('time', 'Time to permit, cost per home', fmt(R.per.timeCost), S.overrides ? 'SYNTHETIC' : w.label,
    S.overrides ? 'Organizers\' synthetic $85,000 time cost.' : `${w.months} months (${w.label === 'SOURCED' ? `median of ${w.n} ${w.city} projects, HCD APR Table A2` : 'ASSUMPTION, too few projects'}) x ${fmt(R.carry.total)} per month carrying cost (ASSUMPTION: ${(S.assumptions.acqRate * 100).toFixed(2)}% interest + ${(S.assumptions.holdTaxRate * 100).toFixed(1)}% tax on land + insurance + management).`, D.timelines.source_url, D.timelines.checked);
  add('carry', 'Carrying cost per home per month', fmt(R.carry.total), 'ASSUMPTION', 'Interest on the land loan + property tax + insurance + management while waiting. Change these under Assumptions.', null, null);
  add('gap', 'Gap per home', fmt(R.per.gap), 'SOURCED', 'Cost to create minus family price. Inherits the tags of its inputs.', null, null);
  add('subsidies', 'Programs counted per home', fmt(R.per.subsidies), S.overrides ? 'SYNTHETIC' : 'SOURCED', S.overrides ? 'Organizers\' synthetic $100,000.' : 'Only confirmed programs (and unconfirmed ones if you switch them on), capped by the gap. Amounts read on each program page today.', null, D.programs.checked);
  add('fundraising', 'Left to fundraise per home', fmt(R.per.fundraising), 'SOURCED', 'Gap minus programs minus rent earned while waiting. Inherits the tags of its inputs.', null, null);
  ['land', 'construction', 'fees'].forEach((k) => add(`cost_${k}`, `Cost: ${k}`, fmt(S.cost[k]), S.synthetic ? 'SYNTHETIC' : 'ASSUMPTION', 'Default copied from the organizers\' synthetic worked example. Replace with your pro forma.', 'https://github.com/travcjohnson/claude-impact-lab-uci/blob/main/lanes/3-fund-it/data/synthetic-example-deal.json', null));
  for (const p of D.programs.programs) {
    const a = p.amount.kind === 'fixed' ? fmt(p.amount.value) : p.amount.kind === 'pct_price' ? `${p.amount.value * 100}%${p.amount.cap ? ` (cap ${fmt(p.amount.cap)})` : ''}` : 'unknown';
    add(`prog_${p.id}`, p.name, a, p.amount.kind === 'unknown' ? 'UNKNOWN' : p.draft ? 'ASSUMPTION' : 'SOURCED', `${p.terms}. Status: ${p.status.replace('_', ' ')}. ${p.status_note}`, p.source_url, p.checked || D.programs.checked);
  }
  add('assume_buyer', 'Buyer costs inside the cap', `$${S.assumptions.insuranceMo + S.assumptions.hoaMo + S.assumptions.utilitiesMo}/mo + ${(S.assumptions.taxRate * 100).toFixed(1)}% tax`, 'ASSUMPTION', 'HSC 50052.5 counts insurance, HOA, utilities and property tax as housing cost, so they come out of the cap before the mortgage. Values are ASSUMPTIONs.', null, null);
  add('limits', 'Known limits of the timeline data', `${D.timelines.limits.length} notes`, 'SOURCED', D.timelines.limits.join(' '), D.timelines.source_url, D.timelines.checked);
}

function renderHero() {
  const n = R.totals.count;
  tween($('#heroLeft'), R.per.fundraising);
  tween($('#heroGap'), R.per.gap, fmtK);
  tween($('#heroTime'), R.per.timeCost, fmtK);
  tween($('#heroSubs'), R.per.subsidies, fmtK);
  tween($('#heroTotal'), R.totals.fundraising);
  const sub = $('#heroSub');
  const cityHtml = `<span class="city-swap" data-c="${S.juris}">${cityName(S.juris)}</span>`;
  const keepCity = sub.querySelector('.city-swap')?.dataset.c === S.juris;
  sub.innerHTML = `<b>${n} home${n > 1 ? 's' : ''}</b> in ${keepCity ? sub.querySelector('.city-swap').outerHTML : cityHtml} at <b class="src" data-k="rate">${S.rate.toFixed(2)}%</b>`;
  tween($('#eqFam'), R.per.family, fmtK);
  tween($('#eqSub'), R.per.subsidies, fmtK);
  tween($('#eqRent'), R.per.rent, fmtK);
  tween($('#eqRaise'), R.per.fundraising, fmtK);
  tween($('#eqCost'), R.per.cost, fmtK);
  const bal = R.per.family + R.per.subsidies + R.per.rent + R.per.fundraising - R.per.cost;
  $('#eqBal').textContent = bal > 1 ? `+${fmtK(bal)} surplus` : '$0';
}

function renderWaterfall() {
  const tabs = $('#homeTabs');
  tabs.innerHTML = R.homes.length > 1 ? R.homes.map((h, i) => `<button data-i="${i}" class="${i === S.tab ? 'active' : ''}">${h.count} x ${BAND_SHORT[h.band]}, ${h.bedrooms}BR</button>`).join('') : '';
  const h = R.homes[S.tab].result;
  const max = Math.max(h.cost, h.family) * 1.08;
  const pct = (v) => (v / max) * 100;
  const cols = [];
  // cost column: stacked lines
  let y = 0;
  const costBars = h.lines.map((l) => { const b = { cls: { land: 'land', construction: 'cons', fees: 'fees', time: 'time' }[l.key], from: y, h: l.value, label: l.label, tag: l.tag, k: l.key === 'time' ? 'time' : `cost_${l.key}` }; y += l.value; return b; });
  cols.push({ key: 'cost', label: 'Cost to create', bars: costBars, total: h.cost, k: 'gap' });
  cols.push({ key: 'family', label: 'Family pays', sub: BAND_SHORT[R.homes[S.tab].band], bars: [{ cls: 'fam', from: 0, h: Math.min(h.family, h.cost), k: 'family' }], total: h.family, k: 'family' });
  let acc = Math.min(h.family, h.cost);
  for (const s of h.stack) {
    if (s.value > 0) {
      cols.push({ key: s.id, label: shortName(s.name), sub: s.status === 'synthetic' ? 'synthetic' : 'counted', bars: [{ cls: 'prog', from: acc, h: s.value, k: `prog_${s.id}` }], total: s.value, k: `prog_${s.id}` });
      acc += s.value;
    } else if (s.eligible && s.on && s.potential && s.status === 'funds_unconfirmed' && acc < h.cost) {
      const v = Math.min(s.potential, h.cost - acc);
      cols.push({ key: s.id, label: shortName(s.name), sub: 'not confirmed', bars: [{ cls: 'ghost', from: acc, h: v, k: `prog_${s.id}` }], total: v, ghost: true, k: `prog_${s.id}` });
    }
  }
  if (h.rent > 0) { cols.push({ key: 'rent', label: 'Rent while waiting', bars: [{ cls: 'rent', from: acc, h: h.rent }], total: h.rent }); acc += h.rent; }
  cols.push({ key: 'raise', label: 'Left to raise', sub: 'fundraising', bars: [{ cls: 'raise', from: acc, h: h.fundraising, k: 'fundraising' }], total: h.fundraising, k: 'fundraising' });

  const wf = $('#waterfall');
  if (!wf._init) {
    wf.innerHTML = '<div class="wf-axis"></div><div class="wf-costline"><span></span></div>';
    wf._init = true;
  }
  // axis
  const axis = $('.wf-axis', wf);
  const step = niceStep(max / 4);
  let ax = '';
  $$('.wf-grid', wf).forEach((g) => g.remove());
  for (let v = 0; v <= max; v += step) { ax += `<div style="bottom:${pct(v)}%">${fmtK(v)}</div>`; const g = el('div', { class: 'wf-grid' }); g.style.bottom = `calc(52px + ${pct(v)}% * (100% - 78px) / 100%)`; }
  axis.innerHTML = ax;
  // grid lines: compute inside plot area via a wrapper approach
  const cl = $('.wf-costline', wf);
  cl.style.bottom = `calc(52px + (100% - 78px) * ${pct(h.cost) / 100})`;
  $('span', cl).textContent = fmtK(h.cost);
  cl.title = `Cost line: ${fmt(h.cost)} per home`;
  // columns keyed
  const existing = new Map($$('.wf-col', wf).map((c) => [c.dataset.key, c]));
  const keep = new Set();
  cols.forEach((c, i) => {
    let col = existing.get(c.key);
    if (!col) {
      col = el('div', { class: 'wf-col', 'data-key': c.key });
      col.innerHTML = `<div class="wf-val"></div><div class="wf-label"></div>`;
      wf.appendChild(col);
    }
    keep.add(c.key);
    col.style.order = i;
    // bars
    const bars = $$('.wf-bar', col);
    c.bars.forEach((b, j) => {
      let bar = bars[j];
      if (!bar) { bar = el('div', { class: 'wf-bar' }); bar.style.bottom = `${pct(b.from)}%`; bar.style.height = '0%'; col.insertBefore(bar, $('.wf-val', col)); }
      bar.className = `wf-bar ${b.cls}${b.k ? ' src' : ''}`;
      if (b.k) bar.dataset.k = b.k;
      bar.title = b.label ? `${b.label}: ${fmt(b.h)}` : fmt(b.h);
      requestAnimationFrame(() => { bar.style.bottom = `${pct(b.from)}%`; bar.style.height = `${Math.max(0, pct(b.h))}%`; });
    });
    bars.slice(c.bars.length).forEach((b) => b.remove());
    const top = c.bars.reduce((m, b) => Math.max(m, b.from + b.h), 0);
    const val = $('.wf-val', col);
    val.style.bottom = `calc(${pct(top)}% + 4px)`;
    tween(val, c.total, fmtK, 700);
    val.style.color = c.key === 'raise' ? 'var(--terra)' : c.ghost ? 'var(--prog)' : 'var(--ink)';
    $('.wf-label', col).innerHTML = `${c.label}${c.sub ? `<span class="st">${c.sub}</span>` : ''}`;
  });
  existing.forEach((col, k) => { if (!keep.has(k)) col.remove(); });

  const fp = h.fp;
  $('#billSub').textContent = S.synthetic ? 'Synthetic example' : `${R.homes[S.tab].bedrooms} BR · ${BAND_SHORT[R.homes[S.tab].band]} · ${cityName(S.juris)}`;
  $('#familyExplain').innerHTML = S.overrides
    ? `<b>Family price fixed at ${fmt(h.family)}</b> <span class="tag SYNTHETIC">SYNTHETIC</span>. Switch to <b>New project</b> to compute it from state law.`
    : `Family pays <b class="src" data-k="family">${fmt(h.family)}</b> · <code class="src" data-k="statute">${fp.formula} = ${fmt(fp.capMo)}/mo</code> · ${fmtK(fp.loan)} loan at <span class="src" data-k="rate">${S.rate.toFixed(2)}%</span>`;
}

const shortName = (n) => n.replace('CalHFA ', '').replace('FHLBank San Francisco ', 'FHLB ').replace('Santa Ana ', 'SA ').replace(' (synthetic)', '').replace('HCD CalHome (via Homeownership Super NOFA)', 'CalHome').replace('Orange County Housing Finance Trust', 'OCHFT');
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p; }

function renderPrograms() {
  const h = R.homes[S.tab].result;
  const box = $('#programs');
  if (S.overrides) {
    box.innerHTML = `<div class="prog"><div><div class="prog-name">Public subsidies <span class="tag SYNTHETIC">SYNTHETIC</span></div><div class="prog-terms">The organizers' placeholder city and state funds. Not real programs.</div></div><div class="prog-amt">${fmt(h.subsidies)}</div></div>`;
    return;
  }
  const label = { confirmed: 'Confirmed', funds_unconfirmed: 'Funds unconfirmed', unknown: 'Unknown amount' };
  box.innerHTML = h.stack.map((s) => {
    const amt = s.potential == null ? 'unknown' : fmt(s.potential);
    const status = `<span class="badge ${s.status}">${label[s.status] || s.status}</span>`;
    const inel = !s.eligible ? `<span class="badge inel">Not eligible: ${s.reasons.join(', ')}</span>` : '';
    const draft = D.programs.programs.find((p) => p.id === s.id)?.draft ? '<span class="badge draft">Claude draft, approved by you</span>' : '';
    const counted = s.value > 0 ? `<small>counted ${fmt(s.value)}</small>` : s.status === 'unknown' ? '<small>listed, never counted</small>' : !s.eligible ? '<small>not counted</small>' : s.status === 'funds_unconfirmed' && !S.countUnconfirmed ? '<small>shown dashed, not counted</small>' : '<small>not needed</small>';
    return `<div class="prog ${s.value > 0 ? 'counted' : ''} ${!s.eligible || !s.on ? 'off' : ''}">
      <div><div class="prog-name">${s.name} ${status} ${inel} ${draft}<a href="${s.source_url}" target="_blank" rel="noopener">source</a></div>
      <div class="prog-terms" title="${(s.terms + '. ' + s.status_note).replace(/"/g, '&quot;')}">${s.terms}</div></div>
      <div style="display:flex;align-items:center;gap:14px"><div class="prog-amt src" data-k="prog_${s.id}">${amt}${counted}</div>
      <label class="switch" title="Include in stack"><input type="checkbox" data-prog="${s.id}" ${s.on ? 'checked' : ''} ${!s.eligible || s.potential == null ? 'disabled' : ''}><span></span></label></div>
    </div>`;
  }).join('');
}

/* ---------------- time ---------------- */
function cityRow(j) { return D.timelines.cities.find((c) => c.juris_name === j); }

function renderTime() {
  const c = cityRow(S.juris);
  const w = R.wait;
  $('#tlCity').textContent = c ? c.city : titleCase(S.juris);
  const conf = $('#tlConf');
  conf.className = `conf ${w.confidence === 'low' ? 'low' : w.label === 'ASSUMPTION' ? 'unknown' : ''}`;
  conf.textContent = w.label === 'SOURCED' ? `${w.n} projects${w.confidence === 'low' ? ', low confidence' : ''}` : 'Not enough data';
  const wait = c?.approval_to_permit.median ?? null;
  const build = c?.permit_to_completion.median ?? null;
  const tot = (wait ?? 0) + (build ?? 0) || 1;
  $('#timeline').innerHTML = `
    <div class="tl-seg wait" style="flex-grow:${Math.max(wait ?? 0, 0.6)}"><span>Approval to permit</span><b>${wait != null ? wait + ' mo' : 'unknown'}</b></div>
    <div class="tl-seg build" style="flex-grow:${Math.max(build ?? 0, 0.6)}"><span>Permit to completion</span><b>${build != null ? build + ' mo' : 'unknown'}</b></div>`;
  const tl = $('#timeline');
  if (!$('.tl-scale', tl.parentNode)) tl.insertAdjacentHTML('afterend', '<div class="tl-scale"></div>');
  $('.tl-scale', tl.parentNode).innerHTML = `<span>Approved</span><span>${c && c.approval_to_permit.p25 != null ? `middle half of projects: ${c.approval_to_permit.p25} to ${c.approval_to_permit.p75} mo to permit` : ''}</span><span>Done, about ${Math.round(tot)} mo</span>`;
  const k = R.carry;
  $('#carry').innerHTML = `
    <div>Land loan interest<b>${fmt(k.interest)}</b></div>
    <div>Property tax<b>${fmt(k.tax)}</b></div>
    <div>Insurance + mgmt<b>${fmt(k.insurance + k.mgmt)}</b></div>
    <div class="total"><span class="src" data-k="carry">Per home / month</span><b>${fmt(k.total)}</b></div>`;

  // compare
  const other = project({ juris: S.compare });
  const diff = other.per.fundraising - R.per.fundraising;
  const timeDiff = other.per.timeCost - R.per.timeCost;
  const oc = cityRow(S.compare);
  const mine = { name: titleCase(S.juris), time: R.per.timeCost, left: R.per.fundraising, months: R.wait.months };
  const theirs = { name: oc ? oc.city : titleCase(S.compare), time: other.per.timeCost, left: other.per.fundraising, months: other.wait.months };
  const card = (x, win) => `<div class="cmp-card ${win ? 'win' : 'lose'}"><span>${x.name} · ${x.months} mo</span><b>${fmtK(x.time)}</b><span>time cost per home</span></div>`;
  $('#compareOut').innerHTML = card(mine, mine.time <= theirs.time) + card(theirs, theirs.time < mine.time);
  // insight
  const known = D.timelines.cities.filter((x) => x.approval_to_permit.median != null && x.approval_to_permit.confidence === 'ok').map((x) => x.approval_to_permit.median).sort((a, b) => a - b);
  const ocMedian = known.length ? known[Math.floor(known.length / 2)] : null;
  const saveMonths = ocMedian != null ? Math.max(0, R.wait.months - ocMedian) : 0;
  const save = saveMonths * k.total;
  const projectSave = save * R.totals.count;
  const wish = D.programs.programs.find((p) => p.id === 'fhlb_wish');
  let msg = `Every month <b>${titleCase(S.juris)}</b> takes from approval to permit costs <b>${fmt(k.total)}</b> per home.`;
  if (ocMedian != null && saveMonths > 0) {
    msg += ` Bringing it down to the Orange County median of ${ocMedian} months would save <b>${fmtK(save)}</b> per home, <b>${fmtK(projectSave)}</b> on this project${wish && save > wish.amount.value ? `, more than a full WISH grant (${fmtK(wish.amount.value)}) per family` : ''}.`;
  } else if (ocMedian != null) {
    msg += ` ${titleCase(S.juris)} is already at or under the Orange County median of ${ocMedian} months.`;
  }
  if (Math.abs(timeDiff) > 1) {
    msg += ` In ${theirs.name} the wait alone would cost <b>${fmtK(Math.abs(timeDiff))}</b> ${timeDiff > 0 ? 'more' : 'less'} per home.`;
    const progDiff = Math.abs(diff - timeDiff);
    if (progDiff > 1) msg += ` Counting local programs too (some only exist in one city), fundraising per home would be <b>${fmtK(Math.abs(diff))}</b> ${diff > 0 ? 'higher' : 'lower'}.`;
  }
  $('#insight').innerHTML = msg;
}

function renderBoard() {
  const carry = R.carry.total;
  const rows = D.timelines.cities.filter((c) => c.approval_to_permit.median != null).sort((a, b) => b.approval_to_permit.median - a.approval_to_permit.median);
  const max = Math.max(...rows.map((r) => r.approval_to_permit.median), 1);
  const board = $('#board');
  const existing = new Map($$('.brow', board).map((r) => [r.dataset.j, r]));
  rows.forEach((c, i) => {
    const m = c.approval_to_permit;
    let row = existing.get(c.juris_name);
    if (!row) {
      row = el('div', { class: 'brow', 'data-j': c.juris_name });
      row.innerHTML = `<div class="bname"></div><div class="btrack"><div class="bfill"><i></i></div></div><div class="bmo"></div>`;
      board.appendChild(row);
    }
    row.style.order = i;
    row.className = `brow ${c.juris_name === S.juris ? 'sel' : ''} ${c.juris_name === S.compare ? 'cmp' : ''} ${m.confidence === 'low' ? 'low' : ''}`;
    $('.bname', row).textContent = c.city;
    $('.bname', row).title = `${c.city}: ${m.n} projects${m.confidence === 'low' ? ' (low confidence)' : ''}`;
    requestAnimationFrame(() => { $('.bfill', row).style.width = `${Math.max(2, (m.median / max) * 100)}%`; });
    $('.bfill i', row).textContent = m.median > max * 0.25 ? fmtK(m.median * carry) : '';
    $('.bmo', row).innerHTML = `${m.median} mo<small>n=${m.n}</small>`;
  });
  board.style.display = 'flex'; board.style.flexDirection = 'column';
  const none = D.timelines.cities.filter((c) => c.approval_to_permit.median == null).map((c) => c.city);
  $('#boardNote').innerHTML = `Faded = under 10 projects. <a class="src-link" data-k="limits" href="#">${none.length} cities without data</a> · <a class="src-link" data-k="apr" href="#">HCD APR Table A2</a>`;
}

/* ---------------- rate ---------------- */
function renderRate() {
  $('#rateVal').textContent = S.rate.toFixed(2);
  const base = D.pmms.latest.rate30;
  const at = (rate) => computeProject({ juris: S.juris, homes: S.homes, cost: S.cost, rate, rentWhileWaiting: S.rentWhileWaiting, enabled: S.enabled, countUnconfirmed: S.countUnconfirmed, assumptions: S.assumptions }, D);
  const now = at(S.rate), ref = at(base);
  const dGap = now.per.gap - ref.per.gap;
  const dFam = now.per.family - ref.per.family;
  const synth = S.overrides ? '<div class="muted tiny">Family price is fixed in the synthetic example; this panel computes it from state law instead.</div>' : '';
  $('#rateOut').innerHTML = `${synth}
    <div class="rate-line"><span>Family price per home</span><b>${fmt(now.per.family)}</b></div>
    <div class="rate-line"><span>Gap per home</span><b>${fmt(now.per.gap)}</b></div>
    <div class="rate-line delta ${dGap < 0 ? 'down' : ''}"><span>vs latest ${base}% (${D.pmms.latest.date})</span><b>${dGap === 0 ? 'no change' : `${dGap > 0 ? '+' : '-'}${fmt(Math.abs(dGap))} gap`}</b></div>
    <div class="rate-line"><span>Whole project, ${now.totals.count} homes</span><b>${dGap === 0 ? '$0' : `${dGap > 0 ? '+' : '-'}${fmt(Math.abs(dGap * now.totals.count))}`}</b></div>`;
  $$('[data-rate]').forEach((b) => b.classList.toggle('active', Math.abs(Number(b.dataset.rate) - S.rate) < 0.001));
  moveSparkCursor();
}

function drawSpark() {
  const pts = D.pmms.weekly_last_2y;
  const svg = $('#spark');
  const W = 600, H = 220, pad = { l: 40, r: 10, t: 12, b: 26 };
  const ys = pts.map((p) => p.rate30);
  const lo = Math.floor(Math.min(...ys, 6) * 2) / 2, hi = Math.ceil(Math.max(...ys) * 2) / 2;
  const x = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  svg._y = y; svg._lo = lo; svg._hi = hi;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rate30).toFixed(1)}`).join('');
  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += 0.5) grid += `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}%</text>`;
  const first = pts[0].date, last = pts[pts.length - 1];
  svg.innerHTML = `<defs><linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d4622f" stop-opacity=".28"/><stop offset="1" stop-color="#d4622f" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="area" d="${d}L${x(pts.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z"/><path class="line" d="${d}"/>
    <circle class="dot" cx="${x(pts.length - 1)}" cy="${y(last.rate30)}" r="5"/>
    <text class="ax" x="${pad.l}" y="${H - 6}">${first}</text><text class="ax" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${last.date}: ${last.rate30}%</text>
    <line class="cur" id="sparkCur" x1="${pad.l}" x2="${W - pad.r}" y1="0" y2="0"/>`;
  moveSparkCursor();
}
function moveSparkCursor() {
  const svg = $('#spark'), c = $('#sparkCur');
  if (!svg || !c || !svg._y) return;
  const v = Math.min(svg._hi, Math.max(svg._lo, S.rate));
  c.setAttribute('y1', svg._y(v)); c.setAttribute('y2', svg._y(v));
}

/* ---------------- donor ---------------- */
function renderDonor() {
  if (!R) return;
  const g = S.gift;
  const h = R.homes[S.tab].result;
  const left = R.per.fundraising;
  const share = left > 0 ? g / left : 0;
  const months = R.carry.total > 0 ? g / R.carry.total : 0;
  const homes = left > 0 ? g / left : 0;
  const projShare = R.totals.fundraising > 0 ? g / R.totals.fundraising : 0;
  $('#donorCards').innerHTML = `
    <div class="dcard hot"><b>${left > 0 ? Math.min(999, Math.round(share * 100)) + '%' : 'n/a'}</b><p>of one home's gap${homes >= 1 ? ` · closes <b>${Math.floor(homes)}</b> home${Math.floor(homes) > 1 ? 's' : ''}` : ''}</p><div class="meter"><i style="width:${Math.min(100, share * 100)}%"></i></div></div>
    <div class="dcard"><b>${months.toFixed(1)} months</b><p>of waiting on a permit <span class="tag ASSUMPTION">ASSUMPTION</span></p><div class="meter"><i style="width:${Math.min(100, (months / Math.max(1, R.wait.months)) * 100)}%"></i></div></div>
    <div class="dcard"><b>${Math.round(projShare * 100)}%</b><p>of the whole project</p><div class="meter"><i style="width:${Math.min(100, projShare * 100)}%"></i></div></div>`;
  void h;
}

/* ---------------- Claude ---------------- */
function memoFacts() {
  const h0 = R.homes[0].result;
  return {
    project: { city: titleCase(S.juris), homes: S.homes.map((h) => ({ count: h.count, band: BAND_LABEL[h.band], bedrooms: h.bedrooms })), rate_pct: S.rate, rate_tag: REG.get('rate').tag, rate_source: REG.get('rate').source },
    per_home_average: { cost_to_create: Math.round(R.per.cost), family_price: Math.round(R.per.family), gap: Math.round(R.per.gap), time_cost: Math.round(R.per.timeCost), programs_counted: Math.round(R.per.subsidies), rent_while_waiting: Math.round(R.per.rent), fundraising_left: Math.round(R.per.fundraising) },
    project_totals: { homes: R.totals.count, fundraising_left: Math.round(R.totals.fundraising), gap: Math.round(R.totals.gap), time_cost: Math.round(R.totals.timeCost) },
    tags: { cost_lines: S.synthetic ? 'SYNTHETIC' : 'ASSUMPTION', family_price: REG.get('family').tag, time_cost: REG.get('time').tag, carrying_cost_per_month: 'ASSUMPTION' },
    time_to_permit: { city: R.wait.city, months: R.wait.months, projects: R.wait.n, confidence: R.wait.confidence, source: 'HCD APR Table A2 via data.ca.gov, checked ' + D.timelines.checked, carrying_cost_per_month: Math.round(R.carry.total), limits: D.timelines.limits },
    compare_city: (() => { const o = project({ juris: S.compare }); return { city: titleCase(S.compare), months: o.wait.months, time_cost_per_home: Math.round(o.per.timeCost), fundraising_left_per_home: Math.round(o.per.fundraising) }; })(),
    family_price_basis: { statute: h0.fp.cite, formula: h0.fp.formula, household_size: h0.fp.hh, income_table: `${D.income.tables.state.name}, revised ${D.income.tables.state.revision_date}`, buyer_costs_tag: 'ASSUMPTION' },
    programs: h0.stack.map((s) => ({ name: s.name, status: s.status, eligible: s.eligible, potential_amount: s.potential == null ? 'unknown' : Math.round(s.potential), counted_per_home: Math.round(s.value), source: s.source_url })),
    synthetic_example: S.synthetic,
  };
}

async function writeMemo() {
  const btn = $('#memoBtn'), out = $('#memoOut');
  btn.disabled = true;
  out.innerHTML = '<div class="thinking"><i></i><i></i><i></i> Claude is reading the engine output</div>';
  const facts = memoFacts();
  const template = {
    homes: R.totals.count, city: titleCase(S.juris), bandLabel: BAND_LABEL[S.homes[0].band].replace(',', ' (') + ')', fundraisingTotal: R.totals.fundraising, fundraisingPer: R.per.fundraising,
    costPer: R.per.cost, familyPer: R.per.family, gapPer: R.per.gap, rate: S.rate, rateDate: D.pmms.latest.date,
    timeLine: `Projects in ${R.wait.city} wait a median ${R.wait.months} months from approval to building permit (HCD APR Table A2, ${R.wait.n} projects). At ${fmt(R.carry.total)} per month carrying cost (assumption), that adds ${fmt(R.per.timeCost)} per home.`,
    programLines: R.homes[0].result.stack.map((s) => `- ${s.name}: ${s.potential == null ? 'amount unknown, lead only' : fmt(s.potential)} (${s.status.replace('_', ' ')})${s.value > 0 ? `, counted ${fmt(s.value)}` : ''}`).join('\n'),
  };
  try {
    const r = await fetch('/api/memo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ facts, template }) }).then((x) => x.json());
    await typeOut(out, r.memo);
    $('#memoActions').classList.remove('hidden');
    $('#memoBy').textContent = r.by === 'template' ? `Template (no Claude key${r.reason && r.reason !== 'no_key' ? `: ${r.reason}` : ''}). Same numbers, no AI.` : `Written by ${r.by} from the engine output above. A person checks it before use.`;
  } catch (e) {
    out.innerHTML = `<p>Could not reach the server: ${e.message}</p>`;
  }
  btn.disabled = false;
}

function md(s) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/_(.+?)_/g, '<i>$1</i>');
  const lines = s.split(/\r?\n/);
  let html = '', list = false;
  for (const l of lines) {
    if (/^\s*[-*] /.test(l)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (/^#{1,3} /.test(l)) html += `<h3>${inline(l.replace(/^#{1,3} /, ''))}</h3>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

async function typeOut(node, text) {
  const words = text.split(/(\s+)/);
  let acc = '';
  for (let i = 0; i < words.length; i++) {
    acc += words[i];
    if (i % 6 === 0 || i === words.length - 1) {
      node.innerHTML = md(acc) + (i < words.length - 1 ? '<span class="caret"></span>' : '');
      await new Promise((r) => setTimeout(r, 14));
    }
  }
}

async function draftProgram() {
  const text = $('#progText').value.trim();
  const out = $('#progOut');
  if (text.length < 40) { toast('Paste the program page text first'); return; }
  out.innerHTML = '<div class="thinking" style="margin-top:10px"><i></i><i></i><i></i> Claude is reading the page</div>';
  const r = await fetch('/api/program', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, url: $('#progUrl').value }) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  if (r.error) { out.innerHTML = `<p class="muted">${r.error}</p>${r.raw ? `<pre class="json">${r.raw}</pre>` : ''}`; return; }
  const row = r.row;
  out.innerHTML = `<pre class="json">${JSON.stringify(row, null, 2).replace(/</g, '&lt;')}</pre>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" id="approveProg">Approve and add to the stack</button><button class="btn small ghost" id="rejectProg">Discard</button></div>
    <p class="muted tiny">Check each number against the evidence quotes before approving. Approved rows last for this session; commit them to data/programs.json after review.</p>`;
  $('#approveProg').onclick = () => {
    const id = 'draft_' + (row.name || 'program').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
    D.programs.programs.push({ id, name: row.name || 'New program', type: row.type || 'buyer', amount: row.amount || { kind: 'unknown' }, terms: row.terms || '', max_ami: row.max_ami ?? null, cities: row.cities || null, status: row.status || 'unknown', status_note: row.status_note || '', source_url: $('#progUrl').value || '#', draft: true, checked: new Date().toISOString().slice(0, 10) });
    out.innerHTML = '<p class="muted">Added. It now appears in the funding stack with a draft badge.</p>';
    render(); toast(`${row.name} added to the stack`);
  };
  $('#rejectProg').onclick = () => { out.innerHTML = ''; };
}

/* ---------------- drawer / misc ---------------- */
function openDrawer(focusKey) {
  const list = $('#sourceList');
  list.innerHTML = [...REG.entries()].map(([k, s]) => `<div class="srow" id="src-${k}"><div><b>${s.label}</b> <span class="tag ${s.tag}">${s.tag}</span></div><div class="v">${s.value}</div><div class="s">${s.source}${s.url ? ` <a href="${s.url}" target="_blank" rel="noopener">open source</a>` : ''}${s.checked ? ` · checked ${s.checked}` : ''}</div></div>`).join('');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#pop').classList.remove('show');
  if (focusKey) { const r = $(`#src-${focusKey}`); if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); } }
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('show'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), 2600); }
function reveal() {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
  $$('.reveal').forEach((n) => io.observe(n));
}

/* ================= STUDIO LAYER ================= */
const cityName = (j) => cityRow(j)?.city || titleCase(j);

function buildPicker() {
  const list = $('#cpList');
  const cities = D.timelines.cities.slice().sort((a, b) => a.city.localeCompare(b.city));
  const max = Math.max(...cities.map((c) => c.approval_to_permit.median || 0), 1);
  list.innerHTML = cities.map((c, i) => {
    const m = c.approval_to_permit;
    const has = m.median != null;
    return `<div class="cp-item ${has ? '' : 'none'}" role="option" data-j="${c.juris_name}" data-name="${c.city.toLowerCase()}" style="--i:${i}">
      <span>${c.city}</span>
      <span class="cp-bar">${has ? `<i style="width:${Math.max(4, (m.median / max) * 100)}%"></i>` : ''}</span>
      <span class="cp-mo">${has ? `${m.median} mo` : 'no data'}</span></div>`;
  }).join('');
}

function updatePicker() {
  const c = cityRow(S.juris), m = c?.approval_to_permit;
  $('#cpCity').textContent = cityName(S.juris);
  $('#cpMeta').textContent = m && m.median != null ? `${m.median} mo to permit · ${m.n} projects` : 'Not enough state data · using an assumption';
  $$('.cp-item').forEach((n) => n.classList.toggle('sel', n.dataset.j === S.juris));
}

function setCity(j) {
  if (!j || j === S.juris) { closePicker(); return; }
  S.juris = j;
  closePicker();
  render();
}

function openPicker(invite = false) {
  const p = $('#cityPicker');
  // restart item stagger
  $$('.cp-item', p).forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
  p.classList.add('open');
  if (invite) p.classList.add('invite');
  setTimeout(() => $('#cpSearch').focus({ preventScroll: true }), 120);
  const sel = $('.cp-item.sel', p), list = $('#cpList');
  if (sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2;
}
function closePicker() { const p = $('#cityPicker'); p.classList.remove('open', 'invite'); $('#cpSearch').value = ''; $$('.cp-item').forEach((n) => (n.style.display = '')); }

function bindStudio() {
  $('#startBtn').addEventListener('click', () => openStudio());
  $('#exampleBtn').addEventListener('click', () => openStudio('synthetic'));
  $('#homeBtn').addEventListener('click', goHome);
  $('#cpBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#cityPicker').classList.contains('open') ? closePicker() : openPicker(); });
  $('#cpList').addEventListener('click', (e) => { const it = e.target.closest('.cp-item'); if (it) setCity(it.dataset.j); });
  $('#cpSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.cp-item').forEach((n) => (n.style.display = n.dataset.name.includes(q) ? '' : 'none'));
  });
  $('#cpSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $$('.cp-item').find((n) => n.style.display !== 'none'); if (first) setCity(first.dataset.j); }
    if (e.key === 'Escape') closePicker();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#cityPicker')) closePicker(); });
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) switchTab(b.dataset.tab); });
  window.addEventListener('resize', moveInk);
}

function openStudio(preset, juris) {
  if (juris) S.juris = juris;
  hideTip();
  document.body.classList.add('leaving');
  setTimeout(() => {
    document.body.classList.remove('at-landing', 'leaving');
    document.body.classList.add('at-studio');
    $('#studio').setAttribute('aria-hidden', 'false');
    window.scrollTo(0, 0);
    // replay chart growth
    const wf = $('#waterfall'); wf._init = false; wf.innerHTML = '';
    $$('.brow').forEach((r) => r.remove());
    ['heroLeft', 'heroGap', 'heroTime', 'heroSubs', 'heroTotal'].forEach((id) => { $('#' + id).dataset.v = 0; });
    R = null;
    if (preset) applyPreset(preset); else render(true);
    switchTab('bill', true);
    if (!preset && !juris) setTimeout(() => $('#cityPicker').classList.add('invite'), 900);
  }, 520);
}

function goHome() {
  closePicker();
  document.body.classList.remove('at-studio');
  document.body.classList.add('at-landing');
  $('#studio').setAttribute('aria-hidden', 'true');
  buildSkyline();
  buildMap();
  window.scrollTo(0, 0);
}

/* ---------- landing map ---------- */
const HEAT = [[243, 220, 198], [233, 164, 111], [212, 98, 47], [143, 52, 18]];
function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const s = t * (HEAT.length - 1), i = Math.min(HEAT.length - 2, Math.floor(s)), f = s - i;
  const c = HEAT[i].map((v, k) => Math.round(v + (HEAT[i + 1][k] - v) * f));
  return `rgb(${c.join(',')})`;
}

function buildMap() {
  const svg = $('#ocMap');
  if (!svg || !D.map) return;
  const [x0, y0, w, h] = D.map.viewBox;
  svg.setAttribute('viewBox', `${x0 - 10} ${y0 - 10} ${w + 20} ${h + 20}`);
  svg.classList.remove('ready', 'hovering');
  const known = D.timelines.cities.map((c) => c.approval_to_permit.median).filter((v) => v != null);
  const max = Math.max(...known, 1);
  const cx = w / 2, cy = h / 2;
  const paths = D.map.cities.map((c) => {
    const row = cityRow(c.juris);
    const m = row?.approval_to_permit.median;
    const dist = Math.hypot(c.cx - cx, c.cy - cy) / Math.hypot(cx, cy);
    const fill = m != null ? heat(m / max) : '';
    return `<path class="city ${m == null ? 'nodata' : ''}" data-j="${c.juris}" d="${c.d}" style="--d:${(0.4 + dist * 0.9).toFixed(2)}s;${fill ? `fill:${fill}` : ''}"></path>`;
  }).join('');
  svg.innerHTML = `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e9dccd"/><line x1="0" y1="0" x2="0" y2="8" stroke="#cbb8a6" stroke-width="3"/></pattern></defs>
    ${paths}<g class="pin" id="mapPin"><circle class="ring" r="12" cx="0" cy="0"/><circle r="7" fill="#fff"/><circle r="4" fill="#d4622f"/></g>`;
  clearTimeout(svg._t);
  svg._t = setTimeout(() => svg.classList.add('ready'), 3200);
  if (!svg._bound) {
    svg._bound = true;
    svg.addEventListener('mousemove', (e) => {
      const p = e.target.closest('.city');
      if (!p) { hideTip(); return; }
      showTip(p, e);
    });
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('click', (e) => { const p = e.target.closest('.city'); if (p) { pulseCity(p); setTimeout(() => openStudio(null, p.dataset.j), 260); } });
  }
}

function showTip(p, e) {
  const svg = $('#ocMap'), tip = $('#mapTip'), wrap = $('#mapWrap');
  const j = p.dataset.j;
  if (svg._hot !== p) {
    $$('.city.hot', svg).forEach((n) => n.classList.remove('hot'));
    p.classList.add('hot');
    p.parentNode.insertBefore(p, $('#mapPin'));
    svg._hot = p;
    const row = cityRow(j), m = row?.approval_to_permit;
    const c = D.map.cities.find((x) => x.juris === j);
    const pin = $('#mapPin');
    pin.setAttribute('transform', `translate(${c.cx},${c.cy})`);
    pin.classList.add('on');
    const carry = R ? R.carry.total : 0;
    tip.innerHTML = `<b>${cityName(j)}</b>${m && m.median != null
      ? `<div class="mt-row"><span>Wait to permit</span><strong>${m.median} mo</strong></div><div class="mt-row"><span>Cost per home</span><strong>${fmtK(m.median * carry)}</strong></div>`
      : '<div class="mt-row"><span>Not enough data</span></div>'}<div class="mt-go">Click to start →</div>`;
  }
  svg.classList.add('hovering');
  const r = wrap.getBoundingClientRect();
  tip.style.left = `${e.clientX - r.left}px`;
  tip.style.top = `${e.clientY - r.top}px`;
  tip.classList.add('show');
}

function hideTip() {
  const svg = $('#ocMap');
  if (!svg) return;
  svg.classList.remove('hovering');
  $$('.city.hot', svg).forEach((n) => n.classList.remove('hot'));
  svg._hot = null;
  $('#mapPin')?.classList.remove('on');
  $('#mapTip')?.classList.remove('show');
}

function pulseCity(p) { p.animate([{ transform: 'scale(1.06) translateY(-3px)' }, { transform: 'scale(1.18) translateY(-6px)' }, { transform: 'scale(1.06) translateY(-3px)' }], { duration: 260, easing: 'ease-out' }); }

function switchTab(name, silent = false) {
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  moveInk(); setTimeout(moveInk, 80); setTimeout(moveInk, 700);
  if (name === 'time') { $$('.bfill').forEach((f) => (f.style.width = '0')); requestAnimationFrame(() => renderBoard()); }
  if (name === 'rate') drawSpark();
  if (name === 'bill' && !silent) { const wf = $('#waterfall'); wf._init = false; wf.innerHTML = ''; renderWaterfall(); }
  if (!silent) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function moveInk() {
  const b = $('#tabbar button.active'), ink = $('#tabInk');
  if (!b || !ink) return;
  ink.style.left = b.offsetLeft + 'px';
  ink.style.width = b.offsetWidth + 'px';
}

function notifyChanges(prev) {
  const items = [
    ['fundraising', '#dLeft', null, false],
    ['gap', '#dGap', '#heroGap', false],
    ['timeCost', '#dTime', '#heroTime', false],
    ['subsidies', '#dSubs', '#heroSubs', true],
  ];
  let changed = false;
  for (const [k, slot, tile, goodWhenUp] of items) {
    const d = R.per[k] - prev[k];
    if (Math.abs(d) < 1) continue;
    changed = true;
    const chip = el('span', { class: `dchip ${(d > 0) !== goodWhenUp ? 'up' : 'down'}` }, `${d > 0 ? '+' : '-'}${fmtK(Math.abs(d))}`);
    const s = $(slot); s.innerHTML = ''; s.appendChild(chip);
    if (tile) { const t = $(tile).closest('.stile'); t.classList.remove('pulse'); void t.offsetWidth; t.classList.add('pulse'); }
  }
  if (changed) { const r = $('#flashRing'); r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }
  if (prev.juris !== R.juris) toast(`Now showing ${cityName(R.juris)}`);
  if (prev.fundraising >= 1 && R.per.fundraising < 1) celebrate();
}

function celebrate() {
  const box = $('#confetti');
  const colors = ['#d4622f', '#f08a4b', '#2f8f6b', '#3d6f91', '#c6a48c', '#ffb081', '#8fe0bd'];
  box.innerHTML = '';
  for (let i = 0; i < 110; i++) {
    const p = el('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
    p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
    p.style.setProperty('--dur', (1.6 + Math.random() * 1.6) + 's');
    p.style.animationDelay = Math.random() * 0.4 + 's';
    box.appendChild(p);
  }
  const b = el('div', { class: 'zero-banner' }, 'Hit $0.');
  document.body.appendChild(b);
  setTimeout(() => { box.innerHTML = ''; b.remove(); }, 3400);
}

function buildSkyline() {
  const sky = $('#skyline');
  if (!sky) return;
  const n = Math.min(30, Math.max(14, Math.floor(window.innerWidth / 52)));
  const pal = [['#6b4434', '#4b2b1f'], ['#9a6a52', '#6b4434'], ['#c6a48c', '#9a6a52'], ['#3d6f91', '#2c536e'], ['#2f8f6b', '#226b50']];
  let html = '';
  for (let i = 0; i < n; i++) {
    const mid = Math.abs(i - (n - 1) / 2) / (n / 2);
    const h = 28 + Math.random() * 55 + (1 - mid) * 15;
    const [c1, c2] = pal[Math.floor(Math.random() * pal.length)];
    const gap = Math.random() < 0.14;
    const lit = !gap && Math.random() < 0.45;
    html += `<div class="house ${gap ? 'gap' : ''} ${lit ? 'lit' : ''}" style="--h:${h}%;--c1:${c1};--c2:${c2};--d:${(0.9 + mid * 0.7 + Math.random() * 0.2).toFixed(2)}s;--t:${(2 + Math.random() * 3).toFixed(1)}s"></div>`;
  }
  sky.innerHTML = html;
}

boot();
