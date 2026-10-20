#!/usr/bin/env node
// MUC data updater v2 — hourly aggregates for ALL variables.
// - data/<station-id>.json: { station, lastUpdate, byDay: { 'YYYY-MM-DD': day } }
//   day = {
//     // legacy (consumed by app.js heatmaps — DO NOT RENAME):
//     M_avg, T_avg, N_avg, all_avg, M_max, T_max, N_max, all_max, M_n, T_n, N_n, all_n,
//     // v2:
//     all_min,
//     h: { t:[24], h:[24], w:[24], d:[24], r:[24] }   // hourly means (d = wind dir, vector mean)
//   }
// Modes:
//   node scripts/update-data.js              → daily refresh (last 36h, raw-ish via average=10)
//   node scripts/update-data.js --backfill   → full rebuild: import data/raw/*.csv + API month
//                                              chunks (average=60) from CSV end (or BACKFILL_START) to now
// All bucketing is done in America/Santiago local time regardless of where this runs (GH Actions = UTC).

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');

const BACKFILL = process.argv.includes('--backfill');
const BACKFILL_START = new Date('2025-07-01T00:00:00-04:00'); // earliest channel start (jul 2025)

// Full field maps (superset of data.js — Node script stays dependency-free).
// Canonical variable keys: t=temp °C · h=humidity % · w=wind m/s · d=wind dir ° · r=rad W/m²
const STATIONS = [
  { id: 'providencia-adv', channelId: 2865012, readKey: 'ZHVO4V54ACWCKMUF',
    fields: { w: 'field1', d: 'field2', r: 'field7' } },
  { id: 'providencia-th',  channelId: 2865013, readKey: 'GPW0MWSXAJYXSN69',
    fields: { t: 'field1', h: 'field2' } },
  { id: 'isla-maipo',      channelId: 2911247, readKey: 'JG5XFI4NB556UKO2',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } },
  { id: 'san-carlos',      channelId: 2950699, readKey: 'JLIRRP01JVIYPRBZ',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } },
  { id: 'chamisero',       channelId: 2950701, readKey: 'KIIWGUYA11WMSIQ9',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } },
  { id: 'renca',           channelId: 3027229, readKey: 'T40LCTX172ZB9E9F',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } },
  { id: 'stgo-centro',     channelId: 3175711, readKey: 'OD4EIUF224PK2IBK',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } },
  { id: 'cerrillos',       channelId: 3218465, readKey: 'P5VMMIJP91Q5M6FO',
    fields: { w: 'field1', d: 'field2', h: 'field3', t: 'field4', r: 'field5' } }
];

const VARS = ['t', 'h', 'w', 'd', 'r'];
const ROUND = { t: 1, h: 1, w: 2, d: 0, r: 0 };
// Filtro de cordura: lecturas fuera de estos rangos físicos se descartan
// (los sensores a veces emiten picos absurdos, p.ej. 150 °C en Renca abr-2026).
const RANGE = { t: [-15, 48], h: [0, 100], w: [0, 60], d: [0, 360], r: [0, 1600] };

// ---------- America/Santiago local time, cached per UTC-hour ----------
const scl = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
});
const _tzCache = new Map(); // utc-hour epoch → { ymd, hr }
function santiagoYmdHour(date) {
  const key = Math.floor(date.getTime() / 3600000);
  // Offset is constant within a UTC hour, so cache ymd/hr of the hour start + minute math is unnecessary:
  // we only need ymd + hour, both fixed across the UTC hour.
  let hit = _tzCache.get(key);
  if (!hit) {
    const parts = {};
    for (const p of scl.formatToParts(new Date(key * 3600000))) parts[p.type] = p.value;
    hit = { ymd: `${parts.year}-${parts.month}-${parts.day}`, hr: parseInt(parts.hour, 10) % 24 };
    _tzCache.set(key, hit);
  }
  return hit;
}

function formatTSDate(d) {
  // ThingSpeak start/end in Santiago local time (paired with timezone=America%2FSantiago)
  const p = {};
  for (const x of scl.formatToParts(d)) p[x.type] = x.value;
  const mins = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  for (const x of mins) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}%20${p.hour}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

// ---------- Aggregation ----------
function newAccDay() {
  const hours = Array.from({ length: 24 }, () => ({
    t: [], h: [], w: [], r: [], dSin: 0, dCos: 0, dN: 0
  }));
  return { hours };
}

function accumulate(buckets, feeds, fields) {
  for (const f of feeds) {
    if (!f || !f.created_at) continue;
    const date = new Date(f.created_at);
    if (isNaN(date)) continue;
    const { ymd, hr } = santiagoYmdHour(date);
    let day = buckets[ymd];
    if (!day) day = buckets[ymd] = newAccDay();
    const H = day.hours[hr];
    for (const v of VARS) {
      const col = fields[v];
      if (!col) continue;
      const val = parseFloat(f[col]);
      if (isNaN(val)) continue;
      if (val < RANGE[v][0] || val > RANGE[v][1]) continue;
      if (v === 'd') {
        const rad = (val * Math.PI) / 180;
        H.dSin += Math.sin(rad); H.dCos += Math.cos(rad); H.dN++;
      } else {
        H[v].push(val);
      }
    }
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function finalizeDay(acc) {
  const mean = arr => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null;
  const rnd = (v, dec) => v == null ? null : Number(v.toFixed(dec));
  const h = { t: [], h: [], w: [], d: [], r: [] };
  const periodOf = hr => (hr >= 6 && hr < 12) ? 'M' : (hr >= 12 && hr < 18) ? 'T' : 'N';
  const perN = { M: 0, T: 0, N: 0, all: 0 };

  acc.hours.forEach((H, hr) => {
    // Despike intra-hora para temperatura: con ≥5 muestras crudas, descartar
    // las que se alejan >6° de la mediana de esa hora (picos de sensor).
    let tSamples = H.t;
    if (tSamples.length >= 5) {
      const med = median(tSamples);
      tSamples = tSamples.filter(v => Math.abs(v - med) <= 6);
    }
    h.t.push(rnd(mean(tSamples), ROUND.t));
    h.h.push(rnd(mean(H.h), ROUND.h));
    h.w.push(rnd(mean(H.w), ROUND.w));
    h.r.push(rnd(mean(H.r), ROUND.r));
    h.d.push(H.dN > 0 ? Math.round(((Math.atan2(H.dSin, H.dCos) * 180 / Math.PI) + 360) % 360) : null);
    perN[periodOf(hr)] += H.t.length;
    perN.all += H.t.length;
  });

  // Despike inter-hora: una hora cuya temp salta >8° respecto de AMBAS horas
  // vecinas (o >10° de su única vecina) es un glitch → null. Clave para la era
  // API (average=60: 1 valor/hora, sin población intra-hora que filtrar).
  const t = h.t;
  for (let i = 0; i < 24; i++) {
    if (t[i] == null) continue;
    let prev = null, next = null;
    for (let j = i - 1; j >= 0; j--) if (t[j] != null) { prev = t[j]; break; }
    for (let j = i + 1; j < 24; j++) if (t[j] != null) { next = t[j]; break; }
    const dp = prev != null ? Math.abs(t[i] - prev) : null;
    const dn = next != null ? Math.abs(t[i] - next) : null;
    if (dp != null && dn != null) { if (Math.min(dp, dn) > 8) t[i] = null; }
    else if ((dp != null && dp > 10) || (dn != null && dn > 10)) t[i] = null;
  }

  // Agregados legacy (app.js) calculados sobre las horas ya despikeadas —
  // consistente entre la era CSV (muestras crudas) y la era API (hourly).
  const day = { h };
  const perVals = { M: [], T: [], N: [], all: [] };
  t.forEach((v, hr) => { if (v == null) return; perVals[periodOf(hr)].push(v); perVals.all.push(v); });
  for (const p of ['M', 'T', 'N', 'all']) {
    day[p + '_avg'] = perVals[p].length ? rnd(mean(perVals[p]), 2) : null;
    day[p + '_max'] = perVals[p].length ? rnd(Math.max(...perVals[p]), 1) : null;
    day[p + '_n'] = perN[p];
  }
  day.all_min = perVals.all.length ? rnd(Math.min(...perVals.all), 1) : null;
  // Total samples across all vars (so wind-only channels like providencia-adv still report coverage)
  const samples = acc.hours.reduce((a, H) => a + H.t.length + H.h.length + H.w.length + H.r.length + H.dN, 0);
  day.n = samples;
  return day;
}

// ---------- Sources ----------
function parseCSV(text, fields) {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(s => s.trim().toLowerCase());
  const createdIdx = header.indexOf('created_at');
  if (createdIdx < 0) return [];
  const colIdx = {};
  for (const v of VARS) {
    if (fields[v]) colIdx[v] = header.indexOf(fields[v]);
  }
  const feeds = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= createdIdx) continue;
    const f = { created_at: cols[createdIdx].trim() };
    for (const v in colIdx) {
      if (colIdx[v] >= 0 && cols[colIdx[v]] != null) f[fields[v]] = cols[colIdx[v]].trim();
    }
    feeds.push(f);
  }
  return feeds;
}

function fetchAPI(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  }).catch(e => {
    if (attempt >= 3) throw e;
    return new Promise(r => setTimeout(r, 2000 * attempt)).then(() => fetchAPI(url, attempt + 1));
  });
}

function feedsUrl(station, start, end, average) {
  return `https://api.thingspeak.com/channels/${station.channelId}/feeds.json` +
    `?api_key=${station.readKey}&start=${formatTSDate(start)}&end=${formatTSDate(end)}` +
    (average ? `&average=${average}` : '') + `&results=8000&timezone=America%2FSantiago`;
}

async function fetchRange(station, start, end, average) {
  // Month-sized chunks so average=60 stays well under the 8000-result cap.
  const feeds = [];
  let cur = new Date(start);
  while (cur < end) {
    const next = new Date(Math.min(end.getTime(), cur.getTime() + 30 * 24 * 3600 * 1000));
    try {
      const json = await fetchAPI(feedsUrl(station, cur, next, average));
      feeds.push(...(json.feeds || []));
    } catch (e) {
      console.error(`  chunk ${cur.toISOString().slice(0, 10)} failed: ${e.message}`);
    }
    cur = next;
  }
  return feeds;
}

// ---------- Per-station update ----------
async function updateStation(station) {
  const jsonPath = path.join(DATA_DIR, station.id + '.json');
  let data = { station: station.id, byDay: {}, lastUpdate: null };
  if (!BACKFILL && fs.existsSync(jsonPath)) {
    try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); }
    catch (e) { console.warn(`  warn: ${station.id}.json corrupt, starting fresh`); }
    if (!data.byDay) data.byDay = {};
  }
  const startDays = Object.keys(data.byDay).length;
  const now = new Date();

  if (BACKFILL) {
    // 1) CSV (raw resolution, full history). Files stay in place — re-runnable.
    const buckets = {};
    let csvEnd = BACKFILL_START;
    const csvPath = path.join(RAW_DIR, station.id + '.csv');
    if (fs.existsSync(csvPath)) {
      const feeds = parseCSV(fs.readFileSync(csvPath, 'utf-8'), station.fields);
      accumulate(buckets, feeds, station.fields);
      if (feeds.length) {
        const lastTs = new Date(feeds[feeds.length - 1].created_at);
        if (!isNaN(lastTs)) csvEnd = lastTs;
      }
      console.log(`  CSV: ${feeds.length} rows (→ ${csvEnd.toISOString().slice(0, 10)})`);
    } else {
      console.log('  CSV: none, full API backfill');
    }
    // 2) API hourly averages from CSV end (minus 1h overlap) to now.
    const apiStart = new Date(Math.max(BACKFILL_START.getTime(), csvEnd.getTime() - 3600000));
    const apiFeeds = await fetchRange(station, apiStart, now, 60);
    accumulate(buckets, apiFeeds, station.fields);
    console.log(`  API backfill: ${apiFeeds.length} hourly points`);
    data.byDay = {};
    for (const ymd of Object.keys(buckets).sort()) data.byDay[ymd] = finalizeDay(buckets[ymd]);
  } else {
    // Daily refresh: last 36h with 10-min averages (covers yesterday fully when run early morning).
    const windowStart = new Date(now.getTime() - 36 * 3600 * 1000);
    const feeds = await fetchRange(station, windowStart, now, 10);
    const buckets = {};
    accumulate(buckets, feeds, station.fields);
    const winYmd = santiagoYmdHour(windowStart).ymd;
    for (const ymd of Object.keys(buckets)) {
      // Override only days the window covers from midnight; the leading partial day
      // would otherwise clobber a previously complete day with its tail hours.
      if (ymd > winYmd || !data.byDay[ymd]) data.byDay[ymd] = finalizeDay(buckets[ymd]);
    }
    console.log(`  API daily: ${feeds.length} points (window ≥ ${winYmd})`);
  }

  data.lastUpdate = now.toISOString();
  fs.writeFileSync(jsonPath, JSON.stringify(data));
  const endDays = Object.keys(data.byDay).length;
  return { startDays, endDays };
}

(async () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`== MUC data updater v2 (${BACKFILL ? 'BACKFILL' : 'daily'}) ==`);
  for (const s of STATIONS) {
    console.log(`\n[${s.id}] channel ${s.channelId}`);
    try {
      const r = await updateStation(s);
      console.log(`  days: ${r.startDays} → ${r.endDays}`);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
    }
  }
  console.log('\n== done ==');
})();
