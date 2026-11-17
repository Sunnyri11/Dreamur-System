/** Galería de estudios: miniatura, tipo de estudio, fecha y, sobre todo, si la IA la reconoció como válida. */
import { esc, fecha, pct, MODALIDADES, ESTADOS } from '../core/format.js';
import { icono } from '../core/icons.js';
import { vacio, pager } from '../core/ui.js';
import { urlImagen } from '../core/api.js';
import { hallazgo, validez } from '../lib/evolucion.js';

/** Insignias que resumen un estudio (válida / no válida, resultado, confirmación, origen). */
export function insignias(rx, { mostrarOrigen = false } = {}) {
  const d = rx.ultimaDeteccion;
  const v = validez(d);
  const out = [`<span class="badge ${v.tono}" title="${esc(v.detalle)}">${icono(v.ico)}${esc(v.texto)}</span>`];
  if (d && d.imagenValida !== false) {
    const h = hallazgo({ imagenValida: true, etiquetaTipo: rx.etiqueta?.tipoTumor, tieneTumor: d.tieneTumor, tipoTumor: d.tipoTumor });
    out.push(`<span class="badge ${h.tono}">${esc(h.texto)}${h.confirmado ? '' : ` · ${pct(d.confianza)}`}</span>`);
  }
  if (rx.etiqueta) out.push(`<span class="badge info">${icono('escudo')}Confirmado</span>`);
  if (mostrarOrigen && rx.origen === 'paciente') out.push('<span class="badge violeta">Subida por el paciente</span>');
  return out.join('');
}

/** Descripción corta de lo que reconoció la IA, para listas. */
export function textoReconocido(rx) {
  const d = rx.ultimaDeteccion;
  if (!d) return 'Aún no analizada';
  return validez(d).detalle || '—';
}

/**
 * Pinta la galería en `contenedor`.
 * @param {HTMLElement} contenedor
 * @param {object[]} items RadiografiaDto[]
 * @param {{alAbrir:(rx)=>void, mostrarPaciente?:boolean, mostrarOrigen?:boolean, vacioTexto?:string}} o
 */
export function pintarGaleria(contenedor, items, { alAbrir, mostrarPaciente = false, mostrarOrigen = false, vacioTexto } = {}) {
  if (!items.length) {
    contenedor.innerHTML = vacio('imagen', 'Todavía no hay estudios', vacioTexto || 'Cuando se suba una imagen aparecerá aquí.');
    return;
  }
  contenedor.innerHTML = `<div class="galeria">${items.map((rx) => `
    <button type="button" class="estudio" data-id="${esc(rx.id)}" aria-label="Abrir estudio del ${esc(fecha(rx.fechaEstudio || rx.createdAt))}">
      <div class="visor"><img alt="" data-img="${esc(rx.id)}"></div>
      <div class="info">
        <div class="fila"><b>${esc(MODALIDADES[rx.modalidad] || rx.modalidad)}</b></div>
        <div class="fecha">${esc(fecha(rx.fechaEstudio || rx.createdAt))}${mostrarPaciente && rx.pacienteNombre ? ` · ${esc(rx.pacienteNombre)}` : ''}</div>
        <div class="fila">${insignias(rx, { mostrarOrigen })}</div>
        <div class="fecha">${esc(textoReconocido(rx))} · ${esc(ESTADOS[rx.estado] || rx.estado)}</div>
      </div>
    </button>`).join('')}</div>`;

  contenedor.querySelectorAll('.estudio').forEach((b) => {
    b.onclick = () => alAbrir(items.find((x) => x.id === b.dataset.id));
  });

  // Las imágenes son privadas: se piden con el token y se muestran como URL de objeto.
  const obs = 'IntersectionObserver' in window ? new IntersectionObserver((entradas) => {
    entradas.forEach((e) => { if (e.isIntersecting) { cargar(e.target); obs.unobserve(e.target); } });
  }, { rootMargin: '200px' }) : null;
  contenedor.querySelectorAll('img[data-img]').forEach((img) => (obs ? obs.observe(img) : cargar(img)));
}

async function cargar(img) {
  try { img.src = (await urlImagen(img.dataset.img)).url; }
  catch { img.replaceWith(Object.assign(document.createElement('span'), { className: 'dim', textContent: 'Sin vista previa' })); }
}

/**
 * Galería con paginación del servidor. `cargarPagina(pagina)` debe devolver un PagedResult de RadiografiaDto.
 * Devuelve {recargar}.
 */
export function galeriaPaginada(contenedor, cargarPagina, opciones = {}) {
  contenedor.innerHTML = '<div data-lista></div><div class="pager" data-pager></div>';
  const lista = contenedor.querySelector('[data-lista]'), pie = contenedor.querySelector('[data-pager]');
  let pagina = 1;

  async function ir(p = pagina) {
    pagina = Math.max(1, p);
    lista.innerHTML = '<div class="cargando"><span class="spin"></span>Cargando estudios…</div>';
    try {
      const r = await cargarPagina(pagina);
      if (r.totalPaginas > 0 && pagina > r.totalPaginas) return ir(r.totalPaginas);
      pintarGaleria(lista, r.items, opciones);
      r.total > r.tamanoPagina ? pager(pie, r, ir) : (pie.innerHTML = '');
      opciones.alCargar?.(r);
    } catch (e) {
      lista.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`;
    }
  }
  ir(1);
  return { recargar: () => ir(pagina), irA: ir };
}
