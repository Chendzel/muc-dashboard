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

## Deploy

Hospedado en GitHub Pages. Cualquier cambio en `main` se publica automáticamente.

## Estaciones

| Nombre | Tipo | Channel ID |
|---|---|---|
| Providencia (viento / luz / radiación) | urbana | 2865012 |
| Providencia (temperatura / humedad) | urbana | 2865013 |
| Isla de Maipo | rural | 2911247 |
| San Carlos de Apoquindo | periférica | 2950699 |
| Chamisero | periférica | 2950701 |
| Renca | urbana | 3027229 |
| Santiago Centro | urbana | 3175711 |
| Cerrillos | urbana | 3218465 |

---

Uso académico — Pontificia Universidad Católica de Chile, MASE.
