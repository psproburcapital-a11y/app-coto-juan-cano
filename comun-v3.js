/* =========================================================
   Comun a la app del cazador y al panel del gestor
   ========================================================= */
const CONFIG = {
  supabaseUrl: 'https://heepekturllhibsqryna.supabase.co',
  supabaseKey: 'sb_publishable_6y_kfjCCVg6elFgUVmLACQ_hqq00Iwn',
  nombreCoto: 'Coto Juan Cano',
  centro: [39.265, -2.605]
};

const sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  // Sesiones separadas: el panel y la app pueden abrirse en el mismo navegador
  auth: { persistSession: true, autoRefreshToken: true, storageKey: /gestor/.test(location.pathname) ? 'sesion-gestor' : 'sesion-cazador' }
});

const TIPOS_ZONA = {
  caza:      { nombre: 'Caza',      color: '#2FB344' },
  reserva:   { nombre: 'Reserva',   color: '#2D7FF9' },
  prohibida: { nombre: 'Prohibida', color: '#E5262B' },
  seguridad: { nombre: 'Seguridad', color: '#F7931E' }
};

const TIPOS_PUNTO = {
  casa:         { nombre: 'Casa',         icono: '🏠' },
  bebedero:     { nombre: 'Bebedero',     icono: '💧' },
  comedero:     { nombre: 'Comedero',     icono: '🌾' },
  puesto:       { nombre: 'Puesto',       icono: '🎯' },
  acceso:       { nombre: 'Acceso',       icono: '🚪' },
  aparcamiento: { nombre: 'Aparcamiento', icono: '🅿️' },
  otro:         { nombre: 'Otro',         icono: '📍' }
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtHa = h => Number(h || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function guardarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function leerLocal(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

/* ---------- Mapa base ---------- */
function crearMapa(id, posZoom = 'bottomright') {
  const map = L.map(id, { zoomControl: false, attributionControl: true }).setView(CONFIG.centro, 14);
  L.control.zoom({ position: posZoom }).addTo(map);
  // Ortofoto PNOA del IGN (servicio WMTS gratuito)
  L.tileLayer(
    'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0' +
    '&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg' +
    '&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}',
    { maxZoom: 20, maxNativeZoom: 19, attribution: 'PNOA © IGN' }
  ).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  return map;
}

function iconoPunto(tipo) {
  const t = TIPOS_PUNTO[tipo] || TIPOS_PUNTO.otro;
  return L.divIcon({ className: 'pin', html: `<span>${t.icono}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}

/* ---------- Datos del coto (con copia en el móvil) ---------- */
const CLAVE_DATOS = 'coto-datos-v2';

async function cargarDatosCoto() {
  const [p, z, pt] = await Promise.all([
    sb.from('parcelas').select('*').order('nombre'),
    sb.from('zonas').select('*').order('creado'),
    sb.from('puntos').select('*').order('creado')
  ]);
  const err = p.error || z.error || pt.error;
  if (err) {
    const copia = leerLocal(CLAVE_DATOS);
    if (copia) return { ...copia, sinConexion: true };
    throw err;
  }
  const datos = { parcelas: p.data, zonas: z.data, puntos: pt.data, fecha: new Date().toISOString() };
  guardarLocal(CLAVE_DATOS, datos);
  return datos;
}

/* Dibuja parcelas, zonas y puntos. Devuelve las capas para poder rehacerlas. */
function pintarCoto(map, datos, capas, opciones = {}) {
  if (capas) Object.values(capas).forEach(c => map.removeLayer(c));
  capas = { parcelas: L.featureGroup(), zonas: L.featureGroup(), puntos: L.featureGroup() };

  datos.parcelas.forEach(p => {
    L.geoJSON(p.geom, { style: { color: '#FFE14D', weight: 2, opacity: .9, fillOpacity: 0 }, interactive: !!opciones.popupParcelas })
      .bindPopup(`<b>${esc(p.nombre)}</b><br>${fmtHa(p.ha)} ha`)
      .addTo(capas.parcelas);
  });

  datos.zonas.forEach(z => {
    const t = TIPOS_ZONA[z.tipo] || TIPOS_ZONA.caza;
    const capa = L.geoJSON(z.geom, { style: { color: t.color, weight: 3, fillColor: t.color, fillOpacity: .28 } })
      .bindPopup(`<b>${esc(t.nombre)}</b>${z.nombre ? '<br>' + esc(z.nombre) : ''}${opciones.borrarZona ? `<br><button class="mini peligro" data-borrar-zona="${z.id}">Borrar zona</button>` : ''}`);
    capa.addTo(capas.zonas);
  });

  datos.puntos.forEach(pt => {
    const t = TIPOS_PUNTO[pt.tipo] || TIPOS_PUNTO.otro;
    const pendiente = pt.estado === 'pendiente';
    const m = L.marker([pt.lat, pt.lng], { icon: iconoPunto(pt.tipo), draggable: !!opciones.moverPuntos, opacity: pendiente ? .5 : 1 })
      .bindPopup(`<b>${esc(t.nombre)}</b>${pendiente ? ' <i>(pendiente de aprobar)</i>' : ''}${pt.nombre ? '<br>' + esc(pt.nombre) : ''}${pt.nota ? '<br><small>' + esc(pt.nota) + '</small>' : ''}` +
        `${pendiente && opciones.aprobarPunto ? `<br><button class="mini" style="margin-top:6px" data-aprobar-punto="${pt.id}">Aprobar</button>` : ''}` +
        `${opciones.borrarPunto ? `<br><button class="mini peligro" data-borrar-punto="${pt.id}">Borrar punto</button>` : ''}`);
    if (opciones.moverPuntos) m.on('dragend', () => opciones.moverPuntos(pt, m.getLatLng()));
    m.addTo(capas.puntos);
  });

  capas.parcelas.addTo(map);
  capas.zonas.addTo(map);
  capas.puntos.addTo(map);
  return capas;
}

function encuadrar(map, capas) {
  const b = L.featureGroup([capas.parcelas, capas.zonas, capas.puntos]).getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [24, 24] });
}
