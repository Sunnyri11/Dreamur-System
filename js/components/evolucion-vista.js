/**
 * Panel de estadísticas de evolución de un paciente: indicadores, tendencia, gráficas, distribución e historial.
 * Se reutiliza en la página de evolución del paciente y en la ficha que ve el médico.
 */
import { esc, fecha, fechaCorta, pct } from '../core/format.js';
import { icono } from '../core/icons.js';
import { vacio } from '../core/ui.js';
import { lineaTiempo } from '../lib/charts.js';
import { hallazgo, areaPct, resumen, series, tendencia, fechaItem, ordenar, modalidadNombre, plural, tipoImagen } from '../lib/evolucion.js';

const COLOR_AREA = '#db6686';      // --viz-rosa
const COLOR_CONFIANZA = '#00a3d6'; // --viz-cian
const fmtArea = (y) => `${+(y * 100).toFixed(y < 0.1 ? 1 : 0)}%`;

export function indicadores(items, totalImagenes) {
  const r = resumen(items, totalImagenes);
  const u = r.ultimo, hu = u ? hallazgo(u) : null;
  const tonoKpi = hu?.tono === 'lesion' ? 'lesion' : hu?.tono === 'ok' ? 'vital' : '';
  return `
    <div class="grid g-4">
      <div class="kpi"><span class="etq">Imágenes subidas</span><span class="valor num">${r.totalImagenes}</span>
        <span class="sub">${r.sinAnalizar ? `${r.sinAnalizar} sin analizar` : 'Todas analizadas'}</span></div>
      <div class="kpi ${r.validas ? 'vital' : ''}"><span class="etq">Estudios válidos</span><span class="valor num">${r.validas}</span>
        <span class="sub">${r.invalidas ? plural(r.invalidas, 'imagen no válida', 'imágenes no válidas') : 'Ninguna imagen descartada'}</span></div>
      <div class="kpi ${tonoKpi}"><span class="etq">Último resultado</span><span class="valor" style="font-size:1.35rem;padding-top:.35rem">${esc(hu ? hu.texto : 'Sin datos')}</span>
        <span class="sub">${u ? `${esc(fecha(fechaItem(u)))} · ${hu.confirmado ? 'confirmado por un médico' : 'según la IA'}` : 'Aún no hay estudios válidos'}</span></div>
      <div class="kpi ${hu?.clave === 'tumor' ? 'lesion' : ''}"><span class="etq">Zona marcada (último estudio)</span><span class="valor num">${u ? `${areaPct(u)}%` : '—'}</span>
        <span class="sub">${r.revisadas ? `${plural(r.revisadas, 'estudio revisado', 'estudios revisados')} por médico` : 'de la imagen'}</span></div>
    </div>`;
}

export function tarjetaTendencia(items, paraPaciente = true) {
  const t = tendencia(items, paraPaciente);
  return `<div class="tendencia ${t.tono}">
    <div class="ico">${icono(t.icono)}</div>
    <div><h3>${esc(t.titulo)}</h3><p>${esc(t.texto)}</p><p class="dim" style="font-size:var(--t-xs)">${esc(t.aviso)}</p></div></div>`;
}

export function distribucion(items) {
  const r = resumen(items);
  const ent = Object.entries(r.distribucion).sort((a, b) => b[1] - a[1]);
  if (!ent.length) return vacio('tendencia', 'Sin resultados todavía', 'Aparecerán cuando haya estudios válidos analizados.');
  const max = Math.max(...ent.map(([, n]) => n));
  return `<div class="stack" style="gap:.6rem">${ent.map(([nombre, n]) => `
      <div class="barra-h"><span title="${esc(nombre)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nombre)}</span>
        <span class="pista"><i style="width:${Math.round((n / max) * 100)}%;background:${nombre === 'Sin tumor' ? 'var(--viz-menta)' : 'var(--viz-rosa)'}"></i></span><span class="num">${n}</span></div>`).join('')}</div>
    <p class="dim" style="font-size:var(--t-xs);margin-top:.8rem">Cantidad de estudios válidos con cada resultado.</p>`;
}

/** Dos gráficas con su propio eje: la zona marcada (pocos puntos porcentuales) y la confianza (0–100 %). */
export function pintarGraficas(raiz, items) {
  const s = series(items);
  if (!s.items.length) {
    raiz.innerHTML = vacio('tendencia', 'Aún no hay datos para graficar', 'Cuando haya estudios válidos verás aquí cómo cambia la zona marcada.');
    return;
  }
  raiz.innerHTML = `<div class="grid g-2">
    <div><h3>Zona marcada por la IA</h3><p class="dim" style="font-size:var(--t-xs)">Porcentaje de la imagen que ocupa la zona sospechosa.</p><div data-g="area"></div></div>
    <div><h3>Confianza de la IA</h3><p class="dim" style="font-size:var(--t-xs)">Qué tan segura estuvo la IA de cada resultado.</p><div data-g="conf"></div></div></div>`;
  const tip = (valor) => (p) => `<b>${valor(p.y)}</b>${esc(fecha(fechaItem(p.i)))} · ${esc(modalidadNombre(p.i.modalidad))}<br>${esc(hallazgo(p.i).texto)}`;
  lineaTiempo(raiz.querySelector('[data-g="area"]'), s.area, {
    color: COLOR_AREA, formato: fmtArea, tooltip: tip(fmtArea), descripcion: 'Zona marcada por la IA en cada estudio, en porcentaje de la imagen',
  });
  lineaTiempo(raiz.querySelector('[data-g="conf"]'), s.confianza, {
    color: COLOR_CONFIANZA, max: 1, formato: (y) => `${Math.round(y * 100)}%`, tooltip: tip((y) => `${Math.round(y * 100)}%`),
    descripcion: 'Confianza de la IA en cada estudio',
  });
}

/** Historial como tabla (también sirve como alternativa accesible a las gráficas). */
export function tablaHistorial(items) {
  if (!items.length) return vacio('reloj', 'Todavía no hay estudios analizados', 'Cada imagen analizada aparecerá aquí, ordenada por fecha.');
  const filas = [...items].reverse().map((i) => {
    const h = hallazgo(i), valida = i.imagenValida !== false;
    return `<tr>
      <td class="num">${esc(fecha(fechaItem(i)))}</td>
      <td>${esc(modalidadNombre(i.modalidad))}</td>
      <td><span class="badge ${valida ? 'ok' : 'alerta'}">${icono(valida ? 'check' : 'alerta')}${valida ? 'Válida' : 'No válida'}</span>
          <div class="dim" style="font-size:var(--t-xs);margin-top:2px">${esc(tipoImagen(i.tipoImagen))}</div></td>
      <td><span class="badge ${h.tono}">${esc(h.texto)}</span>${h.confirmado ? '<div class="dim" style="font-size:var(--t-xs);margin-top:2px">Confirmado por médico</div>' : ''}</td>
      <td class="num">${valida ? pct(i.confianza) : '—'}</td>
      <td class="num">${valida ? `${areaPct(i)}%` : '—'}</td>
      <td class="acciones"><button class="btn btn-sm" data-abrir="${esc(i.radiografiaId)}">${icono('ojo')}Ver</button></td></tr>`;
  }).join('');
  return `<div class="tabla-wrap"><table class="tabla">
    <thead><tr><th>Fecha</th><th>Estudio</th><th>Imagen (según la IA)</th><th>Resultado</th><th>Confianza</th><th>Zona</th><th></th></tr></thead>
    <tbody>${filas}</tbody></table></div>`;
}

/**
 * Vista completa de evolución.
 * @param {{paraPaciente?: boolean, alAbrirEstudio?: (radiografiaId: string)=>void}} o
 */
export function pintarEvolucion(raiz, evo, { paraPaciente = true, alAbrirEstudio } = {}) {
  const items = ordenar(evo.items);
  raiz.innerHTML = `
    <div class="stack" style="gap:1.2rem">
      ${indicadores(items, evo.totalImagenes)}
      <div class="grid g-2" style="align-items:start">
        <section class="card"><div class="card-head"><h2>${paraPaciente ? 'Cómo va tu evolución' : 'Tendencia'}</h2></div>${tarjetaTendencia(items, paraPaciente)}</section>
        <section class="card"><div class="card-head"><h2>Resultados</h2></div>${distribucion(items)}</section>
      </div>
      <section class="card"><div class="card-head"><h2>Evolución por estudio</h2></div><div data-graficas></div></section>
      <section class="card"><div class="card-head"><h2>Historial de estudios</h2></div>${tablaHistorial(items)}</section>
    </div>`;
  pintarGraficas(raiz.querySelector('[data-graficas]'), items);
  raiz.querySelectorAll('[data-abrir]').forEach((b) => { b.onclick = () => alAbrirEstudio?.(b.dataset.abrir); });
}

/** Resumen escrito de lo que lleva el informe PDF (pestaña «Reporte»). */
export function cajaReporte(paciente, evo, paraPaciente = true) {
  const items = ordenar(evo.items);
  const r = resumen(items, evo.totalImagenes);
  const t = tendencia(items, paraPaciente);
  const u = r.ultimo, hu = u ? hallazgo(u) : null;
  return `
    <div class="stack">
      <dl class="ficha">
        <div><dt>Paciente</dt><dd>${esc(paciente.nombres)} ${esc(paciente.apellidos)}</dd></div>
        <div><dt>Código</dt><dd>${esc(paciente.codigo || '—')}</dd></div>
        <div><dt>Seguimiento</dt><dd>${r.primeraFecha ? `${esc(fecha(r.primeraFecha))} → ${esc(fecha(r.ultimaFecha))}` : 'Sin estudios'}</dd></div>
      </dl>
      <ul class="lista-simple">
        <li><span>Imágenes subidas</span><b class="num">${r.totalImagenes}</b></li>
        <li><span>Estudios válidos / no válidos</span><b class="num">${r.validas} / ${r.invalidas}</b></li>
        <li><span>Estudios con hallazgo</span><b class="num">${r.conHallazgo}</b></li>
        <li><span>Revisados por un médico</span><b class="num">${r.revisadas}</b></li>
        ${u ? `<li><span>Último estudio válido (${esc(fecha(fechaItem(u)))})</span><b>${esc(hu.texto)}${hu.confirmado ? ' · confirmado' : ''}</b></li>` : ''}
      </ul>
      ${tarjetaTendencia(items, paraPaciente)}
      <p class="aviso-medico">El PDF incluye los datos del paciente, las gráficas de evolución, la tabla de estudios y la imagen del último estudio con sus zonas marcadas.</p>
    </div>`;
}
