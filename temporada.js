/* =========================================================
   Temporada, especies y calendario (común a app y panel)
   ========================================================= */
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const TIPOS_EVENTO = {
  batida:   { nombre: 'Batida',   icono: '🐗' },
  monteria: { nombre: 'Montería', icono: '📯' },
  suelta:   { nombre: 'Suelta',   icono: '🐦' },
  reunion:  { nombre: 'Reunión',  icono: '👥' },
  trabajos: { nombre: 'Trabajos', icono: '🛠️' },
  otro:     { nombre: 'Otro',     icono: '📌' }
};
const CLAVE_TEMPORADA = 'coto-temporada-v1';

/* Fecha local en formato AAAA-MM-DD (sin desfases de zona horaria) */
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fechaDeIso(s) { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); }
function fechaLarga(d) { const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); }
function fechaCorta(s) { return fechaDeIso(s).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }

async function cargarTemporada() {
  const [t, e, ev] = await Promise.all([
    sb.from('temporada').select('*').eq('id', 1).maybeSingle(),
    sb.from('especies').select('*').order('orden').order('nombre'),
    sb.from('eventos').select('*').order('fecha')
  ]);
  const err = t.error || e.error || ev.error;
  if (err) {
    const copia = leerLocal(CLAVE_TEMPORADA);
    if (copia) return { ...copia, sinConexion: true };
    throw err;
  }
  const d = { temporada: t.data || { dias_semana: [0], festivos: [] }, especies: e.data, eventos: ev.data };
  guardarLocal(CLAVE_TEMPORADA, d);
  return d;
}

/* ¿Se caza ese día en el coto? Devuelve { si, motivo } */
function diaDeCaza(fecha, tmp) {
  const t = tmp.temporada, iso = isoLocal(fecha);
  if (t.inicio && iso < t.inicio) return { si: false, motivo: 'La temporada aún no ha empezado' };
  if (t.fin && iso > t.fin) return { si: false, motivo: 'La temporada ha terminado' };
  if ((t.festivos || []).includes(iso)) return { si: true, motivo: 'Festivo' };
  if ((t.dias_semana || []).includes(fecha.getDay())) return { si: true, motivo: DIAS_SEMANA[fecha.getDay()] };
  return { si: false, motivo: 'No es día de caza en el coto' };
}

/* Especies que se pueden cazar ese día (activas y dentro de sus fechas) */
function especiesDelDia(fecha, tmp) {
  const iso = isoLocal(fecha);
  return tmp.especies.filter(e => e.activa).map(e => {
    const sinFechas = !e.desde && !e.hasta;
    const dentro = (!e.desde || iso >= e.desde) && (!e.hasta || iso <= e.hasta);
    return { ...e, sinFechas, abierta: dentro };
  });
}

/* Próximos días de caza (máx. n, mirando hasta 180 días) */
function proximosDias(desde, tmp, n = 8) {
  const out = [], d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  for (let i = 0; i < 180 && out.length < n; i++) {
    if (diaDeCaza(d, tmp).si) out.push(isoLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function textoCupo(e) {
  const p = [];
  if (e.cupo_jornada) p.push(`${e.cupo_jornada} por cazador y día`);
  if (e.cupo_temporada) p.push(`${e.cupo_temporada} en la temporada`);
  return p.join(' · ');
}
