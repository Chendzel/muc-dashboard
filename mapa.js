// ============================================================
// v1.36 — Mapa Leaflet navegable (reemplaza el satelital estático)
// Capas: Claro (CARTO/OSM, default) · OpenStreetMap · Satelital (Esri)
// Perfiles de comunas RM desde mapa/comunas-rm.json (52 comunas)
// Los pins se actualizan desde app.js → updateMapPins() → MUCMAP.updatePins()
// Nota: zoom con rueda/doble-click centrado ('center') porque el dashboard
// vive dentro de un transform:scale() y el zoom-al-cursor quedaría corrido.
// ============================================================

(function initMucMap() {
  'use strict';
  const el = document.getElementById('livemap');
  if (!el || typeof L === 'undefined') return;

  // Estaciones en el mapa (ids = los que usa app.js en fetchAllStations)
  const MAP_STATIONS = [
    { id: 'providencia', label: 'PROVIDENCIA',   lat: -33.419189, lon: -70.617757, side: 'right' },
    { id: 'stgo-centro', label: 'STGO. CENTRO',  lat: -33.440678, lon: -70.636208, side: 'left'  },
    { id: 'renca',       label: 'RENCA',         lat: -33.392900, lon: -70.697700, side: 'right' },
    { id: 'cerrillos',   label: 'CERRILLOS',     lat: -33.485247, lon: -70.727350, side: 'right' },
    { id: 'san-carlos',  label: 'SAN CARLOS',    lat: -33.402116, lon: -70.501566, side: 'right' },
    { id: 'chamisero',   label: 'CHAMISERO',     lat: -33.305427, lon: -70.659170, side: 'right' },
    { id: 'isla-maipo',  label: '★ ISLA DE MAIPO', lat: -33.734310, lon: -70.910410, side: 'above', rural: true }
  ];

  const map = L.map(el, {
    zoomControl: false,
    scrollWheelZoom: 'center',
    doubleClickZoom: 'center',
    touchZoom: 'center',
    zoomSnap: 0.25,
    minZoom: 8,
    maxZoom: 17,
    // El dashboard vive dentro de transform:scale() (layout fijo 1920×1080):
    // la transición CSS del zoom animado nunca dispara su transitionend ahí,
    // y Leaflet queda esperando. Zoom instantáneo = robusto en este contexto.
    zoomAnimation: false,
    markerZoomAnimation: false
  });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix(false);

  // ---- Capas base ----
  // v1.37: CARTO empezó a exigir API key en dominios publicados → capa clara
  // de Esri (Light Gray Canvas base + labels), gratuita y sin key.
  const claro = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri · © OpenStreetMap', maxNativeZoom: 16, maxZoom: 17
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16, maxZoom: 17
    })
  ]);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri · Maxar', maxZoom: 18
  });
  claro.addTo(map);
  L.control.layers({ 'Claro': claro, 'OpenStreetMap': osm, 'Satelital': sat }, null,
    { position: 'bottomright', collapsed: true }).addTo(map);

  // ---- Encuadre inicial: toda la red (Gran Santiago + Isla de Maipo) ----
  const HOME_BOUNDS = L.latLngBounds(MAP_STATIONS.map(s => [s.lat, s.lon])).pad(0.10);
  map.fitBounds(HOME_BOUNDS);

  // Botón "recentrar" (vuelve al encuadre de la red)
  const HomeCtl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const btn = L.DomUtil.create('a', 'leaflet-bar muc-home-btn');
      btn.href = '#'; btn.title = 'Ver toda la red';
      btn.innerHTML = '⌂';
      L.DomEvent.on(btn, 'click', e => { L.DomEvent.stop(e); map.fitBounds(HOME_BOUNDS); });
      return btn;
    }
  });
  map.addControl(new HomeCtl());

  // ---- Perfiles de comunas ----
  const STATION_COMUNAS = ['Providencia', 'Santiago', 'Renca', 'Cerrillos', 'Las Condes', 'Colina', 'Isla de Maipo'];
  fetch('mapa/comunas-rm.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(gj => {
      L.geoJSON(gj, {
        style: f => STATION_COMUNAS.includes(f.properties.name)
          ? { color: '#2C4B66', weight: 1.6, opacity: 0.55, fillColor: '#2C4B66', fillOpacity: 0.05 }
          : { color: '#2C4B66', weight: 0.8, opacity: 0.28, fillOpacity: 0 },
        onEachFeature: (f, layer) =>
          layer.bindTooltip(f.properties.name, { sticky: true, direction: 'top', className: 'comuna-tip' })
      }).addTo(map);
    })
    .catch(e => console.warn('[mapa] no se pudieron cargar las comunas:', e.message));

  // ---- Markers de estaciones (divIcon con el look de los pins de siempre) ----
  const markers = {};
  for (const s of MAP_STATIONS) {
    const icon = L.divIcon({
      className: 'lf-station side-' + s.side + (s.rural ? ' rural' : ''),
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      html: '<div class="pin" style="background:#B0B9C2;">–</div><div class="label">' + s.label + '</div>'
    });
    markers[s.id] = L.marker([s.lat, s.lon], { icon, keyboard: false }).addTo(map);
  }

  // ---- API para app.js ----
  function updatePins(all) {
    if (!all) return;
    for (const s of MAP_STATIONS) {
      const m = markers[s.id];
      const elM = m && m.getElement();
      if (!elM) continue;
      const pin = elM.querySelector('.pin');
      if (!pin) continue;
      const d = all[s.id];
      if (!d || d.error || d.temp == null) {
        pin.textContent = '–';
        pin.style.background = '#B0B9C2';
        pin.style.opacity = '0.55';
        continue;
      }
      const stale = !d.timestamp || (Date.now() - d.timestamp) / 60000 > 60;
      pin.textContent = Math.round(d.temp) + '°';
      pin.style.background = stale ? '#B0B9C2' : (typeof tempColor === 'function' ? tempColor(d.temp, 0, 35) : '#E78D70');
      pin.style.opacity = stale ? '0.55' : '1';
    }
  }

  window.MUCMAP = { map, updatePins, homeBounds: HOME_BOUNDS };

  // Si app.js ya hizo el primer fetch antes de que el mapa existiera, pintar ahora
  if (typeof LATEST_CURRENT !== 'undefined' && LATEST_CURRENT) updatePins(LATEST_CURRENT);

  // Reflow (mobile/tablet cambian el tamaño real del canvas)
  window.addEventListener('resize', () => map.invalidateSize());
})();
