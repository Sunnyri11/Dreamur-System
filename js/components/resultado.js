/**
 * Panel con el resultado de Dreamur-Detector. Lo usan el paciente, el médico y el detalle del estudio,
 * para que todos lean exactamente lo mismo: si la imagen es válida, qué tipo de imagen reconoció la IA y qué encontró.
 */
import { esc, fecha, pct, tipoImagen, nombreTumor } from '../core/format.js';
import { icono } from '../core/icons.js';
import { coincideModalidad, modalidadNombre } from '../lib/evolucion.js';

/** Frase principal del resultado. */
export function veredicto(det) {
  if (det.imagenValida === false) {
    return { clase: 'invalida', ico: 'alerta', titulo: 'Esta imagen no es válida para el análisis',
      sub: `Dreamur-Detector reconoció: ${tipoImagen(det.tipoImagen)}.` };
  }
  if (det.tieneTumor) {
    return { clase: 'hallazgo', ico: 'cerebro', titulo: `Posible ${nombreTumor(det.tipoTumor, det.tipoTumorNombre).toLowerCase()}`,
      sub: 'La IA marcó una zona sospechosa.' };
  }
  return { clase: 'valida', ico: 'check', titulo: 'Sin hallazgos compatibles con tumor', sub: 'La IA no marcó zonas sospechosas.' };
}

/** Clase de marco del visor según el resultado. */
export const marcoVisor = (det) => (!det ? {} : { invalida: det.imagenValida === false });

/** Estado mientras la IA trabaja. */
export const panelAnalizando = () => `
  <div class="veredicto">
    <h3><span class="spin"></span>Dreamur-Detector está revisando la imagen</h3>
    <p>Comprueba que sea un estudio cerebral y busca zonas sospechosas. La primera vez puede tardar un poco más mientras el modelo se carga.</p>
  </div>`;

/**
 * @param {object} det DeteccionDto
 * @param {object|null} rx RadiografiaDto (para comparar la modalidad indicada con el tipo reconocido y mostrar la etiqueta médica)
 * @param {{audiencia?: 'paciente'|'medico', acciones?: string}} o
 */
export function panelResultado(det, rx = null, { audiencia = 'paciente', acciones = '' } = {}) {
  const v = veredicto(det);
  const invalida = det.imagenValida === false;
  const coincide = coincideModalidad(rx?.modalidad, det.tipoImagen);
  const probs = det.probabilidades ? Object.entries(det.probabilidades).sort((a, b) => b[1] - a[1]) : [];
  const medico = audiencia === 'medico';

  const cuerpo = invalida
    ? `<div class="alerta-caja">${icono('alerta')}<div>
         <p><b>No se analizó como estudio cerebral.</b> ${esc(det.mensaje || 'La imagen no parece una resonancia ni una tomografía de cerebro, así que no se informa un resultado de tumor.')}</p>
         <p class="dim" style="margin-top:.4rem">${medico
           ? 'El paciente debe subir una resonancia (MRI) o tomografía (TC) cerebral. Puedes revisar la imagen original y, si crees que es un error, repetir el análisis.'
           : 'Sube una resonancia (MRI) o tomografía (TC) cerebral. Si crees que es un error, pide a tu médico que la revise.'}</p>
       </div></div>`
    : `<div class="alerta-caja ${coincide ? 'ok' : ''}">${icono(coincide ? 'check' : 'info')}<div>
         <p>Imagen reconocida como <b>${esc(tipoImagen(det.tipoImagen))}</b>.
         ${coincide ? '' : ` Se indicó <b>${esc(modalidadNombre(rx?.modalidad))}</b>; conviene confirmar el tipo de estudio.`}</p>
       </div></div>
       <div class="stack" style="gap:.55rem">
         <div class="prob ${det.tieneTumor ? 'fuerte' : ''}"><span class="nom"><b>Confianza</b></span>
           <span class="pista"><i style="width:${Math.round((det.confianza ?? 0) * 100)}%"></i></span><span class="val">${pct(det.confianza)}</span></div>
         ${probs.length ? `<div class="label" style="margin-top:.4rem">Probabilidad por tipo</div>` : ''}
         ${probs.map(([k, p], i) => `<div class="prob ${i === 0 && det.tieneTumor ? 'fuerte' : ''}"><span class="nom" title="${esc(nombreTumor(k))}">${esc(nombreTumor(k))}</span>
           <span class="pista"><i style="width:${Math.round(p * 100)}%"></i></span><span class="val">${pct(p)}</span></div>`).join('')}
       </div>`;

  const etiqueta = rx?.etiqueta
    ? `<div class="alerta-caja info">${icono('escudo')}<div><p>Un médico confirmó: <b>${esc(nombreTumor(rx.etiqueta.tipoTumor).toLowerCase())}</b>.
         ${rx.etiqueta.comentario ? ` «${esc(rx.etiqueta.comentario)}»` : ''}</p></div></div>` : '';

  return `
    <div class="stack">
      <div class="veredicto ${v.clase}">
        <h3>${icono(v.ico)}${esc(v.titulo)}</h3>
        <p>${esc(v.sub)} · ${esc(fecha(det.createdAt, { hora: true }))}</p>
      </div>
      ${cuerpo}
      ${etiqueta}
      <p class="aviso-medico">Resultado orientativo generado por IA. No es un diagnóstico: debe valorarlo un médico.</p>
      ${acciones ? `<div class="row">${acciones}</div>` : ''}
    </div>`;
}
