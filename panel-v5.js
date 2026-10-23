/* =========================================================
   Panel del gestor · Fase 1: socios, parcelas, zonas y puntos
   ========================================================= */
const $ = id => document.getElementById(id);
let map, capas, datos = { parcelas: [], zonas: [], puntos: [] }, socios = [], modoPunto = false;

function log(txt, cls = '') { const d = document.createElement('div'); d.className = cls; d.textContent = txt; $('registro').prepend(d); }
function fallo(e, que) { console.error(e); alert(`No se pudo ${que}.\n\n${e.message || e}`); }

/* ---------- Acceso ---------- */
async function inicio() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return verAcceso();
  const { data, error } = await sb.from('gestores').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (error || !data) {
    await sb.auth.signOut();
    return verAcceso('Esta cuenta no tiene permiso de gestor.');
  }
  verPanel();
}
function verAcceso(msg = '') {
  document.body.classList.remove('panel');
  $('acceso-gestor').hidden = false; $('lateral').hidden = true; $('mapa-panel').hidden = true;
  $('error-acceso').textContent = msg;
}
$('btn-acceder').onclick = async () => {
  const b = $('btn-acceder'); b.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('clave').value });
  b.disabled = false;
  if (error) { $('error-acceso').textContent = 'Email o contraseña incorrectos.'; return; }
  inicio();
};
$('clave').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-acceder').click(); });
$('btn-salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function verPanel() {
  document.body.classList.add('panel');
  $('acceso-gestor').hidden = true; $('lateral').hidden = false; $('mapa-panel').hidden = false;
  if (!map) prepararMapa();
  setTimeout(() => map.invalidateSize(), 60);
  await recargarSocios();
  await recargarCoto(true);
  refrescarCampo();
  if (!verPanel.t) verPanel.t = setInterval(refrescarCampo, 15000);
}

/* ---------- Mapa ---------- */
function prepararMapa() {
  map = crearMapa('mapa-panel');
  L.drawLocal.draw.handlers.polygon.tooltip = { start: 'Pulsa para empezar la zona.', cont: 'Pulsa para añadir esquinas.', end: 'Pulsa en el primer punto para cerrar.' };
  map.on(L.Draw.Event.CREATED, async e => {
    const geom = e.layer.toGeoJSON().geometry;
    const { error } = await sb.from('zonas').insert({ tipo: $('zona-tipo').value, nombre: $('zona-nombre').value.trim(), geom });
    if (error) return fallo(error, 'guardar la zona');
    $('zona-nombre').value = '';
    recargarCoto();
  });
  map.on('click', e => { if (modoPunto) anadirPunto(e.latlng); });
}

/* Añade un punto donde se hizo clic (también si se pulsa encima de una parcela o zona) */
let ultimoClic = 0;
async function anadirPunto(latlng) {
  if (Date.now() - ultimoClic < 400) return;
  ultimoClic = Date.now();
  const { error } = await sb.from('puntos').insert({
    tipo: $('punto-tipo').value, nombre: $('punto-nombre').value.trim(), nota: $('punto-nota').value.trim() || null,
    lat: +latlng.lat.toFixed(7), lng: +latlng.lng.toFixed(7)
  });
  if (error) return fallo(error, 'guardar el punto');
  $('punto-nombre').value = ''; $('punto-nota').value = '';
  recargarCoto();
}

async function recargarCoto(encuadre = false) {
  try { datos = await cargarDatosCoto(); } catch (e) { return fallo(e, 'cargar los datos del coto'); }
  capas = pintarCoto(map, datos, capas, { popupParcelas: true, borrarZona: true, borrarPunto: true, aprobarPunto: true, moverPuntos: moverPunto });
  if (encuadre) encuadrar(map, capas);
  [capas.parcelas, capas.zonas].forEach(g => g.on('click', e => {
    if (!modoPunto) return;
    setTimeout(() => map.closePopup(), 0);
    anadirPunto(e.latlng);
  }));
  pintarListas();
}

async function moverPunto(pt, ll) {
  const { error } = await sb.from('puntos').update({ lat: +ll.lat.toFixed(7), lng: +ll.lng.toFixed(7) }).eq('id', pt.id);
  if (error) fallo(error, 'mover el punto');
  recargarCoto();
}

/* ---------- Listas ---------- */
function pintarListas() {
  const totalHa = datos.parcelas.reduce((s, p) => s + Number(p.ha || 0), 0);
  $('n-parcelas').textContent = datos.parcelas.length ? `${datos.parcelas.length} · ${fmtHa(totalHa)} ha` : 'ninguna';
  $('n-zonas').textContent = datos.zonas.length || '';
  const pendientes = datos.puntos.filter(p => p.estado === 'pendiente').length;
  $('n-puntos').textContent = (datos.puntos.length || '') + (pendientes ? ` · ⏳ ${pendientes} por aprobar` : '');

  $('lista-zonas').innerHTML = datos.zonas.map(z => {
    const t = TIPOS_ZONA[z.tipo];
    const ha = turf.area(turf.feature(z.geom)) / 1e4;
    return `<div class="item"><div><span class="cuadro" style="display:inline-block;vertical-align:middle;border-color:${t.color};background:${t.color}55"></span>
      <b>${t.nombre}</b> ${esc(z.nombre)}<div class="sub">${fmtHa(ha)} ha</div></div>
      <div class="acc"><button class="mini claro" data-ver-zona="${z.id}">Ver</button><button class="mini peligro" style="margin:0" data-borrar-zona="${z.id}">Borrar</button></div></div>`;
  }).join('') || '<p class="ayuda">Aún no hay zonas.</p>';

  const quien = id => (socios.find(s => s.id === id) || {}).nombre || 'un socio';
  const ordenados = [...datos.puntos].sort((a, b) => (a.estado === 'pendiente' ? 0 : 1) - (b.estado === 'pendiente' ? 0 : 1));
  $('lista-puntos').innerHTML = ordenados.map(p => {
    const t = TIPOS_PUNTO[p.tipo], pend = p.estado === 'pendiente';
    return `<div class="item"${pend ? ' style="background:#FFF6E0"' : ''}><div>${t.icono} <b>${t.nombre}</b> ${esc(p.nombre)}
      ${pend ? `<div class="sub">⏳ Pendiente · marcado por ${esc(quien(p.creado_por))}</div>` : ''}${p.nota ? `<div class="sub">${esc(p.nota)}</div>` : ''}</div>
      <div class="acc">${pend ? `<button class="mini" data-aprobar-punto="${p.id}">Aprobar</button>` : ''}<button class="mini claro" data-ver-punto="${p.id}">Ver</button><button class="mini peligro" style="margin:0" data-borrar-punto="${p.id}">Borrar</button></div></div>`;
  }).join('') || '<p class="ayuda">Aún no hay puntos.</p>';
}

/* Botones de las listas y de los globos del mapa */
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.verZona) { const z = datos.zonas.find(x => x.id === d.verZona); map.fitBounds(L.geoJSON(z.geom).getBounds(), { maxZoom: 17 }); }
  if (d.verPunto) { const p = datos.puntos.find(x => x.id === d.verPunto); map.setView([p.lat, p.lng], 17); }
  if (d.borrarZona && confirm('¿Borrar esta zona?')) {
    const { error } = await sb.from('zonas').delete().eq('id', d.borrarZona);
    if (error) return fallo(error, 'borrar la zona');
    map.closePopup(); recargarCoto();
  }
  if (d.aprobarPunto) {
    const { error } = await sb.from('puntos').update({ estado: 'aprobado' }).eq('id', d.aprobarPunto);
    if (error) return fallo(error, 'aprobar el punto');
    map.closePopup(); recargarCoto();
  }
  if (d.borrarPunto && confirm('¿Borrar este punto?')) {
    const { error } = await sb.from('puntos').delete().eq('id', d.borrarPunto);
    if (error) return fallo(error, 'borrar el punto');
    map.closePopup(); recargarCoto();
  }
});

/* ---------- Zonas y puntos ---------- */
$('zona-tipo').innerHTML = Object.entries(TIPOS_ZONA).map(([k, t]) => `<option value="${k}">${t.nombre}</option>`).join('');
$('punto-tipo').innerHTML = Object.entries(TIPOS_PUNTO).map(([k, t]) => `<option value="${k}">${t.icono} ${t.nombre}</option>`).join('');

$('btn-zona').onclick = () => {
  alternarModoPunto(false);
  const color = TIPOS_ZONA[$('zona-tipo').value].color;
  new L.Draw.Polygon(map, { showArea: false, allowIntersection: false, shapeOptions: { color, weight: 3, fillColor: color, fillOpacity: .28 } }).enable();
};

function alternarModoPunto(v = !modoPunto) {
  modoPunto = v;
  $('btn-punto').classList.toggle('modo-activo', v);
  $('btn-punto').textContent = v ? '✓ Terminar de añadir puntos' : 'Añadir puntos: pulsa en el mapa';
  $('ayuda-punto').textContent = v
    ? 'Haz clic en el mapa en cada sitio donde quieras un punto. Puedes cambiar el tipo entre uno y otro. Cuando acabes, pulsa «Terminar».'
    : 'Puedes arrastrar un punto para moverlo.';
  $('mapa-panel').style.cursor = v ? 'crosshair' : '';
}
$('btn-punto').onclick = () => alternarModoPunto();

/* ---------- Parcelas ---------- */
$('btn-catastro').onclick = async () => {
  const b = $('btn-catastro'); b.disabled = true;
  let ok = 0;
  for (const [pol, par] of PARCELAS_COTO.lista) {
    try {
      const p = await descargarParcela(pol, par);
      const { error } = await sb.from('parcelas').upsert(p);
      if (error) throw error;
      ok++; log(`✓ ${p.nombre} · ${fmtHa(p.ha)} ha`, 'ok');
    } catch (e) {
      log(`✗ Pol. ${pol} Parc. ${par}: ${e instanceof TypeError ? 'no se pudo conectar con el Catastro' : e.message}`, 'mal');
    }
  }
  log(`Cargadas ${ok} de ${PARCELAS_COTO.lista.length} parcelas.`, ok === PARCELAS_COTO.lista.length ? 'ok' : 'mal');
  b.disabled = false;
  recargarCoto(true);
};

$('btn-archivo').onclick = () => $('archivo').click();
$('archivo').onchange = async () => {
  const f = $('archivo').files[0]; $('archivo').value = '';
  if (!f) return;
  try {
    const lista = parcelasDeArchivo(JSON.parse(await f.text()));
    if (!lista.length) throw new Error('El archivo no tiene parcelas.');
    const { error } = await sb.from('parcelas').upsert(lista);
    if (error) throw error;
    log(`✓ ${lista.length} parcelas importadas de ${f.name}`, 'ok');
    recargarCoto(true);
  } catch (e) { log('✗ ' + e.message, 'mal'); }
};

/* ---------- Socios ---------- */
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const nuevoCodigo = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), n => LETRAS[n % LETRAS.length]).join('');
const urlApp = () => new URL('app.html', location.href).href;

async function recargarSocios() {
  const { data, error } = await sb.from('socios').select('*').order('creado');
  if (error) return fallo(error, 'cargar los socios');
  socios = data;
  $('n-socios').textContent = socios.length || '';
  $('lista-socios').innerHTML = socios.map(s => `
    <div class="item"><div><b>${esc(s.nombre)}</b>
      <div class="sub">${esc(s.telefono || 'sin teléfono')} · <span class="codigo">${esc(s.codigo)}</span>
      · ${s.user_id ? '<span class="ok">✓ dentro de la app</span>' : 'pendiente de entrar'}</div></div>
      <div class="acc">
        <button class="mini" data-whatsapp="${s.id}" ${s.telefono ? '' : 'disabled'}>WhatsApp</button>
        <button class="mini claro" data-codigo="${s.id}">Nuevo código</button>
        <button class="mini peligro" style="margin:0" data-borrar-socio="${s.id}">✕</button>
      </div></div>`).join('') || '<p class="ayuda">Aún no hay socios.</p>';
}

$('btn-socio').onclick = async () => {
  const nombre = $('socio-nombre').value.trim(), telefono = $('socio-tel').value.replace(/\s/g, '');
  if (!nombre) return alert('Escribe el nombre del socio.');
  const { error } = await sb.from('socios').insert({ nombre, telefono: telefono || null, codigo: nuevoCodigo() });
  if (error) return fallo(error, 'añadir el socio');
  $('socio-nombre').value = ''; $('socio-tel').value = '';
  recargarSocios();
};

$('lista-socios').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = socios.find(x => x.id === (b.dataset.whatsapp || b.dataset.codigo || b.dataset.borrarSocio));
  if (!s) return;
  if (b.dataset.whatsapp) {
    let tel = s.telefono.replace(/\D/g, ''); if (tel.length === 9) tel = '34' + tel;
    const txt = `Hola ${s.nombre.split(' ')[0]}, ya puedes probar la app del Coto Juan Cano.\n\n` +
      `1. Abre este enlace en el móvil: ${urlApp()}\n2. Mete tu código: ${s.codigo}\n` +
      `3. Para tenerla como una app: en Android, menú ⋮ > «Añadir a pantalla de inicio». En iPhone, desde Safari, botón Compartir > «Añadir a pantalla de inicio».`;
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(txt)}`, '_blank');
  }
  if (b.dataset.codigo && confirm(`¿Dar un código nuevo a ${s.nombre}? Su móvil tendrá que volver a entrar.`)) {
    const { error } = await sb.from('socios').update({ codigo: nuevoCodigo(), user_id: null }).eq('id', s.id);
    if (error) return fallo(error, 'cambiar el código');
    recargarSocios();
  }
  if (b.dataset.borrarSocio && confirm(`¿Borrar a ${s.nombre} y su acceso? No se puede deshacer.`)) {
    const { error } = await sb.from('socios').delete().eq('id', s.id);
    if (error) return fallo(error, 'borrar el socio');
    recargarSocios();
  }
});

/* ---------- En el campo ahora ---------- */
let capaCampo = null;
async function refrescarCampo() {
  try {
    const lista = await leerCompaneros();
    capaCampo = pintarCompaneros(map, capaCampo, lista, { incluirmeYo: true });
    $('n-campo').textContent = lista.length ? lista.length : '';
    $('lista-campo').innerHTML = lista.length ? lista.map(c => `<div class="item"><div>
      <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${c.color};vertical-align:middle"></span>
      <b>${esc(c.nombre)}</b><div class="sub">${haceCuanto(c.actualizado)}</div></div>
      <div class="acc"><button class="mini claro" data-ver-socio="${c.lat},${c.lng}">Ver</button></div></div>`).join('')
      : '<p class="ayuda">Nadie está compartiendo su posición ahora mismo.</p>';
  } catch (e) { console.error(e); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ver-socio]'); if (!b) return;
  const [la, ln] = b.dataset.verSocio.split(',').map(Number); map.setView([la, ln], 17);
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && modoPunto) alternarModoPunto(false); });

inicio().catch(e => { console.error(e); verAcceso('No se pudo conectar con la base de datos.'); });
