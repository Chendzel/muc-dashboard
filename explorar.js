// ============================================================
// MUC — Explorar datos
// Lee los JSONs históricos (data/<id>.json, generados por GitHub
// Actions con scripts/update-data.js v2) y para el día de hoy
// completa en vivo desde ThingSpeak.
// Variables canónicas: t=°C · h=% · w=m/s · d=° viento · r=W/m²
// ============================================================

'use strict';

// ---------- Estaciones (clave de display → fuentes de datos) ----------
const EXP_STATIONS = [
  { key: 'providencia', name: 'Providencia', short: 'Providencia', color: '#E78D70', urban: true,
    sources: [
      { file: 'data/providencia-th.json',  channelId: 2865013, readKey: 'GPW0MWSXAJYXSN69', fields: { t: 'field1', h: 'field2' } },
      { file: 'data/providencia-adv.json', channelId: 2865012, readKey: 'ZHVO4V54ACWCKMUF', fields: { w: 'field1', d: 'field2', r: 'field7' } }
    ] },
  { key: 'stgo-centro', name: 'Santiago Centro', short: 'Stgo Centro', color: '#2C4B66', urban: true,
    sources: [{ file: 'data/stgo-centro.json', channelId: 3175711, readKey: 'OD4EIUF224PK2IBK', fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }] },
  { key: 'renca', name: 'Renca', short: 'Renca', color: '#DCA45E', urban: true,
    sources: [{ file: 'data/renca.json', channelId: 3027229, readKey: 'T40LCTX172ZB9E9F', fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }] },
  { key: 'cerrillos', name: 'Cerrillos', short: 'Cerrillos', color: '#C26A50', urban: true,
    sources: [{ file: 'data/cerrillos.json', channelId: 3218465, readKey: 'P5VMMIJP91Q5M6FO', fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }] },
  { key: 'san-carlos', name: 'San Carlos de Apoquindo', short: 'San Carlos', color: '#6E9470', urban: false,
    sources: [{ file: 'data/san-carlos.json', channelId: 2950699, readKey: 'JLIRRP01JVIYPRBZ', fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }] },
  { key: 'chamisero', name: 'Chamisero', short: 'Chamisero', color: '#5E989E', urban: false,
    sources: [{ file: 'data/chamisero.json', channelId: 2950701, readKey: 'KIIWGUYA11WMSIQ9', fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }] },
  { key: 'isla-maipo', name: 'Isla de Maipo', short: 'Isla de Maipo', color: '#7B8A99', urban: false, rural: true,
    sources: [{ file: 'data/isla-maipo.json', channelId: 2911247, readKey: 'JG5XFI4NB556UKO2', fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }] }
];
const URBAN_KEYS = ['providencia', 'stgo-centro', 'renca', 'cerrillos'];

const VAR_META = {
  t: { label: 'Temperatura', unit: '°C',   dec: 1 },
  h: { label: 'Humedad',     unit: '%',    dec: 0 },
  r: { label: 'Radiación',   unit: 'W/m²', dec: 0 },
  w: { label: 'Viento',      unit: 'm/s',  dec: 1 }
};

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MESES_CAP = MESES.map(m => m[0].toUpperCase() + m.slice(1));

// ---------- Estado ----------
const DATA = {};           // key → { byDay }
let DATA_MIN = null, DATA_MAX = null;   // 'YYYY-MM-DD'
const LIVE_CACHE = {};     // ymd → { key → day } (top-up de hoy desde ThingSpeak)
const SELECTED = new Set(EXP_STATIONS.map(s => s.key));
let currentDay = null;

// ---------- Helpers de fecha ----------
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
  return parseInt(d, 10) + ' de ' + MESES[m - 1] + (withYear ? ' de ' + y : '');
}
function fmtDateShort(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return d + ' ' + MESES[m - 1].slice(0, 3) + ' ' + String(y).slice(2);
}

// ---------- Utilidades numéricas ----------
const mean = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };
const maxOf = arr => { const v = arr.filter(x => x != null); return v.length ? Math.max(...v) : null; };
const minOf = arr => { const v = arr.filter(x => x != null); return v.length ? Math.min(...v) : null; };
function fmt(v, dec, unit) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(dec) + (unit || '');
}
function fmtSigned(v, dec) {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(dec) + '°';
}
function degToCompassEs(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  return dirs[Math.round(deg / 22.5) % 16];
}
function emptyDay() {
  const nulls = () => new Array(24).fill(null);
  return { h: { t: nulls(), h: nulls(), w: nulls(), d: nulls(), r: nulls() } };
}

// ---------- Carga ----------
async function loadAll() {
  await Promise.all(EXP_STATIONS.map(async st => {
    const byDay = {};
    for (const src of st.sources) {
      try {
        const res = await fetch(src.file, { cache: 'no-cache' });
        if (!res.ok) continue;
        const json = await res.json();
        for (const [ymd, day] of Object.entries(json.byDay || {})) {
          if (!byDay[ymd]) byDay[ymd] = JSON.parse(JSON.stringify(day));
          else {
            // Merge providencia-th (t/h) + providencia-adv (w/d/r): las variables no se pisan
            const tgt = byDay[ymd];
            if (day.h) {
              if (!tgt.h) tgt.h = emptyDay().h;
              for (const v of ['t', 'h', 'w', 'd', 'r']) {
                if (!day.h[v]) continue;
                for (let i = 0; i < 24; i++) if (day.h[v][i] != null && (!tgt.h[v] || tgt.h[v][i] == null)) {
                  if (!tgt.h[v]) tgt.h[v] = new Array(24).fill(null);
                  tgt.h[v][i] = day.h[v][i];
                }
              }
            }
            for (const k of ['all_avg','all_max','all_min','M_avg','T_avg','N_avg','all_n']) {
              if (tgt[k] == null && day[k] != null) tgt[k] = day[k];
            }
          }
        }
      } catch (e) { console.warn('[explorar] no se pudo cargar', src.file, e.message); }
    }
    DATA[st.key] = { byDay };
    for (const ymd of Object.keys(byDay)) {
      if (!DATA_MIN || ymd < DATA_MIN) DATA_MIN = ymd;
      if (!DATA_MAX || ymd > DATA_MAX) DATA_MAX = ymd;
    }
  }));
}

// Top-up del día actual directo desde ThingSpeak (el JSON del repo se actualiza 1 vez/día)
async function fetchLiveDay(ymd) {
  if (LIVE_CACHE[ymd]) return LIVE_CACHE[ymd];
  const out = {};
  await Promise.all(EXP_STATIONS.map(async st => {
    const day = emptyDay();
    let got = false;
    for (const src of st.sources) {
      const url = 'https://api.thingspeak.com/channels/' + src.channelId + '/feeds.json' +
        '?api_key=' + src.readKey + '&start=' + ymd + '%2000:00:00&end=' + ymd + '%2023:59:59' +
        '&average=60&results=8000&timezone=America%2FSantiago';
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const json = await res.json();
        for (const f of (json.feeds || [])) {
          if (!f || !f.created_at) continue;
          const hr = new Date(f.created_at).getHours();
          if (isNaN(hr)) continue;
          for (const [v, col] of Object.entries(src.fields)) {
            const val = parseFloat(f[col]);
            if (!isNaN(val) && day.h[v][hr] == null) { day.h[v][hr] = val; got = true; }
          }
        }
      } catch (e) { /* sin red o canal caído: seguimos con lo que haya */ }
    }
    if (got) {
      const temps = day.h.t.filter(x => x != null);
      day.all_avg = temps.length ? mean(temps) : null;
      day.all_max = temps.length ? Math.max(...temps) : null;
      day.all_min = temps.length ? Math.min(...temps) : null;
      out[st.key] = day;
    }
  }));
  LIVE_CACHE[ymd] = out;
  return out;
}

function getDay(stationKey, ymd) {
  const live = LIVE_CACHE[ymd];
  if (live && live[stationKey]) return live[stationKey];
  const sd = DATA[stationKey];
  return (sd && sd.byDay[ymd]) || null;
}

// ============================================================
// Chart SVG genérico — series horarias (24 puntos) con hover
// ============================================================
function renderHourChart(host, opts) {
  const { series, dec, unit, zeroLine, height } = opts;
  const W = 720, H = height || 240;
  const padL = 44, padR = 14, padT = 12, padB = 26;

  const allVals = series.flatMap(s => s.values.filter(v => v != null));
  host.innerHTML = '';
  if (allVals.length === 0) {
    host.innerHTML = '<div style="padding:36px;text-align:center;color:var(--text-light);font-size:13px;">Sin datos para esta selección</div>';
    return;
  }
  let yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  if (zeroLine) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
  if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
  const span = yMax - yMin;
  yMin -= span * 0.08; yMax += span * 0.08;

  const xs = i => padL + (i / 23) * (W - padL - padR);
  const ys = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  // Ticks Y "lindos"
  const rawStep = (yMax - yMin) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) || rawStep;
  const tick0 = Math.ceil(yMin / step) * step;

  let g = '';
  for (let v = tick0; v <= yMax + 1e-9; v += step) {
    const y = ys(v);
    g += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(44,75,102,0.07)" stroke-width="1"/>`;
    g += `<text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#7B8A99" font-weight="600">${Number(v.toFixed(Math.max(0, dec)))}</text>`;
  }
  if (zeroLine && yMin < 0 && yMax > 0) {
    const y0 = ys(0);
    g += `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" stroke="rgba(44,75,102,0.35)" stroke-width="1.2"/>`;
  }
  for (const hr of [0, 6, 12, 18, 23]) {
    g += `<text x="${xs(hr).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#B0B9C2" font-weight="600">${String(hr).padStart(2, '0')}h</text>`;
  }

  let paths = '';
  for (const s of series) {
    let dPath = '', open = false;
    s.values.forEach((v, i) => {
      if (v == null) { open = false; return; }
      dPath += (open ? ' L' : (dPath ? ' M' : 'M')) + xs(i).toFixed(1) + ',' + ys(v).toFixed(1);
      open = true;
    });
    if (dPath) {
      paths += `<path d="${dPath}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ` +
        (s.dash ? `stroke-dasharray="${s.dash}" ` : '') +
        `stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>`;
    }
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g + paths +
    `<line id="hoverLine" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="rgba(44,75,102,0.4)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`;
  host.appendChild(svg);

  // ---- Hover ----
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.style.display = 'none';
  host.appendChild(tip);
  const hoverLine = svg.querySelector('#hoverLine');

  function onMove(ev) {
    const rect = svg.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width * W;
    let hr = Math.round((fx - padL) / (W - padL - padR) * 23);
    hr = Math.max(0, Math.min(23, hr));
    const rows = series
      .map(s => ({ s, v: s.values[hr] }))
      .filter(r => r.v != null);
    if (!rows.length) { tip.style.display = 'none'; hoverLine.setAttribute('visibility', 'hidden'); return; }
    hoverLine.setAttribute('x1', xs(hr)); hoverLine.setAttribute('x2', xs(hr));
    hoverLine.setAttribute('visibility', 'visible');
    tip.innerHTML = `<span class="tt-hour">${String(hr).padStart(2, '0')}:00</span>` +
      rows.map(r =>
        `<div class="tt-row"><span class="tt-dot" style="background:${r.s.color}"></span>${r.s.label}` +
        `<span class="tt-val">${fmt(r.v, dec, unit ? ' ' + unit : '')}</span></div>`).join('');
    tip.style.display = 'block';
    const px = xs(hr) / W * rect.width;
    tip.style.left = Math.max(70, Math.min(rect.width - 70, px)) + 'px';
    tip.style.top = (ev.clientY - rect.top) + 'px';
  }
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; hoverLine.setAttribute('visibility', 'hidden'); });
}

// Serie diaria (para resultados de consultas)
function renderDailyChart(host, days, values, opts) {
  const { dec, unit, color, mark } = opts;
  const W = 720, H = 200;
  const padL = 44, padR = 14, padT = 12, padB = 26;
  host.innerHTML = '';
  const pts = values.map((v, i) => ({ v, i })).filter(p => p.v != null);
  if (!pts.length) { host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-light);font-size:13px;">Sin datos en el período</div>'; return; }

  let yMin = Math.min(...pts.map(p => p.v)), yMax = Math.max(...pts.map(p => p.v));
  if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
  const span = yMax - yMin; yMin -= span * 0.1; yMax += span * 0.1;
  const N = values.length;
  const xs = i => N === 1 ? (padL + (W - padL - padR) / 2) : padL + (i / (N - 1)) * (W - padL - padR);
  const ys = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  let g = '';
  const rawStep = (yMax - yMin) / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) || rawStep;
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    const y = ys(v);
    g += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(44,75,102,0.07)" stroke-width="1"/>`;
    g += `<text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#7B8A99" font-weight="600">${Number(v.toFixed(Math.max(0, dec)))}</text>`;
  }
  // Etiquetas X: inicio, medio, fin
  [[0], [Math.floor((N - 1) / 2)], [N - 1]].forEach(([i]) => {
    if (days[i]) g += `<text x="${xs(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#B0B9C2" font-weight="600">${fmtDateShort(days[i])}</text>`;
  });

  let dPath = '', open = false;
  values.forEach((v, i) => {
    if (v == null) { open = false; return; }
    dPath += (open ? ' L' : (dPath ? ' M' : 'M')) + xs(i).toFixed(1) + ',' + ys(v).toFixed(1);
    open = true;
  });
  let markSvg = '';
  if (mark != null && values[mark] != null) {
    markSvg = `<circle cx="${xs(mark).toFixed(1)}" cy="${ys(values[mark]).toFixed(1)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="2"/>`;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g + `<path d="${dPath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` + markSvg;
  host.appendChild(svg);

  // Hover por día
  const tip = document.createElement('div');
  tip.className = 'chart-tip'; tip.style.display = 'none';
  host.appendChild(tip);
  svg.addEventListener('pointermove', ev => {
    const rect = svg.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width * W;
    let i = Math.round((fx - padL) / Math.max(1, W - padL - padR) * (N - 1));
    i = Math.max(0, Math.min(N - 1, i));
    if (values[i] == null) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<span class="tt-hour">${fmtDateEs(days[i])}</span><div class="tt-row">${fmt(values[i], dec, ' ' + unit)}</div>`;
    tip.style.display = 'block';
    tip.style.left = Math.max(80, Math.min(rect.width - 80, xs(i) / W * rect.width)) + 'px';
    tip.style.top = (ev.clientY - rect.top) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
}

// ============================================================
// SECCIÓN 1 — Día
// ============================================================
function stationsInView() {
  return EXP_STATIONS.filter(s => SELECTED.has(s.key));
}

async function renderDayView(ymd) {
  currentDay = ymd;
  document.getElementById('diaInput').value = ymd;

  // Día de hoy (o posterior al último JSON): completar en vivo
  if (ymd >= (DATA_MAX || '') || ymd === todayYmd()) await fetchLiveDay(ymd);

  const isla = getDay('isla-maipo', ymd);
  const view = stationsInView();
  const anyData = EXP_STATIONS.some(s => getDay(s.key, ymd));

  document.getElementById('dayEmpty').hidden = anyData;
  document.getElementById('dayHeadline').hidden = !anyData;
  document.getElementById('dayCharts').style.display = anyData ? '' : 'none';
  document.querySelector('#seccion-dia .table-wrap').style.display = anyData ? '' : 'none';
  if (!anyData) return;

  // ---- Headline ----
  const urbanDeltas = [], hourlyPeak = { v: -Infinity };
  let netMax = null, netMin = null;
  for (const st of EXP_STATIONS) {
    const day = getDay(st.key, ymd);
    if (!day || !day.h) continue;
    const dayMax = day.all_max != null ? day.all_max : maxOf(day.h.t);
    const dayMin = day.all_min != null ? day.all_min : minOf(day.h.t);
    if (dayMax != null && (!netMax || dayMax > netMax.v)) netMax = { v: dayMax, st };
    if (dayMin != null && (!netMin || dayMin < netMin.v)) netMin = { v: dayMin, st };
    if (st.urban && isla && isla.h) {
      const deltas = [];
      for (let i = 0; i < 24; i++) {
        if (day.h.t[i] != null && isla.h.t[i] != null) {
          const d = day.h.t[i] - isla.h.t[i];
          deltas.push(d);
          if (d > hourlyPeak.v) Object.assign(hourlyPeak, { v: d, st, hr: i });
        }
      }
      const m = mean(deltas);
      if (m != null) urbanDeltas.push(m);
    }
  }
  document.getElementById('dhDelta').textContent = urbanDeltas.length ? fmtSigned(mean(urbanDeltas), 1) : '—';
  document.getElementById('dhMax').innerHTML = netMax ? fmt(netMax.v, 1, '°') + ' <small>' + netMax.st.short + '</small>' : '—';
  document.getElementById('dhMin').innerHTML = netMin ? fmt(netMin.v, 1, '°') + ' <small>' + netMin.st.short + '</small>' : '—';
  document.getElementById('dhPeak').innerHTML = hourlyPeak.v > -Infinity
    ? fmtSigned(hourlyPeak.v, 1) + ' <small>' + hourlyPeak.st.short + ' · ' + String(hourlyPeak.hr).padStart(2, '0') + ':00</small>' : '—';

  // ---- Charts ----
  const mkSeries = v => view
    .map(st => {
      const day = getDay(st.key, ymd);
      return day && day.h && day.h[v] ? { label: st.short, color: st.color, dash: st.rural ? '5 4' : null, values: day.h[v] } : null;
    })
    .filter(Boolean);

  renderHourChart(document.getElementById('chartTemp'), { series: mkSeries('t'), dec: 1, unit: '°C', height: 260 });

  const deltaSeries = view.filter(s => !s.rural).map(st => {
    const day = getDay(st.key, ymd);
    if (!day || !day.h || !isla || !isla.h) return null;
    const values = day.h.t.map((v, i) => (v != null && isla.h.t[i] != null) ? Number((v - isla.h.t[i]).toFixed(2)) : null);
    return { label: st.short, color: st.color, values };
  }).filter(Boolean);
  renderHourChart(document.getElementById('chartDelta'), { series: deltaSeries, dec: 1, unit: '°C', zeroLine: true, height: 220 });

  renderHourChart(document.getElementById('chartHum'), { series: mkSeries('h'), dec: 0, unit: '%', height: 200 });
  renderHourChart(document.getElementById('chartRad'), { series: mkSeries('r'), dec: 0, unit: 'W/m²', height: 200 });

  // ---- Tabla ----
  const tbody = document.querySelector('#dayTable tbody');
  tbody.innerHTML = '';
  for (const st of EXP_STATIONS) {
    const day = getDay(st.key, ymd);
    const tr = document.createElement('tr');
    if (st.rural) tr.className = 'is-rural';
    if (!day || !day.h) {
      tr.innerHTML = `<td><span class="st-name"><span class="dot" style="background:${st.color}"></span>${st.name}</span></td>` +
        '<td>—</td>'.repeat(9);
      tbody.appendChild(tr);
      continue;
    }
    const tAvg = day.all_avg != null ? day.all_avg : mean(day.h.t);
    const tMax = day.all_max != null ? day.all_max : maxOf(day.h.t);
    const tMin = day.all_min != null ? day.all_min : minOf(day.h.t);
    let dAvg = null;
    if (!st.rural && isla && isla.h) {
      const ds = [];
      for (let i = 0; i < 24; i++) if (day.h.t[i] != null && isla.h.t[i] != null) ds.push(day.h.t[i] - isla.h.t[i]);
      dAvg = mean(ds);
    }
    // Dirección predominante: media vectorial ponderada por velocidad
    let dSin = 0, dCos = 0, dW = 0;
    for (let i = 0; i < 24; i++) {
      if (day.h.d[i] != null && day.h.w[i] != null && day.h.w[i] > 0.1) {
        const rad = day.h.d[i] * Math.PI / 180;
        dSin += Math.sin(rad) * day.h.w[i]; dCos += Math.cos(rad) * day.h.w[i]; dW += day.h.w[i];
      }
    }
    const dir = dW > 0 ? ((Math.atan2(dSin, dCos) * 180 / Math.PI) + 360) % 360 : null;
    const covered = day.h.t.filter(x => x != null).length;
    const covPct = Math.round(covered / 24 * 100);

    const dCls = dAvg == null ? '' : (dAvg >= 0 ? 'delta-pos' : 'delta-neg');
    tr.innerHTML =
      `<td><span class="st-name"><span class="dot" style="background:${st.color}"></span>${st.name}</span></td>` +
      `<td>${fmt(tAvg, 1, '°')}</td><td>${fmt(tMax, 1, '°')}</td><td>${fmt(tMin, 1, '°')}</td>` +
      `<td class="${dCls}">${st.rural ? 'ref.' : fmtSigned(dAvg, 1)}</td>` +
      `<td>${fmt(mean(day.h.h), 0, '%')}</td><td>${fmt(maxOf(day.h.r), 0, '')}</td>` +
      `<td>${fmt(mean(day.h.w), 1, '')}</td><td>${dir != null ? degToCompassEs(dir) + ' · ' + Math.round(dir) + '°' : '—'}</td>` +
      `<td class="${covPct < 75 ? 'cov-low' : ''}">${covPct}%</td>`;
    tbody.appendChild(tr);
  }
}

// ============================================================
// SECCIÓN 2 — Comparar
// ============================================================
const CMP_COLOR_A = '#2C4B66', CMP_COLOR_B = '#E78D70';

function renderCompare() {
  const stKey = document.getElementById('cmpStation').value;
  const v = document.getElementById('cmpVar').value;
  const ymdA = document.getElementById('cmpDateA').value;
  const ymdB = document.getElementById('cmpDateB').value;
  if (!ymdA || !ymdB) return;
  const st = EXP_STATIONS.find(s => s.key === stKey);
  const meta = VAR_META[v];
  const dayA = getDay(stKey, ymdA), dayB = getDay(stKey, ymdB);

  document.getElementById('cmpTitle').textContent = meta.label + ' · ' + st.short;
  document.getElementById('cmpUnit').textContent = fmtDateEs(ymdA) + '  vs  ' + fmtDateEs(ymdB);

  renderHourChart(document.getElementById('chartCmp'), {
    series: [
      dayA && dayA.h && dayA.h[v] ? { label: fmtDateShort(ymdA), color: CMP_COLOR_A, values: dayA.h[v] } : null,
      dayB && dayB.h && dayB.h[v] ? { label: fmtDateShort(ymdB), color: CMP_COLOR_B, values: dayB.h[v], dash: '6 4' } : null
    ].filter(Boolean),
    dec: meta.dec, unit: meta.unit, height: 250
  });

  const stats = day => {
    if (!day || !day.h || !day.h[v]) return null;
    return { avg: mean(day.h[v]), max: maxOf(day.h[v]), min: minOf(day.h[v]) };
  };
  const A = stats(dayA), B = stats(dayB);
  const box = document.getElementById('cmpStats');
  const card = (label, swatch, s) =>
    `<div class="cmp-stat"><div class="cs-date"><span class="swatch" style="background:${swatch}"></span>${label}</div>` +
    `<div class="cs-vals">` +
    `<div><span class="cs-v">${s ? fmt(s.avg, meta.dec, '') : '—'}</span><span class="cs-l">Prom</span></div>` +
    `<div><span class="cs-v">${s ? fmt(s.max, meta.dec, '') : '—'}</span><span class="cs-l">Máx</span></div>` +
    `<div><span class="cs-v">${s ? fmt(s.min, meta.dec, '') : '—'}</span><span class="cs-l">Mín</span></div>` +
    `</div></div>`;
  let diffHtml = '<div class="cmp-stat cs-diff"><div class="cs-date">Diferencia A − B</div><div class="cs-vals">';
  for (const k of ['avg', 'max', 'min']) {
    const d = (A && B && A[k] != null && B[k] != null) ? A[k] - B[k] : null;
    const cls = d == null ? '' : (d >= 0 ? 'pos' : 'neg');
    diffHtml += `<div><span class="cs-v ${cls}">${d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(meta.dec)}</span>` +
      `<span class="cs-l">${{ avg: 'Prom', max: 'Máx', min: 'Mín' }[k]}</span></div>`;
  }
  diffHtml += '</div></div>';
  box.innerHTML = card('A · ' + fmtDateEs(ymdA), CMP_COLOR_A, A) + card('B · ' + fmtDateEs(ymdB), CMP_COLOR_B, B) + diffHtml;
}

// ============================================================
// SECCIÓN 3 — Consultas
// ============================================================
function listDays(fromYmd, toYmd) {
  const days = [];
  let d = fromYmd;
  while (d <= toYmd) { days.push(d); d = shiftYmd(d, 1); }
  return days;
}

function buildPeriodOptions() {
  const sel = document.getElementById('qPeriod');
  sel.innerHTML = '';
  const add = (val, label) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    sel.appendChild(o);
  };
  add('last7', 'Últimos 7 días');
  add('last30', 'Últimos 30 días');
  // Meses disponibles, descendente
  if (DATA_MIN && DATA_MAX) {
    let [y, m] = DATA_MAX.split('-').map(Number);
    const [y0, m0] = DATA_MIN.split('-').map(Number);
    while (y > y0 || (y === y0 && m >= m0)) {
      add('month:' + y + '-' + String(m).padStart(2, '0'), MESES_CAP[m - 1] + ' ' + y);
      m--; if (m === 0) { m = 12; y--; }
    }
  }
  add('all', 'Todo el histórico');
  add('custom', 'Rango personalizado…');
}

function resolvePeriod() {
  const val = document.getElementById('qPeriod').value;
  const today = todayYmd();
  if (val === 'last7') return [shiftYmd(today, -6), today];
  if (val === 'last30') return [shiftYmd(today, -29), today];
  if (val === 'all') return [DATA_MIN, DATA_MAX];
  if (val.startsWith('month:')) {
    const [y, m] = val.slice(6).split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
  }
  const a = document.getElementById('qDateA').value, b = document.getElementById('qDateB').value;
  return (a && b && a <= b) ? [a, b] : null;
}

function periodLabel() {
  const sel = document.getElementById('qPeriod');
  const opt = sel.options[sel.selectedIndex];
  if (sel.value === 'custom') {
    const r = resolvePeriod();
    return r ? 'del ' + fmtDateEs(r[0]) + ' al ' + fmtDateEs(r[1]) : '';
  }
  if (sel.value.startsWith('month:')) return 'en ' + opt.textContent.toLowerCase();
  return 'en ' + opt.textContent.toLowerCase();
}

function scopeStations() {
  const val = document.getElementById('qStation').value;
  if (val === '__all') return EXP_STATIONS;
  if (val === '__urban') return EXP_STATIONS.filter(s => s.urban);
  return EXP_STATIONS.filter(s => s.key === val);
}

// Valor diario de una estación para una variable (promedio de horas; temp máx/mín usan extremos crudos)
function dayValue(stKey, ymd, v, kind) {
  const day = getDay(stKey, ymd);
  if (!day || !day.h || !day.h[v]) return null;
  if (v === 't' && kind === 'max' && day.all_max != null) return day.all_max;
  if (v === 't' && kind === 'min' && day.all_min != null) return day.all_min;
  if (kind === 'max') return maxOf(day.h[v]);
  if (kind === 'min') return minOf(day.h[v]);
  if (v === 't' && day.all_avg != null) return day.all_avg;
  return mean(day.h[v]);
}

function runQuery() {
  const v = document.getElementById('qVar').value;
  const op = document.getElementById('qOp').value;
  const range = resolvePeriod();
  if (!range) return;
  const [from, to] = range;
  const days = listDays(from, to);
  const scope = scopeStations();
  const meta = VAR_META[v];
  const perLabel = periodLabel();

  const result = document.getElementById('qResult');
  const valueEl = document.getElementById('qrValue');
  const sentEl = document.getElementById('qrSentence');
  const rankEl = document.getElementById('qrRanking');
  const sparkTitle = document.getElementById('qrSparkTitle');
  const sparkUnit = document.getElementById('qrSparkUnit');
  const sparkHost = document.getElementById('chartQuery');
  result.hidden = false;

  const rankingHtml = (rows, dec, unit, signed) => {
    if (!rows.length) return '<div class="qr-rank-title">Sin datos</div>';
    const maxAbs = Math.max(...rows.map(r => Math.abs(r.v)));
    return '<div class="qr-rank-title">Por estación</div>' + rows.map(r =>
      `<div class="qr-row"><span class="qr-name">${r.st.short}</span>` +
      `<span class="qr-bar-track"><span class="qr-bar" style="width:${maxAbs ? Math.round(Math.abs(r.v) / maxAbs * 100) : 0}%;background:${r.st.color}"></span></span>` +
      `<span class="qr-num">${signed ? fmtSigned(r.v, dec) : fmt(r.v, dec, '')}</span></div>`).join('');
  };

  // ---------- Mayor Δ vs Isla ----------
  if (op === 'deltamax') {
    const best = { v: -Infinity };
    const perStation = new Map();
    const dailySeries = days.map(() => null);
    const cands = scope.filter(s => !s.rural);
    days.forEach((ymd, di) => {
      const isla = getDay('isla-maipo', ymd);
      if (!isla || !isla.h) return;
      for (const st of cands) {
        const day = getDay(st.key, ymd);
        if (!day || !day.h) continue;
        for (let i = 0; i < 24; i++) {
          if (day.h.t[i] == null || isla.h.t[i] == null) continue;
          const d = day.h.t[i] - isla.h.t[i];
          if (dailySeries[di] == null || d > dailySeries[di]) dailySeries[di] = Number(d.toFixed(2));
          if (!perStation.has(st.key) || d > perStation.get(st.key).v) perStation.set(st.key, { st, v: d });
          if (d > best.v) Object.assign(best, { v: d, st, ymd, hr: i });
        }
      }
    });
    if (best.v === -Infinity) {
      valueEl.textContent = '—';
      sentEl.textContent = 'No hay datos suficientes (se necesita la estación de referencia Isla de Maipo y al menos una urbana) ' + perLabel + '.';
      rankEl.innerHTML = ''; sparkHost.innerHTML = '';
      return;
    }
    valueEl.textContent = fmtSigned(best.v, 1);
    sentEl.innerHTML = `El mayor diferencial urbano-rural ${perLabel} fue <strong>${fmtSigned(best.v, 1)}</strong>: ` +
      `<strong>${best.st.name}</strong> sobre Isla de Maipo, el <strong>${fmtDateEs(best.ymd)}</strong> a las <strong>${String(best.hr).padStart(2, '0')}:00</strong>.`;
    rankEl.innerHTML = rankingHtml([...perStation.values()].sort((a, b) => b.v - a.v), 1, '°C', true);
    sparkTitle.textContent = 'Δ máximo diario (todas las estaciones del filtro)';
    sparkUnit.textContent = '°C vs Isla de Maipo';
    renderDailyChart(sparkHost, days, dailySeries, { dec: 1, unit: '°C', color: '#E78D70', mark: days.indexOf(best.ymd) });
    return;
  }

  // ---------- Días con máxima sobre 30° ----------
  if (op === 'over30') {
    const perStation = [];
    const dailyMax = days.map(ymd => maxOf(scope.map(st => dayValue(st.key, ymd, 't', 'max'))));
    for (const st of scope) {
      let n = 0;
      for (const ymd of days) {
        const m = dayValue(st.key, ymd, 't', 'max');
        if (m != null && m > 30) n++;
      }
      perStation.push({ st, v: n });
    }
    perStation.sort((a, b) => b.v - a.v);
    const top = perStation[0];
    const totalDays = days.filter((_, i) => dailyMax[i] != null && dailyMax[i] > 30).length;
    valueEl.textContent = scope.length === 1 ? top.v + ' días' : totalDays + ' días';
    sentEl.innerHTML = scope.length === 1
      ? `<strong>${top.st.name}</strong> superó los 30° en <strong>${top.v}</strong> día${top.v === 1 ? '' : 's'} ${perLabel}.`
      : `${perLabel.replace(/^en /, 'En ').replace(/^del /, 'Del ')}, alguna estación del filtro superó los 30° en <strong>${totalDays}</strong> día${totalDays === 1 ? '' : 's'}. ` +
        (top.v > 0 ? `La que más: <strong>${top.st.name}</strong> (${top.v} días).` : '');
    rankEl.innerHTML = rankingHtml(perStation, 0, 'días', false);
    sparkTitle.textContent = 'Temperatura máxima diaria';
    sparkUnit.textContent = '°C · máx del filtro';
    const peak = dailyMax.reduce((best, v, i) => (v != null && (best < 0 || v > dailyMax[best])) ? i : best, -1);
    renderDailyChart(sparkHost, days, dailyMax, { dec: 1, unit: '°C', color: '#C26A50', mark: peak });
    return;
  }

  // ---------- Promedio / Máximo / Mínimo ----------
  const kind = op === 'avg' ? 'avg' : op;
  const perStation = [];
  for (const st of scope) {
    const vals = days.map(ymd => dayValue(st.key, ymd, v, kind === 'avg' ? 'avg' : kind)).filter(x => x != null);
    if (!vals.length) continue;
    let agg, extreme = null;
    if (kind === 'avg') agg = mean(vals);
    else {
      agg = kind === 'max' ? Math.max(...vals) : Math.min(...vals);
      const allVals = days.map(ymd => dayValue(st.key, ymd, v, kind));
      const idx = allVals.findIndex(x => x === agg);
      if (idx >= 0) extreme = days[idx];
    }
    perStation.push({ st, v: agg, ymd: extreme });
  }
  perStation.sort((a, b) => kind === 'min' ? a.v - b.v : b.v - a.v);

  if (!perStation.length) {
    valueEl.textContent = '—';
    sentEl.textContent = 'No hay datos para esa combinación ' + perLabel + '.';
    rankEl.innerHTML = ''; sparkHost.innerHTML = '';
    return;
  }

  const top = perStation[0];
  const opName = { avg: 'promedio', max: 'máximo', min: 'mínimo' }[kind];
  if (kind === 'avg') {
    const overall = mean(perStation.map(r => r.v));
    valueEl.textContent = fmt(overall, meta.dec, ' ' + meta.unit);
    sentEl.innerHTML = scope.length === 1
      ? `${meta.label} promedio de <strong>${top.st.name}</strong> ${perLabel}: <strong>${fmt(top.v, meta.dec, ' ' + meta.unit)}</strong>.`
      : `${meta.label} promedio del filtro ${perLabel}: <strong>${fmt(overall, meta.dec, ' ' + meta.unit)}</strong>. ` +
        `La más alta: <strong>${top.st.name}</strong> (${fmt(top.v, meta.dec, ' ' + meta.unit)}); ` +
        `la más baja: <strong>${perStation[perStation.length - 1].st.name}</strong> (${fmt(perStation[perStation.length - 1].v, meta.dec, ' ' + meta.unit)}).`;
  } else {
    valueEl.textContent = fmt(top.v, meta.dec, ' ' + meta.unit);
    sentEl.innerHTML = `${meta.label} ${opName} ${perLabel}: <strong>${fmt(top.v, meta.dec, ' ' + meta.unit)}</strong>` +
      ` en <strong>${top.st.name}</strong>` + (top.ymd ? `, el <strong>${fmtDateEs(top.ymd)}</strong>.` : '.');
  }
  rankEl.innerHTML = rankingHtml(perStation, meta.dec, meta.unit, false);

  // Spark: serie diaria del top (o de la única estación)
  const sparkSt = top.st;
  const series = days.map(ymd => dayValue(sparkSt.key, ymd, v, kind === 'avg' ? 'avg' : kind));
  sparkTitle.textContent = (kind === 'avg' ? meta.label + ' media diaria · ' : meta.label + ' ' + opName + ' diario · ') + sparkSt.short;
  sparkUnit.textContent = meta.unit;
  let markIdx = null;
  if (kind !== 'avg' && top.ymd) markIdx = days.indexOf(top.ymd);
  renderDailyChart(sparkHost, days, series, { dec: meta.dec, unit: meta.unit, color: sparkSt.color, mark: markIdx });
}

// ============================================================
// Init
// ============================================================
function buildStationChips() {
  const box = document.getElementById('stationChips');
  for (const st of EXP_STATIONS) {
    const b = document.createElement('button');
    b.className = 'st-chip';
    b.style.setProperty('--dot', st.color);
    b.innerHTML = `<span class="dot"></span>${st.short}`;
    b.title = st.name;
    b.addEventListener('click', () => {
      if (SELECTED.has(st.key)) {
        if (SELECTED.size === 1) return; // siempre al menos una
        SELECTED.delete(st.key); b.classList.add('off');
      } else {
        SELECTED.add(st.key); b.classList.remove('off');
      }
      if (currentDay) renderDayView(currentDay);
    });
    box.appendChild(b);
  }
}

function buildStationSelects() {
  const cmp = document.getElementById('cmpStation');
  const q = document.getElementById('qStation');
  for (const st of EXP_STATIONS) {
    cmp.insertAdjacentHTML('beforeend', `<option value="${st.key}">${st.name}</option>`);
  }
  q.insertAdjacentHTML('beforeend', '<option value="__all">Todas las estaciones</option>');
  q.insertAdjacentHTML('beforeend', '<option value="__urban">Las 4 urbanas</option>');
  for (const st of EXP_STATIONS) {
    q.insertAdjacentHTML('beforeend', `<option value="${st.key}">${st.name}</option>`);
  }
}

async function init() {
  buildStationChips();
  buildStationSelects();

  await loadAll();

  const today = todayYmd();
  const startDay = DATA_MAX && DATA_MAX <= today ? DATA_MAX : today;
  const dia = document.getElementById('diaInput');
  dia.min = DATA_MIN || '';
  dia.max = today;

  document.getElementById('introRange').textContent = DATA_MIN
    ? fmtDateEs(DATA_MIN) + ' → hoy, 7 estaciones'
    : 'no se pudieron cargar los datos (¿estás abriendo el archivo localmente? serví la página por http)';

  // Sección 1
  dia.addEventListener('change', () => { if (dia.value) renderDayView(dia.value); });
  document.getElementById('diaPrev').addEventListener('click', () => renderDayView(shiftYmd(currentDay, -1)));
  document.getElementById('diaNext').addEventListener('click', () => {
    const next = shiftYmd(currentDay, 1);
    if (next <= today) renderDayView(next);
  });
  document.querySelectorAll('.date-quick .chip').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.quick;
    renderDayView(q === 'hoy' ? today : q === 'ayer' ? shiftYmd(today, -1) : shiftYmd(today, -7));
  }));

  // Sección 2
  const cmpA = document.getElementById('cmpDateA'), cmpB = document.getElementById('cmpDateB');
  cmpA.min = cmpB.min = DATA_MIN || ''; cmpA.max = cmpB.max = today;
  cmpA.value = shiftYmd(startDay, -1);
  cmpB.value = startDay;
  ['cmpStation', 'cmpVar', 'cmpDateA', 'cmpDateB'].forEach(id =>
    document.getElementById(id).addEventListener('change', renderCompare));

  // Sección 3
  buildPeriodOptions();
  const qPeriod = document.getElementById('qPeriod');
  const qA = document.getElementById('qDateA'), qB = document.getElementById('qDateB');
  qA.min = qB.min = DATA_MIN || ''; qA.max = qB.max = today;
  qA.value = DATA_MIN || ''; qB.value = today;
  qPeriod.addEventListener('change', () => {
    const custom = qPeriod.value === 'custom';
    document.getElementById('qCustomA').hidden = !custom;
    document.getElementById('qCustomB').hidden = !custom;
  });
  document.getElementById('qGo').addEventListener('click', runQuery);

  await renderDayView(startDay);
  renderCompare();
}

init();
