/* =========================================================
   Carga de parcelas desde el Catastro (reutiliza el zonificador)
   ========================================================= */
const PARCELAS_COTO = {
  provincia: 'ALBACETE',
  municipio: 'VILLARROBLEDO',
  lista: [
    [150, 12], [150, 13], [150, 17], [150, 18], [150, 19], [150, 20], [150, 21], [150, 22], [150, 23],
    [150, 41], [150, 105], [150, 107], [150, 108], [150, 109], [150, 110], [150, 111], [150, 112], [150, 121],
    [100, 233], [100, 238], [100, 239], [140, 35], [150, 42], [150, 43], [150, 59], [150, 60], [110, 217]
  ]
};

proj4.defs('EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const WFS = rc => `https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx?service=wfs&version=2.0.0&request=GetFeature&STOREDQUERIE_ID=GetParcel&refcat=${rc}&srsname=EPSG::25830`;

function buscarRc(o) {
  if (!o || typeof o !== 'object') return null;
  if (typeof o.pc1 === 'string' && typeof o.pc2 === 'string') return o.pc1 + o.pc2;
  for (const k in o) { const r = buscarRc(o[k]); if (r) return r; }
  return null;
}
function buscarError(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.des && o.cod !== undefined) return o.des;
  for (const k in o) { const r = buscarError(o[k]); if (r) return r; }
  return null;
}

async function rcDePoligonoParcela(pol, par) {
  const u = `https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPPP?Provincia=${encodeURIComponent(PARCELAS_COTO.provincia)}&Municipio=${encodeURIComponent(PARCELAS_COTO.municipio)}&Poligono=${pol}&Parcela=${par}`;
  const j = await (await fetch(u)).json();
  const rc = buscarRc(j);
  if (!rc) throw new Error(buscarError(j) || `No existe el polígono ${pol}, parcela ${par}.`);
  return rc.slice(0, 14);
}

/* --- Lector GML --- */
const porNombre = (el, n) => [...el.getElementsByTagName('*')].filter(e => e.localName === n);
function cerrarAnillo(p) { if (p.length && (p[0][0] !== p[p.length - 1][0] || p[0][1] !== p[p.length - 1][1])) p.push([...p[0]]); return p; }
function anillo(el) {
  const pl = porNombre(el, 'posList')[0];
  if (!pl) return [];
  const n = pl.textContent.trim().split(/\s+/).map(Number);
  const dim = parseInt(pl.getAttribute('srsDimension') || '2') || 2;
  const pts = [];
  for (let i = 0; i + 1 < n.length; i += dim) pts.push(proj4('EPSG:25830', 'EPSG:4326', [n[i], n[i + 1]]));
  return cerrarAnillo(pts);
}
function gmlAMultipoligono(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const polis = [...doc.getElementsByTagName('*')].filter(e => e.localName === 'PolygonPatch' || e.localName === 'Polygon').map(p => {
    const ext = [...p.getElementsByTagName('*')].find(e => e.localName === 'exterior');
    if (!ext) return null;
    const anillos = [anillo(ext), ...porNombre(p, 'interior').map(anillo)];
    return anillos.every(a => a.length >= 4) ? anillos : null;
  }).filter(Boolean);
  if (!polis.length) throw new Error('El Catastro no devolvió la geometría.');
  return { type: 'MultiPolygon', coordinates: polis };
}

async function descargarParcela(pol, par) {
  const rc = await rcDePoligonoParcela(pol, par);
  const res = await fetch(WFS(rc));
  if (!res.ok) throw new Error('El Catastro respondió con error ' + res.status);
  const geom = gmlAMultipoligono(await res.text());
  const ha = turf.area(turf.feature(geom)) / 1e4;
  return { id: rc, nombre: `Pol. ${pol} Parc. ${par}`, ha: +ha.toFixed(4), geom };
}

/* Proyecto guardado con el zonificador (.json) o GeoJSON */
function parcelasDeArchivo(j) {
  const aMulti = g => g && (g.type === 'MultiPolygon' ? g : g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : null);
  let lista = [];
  if (j.parcels) lista = j.parcels.map(p => ({ id: p.refcat || p.id, nombre: p.name, geom: aMulti(p.geom) }));
  else if (j.type === 'FeatureCollection') lista = j.features.map((f, i) => ({ id: f.properties?.refcat || 'archivo-' + i, nombre: f.properties?.name || f.properties?.nombre || 'Parcela ' + (i + 1), geom: aMulti(f.geometry) }));
  return lista.filter(p => p.geom).map(p => ({ ...p, ha: +(turf.area(turf.feature(p.geom)) / 1e4).toFixed(4) }));
}
