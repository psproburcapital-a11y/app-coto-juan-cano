/* =========================================================
   App del cazador · Fase 1: acceso, consentimiento, mapa y GPS
   ========================================================= */
const $ = id => document.getElementById(id);
const VISTAS = ['codigo', 'consentimiento', 'mapa'];
function mostrar(v) { VISTAS.forEach(x => { $('vista-' + x).hidden = x !== v; }); }

/* ---------- Inicio ---------- */
async function inicio() {
  const { data: { session } } = await sb.auth.getSession();
  const guardado = leerLocal('coto-socio');
  if (!session || !guardado) { mostrar('codigo'); return; }

  let socio = guardado;
  const r = await sb.from('socios').select('nombre,consentimiento').eq('user_id', session.user.id).maybeSingle();
  if (!r.error) {
    if (!r.data) { // el código se desactivó o se usó en otro móvil
      localStorage.removeItem('coto-socio');
      mostrar('codigo');
      $('error-codigo').textContent = 'Tu acceso ya no es válido en este móvil. Vuelve a meter tu código.';
      return;
    }
    socio = { ...guardado, ...r.data };
    guardarLocal('coto-socio', { nombre: socio.nombre });
  }
  if (!socio.consentimiento && !leerLocal('coto-consentimiento-v2')) { mostrar('consentimiento'); return; }
  abrirMapa(socio.nombre);
}

/* ---------- 1. Código ---------- */
$('codigo').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); $('error-codigo').textContent = ''; });
$('codigo').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-entrar').click(); });
$('btn-entrar').onclick = async () => {
  const c = $('codigo').value.trim().toUpperCase();
  const btn = $('btn-entrar'), err = $('error-codigo');
  if (c.length !== 6) { err.textContent = 'El código tiene 6 letras o números.'; return; }
  btn.disabled = true; btn.textContent = 'Comprobando…';
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw error;
    }
    const { data, error } = await sb.rpc('canjear_codigo', { c });
    if (error) throw error;
    if (!data) { err.textContent = 'Código no válido. Revísalo o pídeselo al gestor.'; return; }
    guardarLocal('coto-socio', { nombre: data });
    await inicio();
  } catch (e) {
    console.error(e);
    err.textContent = 'No se pudo conectar. Comprueba la cobertura e inténtalo otra vez.';
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
};

/* ---------- 2. Consentimiento ---------- */
$('btn-acepto').onclick = async () => {
  guardarLocal('coto-consentimiento-v2', new Date().toISOString());
  try { await sb.rpc('registrar_consentimiento'); } catch (e) { /* se reintenta más adelante */ }
  inicio();
};
$('btn-no-acepto').onclick = () => {
  $('error-consentimiento').textContent = 'Sin aceptar no puedes usar la app. Si tienes dudas, habla con el gestor del coto.';
};

/* ---------- 3. Mapa ---------- */
let ultimaPrec = 9999;
let map, capas, datos, vigilancia = null, marcaYo, circuloYo, ultimaPos = null, primeraPos = true, nivelZona = '';

async function abrirMapa(nombre) {
  mostrar('mapa');
  $('saludo').textContent = 'Hola, ' + String(nombre || '').split(' ')[0];
  if (!map) map = crearMapa('mapa', 'topright');
  setTimeout(() => map.invalidateSize(), 60);
  try {
    datos = await cargarDatosCoto();
    $('estado-datos').textContent = datos.sinConexion ? 'Sin conexión · datos guardados' : '';
    capas = pintarCoto(map, datos, capas, { popupParcelas: true });
    encuadrar(map, capas);
    pintarLeyenda();
  } catch (e) {
    console.error(e);
    $('estado-datos').textContent = 'No se pudo cargar el coto';
  }
  pintarCola();
  sincronizarCola();
}

function pintarLeyenda() {
  const tiposZona = [...new Set(datos.zonas.map(z => z.tipo))];
  const tiposPunto = [...new Set(datos.puntos.map(p => p.tipo))];
  $('leyenda').innerHTML =
    `<div><span class="cuadro" style="border-color:#FFE14D"></span>Parcelas del coto</div>` +
    tiposZona.map(t => `<div><span class="cuadro" style="border-color:${TIPOS_ZONA[t].color};background:${TIPOS_ZONA[t].color}55"></span>Zona ${TIPOS_ZONA[t].nombre.toLowerCase()}</div>`).join('') +
    tiposPunto.map(t => `<div><span>${TIPOS_PUNTO[t].icono}</span>${TIPOS_PUNTO[t].nombre}</div>`).join('');
}
$('btn-leyenda').onclick = () => { $('leyenda').hidden = !$('leyenda').hidden; };

/* ---------- Jornada y GPS (solo se enciende al empezar) ---------- */
$('btn-jornada').onclick = () => (vigilancia === null ? empezarJornada() : terminarJornada());

function empezarJornada() {
  if (!('geolocation' in navigator)) { $('estado-gps').textContent = 'Este móvil no tiene GPS disponible'; return; }
  try { $('opc-pantalla').checked = !!leerLocal('coto-pantalla'); } catch (e) {}
  $('hoja-jornada').hidden = false;
}
$('jornada-compartir').onclick = () => iniciarJornada(true);
$('jornada-solo').onclick = () => iniciarJornada(false);
$('jornada-cancelar').onclick = () => { $('hoja-jornada').hidden = true; };

let compartiendo = false, ultimoEnvio = 0, temporizador = null, capaComp = null, nComp = 0, bloqueoPantalla = null;

function iniciarJornada(compartir) {
  $('hoja-jornada').hidden = true;
  compartiendo = compartir;
  const pantalla = $('opc-pantalla').checked;
  guardarLocal('coto-pantalla', pantalla);
  if (pantalla) pedirPantalla();
  primeraPos = true; ultimoEnvio = 0; nComp = 0;
  $('estado-gps').textContent = 'Buscando señal GPS…';
  vigilancia = navigator.geolocation.watchPosition(nuevaPosicion, errorGps, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  const b = $('btn-jornada'); b.textContent = '■ Terminar jornada'; b.classList.add('rojo');
  $('btn-centrar').hidden = false;
  if (compartiendo) temporizador = setInterval(refrescarCompaneros, 15000);
}

async function pedirPantalla() {
  try { if ('wakeLock' in navigator) bloqueoPantalla = await navigator.wakeLock.request('screen'); } catch (e) { bloqueoPantalla = null; }
}

async function enviarPosicion(forzar = false) {
  if (!compartiendo || !ultimaPos) return;
  if (!forzar && Date.now() - ultimoEnvio < 20000) return;
  ultimoEnvio = Date.now();
  try {
    await sb.rpc('compartir_posicion', { p_lat: +ultimaPos[0].toFixed(6), p_lng: +ultimaPos[1].toFixed(6), p_prec: Math.round(ultimaPrec) });
    refrescarCompaneros();
  } catch (e) { ultimoEnvio = 0; }
}

async function refrescarCompaneros() {
  if (!compartiendo) return;
  try {
    const lista = await leerCompaneros();
    nComp = lista.filter(c => !c.soy_yo).length;
    capaComp = pintarCompaneros(map, capaComp, lista);
    pintarEstado();
  } catch (e) { /* sin cobertura: se reintenta en el siguiente ciclo */ }
}

function pintarEstado() {
  if (vigilancia === null) return;
  const gps = ultimaPos ? `GPS activo · ±${Math.round(ultimaPrec)} m` : 'Buscando señal GPS…';
  $('estado-gps').textContent = gps + (compartiendo ? ` · 👥 ${nComp} ${nComp === 1 ? 'compañero' : 'compañeros'}` : ' · solo para mí');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || vigilancia === null) return;
  if (leerLocal('coto-pantalla')) pedirPantalla();
  enviarPosicion(true);
});

function terminarJornada() {
  if (vigilancia !== null) navigator.geolocation.clearWatch(vigilancia);
  if (temporizador) { clearInterval(temporizador); temporizador = null; }
  if (compartiendo) sb.rpc('dejar_de_compartir').then(() => {}, () => {});
  compartiendo = false;
  if (capaComp) { map.removeLayer(capaComp); capaComp = null; }
  if (bloqueoPantalla) { bloqueoPantalla.release().catch(() => {}); bloqueoPantalla = null; }
  vigilancia = null; ultimaPos = null; ultimaPrec = 9999; nivelZona = '';
  if (marcaYo) { map.removeLayer(marcaYo); map.removeLayer(circuloYo); marcaYo = circuloYo = null; }
  $('alerta').hidden = true;
  $('estado-gps').textContent = 'GPS apagado';
  const b = $('btn-jornada'); b.textContent = '▶ Empezar jornada'; b.classList.remove('rojo');
  $('btn-centrar').hidden = true;
}

function nuevaPosicion(p) {
  const ll = [p.coords.latitude, p.coords.longitude], prec = p.coords.accuracy || 0;
  ultimaPos = ll; ultimaPrec = prec;
  if (!marcaYo) {
    circuloYo = L.circle(ll, { radius: prec, color: '#1F6FEB', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    marcaYo = L.circleMarker(ll, { radius: 10, color: '#fff', weight: 3, fillColor: '#1F6FEB', fillOpacity: 1 }).addTo(map);
  } else {
    marcaYo.setLatLng(ll); circuloYo.setLatLng(ll).setRadius(prec);
  }
  if (primeraPos) { map.setView(ll, Math.max(map.getZoom(), 16)); primeraPos = false; }
  pintarEstado();
  enviarPosicion();
  comprobarZona(p.coords.longitude, p.coords.latitude);
}

function errorGps(e) {
  if (e.code === 1) {
    terminarJornada();
    $('estado-gps').textContent = 'Has bloqueado el GPS. Actívalo en los ajustes del navegador.';
  } else {
    $('estado-gps').textContent = 'Sin señal GPS. Sigo buscando…';
  }
}

$('btn-centrar').onclick = () => { if (ultimaPos) map.setView(ultimaPos, Math.max(map.getZoom(), 16)); };

/* ---------- Aviso de zonas ---------- */
function comprobarZona(lng, lat) {
  if (!datos) return;
  const pt = turf.point([lng, lat]);
  const dentro = g => { try { return turf.booleanPointInPolygon(pt, g); } catch (e) { return false; } };
  const zonaDe = tipo => datos.zonas.find(z => z.tipo === tipo && dentro(z.geom));
  let nivel = '', texto = '';
  const zp = zonaDe('prohibida'), zs = zonaDe('seguridad');
  if (zp) { nivel = 'prohibida'; texto = '⛔ ZONA PROHIBIDA' + (zp.nombre ? ' · ' + zp.nombre : ''); }
  else if (zs) { nivel = 'seguridad'; texto = '⚠️ ZONA DE SEGURIDAD' + (zs.nombre ? ' · ' + zs.nombre : ''); }
  else if (datos.parcelas.length && !datos.parcelas.some(p => dentro(p.geom))) { nivel = 'fuera'; texto = 'Estás FUERA del coto'; }

  const a = $('alerta');
  a.hidden = !nivel;
  a.textContent = texto;
  a.classList.toggle('aviso', nivel !== 'prohibida');
  if (nivel && nivel !== nivelZona && navigator.vibrate) navigator.vibrate(nivel === 'prohibida' ? [500, 200, 500, 200, 500] : [300, 150, 300]);
  nivelZona = nivel;
}

/* ---------- Marcar punto aquí ---------- */
let posMarca = null, tipoMarca = null;
$('hoja-tipos').innerHTML = Object.entries(TIPOS_PUNTO).map(([k, t]) => `<button class="tipo" data-tipo="${k}"><span>${t.icono}</span>${t.nombre}</button>`).join('');

function abrirHoja() {
  tipoMarca = null; posMarca = null;
  $('hoja-nombre').value = ''; $('hoja-error').textContent = '';
  document.querySelectorAll('#hoja-tipos .tipo').forEach(b => b.classList.remove('elegido'));
  $('hoja-guardar').disabled = true;
  $('hoja').hidden = false;
  if (ultimaPos && ultimaPrec <= 30) { posMarca = { lat: ultimaPos[0], lng: ultimaPos[1], prec: ultimaPrec }; pintarPosHoja(); return; }
  $('hoja-pos').textContent = '📡 Buscando tu posición…';
  navigator.geolocation.getCurrentPosition(p => {
    posMarca = { lat: p.coords.latitude, lng: p.coords.longitude, prec: p.coords.accuracy || 0 };
    pintarPosHoja();
  }, e => {
    $('hoja-pos').textContent = e.code === 1 ? '⚠️ Has bloqueado el GPS. Actívalo en los ajustes del navegador.' : '⚠️ No encuentro señal GPS. Muévete a un sitio despejado e inténtalo otra vez.';
  }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
}
function pintarPosHoja() {
  const p = Math.round(posMarca.prec);
  $('hoja-pos').textContent = `📍 Posición encontrada · precisión ±${p} m` + (p > 30 ? ' (poco precisa: espera un poco o muévete a un claro)' : '');
  $('hoja-guardar').disabled = !tipoMarca;
}
function cerrarHoja() { $('hoja').hidden = true; }

$('btn-marcar').onclick = abrirHoja;
$('hoja-cancelar').onclick = cerrarHoja;
$('hoja-tipos').addEventListener('click', e => {
  const b = e.target.closest('.tipo'); if (!b) return;
  tipoMarca = b.dataset.tipo;
  document.querySelectorAll('#hoja-tipos .tipo').forEach(x => x.classList.toggle('elegido', x === b));
  $('hoja-guardar').disabled = !posMarca;
});
$('hoja-guardar').onclick = async () => {
  const b = $('hoja-guardar'); b.disabled = true; b.textContent = 'Guardando…';
  const punto = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    tipo: tipoMarca, nombre: $('hoja-nombre').value.trim(),
    lat: +posMarca.lat.toFixed(7), lng: +posMarca.lng.toFixed(7), hora: new Date().toISOString()
  };
  try {
    if (!navigator.onLine) { encolar(punto); return; }
    const r = await enviarPunto(punto);
    if (r.red) { encolar(punto); return; }
    if (r.error) throw r.error;
    cerrarHoja();
    aviso(r.data === 'aprobado' ? '✅ Punto guardado en el mapa' : '✅ Enviado al gestor. Aparecerá cuando lo apruebe.');
    if (r.data === 'aprobado') await refrescarCoto();
  } catch (e) {
    console.error(e);
    $('hoja-error').textContent = 'No se pudo guardar el punto. Inténtalo otra vez.';
  } finally { b.textContent = 'Guardar punto'; b.disabled = !(tipoMarca && posMarca); }
};

/* ---------- Puntos sin cobertura: se guardan en el móvil y se envían solos ---------- */
const CLAVE_COLA = 'coto-cola-puntos';
const leerCola = () => leerLocal(CLAVE_COLA) || [];
let capaCola = null, enviando = false;

function esErrorDeRed(e) {
  const m = String((e && (e.message || e.details)) || e || '');
  return /fetch|network|load failed|timeout|tiempo|offline|conex/i.test(m);
}
/* Envía un punto. Devuelve {data} si va bien, {red:true} si no hay señal, {error} si el servidor lo rechaza */
async function enviarPunto(p) {
  try {
    const llamada = sb.rpc('marcar_punto', { p_tipo: p.tipo, p_nombre: p.nombre, p_lat: p.lat, p_lng: p.lng });
    const limite = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
    const { data, error } = await Promise.race([llamada, limite]);
    if (error) return esErrorDeRed(error) ? { red: true } : { error };
    return { data };
  } catch (e) { return esErrorDeRed(e) ? { red: true } : { error: e }; }
}
function encolar(p) {
  const cola = leerCola(); cola.push(p); guardarLocal(CLAVE_COLA, cola);
  cerrarHoja();
  aviso('📴 Sin cobertura: punto guardado en el móvil. Se enviará solo cuando haya señal.');
  pintarCola();
}
function pintarCola() {
  if (!map) return;
  const cola = leerCola();
  if (capaCola) map.removeLayer(capaCola);
  capaCola = L.featureGroup();
  cola.forEach(p => {
    const t = TIPOS_PUNTO[p.tipo] || TIPOS_PUNTO.otro;
    L.marker([p.lat, p.lng], { icon: iconoPunto(p.tipo), opacity: .55 })
      .bindPopup(`<b>${esc(t.nombre)}</b> ⏳ pendiente de enviar${p.nombre ? '<br>' + esc(p.nombre) : ''}<br><small>Marcado ${new Date(p.hora).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>`)
      .addTo(capaCola);
  });
  capaCola.addTo(map);
  $('cola-info').textContent = cola.length ? `⏳ ${cola.length} ${cola.length === 1 ? 'punto' : 'puntos'} por enviar` : '';
}
async function sincronizarCola() {
  if (enviando || !navigator.onLine) return;
  let cola = leerCola(); if (!cola.length) return;
  enviando = true;
  let ok = 0, pendientes = 0;
  try {
    for (const p of cola) {
      const r = await enviarPunto(p);
      if (r.red) break;
      if (r.error) { console.error(r.error); break; }
      ok++;
      if (r.data === 'pendiente') pendientes++;
      cola = leerCola().filter(x => x.id !== p.id); guardarLocal(CLAVE_COLA, cola);
    }
  } finally { enviando = false; }
  if (ok) {
    aviso(`📶 ${ok} ${ok === 1 ? 'punto enviado' : 'puntos enviados'}` + (pendientes ? ` (${pendientes} esperan la aprobación del gestor)` : ''));
    await refrescarCoto();
  }
  pintarCola();
}
async function refrescarCoto() {
  try { datos = await cargarDatosCoto(); capas = pintarCoto(map, datos, capas, { popupParcelas: true }); pintarLeyenda(); } catch (e) {}
}
window.addEventListener('online', sincronizarCola);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizarCola(); });
setInterval(sincronizarCola, 30000);

function aviso(txt) {
  const a = $('toast'); a.textContent = txt; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.hidden = true; }, 4000);
}

/* ---------- Arranque ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw2.js').catch(() => {});
inicio().catch(e => { console.error(e); mostrar('codigo'); });
