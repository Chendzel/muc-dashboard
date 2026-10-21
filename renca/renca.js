// ============================================================
// MUC — Estación Renca · dashboard de una pantalla (v2.2)
// En vivo (ThingSpeak cada 5 min) + histórico (../data/*.json del
// GitHub Action) + día en vivo para fechas recientes.
// v2.2: charts nítidos (dimensionados al host, sin estirar SVG),
// selector de variable (T/HR/Rad/Viento), sparklines en "Ahora",
// curva del diferencial en la tarjeta oscura, sello "Actualizado".
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

const VAR_META = {
  t: { label: 'Temperatura', unit: '°C', dec: 1, pill: v => v.toFixed(1) + '°' },
  h: { label: 'Humedad relativa', unit: '%', dec: 0, pill: v => Math.round(v) + '%' },
  r: { label: 'Radiación global', unit: 'W/m²', dec: 0, pill: v => Math.round(v) },
  w: { label: 'Viento', unit: 'm/s', dec: 1, pill: v => v.toFixed(1) }
};

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_CAP = MESES.map(m => m[0].toUpperCase() + m.slice(1));
const MESES_CORTO = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const DIAS_SEM = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

// ---------- Estado ----------
const BYDAY = { renca: {}, isla: {} };
let DATA_MIN = null, DATA_MAX = null;
const LIVE_CACHE = {};
const state = { tab: 'dia', varKey: 't', cmp: '', day: null, month: null, year: null };

// Estaciones del año (hemisferio sur), para el comparador
const SEASONS = {
  verano:    { months: [11, 0, 1], label: 'verano' },
  otono:     { months: [2, 3, 4], label: 'otoño' },
  invierno:  { months: [5, 6, 7], label: 'invierno' },
  primavera: { months: [8, 9, 10], label: 'primavera' }
};
function seasonOf(monthIdx) {
  for (const s of Object.values(SEASONS)) if (s.months.includes(monthIdx)) return s;
  return null;
}

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
  if (delta < 0.5) return '#D9E6D5'; // sage suave = diferencia ≈ 0 (distinto del gris "sin datos")
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
  let day = (live && live[key]) || BYDAY[key][ymd] || null;
  // Días en formato viejo (sin detalle horario): normalizar para que ningún
  // código aguas abajo se caiga leyendo day.h.
  if (day && !day.h) day = Object.assign({}, day, { h: emptyDay().h });
  return day;
}

// Escalas FIJAS por variable (extremos anuales de ambas estaciones), para que
// todos los días/meses se grafiquen en el mismo eje Y y sean comparables.
const FIXED = { dia: {}, mes: {} };
function computeScales() {
  for (const k of ['t', 'h', 'r', 'w']) {
    const all = [], daily = [];
    for (const key of ['renca', 'isla']) {
      for (const day of Object.values(BYDAY[key])) {
        if (!day.h || !day.h[k]) continue;
        const vals = day.h[k].filter(v => v != null);
        if (!vals.length) continue;
        all.push(...vals);
        const m = mean(vals);
        if (m != null) daily.push(m);
      }
    }
    if (k === 'h') { FIXED.dia[k] = [0, 100]; FIXED.mes[k] = [0, 100]; continue; }
    if (!all.length) { FIXED.dia[k] = null; FIXED.mes[k] = null; continue; }
    all.sort((a, b) => a - b);
    daily.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    if (k === 'r' || k === 'w') {
      // percentil 99 para que picos puntuales del sensor no aplasten las curvas
      FIXED.dia[k] = [0, Math.ceil(q(all, 0.99) * 1.05)];
      FIXED.mes[k] = [0, Math.ceil(q(daily, 0.99) * 1.1)];
      continue;
    }
    FIXED.dia[k] = [Math.floor(q(all, 0.002) - 1), Math.ceil(q(all, 0.998) + 1)];
    FIXED.mes[k] = [Math.floor(daily[0] - 1), Math.ceil(daily[daily.length - 1] + 1)];
  }
}

function pairedDelta(ymd) {
  const R = getDay('renca', ymd), I = getDay('isla', ymd);
  if (!R || !I || !R.h || !I.h) return null;
  const ds = [];
  for (let i = 0; i < 24; i++) {
    if (R.h.t[i] != null && I.h.t[i] != null) ds.push(R.h.t[i] - I.h.t[i]);
  }
  if (ds.length >= 6) return mean(ds);
  // Respaldo para días sin detalle horario en ambos lados (formato antiguo):
  // diferencia de promedios diarios, solo si ambos tienen buena cobertura.
  if (R.all_avg != null && I.all_avg != null && (R.all_n || 0) >= 12 && (I.all_n || 0) >= 12) {
    return R.all_avg - I.all_avg;
  }
  return null;
}

// Valor diario de una variable (promedio de horas; temp usa el agregado legacy)
function dayVal(key, ymd, k) {
  const day = getDay(key, ymd);
  if (!day) return null;
  if (k === 't' && day.all_avg != null) return day.all_avg;
  return mean(day.h[k]);
}

// ============================================================
// Charts — dimensionados al tamaño real del host (nítidos)
// ============================================================
let gradSeq = 0;
function hostSize(host, defW, defH) {
  const W = host.clientWidth || defW, H = host.clientHeight || defH;
  return { W: Math.max(W, 200), H: Math.max(H, 120) };
}

function pillSvg(x, y, text, above, color, maxY) {
  // Pastilla anclada al punto con marcador y conector
  const w = Math.max(44, String(text).length * 8.5 + 18), h = 24;
  let py = above ? y - 12 - h : y + 12;
  if (py < 4) py = y + 12;
  if (py + h > maxY) py = y - 12 - h;
  const lineY1 = py > y ? y + 4 : y - 4;
  const lineY2 = py > y ? py : py + h;
  return `<g>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/>
    <line x1="${x.toFixed(1)}" y1="${lineY1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${lineY2.toFixed(1)}" stroke="rgba(44,75,102,0.25)" stroke-width="1"/>
    <rect x="${(x - w / 2).toFixed(1)}" y="${py.toFixed(1)}" width="${w.toFixed(0)}" height="${h}" rx="${h / 2}"
      fill="#fff" stroke="rgba(44,75,102,0.12)" style="filter:drop-shadow(0 2px 4px rgba(44,75,102,0.18))"/>
    <text x="${x.toFixed(1)}" y="${(py + h / 2 + 4).toFixed(1)}" text-anchor="middle"
      font-size="12.5" font-weight="700" fill="#2C4B66" font-family="Helvetica Neue, sans-serif">${text}</text></g>`;
}

function renderSeriesChart(host, opts) {
  const { series, dec, unit, pillFmt } = opts;
  const { W, H } = hostSize(host, 900, 330);
  const padL = 46, padR = 18, padT = 34, padB = 28;
  const N = opts.n;
  host.innerHTML = '';
  const allVals = series.flatMap(s => s.values.filter(v => v != null));
  if (!allVals.length) {
    host.innerHTML = '<div style="padding:60px;text-align:center;color:#B0B9C2;font-size:14px;">Sin datos para esta selección</div>';
    return;
  }
  let yMin, yMax;
  if (opts.yFix) {
    // Escala fija (comparable entre días/meses)
    yMin = opts.yFix[0]; yMax = opts.yFix[1];
  } else {
    yMin = Math.min(...allVals); yMax = Math.max(...allVals);
    if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
    const span = yMax - yMin; yMin -= span * 0.14; yMax += span * 0.14;
  }
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
    g += `<text x="${xs(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#B0B9C2" font-weight="600">${opts.xTickFmt(i)}</text>`;
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
      let iMax = -1, iMin = -1;
      s.values.forEach((v, i) => {
        if (v == null) return;
        if (iMax < 0 || v > s.values[iMax]) iMax = i;
        if (iMin < 0 || v < s.values[iMin]) iMin = i;
      });
      const fmtP = pillFmt || (v => fmt(v, dec, ''));
      if (iMax >= 0) pills += pillSvg(Math.min(Math.max(xs(iMax), padL + 44), W - padR - 44), ys(s.values[iMax]), 'MÁX · ' + fmtP(s.values[iMax]), true, s.color, H - padB);
      if (iMin >= 0 && iMin !== iMax) pills += pillSvg(Math.min(Math.max(xs(iMin), padL + 44), W - padR - 44), ys(s.values[iMin]), 'MÍN · ' + fmtP(s.values[iMin]), false, s.color, H - padB);
    }
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
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

// Serie de las ÚLTIMAS 24 horas (ayer + hoy, terminando en la hora actual)
function last24h(key, k) {
  const curHr = new Date().getHours();
  const today = todayYmd(), yest = shiftYmd(today, -1);
  const T = getDay(key, today), Y = getDay(key, yest);
  const vals = [];
  for (let i = curHr + 1; i < 24; i++) vals.push(Y && Y.h[k][i] != null ? Y.h[k][i] : null);
  for (let i = 0; i <= curHr; i++) vals.push(T && T.h[k][i] != null ? T.h[k][i] : null);
  return vals;
}

// Sparkline (métricas de "Ahora") — 24 puntos, con área, legible
function renderSpark(host, values, color) {
  if (!host) return;
  host.innerHTML = '';
  const pts = values.filter(v => v != null);
  if (pts.length < 3) return;
  const { W, H } = hostSize(host, 170, 34);
  let yMin = Math.min(...pts), yMax = Math.max(...pts);
  if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
  const N = values.length;
  const xs = i => (i / (N - 1)) * (W - 6) + 3;
  const ys = v => 4 + (1 - (v - yMin) / (yMax - yMin)) * (H - 10);
  let dPath = '', open = false, lastI = -1, firstI = -1;
  values.forEach((v, i) => {
    if (v == null) { open = false; return; }
    dPath += (open ? ' L' : (dPath ? ' M' : 'M')) + xs(i).toFixed(1) + ',' + ys(v).toFixed(1);
    open = true; lastI = i;
    if (firstI < 0) firstI = i;
  });
  if (!dPath) return;
  const gid = 'sg' + (++gradSeq);
  const area = dPath + ` L${xs(lastI).toFixed(1)},${H - 2} L${xs(firstI).toFixed(1)},${H - 2} Z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML =
    `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#${gid})"/>` +
    `<path d="${dPath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="${xs(lastI).toFixed(1)}" cy="${ys(values[lastI]).toFixed(1)}" r="2.8" fill="${color}"/>`;
  host.appendChild(svg);
}

// Rosa de viento mini — 16 direcciones ponderadas por velocidad (24 h)
function renderWindRose(host, wVals, dVals) {
  if (!host) return;
  host.innerHTML = '';
  const bins = new Array(16).fill(0);
  let total = 0;
  for (let i = 0; i < wVals.length; i++) {
    if (wVals[i] != null && dVals[i] != null && wVals[i] > 0.1) {
      bins[Math.round(dVals[i] / 22.5) % 16] += wVals[i];
      total += wVals[i];
    }
  }
  const size = Math.min(host.clientWidth || 90, host.clientHeight || 90, 96);
  const cx = size / 2, cy = size / 2, maxR = size / 2 - 10;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  if (total === 0) {
    svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${maxR}" fill="none" stroke="rgba(44,75,102,0.1)"/>` +
      `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="8" fill="#B0B9C2" font-weight="700">CALMA</text>`;
    host.appendChild(svg);
    return;
  }
  const maxBin = Math.max(...bins);
  let maxIdx = 0;
  bins.forEach((v, i) => { if (v > bins[maxIdx]) maxIdx = i; });
  const halfA = (11.25 * Math.PI) / 180;
  let parts = [maxR * 0.5, maxR].map(r =>
    `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="rgba(44,75,102,0.09)" stroke-width="0.8"/>`).join('');
  bins.forEach((v, i) => {
    const r = (v / maxBin) * maxR;
    if (r < 1.2) return;
    const a = (i * 22.5 * Math.PI) / 180;
    const x1 = cx + r * Math.sin(a - halfA), y1 = cy - r * Math.cos(a - halfA);
    const x2 = cx + r * Math.sin(a + halfA), y2 = cy - r * Math.cos(a + halfA);
    const color = i === maxIdx ? '#E78D70' : 'rgba(231,141,112,0.4)';
    parts += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}"/>`;
  });
  parts += `<text x="${cx}" y="8" text-anchor="middle" font-size="7.5" fill="#7B8A99" font-weight="700">N</text>`;
  parts += `<circle cx="${cx}" cy="${cy}" r="1.8" fill="#2C4B66"/>`;
  svg.innerHTML = parts;
  host.appendChild(svg);
}

// Curva del diferencial (tarjeta oscura) — línea limpia sobre navy, sin área
function renderDeltaMini(deltas) {
  const host = $('deltaChart');
  if (!host) return;
  host.innerHTML = '';
  if (!deltas || deltas.length < 2) return;
  const { W, H } = hostSize(host, 356, 120);
  const padL = 42, padR = 12, padT = 12, padB = 20;
  const vals = deltas.map(d => d.v);
  let yMin = Math.min(...vals, 0), yMax = Math.max(...vals, 0);
  if (yMax - yMin < 2) { yMax += 1; yMin -= 1; }
  const span = yMax - yMin; yMin -= span * 0.12; yMax += span * 0.12;
  const xs = hr => padL + (hr / 23) * (W - padL - padR);
  const ys = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  let g = '';
  const y0 = ys(0);
  g += `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" stroke="rgba(246,244,241,0.4)" stroke-width="1" stroke-dasharray="3 3"/>`;
  g += `<text x="${padL - 8}" y="${(y0 + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="rgba(246,244,241,0.85)" font-weight="700">0°</text>`;
  // extremos del eje Y, solo si no chocan con el 0°
  const yTop = ys(yMax), yBot = ys(yMin);
  if (Math.abs(yTop + 9 - y0) > 16) {
    g += `<text x="${padL - 8}" y="${(yTop + 9).toFixed(1)}" text-anchor="end" font-size="11" fill="rgba(246,244,241,0.55)" font-weight="700">${yMax > 0 ? '+' : ''}${Math.round(yMax)}°</text>`;
  }
  if (Math.abs(yBot - 2 - y0) > 16) {
    g += `<text x="${padL - 8}" y="${(yBot - 2).toFixed(1)}" text-anchor="end" font-size="11" fill="rgba(246,244,241,0.55)" font-weight="700">${Math.round(yMin)}°</text>`;
  }
  for (const hr of [0, 6, 12, 18, 23]) {
    g += `<text x="${xs(hr).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10.5" fill="rgba(246,244,241,0.55)" font-weight="600">${String(hr).padStart(2, '0')}h</text>`;
  }

  let dPath = '';
  let last = null;
  deltas.forEach((d, idx) => {
    dPath += (idx === 0 ? 'M' : ' L') + xs(d.hr).toFixed(1) + ',' + ys(d.v).toFixed(1);
    last = d;
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g +
    `<path d="${dPath}" fill="none" stroke="#F8BC7E" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${xs(last.hr).toFixed(1)}" cy="${ys(last.v).toFixed(1)}" r="3.6" fill="#fff"/>`;
  host.appendChild(svg);
}

// Curva "día típico" de un período (promedio por hora sobre los días del scope)
function typicalCurve(key, k, days) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (const ymd of days) {
    const day = BYDAY[key][ymd];
    if (!day || !day.h || !day.h[k]) continue;
    for (let i = 0; i < 24; i++) if (day.h[k][i] != null) buckets[i].push(day.h[k][i]);
  }
  return buckets.map(b => b.length >= 3 ? mean(b) : null);
}

// Días del período de comparación, relativo a una fecha de referencia
function scopeDays(scope, refYmd) {
  const [ry, rm] = refYmd.split('-').map(Number);
  const season = seasonOf(rm - 1);
  const out = [];
  for (const ymd of Object.keys(BYDAY.renca)) {
    const [y, m] = ymd.split('-').map(Number);
    if (scope === 'mes') { if (y === ry && m === rm) out.push(ymd); }
    else if (scope === 'est') { if (season && season.months.includes(m - 1)) out.push(ymd); }
    else if (scope === 'anio') { if (y === ry) out.push(ymd); }
  }
  return out;
}
function scopeLabel(scope, refYmd) {
  const [y, m] = refYmd.split('-').map(Number);
  if (scope === 'mes') return 'promedio ' + MESES[m - 1];
  if (scope === 'est') { const s = seasonOf(m - 1); return 'promedio ' + (s ? s.label : 'estación'); }
  return 'promedio ' + y;
}

// ============================================================
// Panel central — pestañas Día / Mes + selector de variable
// ============================================================
function statHtml(v, l, signed) {
  const cls = signed && v != null ? (v >= 0 ? 'pos' : 'neg') : '';
  const txt = signed ? fmtSigned(v, 1) : (v == null ? '—' : v);
  return `<div class="cs"><span class="cs-v ${cls}">${txt}</span><span class="cs-l">${l}</span></div>`;
}

function dayDeltas(ymd) {
  const R = getDay('renca', ymd), I = getDay('isla', ymd);
  const deltas = [];
  if (R && I && R.h && I.h) {
    for (let i = 0; i < 24; i++) {
      if (R.h.t[i] != null && I.h.t[i] != null) deltas.push({ hr: i, v: R.h.t[i] - I.h.t[i] });
    }
  }
  return deltas;
}

async function renderTab() {
  const today = todayYmd();
  const k = state.varKey;
  const meta = VAR_META[k];
  $('ctlDia').hidden = state.tab !== 'dia';
  $('ctlMes').hidden = state.tab !== 'mes';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  document.querySelectorAll('.vchip').forEach(b => b.classList.toggle('active', b.dataset.var === k));
  const host = $('mainChart');
  const stats = $('chartStats');

  if (state.tab === 'dia') {
    const ymd = state.day;
    const esHoy = ymd === today;
    $('diaInput').value = ymd;
    if (ymd >= (DATA_MAX || '') || esHoy) await fetchLiveDay(ymd);
    const R = getDay('renca', ymd), I = getDay('isla', ymd);
    const dow = DIAS_SEM[new Date(ymd + 'T12:00:00').getDay()];
    $('chartTitle').textContent = meta.label + ' · ' +
      (esHoy ? 'hoy, ' + fmtDateEs(ymd, false) : dow.charAt(0) + dow.slice(1).toLowerCase() + ' ' + fmtDateEs(ymd));

    // Isla sin detalle horario ese día pero con promedio diario (solo temp):
    // línea plana punteada con su promedio, para que no "desaparezca".
    let islaSeries = null;
    if (I) {
      const hourlyCount = I.h[k].filter(v => v != null).length;
      if (hourlyCount >= 2) {
        islaSeries = { label: 'Isla de Maipo', color: ST.isla.color, dash: '5 4', values: I.h[k] };
      } else if (k === 't' && I.all_avg != null) {
        islaSeries = { label: 'Isla · promedio del día', color: ST.isla.color, dash: '2 4', values: new Array(24).fill(Number(I.all_avg.toFixed(1))) };
      }
    }
    // Comparación con el día típico del período elegido
    let cmpSeries = null;
    if (state.cmp) {
      const curve = typicalCurve('renca', k, scopeDays(state.cmp, ymd));
      if (curve.some(v => v != null)) {
        cmpSeries = { label: 'Renca · ' + scopeLabel(state.cmp, ymd), color: '#2C4B66', dash: '2 3', values: curve.map(v => v != null ? Number(v.toFixed(2)) : null) };
      }
    }

    renderSeriesChart(host, {
      n: 24,
      series: [
        R ? { label: 'Renca', color: ST.renca.color, values: R.h[k], hero: true } : null,
        islaSeries,
        cmpSeries
      ].filter(Boolean),
      dec: meta.dec, unit: meta.unit, pillFmt: meta.pill,
      yFix: FIXED.dia[k],
      xTickIdx: [0, 6, 12, 18, 23],
      xTickFmt: i => String(i).padStart(2, '0') + 'h',
      tipTitle: i => String(i).padStart(2, '0') + ':00'
    });

    if (k === 't') {
      const deltas = dayDeltas(ymd);
      const peak = deltas.length ? deltas.reduce((a, b) => b.v > a.v ? b : a) : null;
      // promedio: horario si alcanza, si no el respaldo con promedios diarios
      const dAvg = deltas.length >= 6 ? mean(deltas.map(d => d.v)) : pairedDelta(ymd);
      const tMax = R ? (R.all_max != null ? R.all_max : maxOf(R.h.t)) : null;
      const tMin = R ? (R.all_min != null ? R.all_min : minOf(R.h.t)) : null;
      stats.innerHTML =
        statHtml(dAvg, 'Diferencial promedio', true) +
        statHtml(peak ? peak.v : null, peak ? 'Mayor diferencial · ' + String(peak.hr).padStart(2, '0') + ':00' : 'Mayor diferencial', true) +
        statHtml(tMax != null ? fmt(tMax, 1, '°') : null, 'Máx Renca') +
        statHtml(tMin != null ? fmt(tMin, 1, '°') : null, 'Mín Renca');
    } else {
      const vR = R ? R.h[k] : [];
      stats.innerHTML =
        statHtml(mean(vR) != null ? fmt(mean(vR), meta.dec, ' ' + meta.unit) : null, 'Prom Renca') +
        statHtml(maxOf(vR) != null ? fmt(maxOf(vR), meta.dec, '') : null, 'Máx Renca') +
        statHtml(minOf(vR) != null ? fmt(minOf(vR), meta.dec, '') : null, 'Mín Renca') +
        statHtml(I && mean(I.h[k]) != null ? fmt(mean(I.h[k]), meta.dec, ' ' + meta.unit) : null, 'Prom Isla');
    }
    return;
  }

  // ---- mes ----
  const ym = state.month;
  const [y, m] = ym.split('-').map(Number);
  const lastD = new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= lastD; d++) {
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (ymd <= today) days.push(ymd);
  }
  const avgR = days.map(d => dayVal('renca', d, k));
  const avgI = days.map(d => dayVal('isla', d, k));

  $('chartTitle').textContent = meta.label + ' media diaria · ' + MESES_CAP[m - 1] + ' ' + y;

  // Comparación: línea de referencia con el promedio del período elegido
  let cmpSeriesMes = null;
  if (state.cmp) {
    const ref = days[Math.floor(days.length / 2)] || (ym + '-15');
    const sdays = scopeDays(state.cmp, ref);
    const scopeMean = mean(sdays.map(d => dayVal('renca', d, k)));
    if (scopeMean != null) {
      cmpSeriesMes = { label: 'Renca · ' + scopeLabel(state.cmp, ref), color: '#2C4B66', dash: '2 3', values: new Array(days.length).fill(Number(scopeMean.toFixed(2))) };
    }
  }

  renderSeriesChart(host, {
    n: days.length,
    series: [
      { label: 'Renca', color: ST.renca.color, values: avgR, hero: true },
      { label: 'Isla de Maipo', color: ST.isla.color, dash: '5 4', values: avgI },
      cmpSeriesMes
    ].filter(Boolean),
    dec: meta.dec, unit: meta.unit, pillFmt: meta.pill,
    yFix: FIXED.mes[k],
    xTickIdx: [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i),
    xTickFmt: i => fmtDateShort(days[i]),
    tipTitle: i => fmtDateEs(days[i])
  });

  if (k === 't') {
    const deltas = days.map(d => pairedDelta(d)).filter(v => v != null);
    const maxR = days.map(d => { const x = getDay('renca', d); return x ? (x.all_max != null ? x.all_max : maxOf(x.h.t)) : null; });
    const over30 = maxR.filter(v => v != null && v > 30).length;
    stats.innerHTML =
      statHtml(mean(avgR) != null ? fmt(mean(avgR), 1, '°') : null, 'Prom Renca') +
      statHtml(mean(avgI) != null ? fmt(mean(avgI), 1, '°') : null, 'Prom Isla') +
      statHtml(deltas.length ? mean(deltas) : null, 'Diferencial promedio', true) +
      statHtml(over30 + (over30 === 1 ? ' día' : ' días'), 'Sobre 30°');
  } else {
    stats.innerHTML =
      statHtml(mean(avgR) != null ? fmt(mean(avgR), meta.dec, ' ' + meta.unit) : null, 'Prom Renca') +
      statHtml(maxOf(avgR) != null ? fmt(maxOf(avgR), meta.dec, '') : null, 'Máx diario Renca') +
      statHtml(minOf(avgR) != null ? fmt(minOf(avgR), meta.dec, '') : null, 'Mín diario Renca') +
      statHtml(mean(avgI) != null ? fmt(mean(avgI), meta.dec, ' ' + meta.unit) : null, 'Prom Isla');
  }
}

function setTab(t) { state.tab = t; renderTab(); }

// ============================================================
// Ahora (cards + sparklines + tarjeta oscura + mapa)
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
    for (const [key, col] of Object.entries(st.fields)) {
      const v = parseFloat(latest[col]);
      out[key] = isNaN(v) ? null : v;
      if (prev) {
        const pv = parseFloat(prev[col]);
        if (!isNaN(pv) && !isNaN(v)) out[key + 'Trend'] = v - pv;
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

// Clasificador de condición (misma heurística del dashboard principal):
// radiación observada vs teórica de cielo despejado + humedad + temperatura.
const CONDITION_ICONS = {
  'soleado':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.25"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/><line x1="5.5" y1="5.5" x2="7" y2="7"/><line x1="17" y1="17" x2="18.5" y2="18.5"/><line x1="5.5" y1="18.5" x2="7" y2="17"/><line x1="17" y1="7" x2="18.5" y2="5.5"/></svg>',
  'parcial':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="16" cy="7" r="3.5" fill="currentColor" fill-opacity="0.6"/><line x1="16" y1="1" x2="16" y2="3"/><line x1="22" y1="7" x2="23" y2="7"/><line x1="20" y1="3" x2="21" y2="2"/><line x1="20" y1="11" x2="21" y2="12"/><path d="M3,19 a3.5,3.5 0 0 1 0,-7 a4.5,4.5 0 0 1 9,0 a3.5,3.5 0 0 1 0,7 Z" fill="currentColor" fill-opacity="0.3"/></svg>',
  'nublado':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6,18 a4,4 0 0 1 0,-8 a5,5 0 0 1 10,0 a4,4 0 0 1 0,8 Z" fill="currentColor" fill-opacity="0.18"/></svg>',
  'niebla':   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="9" x2="21" y2="9"/><line x1="5" y1="13" x2="19" y2="13"/><line x1="3" y1="17" x2="17" y2="17"/></svg>',
  'ola-calor':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="9" cy="10" r="2.5" fill="currentColor" fill-opacity="0.4"/><line x1="9" y1="3" x2="9" y2="5"/><line x1="3" y1="10" x2="5" y2="10"/><line x1="13" y1="10" x2="15" y2="10"/><path d="M19 6 v10 a2,2 0 0 1 -4,0 v-10 Z" fill="currentColor" fill-opacity="0.6"/></svg>',
  'noche':    '<svg viewBox="0 0 24 24" fill="none"><path d="M16 4 A9 9 0 1 0 19 17 A7.5 7.5 0 0 1 16 4 Z" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1.2"/></svg>'
};
const CONDITION_LABELS = {
  'soleado': 'Soleado', 'parcial': 'Parcial', 'nublado': 'Nublado',
  'niebla': 'Niebla', 'ola-calor': 'Ola de calor', 'noche': 'Noche'
};

function classifyCondition(temp, humidity, rad, hour) {
  if (temp == null) return null;
  const isNight = hour >= 19 || hour < 6;
  if (isNight) {
    if (humidity != null && humidity >= 88) return 'niebla';
    if (humidity != null && humidity >= 75) return 'nublado';
    return 'noche';
  }
  if (temp >= 30) return 'ola-calor';
  if (humidity != null && humidity >= 88 && rad != null && rad < 50 && hour >= 7 && hour <= 18) return 'niebla';
  let expectedRad = 0;
  if (hour >= 6 && hour <= 18) expectedRad = 1000 * Math.sin((hour - 6) / 12 * Math.PI);
  if (expectedRad < 50) return null;
  if (rad == null) return null;
  const ratio = rad / expectedRad;
  if (ratio >= 0.7) return 'soleado';
  if (ratio >= 0.35) return 'parcial';
  return 'nublado';
}

function updateCondition(rnc) {
  const chip = $('condChip');
  if (!rnc || rnc.t == null) { chip.hidden = true; return; }
  const cond = classifyCondition(rnc.t, rnc.h, rnc.r, new Date().getHours());
  if (!cond) { chip.hidden = true; return; }
  chip.hidden = false;
  $('condIcon').innerHTML = CONDITION_ICONS[cond] || '';
  $('condLbl').textContent = CONDITION_LABELS[cond] || '';
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
    $('rncHum').textContent = rnc.h != null ? Math.round(rnc.h) : '—';
    $('rncRad').textContent = rnc.r != null ? Math.round(rnc.r) : '—';
    $('rncWind').textContent = rnc.w != null ? rnc.w.toFixed(1) : '—';
    $('rncDir').textContent = rnc.d != null ? degToCompassEs(rnc.d) + ' · ' + Math.round(rnc.d) + '°' : '—';
  }
  updateCondition(rnc);
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

  // día de hoy en vivo: rango, sparklines, curva del diferencial
  const today = todayYmd();
  const live = await fetchLiveDay(today, true);
  const R = live.renca;
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
    // Tendencia vs HACE UNA HORA (promedio horario anterior de hoy)
    const tr = $('rncTrend');
    const curHr = new Date().getHours();
    let prevHourVal = null;
    for (let i = curHr - 1; i >= Math.max(0, curHr - 3); i--) {
      if (R.h.t[i] != null) { prevHourVal = R.h.t[i]; break; }
    }
    if (rnc && rnc.t != null && prevHourVal != null) {
      const diff = rnc.t - prevHourVal;
      tr.hidden = false;
      tr.textContent = (diff >= 0 ? '↑' : '↓') + ' ' + Math.abs(diff).toFixed(1) + '° vs hace una hora';
      tr.classList.toggle('up', diff >= 0);
      tr.classList.toggle('down', diff < 0);
    }
    // Barras de rango de hoy: humedad (0–100) y radiación (0–máx del día)
    const setRange = (vals, cur, fillId, pinId, minId, maxId, scaleMin, scaleMax, dec) => {
      const lo = minOf(vals), hi = maxOf(vals);
      if (lo == null || hi == null) return;
      $(minId).textContent = fmt(lo, dec, '');
      $(maxId).textContent = fmt(hi, dec, '');
      const pct = v => Math.max(0, Math.min(100, (v - scaleMin) / (scaleMax - scaleMin) * 100));
      const f = $(fillId);
      f.style.left = pct(lo) + '%';
      f.style.width = Math.max(1.5, pct(hi) - pct(lo)) + '%';
      if (cur != null) $(pinId).style.left = pct(cur) + '%';
    };
    setRange(R.h.h, rnc && rnc.h, 'humFill', 'humPin', 'humMin', 'humMax', 0, 100, 0);
    const radTop = Math.max(1100, (maxOf(R.h.r) || 0) * 1.08, (rnc && rnc.r) || 0);
    setRange(R.h.r, rnc && rnc.r, 'radFill', 'radPin', 'radMin', 'radMax', 0, radTop, 0);
  }
  // Rosa de viento: últimas 24 h (ayer + hoy)
  renderWindRose($('windRose'), last24h('renca', 'w'), last24h('renca', 'd'));
  const deltas = dayDeltas(today);
  if (deltas.length) {
    $('deltaAvgHoy').textContent = fmtSigned(mean(deltas.map(d => d.v)), 1);
    const peak = deltas.reduce((a, b) => b.v > a.v ? b : a);
    $('deltaMaxHoy').textContent = fmtSigned(peak.v, 1);
    $('deltaMaxHoyLbl').textContent = 'Máx · ' + String(peak.hr).padStart(2, '0') + ':00';
    renderDeltaMini(deltas);
  }

  if (mapMarkers) {
    if (rnc && rnc.t != null && mapMarkers.renca) mapMarkers.renca.querySelector('.pin').textContent = Math.round(rnc.t) + '°';
    if (isl && isl.t != null && mapMarkers.isla) mapMarkers.isla.querySelector('.pin').textContent = Math.round(isl.t) + '°';
  }

  // sello de actualización visible
  const now = new Date();
  $('lastUpdate').textContent = 'Actualizado ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  if (state.tab === 'dia' && state.day === today) renderTab();
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
          cell.dataset.tip = `<strong>${fmtDateEs(ymd)}</strong><br>Diferencial ${fmtSigned(delta, 1)} · Renca ${fmt(tR, 1, '°')} · Isla ${fmt(tI, 1, '°')}`;
          cell.dataset.ymd = ymd;
        } else if (tR != null) {
          cell.classList.add('nodata'); // rayado: hay día pero falta la contraparte
          // Ventana de manutención de Isla de Maipo (actualización de equipo, ene-2026)
          const enManutencion = ymd >= '2026-01-12' && ymd <= '2026-01-21';
          cell.dataset.tip = `<strong>${fmtDateEs(ymd)}</strong><br>` +
            (enManutencion ? 'Sin datos · Estación en manutención' : 'Sin datos este día');
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
  $('recHotDate').textContent = stats.maxTDay ? fmtDateEs(stats.maxTDay, false) + ' · máx en Renca' : '—';
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
  computeScales();
  const today = todayYmd();

  state.day = today;
  state.year = Number(today.slice(0, 4));
  state.month = today.slice(0, 7);

  // controles día
  const dia = $('diaInput');
  dia.min = DATA_MIN || ''; dia.max = today;
  dia.addEventListener('change', () => { if (dia.value) { state.day = dia.value; renderTab(); } });
  $('btnHoy').addEventListener('click', () => { state.day = today; renderTab(); });
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

  // tabs + variable
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.querySelectorAll('.vchip').forEach(b => b.addEventListener('click', () => {
    state.varKey = b.dataset.var;
    renderTab();
  }));
  $('cmpSel').addEventListener('change', () => { state.cmp = $('cmpSel').value; renderTab(); });

  initMap();
  renderYear();
  await renderTab();
  updateNow();
  setInterval(updateNow, 5 * 60 * 1000);
  // al volver a la pestaña (o encender el monitor), refrescar al tiro
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateNow(); });
}

init();
