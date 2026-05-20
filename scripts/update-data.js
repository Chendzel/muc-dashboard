#!/usr/bin/env node
// Daily updater + CSV bootstrap importer for MUC dashboard.
// - Reads existing data/<station-id>.json (per-station byDay aggregates).
// - If data/raw/<station-id>.csv exists, imports it into the JSON (then moves to processed/).
// - Fetches last 36h from ThingSpeak API and merges into the JSON.
// - Designed to run from GitHub Actions on a daily cron + on workflow_dispatch.

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const PROCESSED_DIR = path.join(RAW_DIR, 'processed');

// Mirrors STATIONS from data.js — kept inline so the Node script has no browser deps.
const STATIONS = [
  { id: 'providencia-adv', channelId: 2865012, readKey: 'ZHVO4V54ACWCKMUF', fields: {} },
  { id: 'providencia-th',  channelId: 2865013, readKey: 'GPW0MWSXAJYXSN69', fields: { temp: 'field1', humidity: 'field2' } },
  { id: 'isla-maipo',      channelId: 2911247, readKey: 'JG5XFI4NB556UKO2', fields: { temp: 'field4' } },
  { id: 'san-carlos',      channelId: 2950699, readKey: 'JLIRRP01JVIYPRBZ', fields: { temp: 'field4' } },
  { id: 'chamisero',       channelId: 2950701, readKey: 'KIIWGUYA11WMSIQ9', fields: { temp: 'field4' } },
  { id: 'renca',           channelId: 3027229, readKey: 'T40LCTX172ZB9E9F', fields: { temp: 'field4' } },
  { id: 'stgo-centro',     channelId: 3175711, readKey: 'OD4EIUF224PK2IBK', fields: { temp: 'field4' } },
  { id: 'cerrillos',       channelId: 3218465, readKey: 'P5VMMIJP91Q5M6FO', fields: { temp: 'field4' } }
];

function dateToYMD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatTSDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '%20' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function processFeeds(feeds, station) {
  // Returns { 'YYYY-MM-DD': { M_avg, T_avg, N_avg, all_avg, M_n, T_n, N_n, all_n } }
  const byDay = {};
  const tempField = station.fields.temp;
  if (!tempField) return byDay;
  const buckets = {};
  for (const f of feeds) {
    if (!f || !f.created_at) continue;
    const d = new Date(f.created_at);
    const ymd = dateToYMD(d);
    const hr = d.getHours();
    let period;
    if (hr >= 6 && hr < 12) period = 'M';
    else if (hr >= 12 && hr < 18) period = 'T';
    else period = 'N';
    if (!buckets[ymd]) buckets[ymd] = { M: [], T: [], N: [], all: [] };
    const v = parseFloat(f[tempField]);
    if (!isNaN(v)) {
      buckets[ymd][period].push(v);
      buckets[ymd].all.push(v);
    }
  }
  for (const ymd in buckets) {
    const b = buckets[ymd];
    const day = {};
    for (const p of ['M', 'T', 'N', 'all']) {
      day[p + '_avg'] = b[p].length ? b[p].reduce((a, c) => a + c, 0) / b[p].length : null;
      day[p + '_max'] = b[p].length ? Math.max(...b[p]) : null;
      day[p + '_n']   = b[p].length;
    }
    byDay[ymd] = day;
  }
  return byDay;
}

function parseCSV(text, station) {
  // ThingSpeak CSV export: header row + data rows. Columns include created_at,entry_id,field1..fieldN
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const createdIdx = header.indexOf('created_at');
  const tempIdx = header.indexOf(station.fields.temp);
  if (createdIdx < 0 || tempIdx < 0) {
    console.error(`  CSV header missing required columns (need created_at + ${station.fields.temp}). Found: ${header.join(',')}`);
    return [];
  }
  const feeds = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= Math.max(createdIdx, tempIdx)) continue;
    const f = {};
    f.created_at = cols[createdIdx].trim();
    f[station.fields.temp] = cols[tempIdx].trim();
    feeds.push(f);
  }
  return feeds;
}

function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function updateStation(station) {
  if (!station.fields.temp) return { skipped: true };
  const jsonPath = path.join(DATA_DIR, station.id + '.json');
  let data = { station: station.id, byDay: {}, lastUpdate: null };
  if (fs.existsSync(jsonPath)) {
    try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); }
    catch (e) { console.warn(`  warn: ${station.id}.json corrupt, starting fresh`); }
    if (!data.byDay) data.byDay = {};
  }
  const startDays = Object.keys(data.byDay).length;

  // CSV bootstrap (one-time)
  const csvPath = path.join(RAW_DIR, station.id + '.csv');
  if (fs.existsSync(csvPath)) {
    const text = fs.readFileSync(csvPath, 'utf-8');
    const csvFeeds = parseCSV(text, station);
    const csvByDay = processFeeds(csvFeeds, station);
    let added = 0;
    for (const ymd in csvByDay) {
      // CSV provides historical truth; only fill days we don't already have
      if (!data.byDay[ymd]) { data.byDay[ymd] = csvByDay[ymd]; added++; }
    }
    console.log(`  CSV imported: ${csvFeeds.length} rows → ${added} new days`);
    if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
    fs.renameSync(csvPath, path.join(PROCESSED_DIR, station.id + '-' + Date.now() + '.csv'));
  }

  // API daily refresh — last 36h covers yesterday's full day + today so far
  const now = new Date();
  const start = new Date(now.getTime() - 36 * 3600 * 1000);
  const url = `https://api.thingspeak.com/channels/${station.channelId}/feeds.json?api_key=${station.readKey}&start=${formatTSDate(start)}&end=${formatTSDate(now)}&results=8000&timezone=America%2FSantiago`;
  try {
    const json = await fetchAPI(url);
    const newDays = processFeeds(json.feeds || [], station);
    // API data ALWAYS overrides for the days it covers (more recent / authoritative)
    Object.assign(data.byDay, newDays);
    console.log(`  API refreshed: ${(json.feeds || []).length} feeds → ${Object.keys(newDays).length} days updated`);
  } catch (e) {
    console.error(`  API failed: ${e.message}`);
  }

  data.lastUpdate = now.toISOString();
  fs.writeFileSync(jsonPath, JSON.stringify(data));
  const endDays = Object.keys(data.byDay).length;
  return { startDays, endDays, delta: endDays - startDays };
}

(async () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('== MUC data updater ==');
  for (const s of STATIONS) {
    if (!s.fields.temp) continue;
    console.log(`\n[${s.id}] channel ${s.channelId}`);
    try {
      const r = await updateStation(s);
      console.log(`  result: ${r.startDays} → ${r.endDays} days (Δ ${r.delta >= 0 ? '+' : ''}${r.delta})`);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
    }
  }
  console.log('\n== done ==');
})();
