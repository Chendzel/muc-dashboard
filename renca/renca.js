// ============================================================
// MUC — Estación Renca · dashboard de una pantalla (v2)
// En vivo (ThingSpeak cada 5 min) + histórico (../data/*.json del
// GitHub Action) + día en vivo para fechas recientes.
// Pestañas Hoy / Un día / Mes sobre un mismo panel de curvas,
// calendario anual clickeable y mini-mapa Leaflet.
// ============================================================

'use strict';

const ST = {
  renca: {
    file: '../data/renca.json', channelId: 3027229, readKey: 'T40LCTX172ZB9E9F',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' },
    color: '#E78D70', label: 'Renca', lat: -33.392900, lon: -70.697700
  },
  isla: {
    file: '../data/isla-maipo.json', channelId: 2911247, readKey: 'JG5XFI4NB556UKO2',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' },
    color: '#7B8A99', label: 'Isla de Maipo', lat: -33.734310, lon: -70.910410
  }
};

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_CAP = MESES.map(m => m[0].toUpperCase() + m.slice(1));
const MESES_CORTO = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const DIAS_SEM = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

// ---------- Estado ----------
const BYDAY = { renca: {}, isla: {} };
let DATA_MIN = null, DATA_MAX = null;
const LIVE_CACHE = {};
const state = { tab: 'hoy', day: null, month: null, year: null };

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shiftYmd(ymd, days) {
  const d = new Date(ymd + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDateEs(ymd, withYear = true) {
  const [y, m, d] = ymd.split('-').map(Number);
  return d + ' de ' + MESES[m - 1] + (withYear ? ' de ' + y : '');
}
function fmtDateShort(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return d + ' ' + MESES[m - 1].slice(0, 3) + ' ' + String(y).slice(2);
}
const mean = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };
const maxOf = arr => { const v = arr.filter(x => x != null); return v.length ? Math.max(...v) : null; };
const minOf = arr => { const v = arr.filter(x => x != null); return v.length ? Math.min(...v) : null; };
function fmt(v, dec, unit) { return (v == null || isNaN(v)) ? '—' : v.toFixed(dec) + (unit || ''); }
function fmtSigned(v, dec) { return (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(dec) + '°'; }
function degToCompassEs(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  return dirs[Math.round(deg / 22.5) % 16];
}
function deltaColor(delta) {
  if (delta < -3) return '#3E647A';
  if (delta < -1.5) return '#7DA6BB';
  if (delta < -0.5) return '#B4D4E0';
  if (delta < 0.5) return '#F4F4F4';
  if (delta < 2) return '#F8E0CE';
  if (delta < 3.5) return '#F8BC7E';
  if (delta < 4.5) return '#E78D70';
  return '#D26852';
}
function emptyDay() {
  const nulls = () => new Array(24).fill(null);
  return { h: { t: nulls(), h: nulls(), w: nulls(), d: nulls(), r: nulls() } };
}

// ---------- Datos ----------
async function loadHistory() {
  await Promise.all(Object.entries(ST).map(async ([key, st]) => {
    try {
      const res = await fetch(st.file, { cache: 'no-cache' });
      if (!res.ok) return;
      const json = await res.json();
      BYDAY[key] = json.byDay || {};
      for (const ymd of Object.keys(BYDAY[key])) {
        if (!DATA_MIN || ymd < DATA_MIN) DATA_MIN = ymd;
        if (!DATA_MAX || ymd > DATA_MAX) DATA_MAX = ymd;
      }
    } catch (e) { console.warn('[renca] no se pudo cargar', st.file, e.message); }
  }));
}

async function fetchLiveDay(ymd, force = false) {
  if (LIVE_CACHE[ymd] && !force) return LIVE_CACHE[ymd];
  const out = {};
  await Promise.all(Object.entries(ST).map(async ([key, st]) => {
    const url = 'https://api.thingspeak.com/channels/' + st.channelId + '/feeds.json' +
      '?api_key=' + st.readKey + '&start=' + ymd + '%2000:00:00&end=' + ymd + '%2023:59:59' +
      '&average=60&results=8000&timezone=America%2FSantiago';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return;
      const json = await res.json();
      const day = emptyDay();
      let got = false;
      for (const f of (json.feeds || [])) {
        if (!f || !f.created_at) continue;
        const hr = new Date(f.created_at).getHours();
        if (isNaN(hr)) continue;
        for (const [v, col] of Object.entries(st.fields)) {
          const val = parseFloat(f[col]);
          if (!isNaN(val) && day.h[v][hr] == null) { day.h[v][hr] = val; got = true; }
        }
      }
      if (got) {
        day.all_avg = mean(day.h.t);
        day.all_max = maxOf(day.h.t);
        day.all_min = minOf(day.h.t);
        out[key] = day;
      }
    } catch (e) { /* sin red: seguimos con el JSON */ }
  }));
  LIVE_CACHE[ymd] = out;
  return out;
}

function getDay(key, ymd) {
  const live = LIVE_CACHE[ymd];
  if (live && live[key]) return live[key];
  return BYDAY[key][ymd] || null;
}

function pairedDelta(ymd) {
  const R = getDay('renca', ymd), I = getDay('isla', ymd);
  if (!R || !I || !R.h || !I.h) return null;
  const ds = [];
  for (let i = 0; i < 24; i++) {
    if (R.h.t[i] != null && I.h.t[i] != null) ds.push(R.h.t[i] - I.h.t[i]);
  }
  return ds.length >= 6 ? mean(ds) : null;
}

// ============================================================
// Charts — línea con área degradé + pastillas máx/mín (hero)
// ============================================================
let gradSeq = 0;
function pillSvg(x, y, text, above) {
  const w = Math.max(46, text.length * 8.5 + 18), h = 24;
  const py = above ? y - 14 - h : y + 14;
  return `<g><rect x="${(x - w / 2).toFixed(1)}" y="${py.toFixed(1)}" width="${w.toFixed(0)}" height="${h}" rx="${h / 2}"
      fill="#fff" stroke="rgba(44,75,102,0.12)" style="filter:drop-shadow(0 2px 4px rgba(44,75,102,0.18))"/>
    <text x="${x.toFixed(1)}" y="${(py + h / 2 + 4).toFixed(1)}" text-anchor="middle"
      font-size="12.5" font-weight="700" fill="#2C4B66" font-family="Helvetica Neue, sans-serif">${text}</text></g>`;
}

function renderSeriesChart(host, opts) {
  // opts: { xs: labels[], series: [{label,color,dash,values[],hero}], dec, unit, xTickIdx: [i...], xTickFmt(i), tipTitle(i) }
  const { series, dec, unit } = opts;
  const W = 900, H = 330;
  const padL = 46, padR = 18, padT = 34, padB = 30;
  const N = opts.n;
  host.innerHTML = '';
  const allVals = series.flatMap(s => s.values.filter(v => v != null));
  if (!allVals.length) {
    host.innerHTML = '<div style="padding:60px;text-align:center;color:#B0B9C2;font-size:14px;">Sin datos para esta selección</div>';
    return;
  }
  let yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
  const span = yMax - yMin; yMin -= span * 0.14; yMax += span * 0.14;
  const xs = i => N === 1 ? (padL + (W - padL - padR) / 2) : padL + (i / (N - 1)) * (W - padL - padR);
  const ys = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const rawStep = (yMax - yMin) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) || rawStep;
  let g = '';
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    const y = ys(v);
    g += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(44,75,102,0.07)" stroke-width="1"/>`;
    g += `<text x="${padL - 9}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11" fill="#7B8A99" font-weight="600">${Number(v.toFixed(Math.max(0, dec)))}</text>`;
  }
  for (const i of opts.xTickIdx) {
    g += `<text x="${xs(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="#B0B9C2" font-weight="600">${opts.xTickFmt(i)}</text>`;
  }

  let defs = '', paths = '', pills = '';
  for (const s of series) {
    let dPath = '', open = false, first = -1, last = -1;
    s.values.forEach((v, i) => {
      if (v == null) { open = false; return; }
      dPath += (open ? ' L' : (dPath ? ' M' : 'M')) + xs(i).toFixed(1) + ',' + ys(v).toFixed(1);
      open = true;
      if (first < 0) first = i;
      last = i;
    });
    if (!dPath) continue;
    if (s.hero) {
      const gid = 'rg' + (++gradSeq);
      defs += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${s.color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/></linearGradient>`;
      const area = dPath + ` L${xs(last).toFixed(1)},${H - padB} L${xs(first).toFixed(1)},${H - padB} Z`;
      paths += `<path d="${area}" fill="url(#${gid})"/>`;
    }
    paths += `<path d="${dPath}" fill="none" stroke="${s.color}" stroke-width="${s.hero ? 2.6 : 2}" ` +
      (s.dash ? `stroke-dasharray="${s.dash}" ` : '') + `stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.hero) {
      // pastillas en máx y mín (estilo referencia "sales report")
      let iMax = -1, iMin = -1;
      s.values.forEach((v, i) => {
        if (v == null) return;
        if (iMax < 0 || v > s.values[iMax]) iMax = i;
        if (iMin < 0 || v < s.values[iMin]) iMin = i;
      });
      if (iMax >= 0) pills += pillSvg(Math.min(Math.max(xs(iMax), padL + 30), W - padR - 30), ys(s.values[iMax]), fmt(s.values[iMax], dec, '°'), true);
      if (iMin >= 0 && iMin !== iMax) pills += pillSvg(Math.min(Math.max(xs(iMin), padL + 30), W - padR - 30), ys(s.values[iMin]), fmt(s.values[iMin], dec, '°'), false);
    }
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `<defs>${defs}</defs>` + g + paths + pills +
    `<line class="hover-line" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="rgba(44,75,102,0.4)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`;
  host.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'chart-tip'; tip.style.display = 'none';
  host.appendChild(tip);
  const hoverLine = svg.querySelector('.hover-line');
  svg.addEventListener('pointermove', ev => {
    const rect = svg.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width * W;
    let i = Math.round((fx - padL) / (W - padL - padR) * (N - 1));
    i = Math.max(0, Math.min(N - 1, i));
    const rows = series.map(s => ({ s, v: s.values[i] })).filter(r => r.v != null);
    if (!rows.length) { tip.style.display = 'none'; hoverLine.setAttribute('visibility', 'hidden'); return; }
    hoverLine.setAttribute('x1', xs(i)); hoverLine.setAttribute('x2', xs(i));
    hoverLine.setAttribute('visibility', 'visible');
    tip.innerHTML = `<span class="tt-hour">${opts.tipTitle(i)}</span>` +
      rows.map(r => `<div class="tt-row"><span class="tt-dot" style="background:${r.s.color}"></span>${r.s.label}` +
        `<span class="tt-val">${fmt(r.v, dec, ' ' + unit)}</span></div>`).join('');
    tip.style.display = 'block';
    tip.style.left = Math.max(80, Math.min(rect.width - 80, xs(i) / W * rect.width)) + 'px';
    tip.style.top = (ev.clientY - rect.top) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; hoverLine.setAttribute('visibility', 'hidden'); });
}

function renderHourly(host, R, I) {
  renderSeriesChart(host, {
    n: 24,
    series: [
      R && R.h ? { label: 'Renca', color: ST.renca.color, values: R.h.t, hero: true } : null,
      I && I.h ? { label: 'Isla de Maipo', color: ST.isla.color, dash: '5 4', values: I.h.t } : null
    ].filter(Boolean),
    dec: 1, unit: '°C',
    xTickIdx: [0, 6, 12, 18, 23],
    xTickFmt: i => String(i).padStart(2, '0') + 'h',
    tipTitle: i => String(i).padStart(2, '0') + ':00'
  });
}

// ============================================================
// Panel central — pestañas Hoy / Un día / Mes
// ============================================================
function statHtml(v, l, signed) {
  const cls = signed && v != null ? (v >= 0 ? 'pos' : 'neg') : '';
  const txt = signed ? fmtSigned(v, 1) : (v == null ? '—' : v);
  return `<div class="cs"><span class="cs-v ${cls}">${txt}</span><span class="cs-l">${l}</span></div>`;
}

function dayStats(ymd) {
  const R = getDay('renca', ymd), I = getDay('isla', ymd);
  const deltas = [];
  if (R && I && R.h && I.h) {
    for (let i = 0; i < 24; i++) {
      if (R.h.t[i] != null && I.h.t[i] != null) deltas.push({ hr: i, v: R.h.t[i] - I.h.t[i] });
    }
  }
  const peak = deltas.length ? deltas.reduce((a, b) => b.v > a.v ? b : a) : null;
  return {
    R, I,
    dAvg: deltas.length ? mean(deltas.map(d => d.v)) : null,
    peak,
    tMax: R ? (R.all_max != null ? R.all_max : maxOf(R.h.t)) : null,
    tMin: R ? (R.all_min != null ? R.all_min : minOf(R.h.t)) : null
  };
}

async function renderTab() {
  const today = todayYmd();
  $('ctlDia').hidden = state.tab !== 'dia';
  $('ctlMes').hidden = state.tab !== 'mes';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const host = $('mainChart');
  const stats = $('chartStats');

  if (state.tab === 'hoy') {
    await fetchLiveDay(today);
    const s = dayStats(today);
    $('chartTitle').textContent = 'Hoy, hora a hora · ' + fmtDateEs(today, false);
    renderHourly(host, s.R, s.I);
    stats.innerHTML =
      statHtml(s.dAvg, 'Δ promedio hoy', true) +
      statHtml(s.peak ? s.peak.v : null, s.peak ? 'Mayor Δ · ' + String(s.peak.hr).padStart(2, '0') + ':00' : 'Mayor Δ', true) +
      statHtml(s.tMax != null ? fmt(s.tMax, 1, '°') : null, 'Máx Renca') +
      statHtml(s.tMin != null ? fmt(s.tMin, 1, '°') : null, 'Mín Renca');
    return;
  }

  if (state.tab === 'dia') {
    const ymd = state.day;
    $('diaInput').value = ymd;
    if (ymd >= (DATA_MAX || '') || ymd === today) await fetchLiveDay(ymd);
    const s = dayStats(ymd);
    const dow = DIAS_SEM[new Date(ymd + 'T12:00:00').getDay()];
    $('chartTitle').textContent = dow.charAt(0) + dow.slice(1).toLowerCase() + ' ' + fmtDateEs(ymd);
    renderHourly(host, s.R, s.I);
    stats.innerHTML =
      statHtml(s.dAvg, 'Δ promedio', true) +
      statHtml(s.peak ? s.peak.v : null, s.peak ? 'Mayor Δ · ' + String(s.peak.hr).padStart(2, '0') + ':00' : 'Mayor Δ', true) +
      statHtml(s.tMax != null ? fmt(s.tMax, 1, '°') : null, 'Máx Renca') +
      statHtml(s.tMin != null ? fmt(s.tMin, 1, '°') : null, 'Mín Renca');
    return;
  }

  // mes
  const ym = state.month;
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (ymd <= today) days.push(ymd);
  }
  const avgR = days.map(d => { const x = getDay('renca', d); return x ? (x.all_avg != null ? x.all_avg : mean(x.h.t)) : null; });
  const avgI = days.map(d => { const x = getDay('isla', d); return x ? (x.all_avg != null ? x.all_avg : mean(x.h.t)) : null; });
  const maxR = days.map(d => { const x = getDay('renca', d); return x ? (x.all_max != null ? x.all_max : maxOf(x.h.t)) : null; });
  const deltas = days.map(d => pairedDelta(d)).filter(v => v != null);

  $('chartTitle').textContent = 'Temperatura media diaria · ' + MESES_CAP[m - 1] + ' ' + y;
  renderSeriesChart(host, {
    n: days.length,
    series: [
      { label: 'Renca', color: ST.renca.color, values: avgR, hero: true },
      { label: 'Isla de Maipo', color: ST.isla.color, dash: '5 4', values: avgI }
    ],
    dec: 1, unit: '°C',
    xTickIdx: [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i),
    xTickFmt: i => fmtDateShort(days[i]),
    tipTitle: i => fmtDateEs(days[i])
  });
  const over30 = maxR.filter(v => v != null && v > 30).length;
  stats.innerHTML =
    statHtml(mean(avgR) != null ? fmt(mean(avgR), 1, '°') : null, 'Prom Renca') +
    statHtml(mean(avgI) != null ? fmt(mean(avgI), 1, '°') : null, 'Prom Isla') +
    statHtml(deltas.length ? mean(deltas) : null, 'Δ promedio', true) +
    statHtml(over30 + (over30 === 1 ? ' día' : ' días'), 'Sobre 30°');
}

function setTab(t) { state.tab = t; renderTab(); }

// ============================================================
// Ahora (cards + badge del mapa) — cada 5 min
// ============================================================
function tsUrl(st, results) {
  return 'https://api.thingspeak.com/channels/' + st.channelId + '/feeds.json?api_key=' + st.readKey + '&results=' + results;
}
async function fetchNowFor(st) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(tsUrl(st, 2), { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const feeds = ((await res.json()).feeds || []).filter(f => f && f.created_at);
    if (!feeds.length) return null;
    const latest = feeds[feeds.length - 1];
    const prev = feeds.length > 1 ? feeds[feeds.length - 2] : null;
    const out = { timestamp: new Date(latest.created_at) };
    for (const [k, col] of Object.entries(st.fields)) {
      const v = parseFloat(latest[col]);
      out[k] = isNaN(v) ? null : v;
      if (prev) {
        const pv = parseFloat(prev[col]);
        if (!isNaN(pv) && !isNaN(v)) out[k + 'Trend'] = v - pv;
      }
    }
    return out;
  } catch (e) { return null; }
}
function setStatus(el, data) {
  if (!data || !data.timestamp) { el.textContent = 'SIN DATOS'; el.classList.add('stale'); return true; }
  const mins = Math.round((Date.now() - data.timestamp) / 60000);
  el.textContent = mins > 120 ? '● hace ' + Math.round(mins / 60) + ' h' : '● hace ' + mins + ' min';
  const stale = mins > 30;
  el.classList.toggle('stale', stale);
  return stale;
}

let mapMarkers = null;
async function updateNow() {
  const [rnc, isl] = await Promise.all([fetchNowFor(ST.renca), fetchNowFor(ST.isla)]);
  const rncStale = setStatus($('rncStatus'), rnc);
  setStatus($('islStatus'), isl);
  $('livePill').dataset.status = rncStale ? 'warn' : 'ok';
  $('livePillText').textContent = rncStale ? 'SIN SEÑAL RECIENTE' : 'EN VIVO';

  if (rnc) {
    if (rnc.t != null) $('rncTemp').textContent = Math.round(rnc.t) + '°';
    const tr = $('rncTrend');
    if (rnc.tTrend != null) {
      tr.textContent = (rnc.tTrend >= 0 ? '↑' : '↓') + Math.abs(rnc.tTrend).toFixed(1) + '°';
      tr.classList.toggle('up', rnc.tTrend >= 0);
      tr.classList.toggle('down', rnc.tTrend < 0);
    }
    $('rncHum').textContent = rnc.h != null ? Math.round(rnc.h) : '—';
    $('rncRad').textContent = rnc.r != null ? Math.round(rnc.r) : '—';
    $('rncWind').textContent = rnc.w != null ? rnc.w.toFixed(1) : '—';
    $('rncDir').textContent = rnc.d != null ? degToCompassEs(rnc.d) + ' · ' + Math.round(rnc.d) + '°' : '—';
  }
  if (isl) {
    if (isl.t != null) $('islTemp').textContent = Math.round(isl.t) + '°';
    $('islHum').textContent = isl.h != null ? Math.round(isl.h) : '—';
    $('islRad').textContent = isl.r != null ? Math.round(isl.r) : '—';
    $('islWind').textContent = isl.w != null ? isl.w.toFixed(1) : '—';
  }
  let dNow = null;
  if (rnc && isl && rnc.t != null && isl.t != null) {
    dNow = rnc.t - isl.t;
    const el = $('deltaNow');
    el.textContent = fmtSigned(dNow, 1) + 'C';
    el.classList.toggle('neg', dNow < 0);
  }
  $('mapBadgeVal').textContent = dNow != null ? fmtSigned(dNow, 1) : '—';

  // rango de hoy + Δ prom/máx (en vivo)
  const today = todayYmd();
  const live = await fetchLiveDay(today, true);
  const R = live.renca, I = live.isla;
  if (R) {
    $('rncMin').textContent = fmt(R.all_min, 0, '°');
    $('rncMax').textContent = fmt(R.all_max, 0, '°');
    if (R.all_min != null && R.all_max != null) {
      const pct = v => Math.max(0, Math.min(100, v / 35 * 100));
      const fill = $('rncRangeFill');
      fill.style.left = pct(R.all_min) + '%';
      fill.style.width = Math.max(1, pct(R.all_max) - pct(R.all_min)) + '%';
      if (rnc && rnc.t != null) $('rncRangePin').style.left = pct(rnc.t) + '%';
    }
  }
  if (R && I) {
    const deltas = [];
    for (let i = 0; i < 24; i++) {
      if (R.h.t[i] != null && I.h.t[i] != null) deltas.push({ hr: i, v: R.h.t[i] - I.h.t[i] });
    }
    if (deltas.length) {
      $('deltaAvgHoy').textContent = fmtSigned(mean(deltas.map(d => d.v)), 1);
      const peak = deltas.reduce((a, b) => b.v > a.v ? b : a);
      $('deltaMaxHoy').textContent = fmtSigned(peak.v, 1);
      $('deltaMaxHoyLbl').textContent = 'Máx · ' + String(peak.hr).padStart(2, '0') + ':00';
    }
  }
  // actualizar pins del mapa
  if (mapMarkers) {
    if (rnc && rnc.t != null) mapMarkers.renca.querySelector('.pin').textContent = Math.round(rnc.t) + '°';
    if (isl && isl.t != null) mapMarkers.isla.querySelector('.pin').textContent = Math.round(isl.t) + '°';
  }
  if (state.tab === 'hoy') renderTab();
}

// ============================================================
// Calendario anual + récords
// ============================================================
let calTip = null;
function renderYear() {
  const year = state.year;
  const grid = $('calGrid');
  grid.innerHTML = '';
  $('calMonths').innerHTML = MESES_CORTO.map(m => '<span>' + m + '</span>').join('');

  const jan1 = new Date(year, 0, 1);
  const start = new Date(jan1);
  const dow = jan1.getDay();
  start.setDate(jan1.getDate() - (dow === 0 ? 6 : dow - 1));
  const today = todayYmd();

  if (!calTip) {
    calTip = document.createElement('div');
    calTip.className = 'cal-tip';
    calTip.style.display = 'none';
    document.body.appendChild(calTip);
  }

  const stats = { deltas: [], maxT: null, maxTDay: null, peakD: null, peakDay: null };
  for (let w = 0; w < 53; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const ymd = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (date.getFullYear() === year && ymd <= today) {
        const R = getDay('renca', ymd);
        const tR = R ? (R.all_avg != null ? R.all_avg : mean(R.h.t)) : null;
        if (tR != null) {
          const mx = R.all_max != null ? R.all_max : maxOf(R.h.t);
          if (mx != null && (stats.maxT == null || mx > stats.maxT)) { stats.maxT = mx; stats.maxTDay = ymd; }
        }
        const delta = pairedDelta(ymd);
        if (delta != null) {
          stats.deltas.push(delta);
          if (stats.peakD == null || delta > stats.peakD) { stats.peakD = delta; stats.peakDay = ymd; }
          cell.style.background = deltaColor(delta);
          cell.classList.add('hasdata');
          const I = getDay('isla', ymd);
          const tI = I ? (I.all_avg != null ? I.all_avg : mean(I.h.t)) : null;
          cell.dataset.tip = `<strong>${fmtDateEs(ymd)}</strong><br>Δ ${fmtSigned(delta, 1)} · Renca ${fmt(tR, 1, '°')} · Isla ${fmt(tI, 1, '°')}`;
          cell.dataset.ymd = ymd;
        } else if (tR != null) {
          cell.style.background = 'rgba(123,138,153,0.25)';
        }
      }
      grid.appendChild(cell);
    }
  }

  grid.onpointermove = ev => {
    const c = ev.target.closest('.cal-cell');
    if (!c || !c.dataset.tip) { calTip.style.display = 'none'; return; }
    calTip.innerHTML = c.dataset.tip;
    calTip.style.display = 'block';
    calTip.style.left = ev.clientX + 'px';
    calTip.style.top = ev.clientY + 'px';
  };
  grid.onpointerleave = () => { calTip.style.display = 'none'; };
  grid.onclick = ev => {
    const c = ev.target.closest('.cal-cell');
    if (!c || !c.dataset.ymd) return;
    state.day = c.dataset.ymd;
    setTab('dia');
  };

  $('recDelta').textContent = stats.peakD != null ? fmtSigned(stats.peakD, 1) : '—';
  $('recDeltaDate').textContent = stats.peakDay ? fmtDateEs(stats.peakDay, false) + ' · promedio del día' : '—';
  $('recHot').textContent = stats.maxT != null ? fmt(stats.maxT, 1, '°') : '—';
  $('recHotDate').textContent = stats.maxTDay ? fmtDateEs(stats.maxTDay, false) + ' · máxima en Renca' : '—';
}

// ============================================================
// Mini mapa
// ============================================================
function initMap() {
  const el = $('miniMap');
  if (!el || typeof L === 'undefined') return;
  const map = L.map(el, {
    zoomControl: true, attributionControl: true,
    scrollWheelZoom: false, doubleClickZoom: 'center', touchZoom: 'center',
    zoomSnap: 0.25, zoomAnimation: false, markerZoomAnimation: false,
    minZoom: 8, maxZoom: 15
  });
  map.attributionControl.setPrefix(false);
  L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri · © OpenStreetMap', maxNativeZoom: 16
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16 })
  ]).addTo(map);

  fetch('../mapa/comunas-rm.json')
    .then(r => r.ok ? r.json() : null)
    .then(gj => {
      if (!gj) return;
      L.geoJSON(gj, {
        style: f => ['Renca', 'Isla de Maipo'].includes(f.properties.name)
          ? { color: '#2C4B66', weight: 1.8, opacity: 0.6, fillColor: '#E78D70', fillOpacity: 0.08 }
          : { color: '#2C4B66', weight: 0.7, opacity: 0.22, fillOpacity: 0 }
      }).addTo(map);
    }).catch(() => {});

  mapMarkers = {};
  for (const [key, st] of Object.entries(ST)) {
    const icon = L.divIcon({
      className: 'lf-station' + (key === 'isla' ? ' rural label-above' : ''),
      iconSize: [30, 30], iconAnchor: [15, 15],
      html: '<div class="pin" style="background:' + (key === 'isla' ? '#89B8BC' : '#E78D70') + ';">–</div>' +
            '<div class="label">' + st.label.toUpperCase() + '</div>'
    });
    const m = L.marker([st.lat, st.lon], { icon, keyboard: false }).addTo(map);
    // guardamos el elemento una vez montado
    setTimeout(() => { mapMarkers[key] = m.getElement(); }, 0);
  }
  map.fitBounds(L.latLngBounds([[ST.renca.lat, ST.renca.lon], [ST.isla.lat, ST.isla.lon]]).pad(0.25));
  window.addEventListener('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 300);
}

// ============================================================
// Reloj + escala TV
// ============================================================
function tickClock() {
  const now = new Date();
  $('clockTime').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  $('clockDate').textContent = DIAS_SEM[now.getDay()] + ' · ' + now.getDate() + ' ' + MESES_CORTO[now.getMonth()] + ' ' + now.getFullYear();
}
function scale() {
  const b = $('board');
  const w = window.innerWidth, h = window.innerHeight;
  if (w < 1200) { b.style.transform = ''; return; }
  b.style.transform = 'scale(' + Math.min(w / 1920, h / 1080) + ')';
}

// ============================================================
// Init
// ============================================================
async function init() {
  scale();
  window.addEventListener('resize', scale);
  tickClock();
  setInterval(tickClock, 30 * 1000);

  await loadHistory();
  const today = todayYmd();

  // estado inicial
  state.day = DATA_MAX && DATA_MAX < today ? DATA_MAX : shiftYmd(today, -1);
  state.year = Number(today.slice(0, 4));
  state.month = today.slice(0, 7);

  // controles día
  const dia = $('diaInput');
  dia.min = DATA_MIN || ''; dia.max = today;
  dia.addEventListener('change', () => { if (dia.value) { state.day = dia.value; renderTab(); } });
  $('diaPrev').addEventListener('click', () => { state.day = shiftYmd(state.day, -1); renderTab(); });
  $('diaNext').addEventListener('click', () => {
    const next = shiftYmd(state.day, 1);
    if (next <= today) { state.day = next; renderTab(); }
  });

  // controles mes
  const mesSel = $('ctlMes');
  if (DATA_MIN && DATA_MAX) {
    let [y, m] = DATA_MAX.split('-').map(Number);
    const [y0, m0] = DATA_MIN.split('-').map(Number);
    while (y > y0 || (y === y0 && m >= m0)) {
      const o = document.createElement('option');
      o.value = y + '-' + String(m).padStart(2, '0');
      o.textContent = MESES_CAP[m - 1] + ' ' + y;
      mesSel.appendChild(o);
      m--; if (m === 0) { m = 12; y--; }
    }
  }
  mesSel.addEventListener('change', () => { state.month = mesSel.value; renderTab(); });

  // año
  const anioSel = $('anioSelect');
  if (DATA_MIN && DATA_MAX) {
    for (let y = Number(DATA_MAX.slice(0, 4)); y >= Number(DATA_MIN.slice(0, 4)); y--) {
      const o = document.createElement('option');
      o.value = String(y); o.textContent = String(y);
      anioSel.appendChild(o);
    }
  }
  anioSel.addEventListener('change', () => { state.year = Number(anioSel.value); renderYear(); });

  // tabs
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  initMap();
  renderYear();
  await renderTab();
  updateNow();
  setInterval(updateNow, 5 * 60 * 1000);
}

init();
