function scale() {
  const d = document.getElementById('dashboard');
  const w = window.innerWidth;
  const h = window.innerHeight;
  // <1200px (tablet/móvil): CSS hace reflow real, sin scale
  if (w < 1200) {
    d.style.transform = '';
    return;
  }
  // ≥1200px (laptop/TV): scale para encajar el layout fijo 1920x1080
  const s = Math.min(w / 1920, h / 1080);
  d.style.transform = `scale(${s})`;
}
window.addEventListener('resize', scale);
scale();

function setView(v, e) {
  document.body.className = v === 'all' ? '' : 'view-' + v;
  document.querySelectorAll('.toggle-bar button').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  scale();
}

// ============================================================
// Heatmaps — 4 vistas: Anual (Δ U-R) / Mañana / Tarde / Noche
// ============================================================

const today = (function(){const d=new Date();d.setHours(0,0,0,0);return d;})();
const yearStart = new Date(today.getFullYear(), 0, 1);

// Populated by Phase 2D fetchAllYearHistory(); declared early to avoid TDZ on regenerateAllHeatmaps/renderUptimeBars
let YEAR_DATA = {};
let CURRENT_ACTIVE_STATIONS = new Set(); // station IDs whose last reading is within 60 min
const jan1Day = yearStart.getDay();
const startMonday = new Date(yearStart);
startMonday.setDate(yearStart.getDate() - (jan1Day === 0 ? 6 : jan1Day - 1));

function deltaColor(delta) {
  // Divergent palette: -5° (cold, rural warmer) → 0° (neutral) → +5° (urban heat island)
  if (delta < -3) return '#3E647A';   // deep blue
  if (delta < -1.5) return '#7DA6BB'; // mid blue
  if (delta < -0.5) return '#B4D4E0'; // pale blue
  if (delta < 0.5) return '#F4F4F4';  // neutral
  if (delta < 2) return '#F8E0CE';
  if (delta < 3.5) return '#F8BC7E';
  if (delta < 4.5) return '#E78D70';
  return '#D26852';
}

function tempColor(t, min, max) {
  if (t == null) return 'rgba(44,75,102,0.04)';
  const r = Math.max(0, Math.min(1, (t - min) / (max - min)));
  // navy-teal-sage-peach-coral ramp
  const stops = [
    [0.00, [137, 184, 188]], // teal
    [0.30, [146, 178, 148]], // sage
    [0.60, [248, 188, 126]], // peach
    [1.00, [231, 141, 112]], // coral
  ];
  for (let i = 1; i < stops.length; i++) {
    if (r <= stops[i][0]) {
      const a = stops[i-1], b = stops[i];
      const k = (r - a[0]) / (b[0] - a[0]);
      const c = a[1].map((v, j) => Math.round(v + (b[1][j] - v) * k));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(${stops[stops.length-1][1].join(',')})`;
}

// View metadata (label, title, legend, scale, dataFn)
const VIEWS = {
  anual: {
    id: 'heatmap',
    label: 'Calendario climático · 2026',
    title: 'Δ Urbano-Rural diario · {S} − Isla de Maipo',
    legend: ['−5°', '+5°'],
    fn: (doy, seed, rnd) => {
      const r = rnd ? rnd() : Math.random();
      const seasonal = 1 + 2 * Math.cos((doy - 15) / 365 * 2 * Math.PI) + (seed || 0) * 0.5;
      const v = seasonal + (r - 0.5) * 2.4;
      return deltaColor(v);
    }
  },
  manana: {
    id: 'heatmap-manana',
    label: 'Promedio de mañana · 06:00 – 12:00',
    title: 'Temperatura matinal · {S}',
    legend: ['0°', '32°'],
    fn: (doy, seed, rnd) => {
      const r = rnd ? rnd() : Math.random();
      const t = 13 + (seed || 0) + 8 * Math.cos((doy - 15) / 365 * 2 * Math.PI) + (r - 0.5) * 2.5;
      return tempColor(t, 0, 32);
    }
  },
  tarde: {
    id: 'heatmap-tarde',
    label: 'Promedio de tarde · 12:00 – 18:00',
    title: 'Temperatura vespertina · {S}',
    legend: ['0°', '32°'],
    fn: (doy, seed, rnd) => {
      const r = rnd ? rnd() : Math.random();
      const t = 22 + (seed || 0) + 8 * Math.cos((doy - 15) / 365 * 2 * Math.PI) + (r - 0.5) * 3;
      return tempColor(t, 0, 32);
    }
  },
  noche: {
    id: 'heatmap-noche',
    label: 'Promedio de noche · 18:00 – 06:00',
    title: 'Temperatura nocturna · {S}',
    legend: ['0°', '32°'],
    fn: (doy, seed, rnd) => {
      const r = rnd ? rnd() : Math.random();
      const t = 10 + (seed || 0) + 6 * Math.cos((doy - 15) / 365 * 2 * Math.PI) + (r - 0.5) * 2;
      return tempColor(t, 0, 32);
    }
  }
};

function generateHeatmap(view) {
  const container = document.getElementById(view.id);
  if (!container || container.dataset.generated) return;
  for (let w = 0; w < 52; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(startMonday);
      date.setDate(startMonday.getDate() + w * 7 + d);
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (date.getFullYear() !== 2026 || date > today) {
        cell.style.background = 'rgba(44,75,102,0.04)';
      } else {
        const doy = (date - yearStart) / (1000*60*60*24);
        cell.style.background = view.fn(doy);
      }
      container.appendChild(cell);
    }
  }
  container.dataset.generated = '1';
}

Object.values(VIEWS).forEach(generateHeatmap);

// Tab switching + auto-rotate
const tabs = document.querySelectorAll('.hm-tab');
const panels = document.querySelectorAll('[data-view-content]');
const labelEl = document.getElementById('hm-current-label');
const titleEl = document.getElementById('hm-current-title');
const legendMin = document.getElementById('hm-legend-min');
const legendMax = document.getElementById('hm-legend-max');

function setActiveView(name) {
  const v = VIEWS[name];
  if (!v) return;
  tabs.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  panels.forEach(p => p.hidden = (p.dataset.viewContent !== name));
  labelEl.textContent = v.label;
  titleEl.textContent = v.title;
  legendMin.textContent = v.legend[0];
  legendMax.textContent = v.legend[1];
}

tabs.forEach(b => b.addEventListener('click', () => {
  stopRotate();
  setActiveView(b.dataset.view);
}));

// Auto-rotate among the 3 time-of-day views every 10s (only on TV-size viewports)
const ROTATE_VIEWS = ['manana', 'tarde', 'noche'];
let rotateIdx = 0;
let rotateTimer = null;
function startRotate() {
  if (window.innerWidth < 1600) return; // laptop: manual only
  rotateTimer = setInterval(() => {
    rotateIdx = (rotateIdx + 1) % ROTATE_VIEWS.length;
    setActiveView(ROTATE_VIEWS[rotateIdx]);
  }, 10000);
}
function stopRotate() {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
}
// startRotate(); // habilitar cuando se prefiera auto-rotación en TV




// ============================================================
// Uptime bars per station (yearly continuity) — placeholder data
// Reemplazar en Phase 2B con cobertura real desde ThingSpeak
// ============================================================

// Solar-powered stations tend to have more night/battery gaps.
const STATION_PROFILE = {
  providencia: { gapRate: 0.012, solar: false },
  stgocentro:  { gapRate: 0.018, solar: false },
  renca:       { gapRate: 0.072, solar: true  },
  cerrillos:   { gapRate: 0.064, solar: true  },
  sancarlos:   { gapRate: 0.022, solar: false },
  chamisero:   { gapRate: 0.028, solar: false },
  isla:        { gapRate: 0.015, solar: false }
};

function renderUptimeBars() {
  const todayDoy = Math.floor((today - yearStart) / (1000 * 60 * 60 * 24));
  const NS = 'http://www.w3.org/2000/svg';
  const hasRealData = typeof YEAR_DATA === 'object' && Object.keys(YEAR_DATA).length > 0;

  document.querySelectorAll('.sc-uptime').forEach(box => {
    const stationKey = box.dataset.station;
    const svg = box.querySelector('.sc-uptime-svg');
    const pctEl = box.querySelector('.sc-uptime-pct strong');
    if (!svg) return;
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.innerHTML = '';
    const sd = hasRealData ? YEAR_DATA[stationKey] : null;
    let total = 0, covered = 0;

    // Future days as one continuous rect
    if (todayDoy < 364) {
      const future = document.createElementNS(NS, 'rect');
      future.setAttribute('x', todayDoy + 1);
      future.setAttribute('y', 0);
      future.setAttribute('width', 365 - todayDoy - 1);
      future.setAttribute('height', 6);
      future.setAttribute('fill', 'rgba(44,75,102,0.06)');
      svg.appendChild(future);
    }
    // Past days
    for (let d = 0; d <= todayDoy; d++) {
      const date = new Date(yearStart);
      date.setDate(yearStart.getDate() + d);
      const ymd = dateToYMD(date);
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', d);
      rect.setAttribute('y', 0);
      rect.setAttribute('width', 1.05);
      rect.setAttribute('height', 6);
      let color;
      total++;

      if (sd && Object.keys(sd).length > 0) {
        const day = sd[ymd];
        const n = day ? (day.all_n || 0) : 0;
        if (n === 0) {
          color = 'rgba(123,138,153,0.32)'; // gris = sin datos
        } else if (n < 6) {
          color = 'rgba(44,75,102,0.55)';   // navy semi = parcial
          covered++;
        } else {
          color = '#2C4B66';                // navy = completo
          covered++;
        }
      } else {
        // No hay datos cargados todavía → gris (determinista, sin Math.random)
        color = 'rgba(123,138,153,0.18)';
      }
      rect.setAttribute('fill', color);
      svg.appendChild(rect);
    }
    if (pctEl && total > 0) {
      const pct = Math.round((covered / total) * 100);
      pctEl.textContent = pct + '%';
      pctEl.classList.toggle('warn', pct < 92);
      pctEl.classList.toggle('ok', pct >= 95);
    }
  });
}
renderUptimeBars();

// ============================================================
// Network pill status updater
// Llamar updateNetStatus(['renca', 'chamisero']) cuando haya offline
// ============================================================
function updateNetStatus(offlineList = []) {
  const pill = document.getElementById('netPill');
  const text = document.getElementById('netPillText');
  const off = document.getElementById('netOffline');
  if (!pill) return;
  const total = 7;
  const active = total - offlineList.length;
  text.textContent = `${active}/${total} Estaciones activas`;
  if (offlineList.length === 0) {
    pill.dataset.status = 'ok';
    off.hidden = true;
    off.textContent = '';
  } else {
    pill.dataset.status = 'warn';
    off.hidden = false;
    const names = offlineList.map(k => ({
      providencia: 'Providencia', stgocentro: 'Stgo. Centro',
      renca: 'Renca', cerrillos: 'Cerrillos', sancarlos: 'San Carlos',
      chamisero: 'Chamisero', isla: 'Isla de Maipo'
    }[k] || k)).join(' · ');
    off.textContent = '· ' + names + (offlineList.length === 1 ? ' offline' : ' offline');
  }
}
updateNetStatus([]); // por defecto todas activas; cambiará desde fetchAllStations en Phase 2B


// ============================================================
// INTERACTIVE BOTTOM ROW — click station card to switch view
// ============================================================

const STATION_DATA = {
  __avg: {
    name: 'Promedio 4 urbanas',
    deltaSubtitle: 'Promedio 4 urbanas − Isla de Maipo',
    deltaBig: '+4.5°C',
    deltaNow: '+4.5°', deltaAvg: '+3.4°', deltaMax: '+7.2°',
    seed: 0,
    seasons: { verano: ['22.8°', '24', '+5.2°'], otono: ['17.9°', '12', '+3.8°'] }
  },
  providencia: {
    name: 'Providencia',
    deltaSubtitle: 'Providencia − Isla de Maipo',
    deltaBig: '+5.2°C',
    deltaNow: '+5.2°', deltaAvg: '+3.8°', deltaMax: '+8.1°',
    seed: 1.2,
    seasons: { verano: ['23.4°', '28', '+5.8°'], otono: ['18.4°', '14', '+4.2°'] }
  },
  stgocentro: {
    name: 'Centro',
    deltaSubtitle: 'Centro − Isla de Maipo',
    deltaBig: '+6.1°C',
    deltaNow: '+6.1°', deltaAvg: '+4.2°', deltaMax: '+9.0°',
    seed: 2.1,
    seasons: { verano: ['24.0°', '32', '+6.4°'], otono: ['19.0°', '18', '+4.8°'] }
  },
  renca: {
    name: 'Renca',
    deltaSubtitle: 'Renca − Isla de Maipo',
    deltaBig: '+5.6°C',
    deltaNow: '+5.6°', deltaAvg: '+3.9°', deltaMax: '+8.5°',
    seed: 1.6,
    seasons: { verano: ['23.6°', '29', '+6.0°'], otono: ['18.6°', '15', '+4.4°'] }
  },
  cerrillos: {
    name: 'Cerrillos',
    deltaSubtitle: 'Cerrillos − Isla de Maipo',
    deltaBig: '+6.4°C',
    deltaNow: '+6.4°', deltaAvg: '+4.5°', deltaMax: '+9.3°',
    seed: 2.4,
    seasons: { verano: ['24.3°', '33', '+6.7°'], otono: ['19.2°', '19', '+5.0°'] }
  },
  sancarlos: {
    name: 'Apoquindo',
    deltaSubtitle: 'Apoquindo − Isla de Maipo',
    deltaBig: '+2.1°C',
    deltaNow: '+2.1°', deltaAvg: '+1.4°', deltaMax: '+4.3°',
    seed: -1.5,
    seasons: { verano: ['20.5°', '15', '+2.8°'], otono: ['16.0°', '6', '+2.0°'] }
  },
  chamisero: {
    name: 'Chamisero',
    deltaSubtitle: 'Chamisero − Isla de Maipo',
    deltaBig: '+1.4°C',
    deltaNow: '+1.4°', deltaAvg: '+0.9°', deltaMax: '+3.2°',
    seed: -2.2,
    seasons: { verano: ['19.6°', '11', '+2.0°'], otono: ['15.2°', '3', '+1.4°'] }
  },
  isla: {
    name: 'Isla de Maipo',
    deltaSubtitle: 'Isla de Maipo (referencia rural)',
    deltaBig: '0°C',
    deltaNow: '0°', deltaAvg: '0°', deltaMax: '0°',
    seed: -3,
    seasons: { verano: ['18.4°', '7', '0°'], otono: ['14.3°', '1', '0°'] }
  }
};

let activeStation = '__avg';

// Seeded PRNG for reproducible randomness per station
function mulberry32(s) {
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function regenerateAllHeatmaps() {
  const hasRealData = typeof YEAR_DATA === 'object' && Object.keys(YEAR_DATA).length > 0;
  const GRAY_FUTURE = 'rgba(44,75,102,0.04)';
  const GRAY_NODATA = 'rgba(123,138,153,0.22)';
  const YEAR = today.getFullYear();

  Object.entries(VIEWS).forEach(([viewKey, view]) => {
    const container = document.getElementById(view.id);
    if (!container) return;
    container.innerHTML = '';
    container.dataset.generated = '';
    const stationSeed = (STATION_DATA[activeStation] || {}).seed || 0;
    const rnd = mulberry32(Math.floor(stationSeed * 1000) + view.id.length);

    for (let w = 0; w < 52; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(startMonday);
        date.setDate(startMonday.getDate() + w * 7 + d);
        const cell = document.createElement('div');
        cell.className = 'cell';

        if (date.getFullYear() !== YEAR || date > today) {
          cell.style.background = GRAY_FUTURE;
        } else if (hasRealData) {
          const ymd = dateToYMD(date);
          const v = dayValueFor(activeStation, ymd, viewKey);
          if (v == null) {
            cell.style.background = GRAY_NODATA;
          } else if (viewKey === 'anual') {
            const isla = YEAR_DATA.isla && YEAR_DATA.isla[ymd];
            const islaV = isla && isla.all_avg;
            if (islaV == null) cell.style.background = GRAY_NODATA;
            else cell.style.background = deltaColor(v - islaV);
          } else {
            cell.style.background = tempColor(v, 0, 32);
          }
        } else {
          // Fallback to placeholder while year data loads
          const doy = (date - yearStart) / (1000*60*60*24);
          cell.style.background = view.fn(doy, stationSeed, rnd);
        }
        container.appendChild(cell);
      }
    }
  });
  refreshHeatmapHeader();
}

function refreshHeatmapHeader() {
  const v = VIEWS[activeView];
  const s = STATION_DATA[activeStation];
  labelEl.textContent = v.label;
  titleEl.textContent = (v.title || '').replace('{S}', s.name);
  legendMin.textContent = v.legend[0];
  legendMax.textContent = v.legend[1];
}

let activeView = 'anual';
const _origSetActiveView = setActiveView;
setActiveView = function(name) {
  const v = VIEWS[name];
  if (!v) return;
  activeView = name;
  tabs.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  panels.forEach(p => p.hidden = (p.dataset.viewContent !== name));
  refreshHeatmapHeader();
};

function setActiveStation(key) {
  if (!STATION_DATA[key]) return;
  activeStation = key;
  const d = STATION_DATA[key];

  // Update delta card
  const dst = document.getElementById('delta-subtitle');
  const dbg = document.getElementById('delta-big');
  if (dst) dst.textContent = d.deltaSubtitle;
  if (dbg) dbg.textContent = d.deltaBig;
  ['delta-now','delta-avg','delta-max'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = [d.deltaNow, d.deltaAvg, d.deltaMax][i];
  });
  const maxLbl = document.getElementById('delta-max-label');
  if (maxLbl) maxLbl.textContent = 'Máx ' + (d.deltaMaxHour || '—');

  // Update resumen label
  const rs = document.getElementById('resumen-station');
  if (rs) rs.textContent = d.name;

  // Update season-row stats (Verano + Otoño rows have data; others "próximo")
  const rows = document.querySelectorAll('.stats-card .season-row');
  const seasonKeys = ['verano', 'otono', 'invierno', 'primavera'];
  rows.forEach((row, i) => {
    const sk = seasonKeys[i];
    const data = d.seasons && d.seasons[sk];
    const stats = row.querySelectorAll('.season-stat .v');
    const upcomingMsg = row.querySelector('.season-stats.upcoming');
    if (data && Array.isArray(data) && stats.length >= 3) {
      // Replace upcoming-message if it exists with actual stats
      if (upcomingMsg) upcomingMsg.outerHTML = '<div class="season-stats"><div class="season-stat"><span class="v">' + data[0] + '</span><span class="l">PROM</span></div><div class="season-stat"><span class="v">' + data[1] + '<span class="u">d</span></span><span class="l">&gt;28°</span></div><div class="season-stat"><span class="v">' + data[2] + '</span><span class="l">ΔU-R</span></div></div>';
      else {
        stats[0].textContent = data[0];
        stats[1].innerHTML = data[1] + '<span class="u">d</span>';
        stats[2].textContent = data[2];
      }
    }
  });

  // Highlight active station card
  document.querySelectorAll('.station-card').forEach(c => {
    c.classList.toggle('active-station', c.dataset.stationKey === key);
  });

  // Regenerate heatmaps + Δ chart with this station's seed
  regenerateAllHeatmaps();
  renderDeltaChart();
}

// ============================================================
// Resumen por estación — compute real season stats from YEAR_DATA
// Seasons in southern hemisphere:
//   Verano:    Dec-Jan-Feb     (months 11, 0, 1)
//   Otoño:     Mar-Apr-May     (2, 3, 4)
//   Invierno:  Jun-Jul-Aug     (5, 6, 7)
//   Primavera: Sep-Oct-Nov     (8, 9, 10)
// ============================================================

const SEASON_MONTHS = {
  verano:    [11, 0, 1],
  otono:     [2, 3, 4],
  invierno:  [5, 6, 7],
  primavera: [8, 9, 10]
};

function computeSeasonStatsForStation(stationKey) {
  // Returns { verano: [prom, days>28, deltaUR], otono: [...], invierno: [...], primavera: [...] }
  // Each value is a string '—' if no data.
  const out = { verano: null, otono: null, invierno: null, primavera: null };
  if (!YEAR_DATA) return out;
  const sd = (stationKey === '__avg')
    ? null
    : YEAR_DATA[stationKey];
  const isla = YEAR_DATA.isla;

  for (const seasonName of Object.keys(SEASON_MONTHS)) {
    const months = SEASON_MONTHS[seasonName];
    let temps = [], deltas = [], over28 = 0;

    function collectFor(byDay) {
      Object.entries(byDay).forEach(([ymd, day]) => {
        const d = new Date(ymd);
        if (!months.includes(d.getMonth())) return;
        if (day.all_avg == null) return;
        temps.push(day.all_avg);
        if (day.all_avg > 28) over28++;
        const islaDay = isla && isla[ymd];
        if (islaDay && islaDay.all_avg != null) deltas.push(day.all_avg - islaDay.all_avg);
      });
    }

    if (stationKey === '__avg') {
      // Avg of 4 urbans → for each day, compute avg of urban stations
      const urbans = ['providencia', 'stgocentro', 'renca', 'cerrillos'];
      const allDays = new Set();
      urbans.forEach(u => YEAR_DATA[u] && Object.keys(YEAR_DATA[u]).forEach(d => allDays.add(d)));
      for (const ymd of allDays) {
        const d = new Date(ymd);
        if (!months.includes(d.getMonth())) continue;
        const dayTemps = urbans.map(u => YEAR_DATA[u] && YEAR_DATA[u][ymd] && YEAR_DATA[u][ymd].all_avg).filter(t => t != null);
        if (dayTemps.length === 0) continue;
        const avg = dayTemps.reduce((a,c)=>a+c,0) / dayTemps.length;
        temps.push(avg);
        if (avg > 28) over28++;
        const islaDay = isla && isla[ymd];
        if (islaDay && islaDay.all_avg != null) deltas.push(avg - islaDay.all_avg);
      }
    } else if (sd) {
      collectFor(sd);
    }

    if (temps.length === 0) {
      out[seasonName] = null;
    } else {
      const prom = temps.reduce((a,c)=>a+c, 0) / temps.length;
      const dUR = deltas.length ? deltas.reduce((a,c)=>a+c, 0) / deltas.length : null;
      out[seasonName] = [
        prom.toFixed(1) + '°',
        String(over28),
        dUR != null ? (dUR >= 0 ? '+' : '') + dUR.toFixed(1) + '°' : '—'
      ];
    }
  }
  return out;
}

function applyComputedSeasons() {
  Object.keys(STATION_DATA).forEach(key => {
    const s = computeSeasonStatsForStation(key);
    if (!STATION_DATA[key].seasons) STATION_DATA[key].seasons = {};
    Object.keys(s).forEach(season => {
      if (s[season]) STATION_DATA[key].seasons[season] = s[season];
    });
  });
}

// ============================================================
// Per-station condition icon (Niebla/Nublado/Parcial/Soleado/Ola Calor/Noche)
// ============================================================

const CONDITION_ICONS = {
  'soleado':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.25"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/><line x1="5.5" y1="5.5" x2="7" y2="7"/><line x1="17" y1="17" x2="18.5" y2="18.5"/><line x1="5.5" y1="18.5" x2="7" y2="17"/><line x1="17" y1="7" x2="18.5" y2="5.5"/></svg>',
  'parcial':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="16" cy="7" r="3.5" fill="currentColor" fill-opacity="0.6"/><line x1="16" y1="1" x2="16" y2="3"/><line x1="22" y1="7" x2="23" y2="7"/><line x1="20" y1="3" x2="21" y2="2"/><line x1="20" y1="11" x2="21" y2="12"/><path d="M3,19 a3.5,3.5 0 0 1 0,-7 a4.5,4.5 0 0 1 9,0 a3.5,3.5 0 0 1 0,7 Z" fill="currentColor" fill-opacity="0.3"/></svg>',
  'nublado':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6,18 a4,4 0 0 1 0,-8 a5,5 0 0 1 10,0 a4,4 0 0 1 0,8 Z" fill="currentColor" fill-opacity="0.18"/></svg>',
  'niebla':   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="9" x2="21" y2="9"/><line x1="5" y1="13" x2="19" y2="13"/><line x1="3" y1="17" x2="17" y2="17"/></svg>',
  'ola-calor':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="9" cy="10" r="2.5" fill="currentColor" fill-opacity="0.4"/><line x1="9" y1="3" x2="9" y2="5"/><line x1="3" y1="10" x2="5" y2="10"/><line x1="13" y1="10" x2="15" y2="10"/><path d="M19 6 v10 a2,2 0 0 1 -4,0 v-10 Z" fill="currentColor" fill-opacity="0.6"/></svg>',
  'noche':    '<svg viewBox="0 0 24 24" fill="none"><path d="M16 4 A9 9 0 1 0 19 17 A7.5 7.5 0 0 1 16 4 Z" fill="#F4E2A5" stroke="currentColor" stroke-width="1.2"/></svg>'
};

function setStationConditionIcon(card, cond) {
  let el = card.querySelector('.sc-cond');
  if (!el) {
    el = document.createElement('div');
    el.className = 'sc-cond';
    const header = card.querySelector('.sc-header');
    if (!header) { console.warn('[cond] no .sc-header in card', card); return; }
    header.insertBefore(el, header.firstChild);
  }
  if (!cond) {
    el.dataset.cond = 'none';
    el.innerHTML = '';
    el.style.opacity = '0.3';
    return;
  }
  el.style.opacity = '1';
  el.dataset.cond = cond;
  el.innerHTML = CONDITION_ICONS[cond] || '';
}

function applyStationConditions(allCurrent) {
  if (!allCurrent) return;
  const hour = new Date().getHours();
  const isNight = hour >= 19 || hour < 6;
  for (const [stationId, cardClass] of Object.entries(STATION_CARD_CLASS)) {
    const d = allCurrent[stationId];
    const card = document.querySelector('.station-card.' + cardClass);
    if (!card) continue;
    if (!d || d.error) { setStationConditionIcon(card, null); continue; }
    let cond;
    if (isNight) {
      if (d.humidity != null && d.humidity >= 88) cond = 'niebla';
      else if (d.humidity != null && d.humidity >= 75) cond = 'nublado';
      else cond = 'noche';
    } else {
      cond = classifyCondition({ temp: d.temp, humidity: d.humidity, radHoriz: d.radHoriz, hour });
    }
    setStationConditionIcon(card, cond);
  }
}

// ============================================================
// Δ Urbano-Rural — recompute from real data (Phase 2B current + Phase 2C history)
// Replaces the hardcoded placeholders in STATION_DATA
// ============================================================
let LATEST_CURRENT = null;   // result of fetchAllStations()
let LATEST_HISTORY = null;   // result of fetchAllHistory()

const _stationIdMap = {
  providencia: 'providencia',
  stgocentro:  'stgo-centro',
  renca:       'renca',
  cerrillos:   'cerrillos',
  sancarlos:   'san-carlos',
  chamisero:   'chamisero',
  isla:        'isla-maipo'
};

function _fmtDelta(v) {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
}
function _fmtDeltaBig(v) {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '°C';
}

// ============================================================
// Δ Chart — draw today's hourly deltas (station - isla)
// ============================================================
function renderDeltaChart() {
  const g = document.getElementById('delta-chart-paths');
  if (!g) return;
  const stationKey = activeStation;
  const stationId = ({
    providencia: 'providencia',
    stgocentro:  'stgo-centro',
    renca:       'renca',
    cerrillos:   'cerrillos',
    sancarlos:   'san-carlos',
    chamisero:   'chamisero',
    isla:        'isla-maipo'
  })[stationKey];

  if (!LATEST_HISTORY) { g.innerHTML = ''; return; }
  const islaHist = LATEST_HISTORY['isla-maipo'];
  if (!islaHist || islaHist.error) { g.innerHTML = ''; return; }

  // Build series of hourly deltas (station|avg - isla) up to 24 points
  let series = [];
  if (stationKey === '__avg') {
    const urbanIds = ['providencia', 'stgo-centro', 'renca', 'cerrillos'];
    for (let i = 0; i < 24; i++) {
      const il = islaHist.hourlyAvg[i] && islaHist.hourlyAvg[i].temp;
      if (il == null) continue;
      const urbanTemps = urbanIds.map(id => {
        const h = LATEST_HISTORY[id];
        return h && h.hourlyAvg && h.hourlyAvg[i] && h.hourlyAvg[i].temp;
      }).filter(t => t != null);
      if (urbanTemps.length === 0) continue;
      const avg = urbanTemps.reduce((a,c)=>a+c,0) / urbanTemps.length;
      series.push({ i: i, delta: avg - il });
    }
  } else if (stationId) {
    const sHist = LATEST_HISTORY[stationId];
    if (sHist && !sHist.error && sHist.hourlyAvg) {
      for (let i = 0; i < 24; i++) {
        const s = sHist.hourlyAvg[i] && sHist.hourlyAvg[i].temp;
        const il = islaHist.hourlyAvg[i] && islaHist.hourlyAvg[i].temp;
        if (s != null && il != null) series.push({ i: i, delta: s - il });
      }
    }
  }
  if (series.length < 2) { g.innerHTML = ''; return; }

  // Chart geometry
  const W = 280, H = 96;
  const padL = 26, padR = 10, padT = 4, padB = 14;

  // Auto-scale Y to actual data range, with both negative and positive shown if applicable
  const vals = series.map(p => p.delta);
  let dataMin = Math.min(...vals);
  let dataMax = Math.max(...vals);
  // Round outward to nearest 2 for clean grid
  let yMin = Math.floor(dataMin / 2) * 2;
  let yMax = Math.ceil(dataMax / 2) * 2;
  // Ensure both sides visible if data crosses 0
  if (dataMin < 0 && yMin > -2) yMin = -2;
  if (dataMax > 0 && yMax < 2) yMax = 2;
  // Guarantee min span of 4°
  if (yMax - yMin < 4) yMax = yMin + 4;

  const yScale = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const xScale = i => padL + (i / 23) * (W - padL - padR);

  // Build line + area paths
  let line = '', firstX = null, lastX = null;
  series.forEach((p, idx) => {
    const x = xScale(p.i), y = yScale(p.delta);
    line += (idx === 0 ? 'M' : ' L') + x.toFixed(1) + ',' + y.toFixed(1);
    if (firstX === null) firstX = x;
    lastX = x;
  });
  const zeroY = yScale(0);
  const baselineY = (yMin >= 0) ? H - padB : zeroY;
  const area = line + ' L' + lastX.toFixed(1) + ',' + baselineY.toFixed(1) +
               ' L' + firstX.toFixed(1) + ',' + baselineY.toFixed(1) + ' Z';

  // Generate gridlines + Y labels: solo 0, min, max
  let gridSVG = '';
  const yTicks = new Set([yMin, yMax]);
  if (yMin < 0 && yMax > 0) yTicks.add(0);
  Array.from(yTicks).sort((a,b)=>a-b).forEach(v => {
    const y = yScale(v);
    const isZero = (v === 0);
    gridSVG += '<line x1="' + padL + '" y1="' + y.toFixed(1) +
               '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
               '" stroke="rgba(255,255,255,' + (isZero ? '0.5' : '0.25') +
               ')" stroke-width="' + (isZero ? '1' : '0.5') +
               '" stroke-dasharray="' + (isZero ? '0' : '2 3') + '"/>';
    const label = (v > 0 ? '+' : '') + v + '°';
    gridSVG += '<text x="' + (padL - 5) + '" y="' + (y + 3).toFixed(1) +
               '" font-size="10" fill="white" font-weight="700" text-anchor="end" opacity="0.9">' +
               label + '</text>';
  });
  // X axis labels: 00, 06, 12, 18 (24h)
  const xLabels = [0, 6, 12, 18];
  const xLabelY = H - 1;
  xLabels.forEach(h => {
    const x = xScale(h);
    gridSVG += '<text x="' + x.toFixed(1) + '" y="' + xLabelY +
               '" font-size="9" fill="rgba(255,255,255,0.65)" font-weight="600" text-anchor="middle">' +
               String(h).padStart(2,'0') + 'h</text>';
  });

  // Current point marker
  const last = series[series.length - 1];
  const lx = xScale(last.i).toFixed(1);
  const ly = yScale(last.delta).toFixed(1);

  g.innerHTML =
    gridSVG +
    '<path d="' + area + '" fill="url(#dg)"/>' +
    '<path d="' + line + '" stroke="white" stroke-width="2" fill="none" stroke-linejoin="round"/>' +
    '<circle cx="' + lx + '" cy="' + ly + '" r="3.5" fill="white"/>' +
    '<line x1="' + lx + '" y1="' + padT + '" x2="' + lx + '" y2="' + (H - padB) +
    '" stroke="white" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.5"/>';
}

function recomputeStationDeltas() {
  if (!LATEST_CURRENT) return;
  const isla = LATEST_CURRENT['isla-maipo'];
  if (!isla || isla.error || isla.temp == null) return;
  const islaTemp = isla.temp;
  const islaHist = LATEST_HISTORY && LATEST_HISTORY['isla-maipo'];

  Object.keys(_stationIdMap).forEach(key => {
    const sId = _stationIdMap[key];
    const cur = LATEST_CURRENT[sId];
    if (!STATION_DATA[key]) return;
    if (!cur || cur.error || cur.temp == null) return;

    // Δ ahora — directo de las temps actuales
    const dNow = cur.temp - islaTemp;
    STATION_DATA[key].deltaNow = _fmtDelta(dNow);
    STATION_DATA[key].deltaBig = _fmtDeltaBig(dNow);

    // Δ promedio + máx de hoy — solo si tenemos history horario de ambos
    if (islaHist && !islaHist.error && islaHist.hourlyAvg) {
      const sHist = LATEST_HISTORY[sId];
      if (sHist && !sHist.error && sHist.hourlyAvg) {
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const nowH = new Date().getHours();
        const deltas = [];
        // Cada bucket del hourlyAvg representa una hora de las últimas 24
        // Buckets 0=24h ago … 23=ahora. Tomo solo los de "hoy" (desde medianoche local hasta ahora).
        for (let i = Math.max(0, 23 - nowH); i <= 23; i++) {
          const s = sHist.hourlyAvg[i] && sHist.hourlyAvg[i].temp;
          const l = islaHist.hourlyAvg[i] && islaHist.hourlyAvg[i].temp;
          if (s != null && l != null) {
            // i corresponde a la hora: 23 = ahora, 23-nowH = 00:00 de hoy
            const hour = (24 - (23 - i) + new Date().getHours()) % 24;
            deltas.push({ hour: nowH - (23 - i), delta: s - l });
          }
        }
        if (deltas.length > 0) {
          const avg = deltas.reduce((a, c) => a + c.delta, 0) / deltas.length;
          let maxItem = deltas[0];
          deltas.forEach(d => { if (d.delta > maxItem.delta) maxItem = d; });
          STATION_DATA[key].deltaAvg = _fmtDelta(avg);
          STATION_DATA[key].deltaMax = _fmtDelta(maxItem.delta);
          STATION_DATA[key].deltaMaxHour = String(maxItem.hour).padStart(2,'0') + ':00';
        }
      }
    }
  });

  // Promedio de las 4 urbanas vs Isla
  const urbanIds = ['providencia', 'stgo-centro', 'renca', 'cerrillos'];
  const urbanTemps = urbanIds.map(id => LATEST_CURRENT[id] && LATEST_CURRENT[id].temp)
    .filter(t => t != null && !isNaN(t));
  if (urbanTemps.length > 0) {
    const avgT = urbanTemps.reduce((a,c) => a+c, 0) / urbanTemps.length;
    const dAvg = avgT - islaTemp;
    STATION_DATA.__avg.deltaNow = _fmtDelta(dAvg);
    STATION_DATA.__avg.deltaBig = _fmtDeltaBig(dAvg);
  }

  // Refrescar la card de la estación activa + Δ chart
  if (typeof activeStation !== 'undefined' && STATION_DATA[activeStation]) {
    setActiveStation(activeStation);
  }
  renderDeltaChart();
}

// Bind station-card clicks
document.querySelectorAll('.station-card').forEach(card => {
  card.addEventListener('click', () => setActiveStation(card.dataset.stationKey));
});

// Initial render: __avg
setActiveStation('__avg');

// Auto-rotate through stations every 12s on TV-size viewports
const STATION_ROTATE = ['__avg', 'providencia', 'stgocentro', 'renca', 'cerrillos', 'sancarlos', 'chamisero', 'isla'];
let stationRotateIdx = 0;
let stationRotateTimer = null;
function startStationRotate() {
  if (window.innerWidth < 1600) return; // laptop: manual only
  stationRotateTimer = setInterval(() => {
    stationRotateIdx = (stationRotateIdx + 1) % STATION_ROTATE.length;
    setActiveStation(STATION_ROTATE[stationRotateIdx]);
  }, 10000);
}
function stopStationRotate() {
  if (stationRotateTimer) { clearInterval(stationRotateTimer); stationRotateTimer = null; }
}
// startStationRotate(); // descomentar para activar auto-rotación en TV


// ============================================================
// Phase 2B — ThingSpeak fetch + render real data
// ============================================================

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;   // 2 min (más frecuente para ver cambios)
const OFFLINE_THRESHOLD_MIN = 30;             // station offline if no data in 30 min

// Maps station.id (from data.js) → CSS class of the station card it renders into
const STATION_CARD_CLASS = {
  'providencia':   's-providencia',   // merged Providencia (adv + th)
  'isla-maipo':    's-isla',
  'san-carlos':    's-sancarlos',
  'chamisero':     's-chamisero',
  'renca':         's-renca',
  'stgo-centro':   's-stgocentro',
  'cerrillos':     's-cerrillos'
};

// Cardinal direction labels (Spanish — O = west, SO = south-west)
function degToCompassEs(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchStation(station, results = 2) {
  const url = thingspeakUrl(station.channelId, station.readKey, results);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return parseStationFeed(json, station);
  } catch (e) {
    clearTimeout(t);
    console.warn('[fetch] ' + station.name + ' (ch ' + station.channelId + ')', e.message);
    return { error: e.message, station };
  }
}

function parseStationFeed(json, station) {
  const feeds = (json.feeds || []).filter(f => f && f.created_at);
  if (feeds.length === 0) return { error: 'no feeds', station };
  const latest = feeds[feeds.length - 1];
  const prev = feeds.length >= 2 ? feeds[feeds.length - 2] : null;
  const out = { station, timestamp: new Date(latest.created_at), raw: latest };
  for (const [key, fieldName] of Object.entries(station.fields)) {
    const raw = latest[fieldName];
    const v = parseFloat(raw);
    out[key] = (raw == null || isNaN(v)) ? null : v;
    if (prev) {
      const pv = parseFloat(prev[fieldName]);
      if (!isNaN(pv) && !isNaN(v)) out[key + 'Trend'] = v - pv;
    }
  }
  return out;
}

async function fetchAllStations() {
  const settled = await Promise.allSettled(STATIONS.map(s => fetchStation(s)));
  const byId = {};
  settled.forEach((r, i) => {
    byId[STATIONS[i].id] = (r.status === 'fulfilled') ? r.value : { error: String(r.reason), station: STATIONS[i] };
  });
  // Merge Providencia 2 canales → 'providencia'
  const adv = byId['providencia-adv'];
  const th  = byId['providencia-th'];
  if (th && !th.error) {
    const merged = Object.assign({}, adv && !adv.error ? adv : {}, th);
    merged.timestamp = (adv && !adv.error && adv.timestamp > th.timestamp) ? adv.timestamp : th.timestamp;
    byId['providencia'] = merged;
  } else if (adv && !adv.error) {
    byId['providencia'] = adv;
  } else {
    byId['providencia'] = { error: 'providencia channels unreachable', station: STATIONS[0] };
  }
  return byId;
}

function setText(el, txt) { if (el) el.textContent = txt; }
function setHTML(el, html) { if (el) el.innerHTML = html; }

function updateMetricValue(card, iconClass, html) {
  // For both .sc-metric (small + providencia top-row) and .isla-metric-col layouts
  const metric = card.querySelector('.sc-metric:has(.icon.' + iconClass + ')');
  if (metric) {
    const val = metric.querySelector('.val');
    if (val) val.innerHTML = html;
    return;
  }
  const isla = card.querySelector('.isla-metric-col .icon.' + iconClass);
  if (isla) {
    const val = isla.parentElement.querySelector('.val');
    if (val) val.innerHTML = html;
  }
}

function renderStationCard(cardClass, data) {
  const card = document.querySelector('.station-card.' + cardClass);
  if (!card) return;
  card.classList.toggle('station-error', !!data.error);
  if (data.error) {
    const status = card.querySelector('.sc-status');
    if (status) status.textContent = 'SIN DATOS';
    return;
  }

  // Temperature
  if (data.temp != null) {
    setText(card.querySelector('.sc-temp-big'), Math.round(data.temp) + '°');
  }

  // Trend
  const trendEl = card.querySelector('.sc-temp-trend');
  if (trendEl && data.tempTrend != null) {
    const t = data.tempTrend;
    const abs = Math.abs(t).toFixed(1);
    trendEl.textContent = (t >= 0 ? '↑' : '↓') + abs + '°';
    trendEl.classList.toggle('up', t >= 0);
    trendEl.classList.toggle('down', t < 0);
  }

  // Range bar pin (current temp position on 8–32° scale)
  if (data.temp != null) {
    const pin = card.querySelector('.sc-range-pin');
    if (pin) {
      const pct = Math.max(0, Math.min(100, ((data.temp - 0) / (35 - 0)) * 100));
      pin.style.left = pct.toFixed(1) + '%';
    }
  }

  // Humidity
  if (data.humidity != null) {
    updateMetricValue(card, 'hum', Math.round(data.humidity) + '<span class="u">%</span>');
  }

  // Radiation (horizontal global)
  if (data.radHoriz != null) {
    updateMetricValue(card, 'rad', Math.round(data.radHoriz) + '<span class="u">W/m²</span>');
  }

  // Wind speed
  if (data.windSpeed != null) {
    updateMetricValue(card, 'wind', data.windSpeed.toFixed(1) + '<span class="u">m/s</span>');
  }

  // Wind direction
  if (data.windDir != null) {
    const dirText = degToCompassEs(data.windDir) + ' · ' + Math.round(data.windDir) + '°';
    // .sc-metric layout (Providencia/small): .sub.dir under val
    const subDir = card.querySelector('.sc-metric:has(.icon.wind) .sub.dir');
    if (subDir) subDir.textContent = dirText;
    // Isla layout: lbl contains "Viento · S 180°"
    const islaWindLbl = card.querySelector('.isla-metric-col .icon.wind');
    if (islaWindLbl) {
      const lbl = islaWindLbl.parentElement.querySelector('.lbl');
      if (lbl) lbl.textContent = 'Viento · ' + dirText;
    }
  }

  // Status: time since last reading — MIN under 2h, H above
  const statusEl = card.querySelector('.sc-status');
  if (data.timestamp) {
    const mins = Math.round((Date.now() - data.timestamp) / 60000);
    if (statusEl) {
      if (mins > 120) {
        statusEl.textContent = Math.round(mins / 60) + ' H';
      } else {
        statusEl.textContent = mins + ' MIN';
      }
      statusEl.style.color = mins > OFFLINE_THRESHOLD_MIN ? 'var(--coral)' : '';
    }
    // Stale overlay if data hasn't refreshed in >1h
    card.classList.toggle('station-stale', mins > 60);
  }
}

// Update map pins (only stations whose markers carry a stable identifier in HTML)
function updateMapPins(all) {
  const pinByLabel = {
    'STGO. CENTRO': 'stgo-centro',
    'RENCA':        'renca',
    'CERRILLOS':    'cerrillos',
    'CHAMISERO':    'chamisero',
    'SAN CARLOS':   'san-carlos'
  };
  document.querySelectorAll('.station-marker').forEach(m => {
    const lblEl = m.querySelector('.label');
    if (!lblEl) return;
    const txt = lblEl.textContent.replace('★ ', '').trim().toUpperCase();
    let stationId = pinByLabel[txt];
    if (!stationId && txt.includes('PROVIDENCIA')) stationId = 'providencia';
    if (!stationId) return;
    const data = all[stationId];
    if (!data || data.error || data.temp == null) return;
    const pin = m.querySelector('.pin');
    if (!pin) return;
    const stale = !data.timestamp || (Date.now() - data.timestamp) / 60000 > 60;
    pin.textContent = Math.round(data.temp) + '°';
    if (stale) {
      pin.style.background = '#B0B9C2';
      pin.style.opacity = '0.55';
    } else {
      pin.style.background = tempColor(data.temp, 0, 35);
      pin.style.opacity = '1';
    }
  });
  // Isla off-chip in map
  const islaChip = document.querySelector('.out-chip .dot');
  const isla = all['isla-maipo'];
  if (islaChip && isla && !isla.error && isla.temp != null) {
    const stale = !isla.timestamp || (Date.now() - isla.timestamp) / 60000 > 60;
    islaChip.textContent = Math.round(isla.temp) + '°';
    islaChip.style.background = stale ? '#B0B9C2' : tempColor(isla.temp, 0, 35);
    islaChip.style.opacity = stale ? '0.55' : '1';
  }
}

async function updateAll() {
  const t0 = performance.now();
  const all = await fetchAllStations();
  console.log('[fetch] %.0fms', performance.now() - t0, all);

  // Render all station cards
  for (const [stationId, cardClass] of Object.entries(STATION_CARD_CLASS)) {
    const data = all[stationId];
    if (data) renderStationCard(cardClass, data);
  }

  // Update map pins
  updateMapPins(all);

  // Detect offline stations + populate CURRENT_ACTIVE_STATIONS set
  const offline = [];
  CURRENT_ACTIVE_STATIONS = new Set();
  for (const [stationId, cardClass] of Object.entries(STATION_CARD_CLASS)) {
    const data = all[stationId];
    const key = cardClass.replace('s-', '');
    if (!data || data.error) { offline.push(key); continue; }
    const minsAgo = (Date.now() - data.timestamp) / 60000;
    if (minsAgo > OFFLINE_THRESHOLD_MIN) offline.push(key);
    if (minsAgo <= 60) CURRENT_ACTIVE_STATIONS.add(stationId);
  }
  updateNetStatus(offline);

  // Store + recompute Δ Urbano-Rural with real data
  LATEST_CURRENT = all;
  recomputeStationDeltas();
  // Iconos de condición por estación (independiente de Isla)
  applyStationConditions(all);
  console.log('[cond] applyStationConditions ran on', Object.keys(all).length, 'stations');

  // Condition detection + season banner
  setActiveCondition(detectNetworkCondition(all));
  updateSeasonBanner();

  // Update clock to real local time
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const timeEl = document.querySelector('.clock .time');
  if (timeEl) timeEl.textContent = hh + ':' + mm;
  const luEl = document.getElementById('lastUpdate');
  if (luEl) luEl.textContent = 'Actualizado ' + hh + ':' + mm;
  const days = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
  const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const dateEl = document.querySelector('.clock .date');
  if (dateEl) dateEl.textContent = days[now.getDay()] + ' · ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
}

// Kick off: fetch immediately + every 5 min
updateAll();
setInterval(updateAll, REFRESH_INTERVAL_MS);


// ============================================================
// Phase 2C — Histórico 24 h (range bar + sparklines + wind rose)
// ============================================================

const HISTORY_REFRESH_MS = 30 * 60 * 1000;  // 30 min

function thingspeakUrlDays(channelId, readKey, days = 1) {
  return 'https://api.thingspeak.com/channels/' + channelId + '/feeds.json?api_key=' + readKey + '&days=' + days;
}

async function fetchHistory(station, days = 1) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(thingspeakUrlDays(station.channelId, station.readKey, days), { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return processHistory24h(json.feeds || [], station);
  } catch (e) {
    clearTimeout(t);
    console.warn('[history] ' + station.name, e.message);
    return { error: e.message, station };
  }
}

function processHistory24h(feeds, station) {
  const now = Date.now();
  const recent = feeds
    .filter(f => f && f.created_at)
    .map(f => {
      const r = { ts: new Date(f.created_at).getTime() };
      for (const [k, fn] of Object.entries(station.fields)) {
        const v = parseFloat(f[fn]);
        r[k] = isNaN(v) ? null : v;
      }
      return r;
    })
    .filter(r => now - r.ts <= 24 * 3600 * 1000);

  // Today's min/max temp (since local midnight)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();
  const todayTemps = recent.filter(r => r.ts >= todayTs && r.temp != null).map(r => r.temp);
  const minTemp = todayTemps.length ? Math.min(...todayTemps) : null;
  const maxTemp = todayTemps.length ? Math.max(...todayTemps) : null;

  // 24 hourly buckets (idx 0 = 24h ago, idx 23 = now)
  const hourly = Array.from({ length: 24 }, () => ({ temp: [], humidity: [], radHoriz: [], radDiffuse: [] }));
  for (const r of recent) {
    const hoursAgo = Math.floor((now - r.ts) / 3600000);
    if (hoursAgo < 0 || hoursAgo >= 24) continue;
    const idx = 23 - hoursAgo;
    ['temp', 'humidity', 'radHoriz', 'radDiffuse'].forEach(k => {
      if (r[k] != null) hourly[idx][k].push(r[k]);
    });
  }
  const hourlyAvg = hourly.map(b => {
    const o = {};
    Object.keys(b).forEach(k => {
      o[k] = b[k].length ? b[k].reduce((a, c) => a + c, 0) / b[k].length : null;
    });
    return o;
  });

  // Wind direction distribution (16 bins, weighted by wind speed)
  const dirBins = new Array(16).fill(0);
  for (const r of recent) {
    if (r.windDir != null && r.windSpeed != null && r.windSpeed > 0.2) {
      const bin = Math.round(r.windDir / 22.5) % 16;
      dirBins[bin] += r.windSpeed;
    }
  }

  return { station, recent, minTemp, maxTemp, hourlyAvg, dirBins };
}

async function fetchAllHistory() {
  const settled = await Promise.allSettled(STATIONS.map(s => fetchHistory(s)));
  const byId = {};
  settled.forEach((r, i) => {
    byId[STATIONS[i].id] = (r.status === 'fulfilled') ? r.value : { error: String(r.reason), station: STATIONS[i] };
  });
  // Merge Providencia 2 canales for history
  const adv = byId['providencia-adv'];
  const th = byId['providencia-th'];
  if (th && !th.error && adv && !adv.error) {
    const merged = {
      station: th.station,
      recent: th.recent,
      minTemp: th.minTemp, maxTemp: th.maxTemp,
      hourlyAvg: th.hourlyAvg.map((b, i) => Object.assign({}, b, {
        radHoriz: adv.hourlyAvg[i].radHoriz,
        radDiffuse: adv.hourlyAvg[i].radDiffuse
      })),
      dirBins: adv.dirBins  // wind from -adv
    };
    byId['providencia'] = merged;
  } else if (th && !th.error) {
    byId['providencia'] = th;
  } else if (adv && !adv.error) {
    byId['providencia'] = adv;
  }
  return byId;
}

// ---------- Renderers ----------

function renderRangeBar(card, h) {
  if (!h || h.minTemp == null || h.maxTemp == null) return;
  const SCALE_MIN = 0, SCALE_MAX = 35, range = SCALE_MAX - SCALE_MIN;
  const minPct = Math.max(0, Math.min(100, ((h.minTemp - SCALE_MIN) / range) * 100));
  const maxPct = Math.max(0, Math.min(100, ((h.maxTemp - SCALE_MIN) / range) * 100));
  const fill = card.querySelector('.sc-range-fill');
  if (fill) {
    fill.style.left = minPct.toFixed(1) + '%';
    fill.style.width = Math.max(0.5, maxPct - minPct).toFixed(1) + '%';
  }
  const minNum = card.querySelector('.min-num');
  const maxNum = card.querySelector('.max-num');
  if (minNum) minNum.textContent = Math.round(h.minTemp) + '°';
  if (maxNum) maxNum.textContent = Math.round(h.maxTemp) + '°';
}

function pathFromSeries(values, vMin, vMax, W, top, bottom) {
  const ys = v => {
    if (v == null) return null;
    const r = Math.max(0, Math.min(1, (v - vMin) / (vMax - vMin)));
    return bottom - r * (bottom - top);
  };
  const N = values.length;
  // Build line path, skipping null gaps
  let line = '', cur = false;
  values.forEach((v, i) => {
    const y = ys(v);
    if (y == null) { cur = false; return; }
    const x = (i / (N - 1)) * W;
    line += (!cur ? 'M' : ' L') + x.toFixed(1) + ',' + y.toFixed(1);
    cur = true;
  });
  // Build area path (close to bottom)
  let area = '';
  let first = -1, last = -1;
  values.forEach((v, i) => { if (v != null) { if (first < 0) first = i; last = i; } });
  if (first >= 0 && last > first) {
    const xLast = (last / (N - 1)) * W;
    const xFirst = (first / (N - 1)) * W;
    area = line + ' L' + xLast.toFixed(1) + ',' + bottom + ' L' + xFirst.toFixed(1) + ',' + bottom + ' Z';
  }
  return { line, area };
}

function renderProvSparklines(h) {
  if (!h || h.error) return;
  const card = document.querySelector('.station-card.s-providencia');
  if (!card) return;
  const charts = card.querySelectorAll('.sc-chart-multi');
  if (charts.length < 2) return;

  const W = 280, top = 10, bottom = 46;
  const temps = h.hourlyAvg.map(b => b.temp);
  const hums = h.hourlyAvg.map(b => b.humidity);
  const radG = h.hourlyAvg.map(b => b.radHoriz);
  const radD = h.hourlyAvg.map(b => b.radDiffuse);

  // Auto-scale temp around its actual range with padding
  const tMin = Math.min(...temps.filter(x => x != null)) - 1;
  const tMax = Math.max(...temps.filter(x => x != null)) + 1;
  const tempPaths = pathFromSeries(temps, tMin, tMax, W, top, bottom);
  const humPaths = pathFromSeries(hums, 0, 100, W, top, bottom);

  // Build new SVG content for chart 1 (temp + humidity)
  const svg1 = charts[0].querySelector('svg');
  if (svg1) {
    svg1.innerHTML =
      '<defs><linearGradient id="tempG1" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0%" stop-color="#E78D70" stop-opacity="0.3"/>' +
      '<stop offset="100%" stop-color="#E78D70" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="0" y1="14" x2="280" y2="14" stroke="rgba(44,75,102,0.05)" stroke-width="1"/>' +
      '<line x1="0" y1="42" x2="280" y2="42" stroke="rgba(44,75,102,0.05)" stroke-width="1"/>' +
      (tempPaths.area ? '<path d="' + tempPaths.area + '" fill="url(#tempG1)"/>' : '') +
      (tempPaths.line ? '<path d="' + tempPaths.line + '" fill="none" stroke="#E78D70" stroke-width="1.8" stroke-linejoin="round"/>' : '') +
      (humPaths.line ? '<path d="' + humPaths.line + '" fill="none" stroke="#89B8BC" stroke-width="1.8" stroke-linejoin="round"/>' : '');
  }
  // Update legend values
  const leg1 = charts[0].querySelector('.sc-chart-legend');
  if (leg1) {
    const last = i => { for (let j = i.length - 1; j >= 0; j--) if (i[j] != null) return i[j]; return null; };
    const tNow = last(temps), hNow = last(hums);
    leg1.innerHTML =
      '<span class="lgd-item"><span class="lgd-swatch" style="background:#E78D70;"></span>Temp <strong>' +
        (tNow != null ? Math.round(tNow) + '°' : '—') + '</strong></span>' +
      '<span class="lgd-item">Últimas 24 h</span>' +
      '<span class="lgd-item"><span class="lgd-swatch" style="background:#89B8BC;"></span>Humedad <strong>' +
        (hNow != null ? Math.round(hNow) + '%' : '—') + '</strong></span>';
  }

  // Chart 2: rad global + difusa, scale 0 → max
  const rgMax = Math.max(50, ...radG.filter(x => x != null), ...radD.filter(x => x != null));
  const rgPaths = pathFromSeries(radG, 0, rgMax, W, top, bottom);
  const rdPaths = pathFromSeries(radD, 0, rgMax, W, top, bottom);
  const svg2 = charts[1].querySelector('svg');
  if (svg2) {
    svg2.innerHTML =
      '<defs><linearGradient id="radG1" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0%" stop-color="#E78D70" stop-opacity="0.3"/>' +
      '<stop offset="100%" stop-color="#E78D70" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="0" y1="14" x2="280" y2="14" stroke="rgba(44,75,102,0.05)" stroke-width="1"/>' +
      '<line x1="0" y1="42" x2="280" y2="42" stroke="rgba(44,75,102,0.05)" stroke-width="1"/>' +
      (rgPaths.area ? '<path d="' + rgPaths.area + '" fill="url(#radG1)"/>' : '') +
      (rgPaths.line ? '<path d="' + rgPaths.line + '" fill="none" stroke="#E78D70" stroke-width="1.8" stroke-linejoin="round"/>' : '') +
      (rdPaths.line ? '<path d="' + rdPaths.line + '" fill="none" stroke="#F8BC7E" stroke-width="1.6" stroke-linejoin="round"/>' : '');
  }
  const leg2 = charts[1].querySelector('.sc-chart-legend');
  if (leg2) {
    const last = arr => { for (let j = arr.length - 1; j >= 0; j--) if (arr[j] != null) return arr[j]; return null; };
    const gNow = last(radG), dNow = last(radD);
    leg2.innerHTML =
      '<span class="lgd-item"><span class="lgd-swatch" style="background:#E78D70;"></span>Rad. global <strong>' +
        (gNow != null ? Math.round(gNow) : '—') + '</strong></span>' +
      '<span class="lgd-item">W/m² · 24 h</span>' +
      '<span class="lgd-item"><span class="lgd-swatch" style="background:#F8BC7E;"></span>Rad. difusa <strong>' +
        (dNow != null ? Math.round(dNow) : '—') + '</strong></span>';
  }
}

function renderWindRose(h) {
  if (!h || h.error || !h.dirBins) return;
  const total = h.dirBins.reduce((a, c) => a + c, 0);
  if (total === 0) return;
  const wrap = document.querySelector('.s-providencia .sc-windrose-svg-wrap');
  if (!wrap) return;
  const max = Math.max(...h.dirBins);
  const maxRadius = 68, cx = 100, cy = 100, halfA = (11.25 * Math.PI) / 180;

  // Predominant direction (largest bin)
  let maxIdx = 0;
  h.dirBins.forEach((v, i) => { if (v > h.dirBins[maxIdx]) maxIdx = i; });
  const predomAngle = maxIdx * 22.5;
  const dirsEs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];

  const grid = [22, 45, 68].map(gr =>
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + gr + '" fill="none" stroke="rgba(44,75,102,0.08)" stroke-width="0.7"/>'
  ).join('');

  const wedges = h.dirBins.map((v, i) => {
    const r = (v / max) * maxRadius;
    if (r < 1) return '';
    const a = (i * 22.5 * Math.PI) / 180;
    const a1 = a - halfA, a2 = a + halfA;
    const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
    const x2 = cx + r * Math.sin(a2), y2 = cy - r * Math.cos(a2);
    const color = (i === maxIdx) ? '#E78D70' :
      (Math.abs(i - maxIdx) <= 1 || Math.abs(i - maxIdx) >= 15) ? '#F8BC7E' :
      'rgba(231,141,112,0.35)';
    return '<path d="M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
           ' A ' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + color + '"/>';
  }).join('');

  const labels =
    '<text x="100" y="14" text-anchor="middle" font-size="9" fill="#7B8A99" font-weight="700">N</text>' +
    '<text x="192" y="104" text-anchor="middle" font-size="9" fill="#7B8A99" font-weight="700">E</text>' +
    '<text x="100" y="196" text-anchor="middle" font-size="9" fill="#7B8A99" font-weight="700">S</text>' +
    '<text x="9" y="104" text-anchor="middle" font-size="9" fill="#7B8A99" font-weight="700">W</text>';
  const center = '<circle cx="' + cx + '" cy="' + cy + '" r="2.5" fill="#2C4B66"/>';
  const ptrA = (predomAngle * Math.PI) / 180;
  const pointer = '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + 78 * Math.sin(ptrA)).toFixed(2) +
                  '" y2="' + (cy - 78 * Math.cos(ptrA)).toFixed(2) + '" stroke="#2C4B66" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.6"/>';

  wrap.innerHTML = '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">' +
    grid + wedges + pointer + center + labels + '</svg>';

  // Update legend with predominant direction
  const legend = wrap.parentElement.querySelector('.sc-chart-legend');
  if (legend) {
    legend.innerHTML =
      '<span class="lgd-item"><span class="lgd-swatch" style="background:#E78D70;"></span>Rosa de viento</span>' +
      '<span class="lgd-item">24 h</span>' +
      '<span class="lgd-item">Predomina <strong>' + dirsEs[maxIdx] + ' · ' + predomAngle + '°</strong></span>';
  }
}

function renderDailyStripExtremes(all) {
  // Solo MAX/MIN de hoy en estaciones actualmente activas
  const temps = [];
  Object.entries(all).forEach(([stationId, h]) => {
    if (!h || h.error) return;
    if (!CURRENT_ACTIVE_STATIONS.has(stationId)) return;
    if (h.minTemp != null) temps.push(h.minTemp);
    if (h.maxTemp != null) temps.push(h.maxTemp);
  });
  if (temps.length === 0) return;
  const minAll = Math.min(...temps), maxAll = Math.max(...temps);
  const maxEl = document.querySelector('.ds-temp-row.max .val');
  const minEl = document.querySelector('.ds-temp-row.min .val');
  if (maxEl) maxEl.textContent = maxAll.toFixed(1) + '°';
  if (minEl) minEl.textContent = minAll.toFixed(1) + '°';
}

async function updateHistorical() {
  const t0 = performance.now();
  const all = await fetchAllHistory();
  console.log('[history] %.0fms', performance.now() - t0, all);

  for (const [stationId, cardClass] of Object.entries(STATION_CARD_CLASS)) {
    const h = all[stationId];
    const card = document.querySelector('.station-card.' + cardClass);
    if (card && h && !h.error) renderRangeBar(card, h);
  }
  if (all['providencia'] && !all['providencia'].error) {
    renderProvSparklines(all['providencia']);
    renderWindRose(all['providencia']);
  }
  renderDailyStripExtremes(all);
  LATEST_HISTORY = all;
  recomputeStationDeltas();
}

// Initial historical fetch + schedule every 30 min
updateHistorical();
setInterval(updateHistorical, HISTORY_REFRESH_MS);


// ============================================================
// ============================================================
// Condition classifier — Niebla / Nublado / Parcial / Soleado / Ola Calor
// Heurística simple basada en rad horizontal + humedad + temp
// ============================================================

function classifyCondition(ctx) {
  const { temp, humidity, radHoriz, hour } = ctx;
  if (temp == null) return null;

  // Ola de calor
  if (temp >= 30) return 'ola-calor';

  // Niebla: alta humedad + radiación muy baja durante el día
  if (humidity != null && humidity >= 88 && radHoriz != null && radHoriz < 50 && hour >= 7 && hour <= 18) {
    return 'niebla';
  }

  // Clear-sky theoretical max para la hora (curva senoidal 6-18, pico ~1000 W/m²)
  let expectedRad = 0;
  if (hour >= 6 && hour <= 18) {
    expectedRad = 1000 * Math.sin((hour - 6) / 12 * Math.PI);
  }

  if (expectedRad < 50) {
    // De noche no podemos inferir cobertura nubosa por radiación → uso humedad
    if (humidity != null && humidity >= 88) return 'niebla';
    if (humidity != null && humidity >= 75) return 'nublado';
    return null; // noche despejada → ningún icono activo, basta con la luna del AM/PM
  }

  if (radHoriz == null) return null;
  const ratio = radHoriz / expectedRad;
  if (ratio >= 0.7) return 'soleado';
  if (ratio >= 0.35) return 'parcial';
  return 'nublado';
}

function detectNetworkCondition(allCurrent) {
  // Solo estaciones urbanas ACTIVAS (ultima lectura ≤60 min)
  const urbans = ['providencia', 'stgo-centro', 'renca', 'cerrillos'];
  const cutoff = Date.now() - 60 * 60 * 1000;
  const temps = [], hums = [], rads = [];
  urbans.forEach(id => {
    const d = allCurrent[id];
    if (!d || d.error) return;
    if (!d.timestamp || d.timestamp < cutoff) return; // skip stale
    if (d.temp != null) temps.push(d.temp);
    if (d.humidity != null) hums.push(d.humidity);
    if (d.radHoriz != null) rads.push(d.radHoriz);
  });
  if (temps.length === 0) return null;
  const avg = arr => arr.reduce((a, c) => a + c, 0) / arr.length;
  return classifyCondition({
    temp: avg(temps),
    humidity: hums.length ? avg(hums) : null,
    radHoriz: rads.length ? avg(rads) : null,
    hour: new Date().getHours()
  });
}

function setActiveCondition(cond) {
  const hour = new Date().getHours();
  const isNight = hour >= 19 || hour < 6;
  // Swap AM/PM icons: 1st = moon (active at night), 2nd = sun (active at day)
  const ampm = document.querySelectorAll('.ds-ampm-icon');
  if (ampm.length >= 2) {
    ampm[0].classList.toggle('inactive', !isNight);
    ampm[1].classList.toggle('inactive', isNight);
  }
  document.querySelectorAll('.ds-condition').forEach(el => {
    const labelEl = el.querySelector('.ds-condition-label');
    if (!labelEl) return el.classList.remove('active');
    const txt = labelEl.textContent.toLowerCase().trim();
    const key = txt === 'ola calor' ? 'ola-calor' : txt;
    // At night: only allow Niebla/Nublado (no Soleado/Parcial/Ola Calor)
    if (isNight && (key === 'soleado' || key === 'parcial' || key === 'ola-calor')) {
      el.classList.remove('active');
      return;
    }
    el.classList.toggle('active', cond != null && key === cond);
  });
}

// ============================================================
// Season banner — actualiza Otoño/Verano/Invierno/Primavera + fecha
// ============================================================

function getSeasonEs(m) {
  // Hemisferio sur (Chile)
  if (m === 11 || m <= 1) return { name: 'Verano',    cls: 'summer' };
  if (m <= 4)             return { name: 'Otoño',     cls: 'autumn' };
  if (m <= 7)             return { name: 'Invierno',  cls: 'winter' };
  return { name: 'Primavera', cls: 'spring' };
}

function updateSeasonBanner() {
  const now = new Date();
  const s = getSeasonEs(now.getMonth());
  const labelEl = document.querySelector('.ds-season .label');
  if (labelEl) labelEl.textContent = s.name;
  const dateEl = document.querySelector('.ds-season .date');
  if (dateEl) {
    const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    dateEl.textContent = now.getDate() + ' DE ' + months[now.getMonth()] + ' ' + now.getFullYear();
  }
  // Mark current season row in Resumen
  const seasonRows = document.querySelectorAll('.stats-card .season-row');
  const seasonOrder = ['summer','autumn','winter','spring'];  // matches the 4 rows in HTML order
  const currentIdx = seasonOrder.indexOf(s.cls);
  seasonRows.forEach((row, i) => {
    row.classList.toggle('current', i === currentIdx);
    // Solo las FUTURAS (después de la actual) van como upcoming/transparente.
    // Las pasadas (verano si estamos en otoño) tienen datos → opacidad normal.
    row.classList.toggle('upcoming', i > currentIdx);
    // Toggle the EN CURSO badge
    const nameEl = row.querySelector('.season-name');
    if (!nameEl) return;
    const existing = nameEl.querySelector('.now-tag');
    if (seasonOrder[i] === s.cls && !existing) {
      const tag = document.createElement('span');
      tag.className = 'now-tag';
      tag.textContent = 'EN CURSO';
      nameEl.appendChild(document.createTextNode(' '));
      nameEl.appendChild(tag);
    } else if (seasonOrder[i] !== s.cls && existing) {
      existing.remove();
    }
  });
}

// // Phase 2D — Histórico anual (heatmap + uptime con datos reales)
// ============================================================

const YEAR_REFRESH_MS = 6 * 60 * 60 * 1000; // cada 6h
function dateToYMD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatTSDate(d) {
  const pad = n => String(n).padStart(2, '0');
  // ThingSpeak espera YYYY-MM-DD HH:NN:SS (espacio URL-encoded)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '%20' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function thingspeakUrlChunk(channelId, readKey, start, end) {
  // average=60 = 1 punto cada hora. Año a la fecha (Ene 1 → hoy) cabe holgado en 8000.
  // timezone=America/Santiago para que start/end se interpreten en hora local Chile.
  return 'https://api.thingspeak.com/channels/' + channelId + '/feeds.json?api_key=' + readKey +
         '&start=' + formatTSDate(start) + '&end=' + formatTSDate(end) +
         '&average=60&results=8000&timezone=America/Santiago';
}

async function fetchYearChunk(station, start, end) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(thingspeakUrlChunk(station.channelId, station.readKey, start, end), { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json.feeds || [];
  } catch (e) {
    clearTimeout(t);
    console.warn('[year-chunk] ' + station.name, e.message);
    return [];
  }
}

async function loadStationJSON(station) {
  // Cargado por GitHub Actions (scripts/update-data.js) — acumulador histórico.
  try {
    const res = await fetch('data/' + station.id + '.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.byDay && Object.keys(json.byDay).length > 0) return json;
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchYearHistory(station) {
  if (!station.fields.temp) return { error: 'no-temp-field', station, byDay: {} };

  // 1) Intentar el JSON acumulado del repo (mantenido por GitHub Actions)
  const cached = await loadStationJSON(station);
  if (cached) {
    console.log('[year]', station.id, '(JSON cache) days:', Object.keys(cached.byDay).length, '· lastUpdate:', cached.lastUpdate);
    return { station, byDay: cached.byDay };
  }

  // 2) Fallback: API directo, año en curso
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const feeds = await fetchYearChunk(station, yearStart, now);
  const uniqueDays = new Set(feeds.map(f => f && f.created_at ? f.created_at.slice(0, 10) : null)).size;
  console.log('[year]', station.id, '(API fallback) feeds:', feeds.length, '· unique dates:', uniqueDays);
  return { station, byDay: processYearFeeds(feeds, station) };
}

function processYearFeeds(feeds, station) {
  const byDay = {};
  const tempField = station.fields.temp;
  for (const f of feeds) {
    if (!f || !f.created_at) continue;
    const d = new Date(f.created_at);
    const ymd = dateToYMD(d);
    const hr = d.getHours();
    let period;
    if (hr >= 6 && hr < 12) period = 'M';
    else if (hr >= 12 && hr < 18) period = 'T';
    else period = 'N';
    if (!byDay[ymd]) byDay[ymd] = { M: [], T: [], N: [], all: [] };
    const v = parseFloat(f[tempField]);
    if (!isNaN(v)) {
      byDay[ymd][period].push(v);
      byDay[ymd].all.push(v);
    }
  }
  Object.keys(byDay).forEach(k => {
    const b = byDay[k];
    ['M', 'T', 'N', 'all'].forEach(p => {
      const arr = b[p];
      b[p + '_avg'] = arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null;
      b[p + '_n'] = arr.length;
    });
  });
  return byDay;
}

// Map station.id → key used in YEAR_DATA + STATION_DATA + uptime data-station
function stationIdToKey(id) {
  if (id === 'providencia-th') return 'providencia';
  if (id === 'providencia-adv') return null;
  if (id === 'isla-maipo') return 'isla';
  if (id === 'san-carlos') return 'sancarlos';
  if (id === 'stgo-centro') return 'stgocentro';
  return id;
}

async function fetchAllYearHistory() {
  // Skip channels without temp (providencia-adv)
  const tempStations = STATIONS.filter(s => s.fields.temp);
  const settled = await Promise.allSettled(tempStations.map(s => fetchYearHistory(s)));
  YEAR_DATA = {};
  settled.forEach((r, i) => {
    const key = stationIdToKey(tempStations[i].id);
    if (!key) return;
    if (r.status === 'fulfilled' && !r.value.error) {
      YEAR_DATA[key] = r.value.byDay;
    } else {
      YEAR_DATA[key] = {};
    }
  });
  console.log('[year] day counts per station:',
    Object.fromEntries(Object.entries(YEAR_DATA).map(([k, v]) => [k, Object.keys(v).length])));
  // Re-render with real data
  regenerateAllHeatmaps();
  renderUptimeBars();
}

function dayValueFor(stationKey, ymd, viewKey) {
  // Compute the temp value (or avg of 4 urbanas) for a given day + view
  if (stationKey === '__avg') {
    const urbans = ['providencia', 'stgocentro', 'renca', 'cerrillos'];
    const vals = urbans.map(s => {
      const d = YEAR_DATA[s] && YEAR_DATA[s][ymd];
      if (!d) return null;
      if (viewKey === 'anual') return d.all_avg;
      if (viewKey === 'manana') return d.M_avg;
      if (viewKey === 'tarde')  return d.T_avg;
      return d.N_avg;
    }).filter(v => v != null);
    return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
  }
  const sd = YEAR_DATA[stationKey];
  if (!sd || !sd[ymd]) return null;
  const d = sd[ymd];
  if (viewKey === 'anual') return d.all_avg;
  if (viewKey === 'manana') return d.M_avg;
  if (viewKey === 'tarde') return d.T_avg;
  return d.N_avg;
}

// Kick off + schedule
fetchAllYearHistory();
setInterval(fetchAllYearHistory, YEAR_REFRESH_MS);
