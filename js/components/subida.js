/**
 * Subida de un estudio + análisis inmediato con Dreamur-Detector.
 * Lo usan el paciente (sus propias imágenes) y el médico (imágenes de un paciente vinculado).
 *
 * Flujo: elegir imagen → pre-chequeo local (aviso rápido) → subir al backend → analizar con la IA →
 * mostrar si la imagen es válida, qué tipo de imagen reconoció y qué encontró.
 */
import { CONFIG } from '../../config.js';
import { esc, MODALIDADES } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, el, toast, leerComoURL } from '../core/ui.js';
import { radiografiasService, deteccionesService } from '../services/radiografias.service.js';
import { preverificar } from '../lib/precheck.js';
import { visor, activarVisor } from './visor.js';
import { panelResultado, panelAnalizando, marcoVisor } from './resultado.js';
import { opciones, mensajeForm } from './forms.js';

const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * @param {HTMLElement} raiz
 * @param {{pacienteId?: string|null, propia?: boolean, audiencia?: 'paciente'|'medico', alListo?: (rx, det)=>void}} opc
 *   propia: el paciente sube sus propias imágenes (cambia textos y no envía pacienteId).
 */
export function montarSubida(raiz, { pacienteId = null, propia = false, audiencia = propia ? 'paciente' : 'medico', alListo = () => {} } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  let archivo = null, urlLocal = null, pacienteActual = pacienteId;

  raiz.innerHTML = `
    <div class="grid g-2" id="sub-grid" style="align-items:start">
      <section class="card" aria-labelledby="sub-titulo">
        <div class="card-head"><div><h2 id="sub-titulo">Subir un estudio cerebral</h2>
          <p>${propia ? 'Resonancia (MRI) o tomografía (TC) de cerebro.' : 'Resonancia (MRI) o tomografía (TC) de cerebro del paciente.'}</p></div></div>
        <form class="stack" id="sub-form" novalidate>
          <label class="dropzone" id="sub-drop" for="sub-file">
            ${icono('subir')}
            <b>Arrastra la imagen aquí</b>
            <small>o toca para elegirla · JPG, PNG o WEBP · hasta ${CONFIG.MAX_ARCHIVO_MB} MB</small>
            <input class="sr-only" type="file" id="sub-file" accept="${CONFIG.TIPOS_IMAGEN.join(',')}">
          </label>
          <div class="preview-fila oculto" id="sub-prev">
            <div class="visor"><img alt="Vista previa de la imagen elegida"></div>
            <div class="stack" style="gap:.6rem"><div id="sub-nombre" class="muted" style="font-size:var(--t-sm);overflow-wrap:anywhere"></div><div id="sub-aviso"></div></div>
          </div>
          <div class="form-grid">
            <div class="field"><label for="sub-mod">Tipo de estudio</label>
              <select class="select" id="sub-mod" name="modalidad">${opciones(MODALIDADES, 'mri')}</select></div>
            <div class="field"><label for="sub-fecha">Fecha del estudio</label>
              <input class="input" type="date" id="sub-fecha" name="fechaEstudio" max="${hoy}" min="1901-01-01"></div>
            <div class="field full"><label for="sub-notas">Notas (opcional)</label>
              <textarea class="textarea" id="sub-notas" name="notas" maxlength="2000" rows="2"
                placeholder="${propia ? 'Por ejemplo: control de los 6 meses, dolores de cabeza frecuentes…' : 'Contexto clínico, indicación del estudio…'}"></textarea></div>
          </div>
          <div class="pasos oculto" id="sub-pasos" aria-live="polite">
            <span class="paso" data-paso="subir">${icono('subir')}Subiendo</span>
            <span class="paso" data-paso="analizar">${icono('escaner')}Analizando con Dreamur-Detector</span>
            <span class="paso" data-paso="listo">${icono('check')}Listo</span>
          </div>
          <div class="row">
            <button type="button" class="btn" id="sub-quitar" disabled>Quitar imagen</button>
            <button type="submit" class="btn btn-primario" id="sub-enviar" disabled>${icono('escaner')}Subir y analizar</button>
          </div>
          <p class="aviso-medico" style="margin:0">${propia
            ? 'Tu médico verá esta imagen y si Dreamur-Detector la reconoció como un estudio cerebral válido.'
            : 'El paciente verá la imagen y el resultado en su panel.'}</p>
        </form>
      </section>
      <section class="card oculto" id="sub-res" aria-live="polite" aria-label="Resultado del análisis"></section>
    </div>`;

  const form = $('#sub-form', raiz), res = $('#sub-res', raiz);
  const drop = $('#sub-drop', raiz), input = $('#sub-file', raiz);
  const prev = $('#sub-prev', raiz), aviso = $('#sub-aviso', raiz);
  const btnEnviar = $('#sub-enviar', raiz), btnQuitar = $('#sub-quitar', raiz), pasos = $('#sub-pasos', raiz);

  const marcarPaso = (clave, error = false) => {
    const orden = ['subir', 'analizar', 'listo'];
    pasos.querySelectorAll('.paso').forEach((p) => {
      const i = orden.indexOf(p.dataset.paso), a = orden.indexOf(clave);
      p.className = 'paso' + (clave === 'listo' || i < a ? ' hecho' : i === a ? (error ? ' error' : ' activo') : '');
    });
  };

  // ───── elegir archivo ─────
  async function elegir(f) {
    mensajeForm(form, '');
    aviso.innerHTML = '';
    if (!f) return quitar();
    if (!CONFIG.TIPOS_IMAGEN.includes(f.type)) { mensajeForm(form, 'Ese archivo no es una imagen JPG, PNG o WEBP.'); return quitar(); }
    if (f.size > CONFIG.MAX_ARCHIVO_MB * 1048576) { mensajeForm(form, `La imagen pesa ${tamano(f.size)} y el máximo es ${CONFIG.MAX_ARCHIVO_MB} MB.`); return quitar(); }

    archivo = f;
    if (urlLocal) URL.revokeObjectURL(urlLocal);
    urlLocal = leerComoURL(f);
    prev.querySelector('img').src = urlLocal;
    $('#sub-nombre', raiz).textContent = `${f.name} · ${tamano(f.size)}`;
    prev.classList.remove('oculto');
    drop.classList.add('oculto');
    btnEnviar.disabled = btnQuitar.disabled = false;

    try {
      const r = await preverificar(f);
      const tono = r.tipo === 'compatible' ? 'ok' : r.tipo === 'foto' ? '' : 'info';
      aviso.innerHTML = `<div class="alerta-caja ${tono}" role="status">${icono(r.tipo === 'compatible' ? 'check' : 'info')}<div>
        <p><b>${esc(r.titulo)}.</b> ${esc(r.detalle)}</p>${r.notas.map((n) => `<p class="dim">${esc(n)}</p>`).join('')}</div></div>`;
    } catch { /* el pre-chequeo es solo una ayuda; la IA decide */ }
  }

  function quitar() {
    archivo = null;
    if (urlLocal) { URL.revokeObjectURL(urlLocal); urlLocal = null; }
    input.value = '';
    prev.classList.add('oculto');
    drop.classList.remove('oculto');
    aviso.innerHTML = '';
    btnEnviar.disabled = btnQuitar.disabled = true;
  }

  input.addEventListener('change', () => elegir(input.files[0]));
  btnQuitar.addEventListener('click', quitar);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('arrastra'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('arrastra'); }));
  drop.addEventListener('drop', (e) => elegir(e.dataTransfer.files[0]));

  // ───── análisis ─────
  async function analizar(rx, src) {
    res.classList.remove('oculto');
    res.innerHTML = `<div class="stack">${visor({ src, escaneando: true })}${panelAnalizando()}</div>`;
    try {
      const det = await deteccionesService.analizar(rx.id);
      marcarPaso('listo');
      const invalida = det.imagenValida === false;
      res.innerHTML = `<div class="stack">${visor({ src, zonas: invalida ? [] : det.zonas, ...marcoVisor(det) })}
        ${panelResultado(det, rx, { audiencia, acciones: `<button type="button" class="btn" data-otra>${icono('mas')}Subir otra imagen</button>` })}</div>`;
      activarVisor(res);
      $('[data-otra]', res).onclick = reiniciar;
      toast(invalida ? 'La IA no reconoció un estudio cerebral en esta imagen.' : 'Análisis terminado.', invalida ? 'aviso' : 'ok');
      alListo(rx, det);
    } catch (e) {
      marcarPaso('analizar', true);
      res.innerHTML = `<div class="stack">${visor({ src })}
        <div class="alerta-caja lesion" role="alert">${icono('alerta')}<div>
          <p><b>La imagen se guardó, pero el análisis no terminó.</b> ${esc(e.message)}</p>
          <div class="row" style="margin-top:.6rem"><button type="button" class="btn btn-sm" data-reintentar>${icono('refrescar')}Reintentar análisis</button></div>
        </div></div></div>`;
      $('[data-reintentar]', res).onclick = () => { marcarPaso('analizar'); analizar(rx, src); };
      alListo(rx, null);
    }
  }

  function reiniciar() {
    res.classList.add('oculto');
    res.innerHTML = '';
    form.reset();
    quitar();
    pasos.classList.add('oculto');
    mensajeForm(form, '');
    raiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ───── enviar ─────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!archivo) return;
    mensajeForm(form, '');
    if (!propia && !pacienteActual) { mensajeForm(form, 'Elige primero un paciente.'); return; }

    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('modalidad', form.elements.modalidad.value);
    if (!propia) fd.append('pacienteId', pacienteActual);
    if (form.elements.fechaEstudio.value) fd.append('fechaEstudio', form.elements.fechaEstudio.value);
    const notas = form.elements.notas.value.trim();
    if (notas) fd.append('notas', notas);

    const src = urlLocal;
    pasos.classList.remove('oculto');
    marcarPaso('subir');
    btnEnviar.disabled = true; btnQuitar.disabled = true;
    btnEnviar.setAttribute('aria-busy', 'true');

    let rx;
    try {
      rx = await radiografiasService.subir(fd);
    } catch (err) {
      pasos.classList.add('oculto');
      btnEnviar.removeAttribute('aria-busy');
      btnEnviar.disabled = btnQuitar.disabled = false;
      mensajeForm(form, err.status === 409 ? 'Esta imagen ya se había subido antes. Búscala en la lista de estudios.' : err.message);
      return;
    }
    btnEnviar.removeAttribute('aria-busy');
    marcarPaso('analizar');
    await analizar(rx, src);
  });

  return {
    reiniciar,
    /** El médico puede cambiar de paciente sin recrear el formulario. */
    setPaciente(id) { pacienteActual = id; },
  };
}
