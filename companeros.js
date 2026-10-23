/* =========================================================
   Compañeros en el campo (posición en directo, voluntaria)
   ========================================================= */
const COMP_VIEJO_MS = 2 * 60 * 1000;   // más de 2 min sin actualizar = gris

function iniciales(nombre) {
  const p = String(nombre || '').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}
function haceCuanto(fecha) {
  const s = Math.max(0, Math.round((Date.now() - new Date(fecha)) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.round(s / 60);
  return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`;
}

async function leerCompaneros() {
  const { data, error } = await sb.rpc('ver_companeros');
  if (error) throw error;
  return data || [];
}

/* Pinta los compañeros en una capa. Devuelve la capa nueva. */
function pintarCompaneros(map, capa, lista, { incluirmeYo = false } = {}) {
  if (capa) map.removeLayer(capa);
  capa = L.featureGroup();
  lista.filter(c => incluirmeYo || !c.soy_yo).forEach(c => {
    const viejo = Date.now() - new Date(c.actualizado) > COMP_VIEJO_MS;
    const color = viejo ? '#8A8F8C' : c.color;
    const icono = L.divIcon({
      className: 'companero',
      html: `<div style="background:${color};opacity:${viejo ? .75 : 1}">${esc(iniciales(c.nombre))}</div>`,
      iconSize: [40, 40], iconAnchor: [20, 20]
    });
    L.marker([c.lat, c.lng], { icon: icono, zIndexOffset: 1000 })
      .bindPopup(`<b>${esc(c.nombre)}</b><br>${viejo ? '⚠️ Última posición ' : 'Actualizado '}${haceCuanto(c.actualizado)}`)
      .addTo(capa);
  });
  capa.addTo(map);
  return capa;
}

/* Estilo de las marcas (se inyecta una sola vez) */
(function () {
  const st = document.createElement('style');
  st.textContent = `.companero div{width:40px;height:40px;border-radius:50%;border:3px solid #fff;color:#fff;font:800 15px/34px system-ui,sans-serif;
    text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.5)}`;
  document.head.appendChild(st);
})();
