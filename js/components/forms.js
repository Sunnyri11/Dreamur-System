/** Ayudas para armar y leer formularios sin repetir marcado. */
import { esc, SEXOS, DOCUMENTOS } from '../core/format.js';

/** <option> a partir de un mapa {valor: texto}. */
export function opciones(mapa, seleccionado = '', vacio = null) {
  const base = vacio === null ? '' : `<option value="">${esc(vacio)}</option>`;
  return base + Object.entries(mapa)
    .map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(seleccionado ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

export const GRUPOS_SANGUINEOS = Object.fromEntries(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => [g, g]));

/**
 * Campo de formulario.
 * @param {{id:string, etiqueta:string, tipo?:string, valor?:any, req?:boolean, ayuda?:string, attrs?:string, completo?:boolean,
 *          opciones?:object, vacio?:string|null, filas?:number}} c
 *  Si trae `opciones` se pinta un <select>; con `filas` un <textarea>.
 */
export function campo(c) {
  const { id, etiqueta, tipo = 'text', valor = '', req = false, ayuda = '', attrs = '', completo = false } = c;
  let control;
  if (c.opciones) control = `<select class="select" id="${id}" name="${id}" ${req ? 'required' : ''} ${attrs}>${opciones(c.opciones, valor, c.vacio ?? 'Sin indicar')}</select>`;
  else if (c.filas) control = `<textarea class="textarea" id="${id}" name="${id}" rows="${c.filas}" ${attrs}>${esc(valor)}</textarea>`;
  else control = `<input class="input" id="${id}" name="${id}" type="${tipo}" value="${esc(valor)}" ${req ? 'required' : ''} ${attrs}>`;
  return `<div class="field ${completo ? 'full' : ''}"><label for="${id}" class="${req ? 'req' : ''}">${esc(etiqueta)}</label>${control}${ayuda ? `<span class="hint">${esc(ayuda)}</span>` : ''}</div>`;
}

/** Campos de identificación comunes (documento, nacimiento, sexo, teléfono). */
export function camposIdentidad(d = {}, { sufijo = '' } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  return [
    campo({ id: 'tipoDocumento' + sufijo, etiqueta: 'Tipo de documento', valor: d.tipoDocumento, opciones: DOCUMENTOS }),
    campo({ id: 'numeroDocumento' + sufijo, etiqueta: 'Número de documento', valor: d.numeroDocumento, attrs: 'maxlength="30" autocomplete="off"' }),
    campo({ id: 'fechaNacimiento' + sufijo, etiqueta: 'Fecha de nacimiento', tipo: 'date', valor: d.fechaNacimiento, attrs: `min="1901-01-01" max="${hoy}"` }),
    campo({ id: 'sexo' + sufijo, etiqueta: 'Sexo', valor: d.sexo, opciones: SEXOS }),
    campo({ id: 'telefono' + sufijo, etiqueta: 'Teléfono', tipo: 'tel', valor: d.telefono, attrs: 'maxlength="30" autocomplete="tel"' }),
  ].join('');
}

/** Lee un formulario como objeto {name: valor} con los textos recortados. */
export function leerForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === 'file' || el.type === 'submit' || el.type === 'button') continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  }
  return o;
}

/** Pone o quita un mensaje de error dentro del formulario (sin toasts). */
export function mensajeForm(form, texto, tipo = 'lesion') {
  let caja = form.querySelector('[data-mensaje]');
  if (!texto) { caja?.remove(); return; }
  if (!caja) {
    caja = document.createElement('div');
    caja.dataset.mensaje = '';
    caja.setAttribute('role', 'alert');
    form.append(caja);
  }
  caja.className = `alerta-caja ${tipo}`;
  caja.textContent = texto;
}

/** Quita claves con valor '' (para PATCH) y convierte '' en null en las indicadas. */
export const vacioANull = (o, claves) => { const r = { ...o }; for (const k of claves) if (r[k] === '') r[k] = null; return r; };
