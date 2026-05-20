# MUC — Microclimas Urbanos y Confort (Dashboard)

Dashboard en vivo del proyecto FONDECYT Nº 1241886 (MASE, PUC). Lee datos de 8 estaciones ThingSpeak en Santiago.

## Archivos

- `index.html` — estructura del dashboard (header, grilla de estaciones, mapa, daily strip, heatmap, footer).
- `style.css` — estilos del dashboard (variables de color, layout, tarjetas).
- `app.js` — lógica del cliente (escalado, vistas, generador de heatmap; Phase 2B: fetch ThingSpeak).
- `data.js` — metadata de las 8 estaciones (channel IDs, read keys, mapeo de fields).
- `README.md` — este archivo.

## Cómo verlo localmente

Abrí `index.html` en cualquier navegador. No requiere build ni servidor.

Uso académico — Pontificia Universidad Católica de Chile, MASE.
