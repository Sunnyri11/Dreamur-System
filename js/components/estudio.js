/**
 * Detalle de un estudio en una ventana: imagen con zonas, resultado de Dreamur-Detector (¿es válida? ¿qué tipo de imagen es?),
 * historial de análisis, diagnóstico confirmado por el médico, PDF del estudio y acciones.
 */
import { esc, fecha, pct, nombreTumor, MODALIDADES, ESTADOS, ORIGENES } from '../core/format.js';
import { icono } from '../core/icons.js';
import { el, modal, cargando, confirmar, accion, ok, fallo } from '../core/ui.js';
import { urlImagen } from '../core/api.js';
import { radiografiasService, deteccionesService, etiquetasService } from '../services/radiografias.service.js';
import { pacientesService } from '../services/pacientes.service.js';
import { catalogoService } from '../services/catalogo.service.js';
import { visor, activarVisor } from './visor.js';
import { panelResultado, panelAnalizando, marcoVisor } from './resultado.js';
import { informeEstudio, descargarInforme } from './informe.js';
import { opciones } from './forms.js';
import { campoModelo3D, activarModelo3D } from './modelo3d.js';


/**
 * @param {object} rx RadiografiaDto (se vuelve a pedir para tener lo último)
 * @param {{usuario: object, paciente?: object|null, alCambiar?: ()=>void}} o
 */
export async function abrirEstudio(rx, { usuario, paciente = null, alCambiar = () => {} } = {}) {
  const staff = usuario.rol === 'medico' || usuario.rol === 'admin';
  const audiencia = usuario.rol === 'paciente' ? 'paciente' : 'medico';

  const btnPdf = el(`<button class="btn">${icono('documento')}Descargar PDF</button>`);
  const btnReanalizar = el(`<button class="btn">${icono('refrescar')}Analizar de nuevo</button>`);
  const btnEliminar = el(`<button class="btn btn-peligro">${icono('basura')}Eliminar</button>`);
  const m = modal({ titulo: 'Estudio cerebral', cuerpo: cargando('Cargando estudio…'), pie: [btnEliminar, btnReanalizar, btnPdf], tamano: 'ancho' });
  [btnEliminar, btnReanalizar, btnPdf].forEach((b) => (b.disabled = true));

  let actual = rx, historial = [], src = null, tipos = [];

  async function cargar() {
    const [fresco, hist, img, cat] = await Promise.all([
      radiografiasService.obtener(rx.id),
      deteccionesService.historial(rx.id),
      urlImagen(rx.id).catch(() => null),
      staff ? catalogoService.tiposTumor().catch(() => []) : [],
    ]);
    actual = fresco; historial = hist; src = img?.url ?? null; tipos = cat;
  }

  function pintar() {
    const det = historial[0] ?? null;           // el análisis más reciente
    const invalida = det?.imagenValida === false;
    const puedeEliminar = (usuario.rol === 'paciente' && actual.origen === 'paciente') || usuario.rol === 'admin';
    btnEliminar.hidden = !puedeEliminar;
    btnReanalizar.disabled = false; btnPdf.disabled = false; btnEliminar.disabled = false;
    btnReanalizar.lastChild.textContent = det ? 'Analizar de nuevo' : 'Analizar con la IA';

    const titulo = `${MODALIDADES[actual.modalidad] || actual.modalidad} · ${fecha(actual.fechaEstudio || actual.createdAt)}`;
    m.fondo.querySelector('.modal-head h2').textContent = titulo;

    const izquierda = `
      <div class="stack">
        ${src ? visor({ src, zonas: invalida || !det ? [] : det.zonas, ...marcoVisor(det) }) : '<div class="alerta-caja lesion">No se pudo cargar la imagen.</div>'}
        <dl class="meta-lista">
          <dt>Paciente</dt><dd>${esc(actual.pacienteNombre || '—')} ${actual.pacienteCodigo ? `<span class="codigo">${esc(actual.pacienteCodigo)}</span>` : ''}</dd>
          <dt>Origen</dt><dd>${esc(ORIGENES[actual.origen] || actual.origen)}</dd>
          <dt>Estado</dt><dd>${esc(ESTADOS[actual.estado] || actual.estado)}</dd>
          <dt>Subida el</dt><dd>${esc(fecha(actual.createdAt, { hora: true }))}</dd>
          ${actual.notas ? `<dt>Notas</dt><dd>${esc(actual.notas)}</dd>` : ''}
        </dl>
      </div>`;

    const resultado = det
      ? panelResultado(det, actual, { audiencia })
      : `<div class="alerta-caja info">${icono('info')}<div><p><b>Este estudio todavía no fue analizado.</b></p>
           <p class="dim" style="margin-top:.3rem">Pulsa «Analizar con la IA» para que Dreamur-Detector compruebe si es un estudio cerebral válido y busque zonas sospechosas.</p></div></div>`;

    const confirmacion = staff && det && !invalida ? `
      <form class="card plana stack" id="et-form" style="padding:1rem">
        <div><h3>Confirmar diagnóstico</h3>
          <p class="dim" style="font-size:var(--t-xs);margin:.2rem 0 0">Tu confirmación manda sobre el resultado de la IA y, si el paciente lo permitió, ayuda a reentrenar el modelo.</p></div>
        <div class="field"><label for="et-tipo">Diagnóstico</label>
          <select class="select" id="et-tipo" name="tipo">${opciones(Object.fromEntries(tipos.map((t) => [t.codigo, t.nombre])), actual.etiqueta?.tipoTumor || det.tipoTumor)}</select></div>
        <div class="field"><label for="et-com">Comentario (opcional)</label>
          <textarea class="textarea" id="et-com" name="comentario" rows="2" maxlength="2000">${esc(actual.etiqueta?.comentario || '')}</textarea></div>
        <div class="row"><button class="btn btn-primario btn-sm" type="submit">${icono('escudo')}${actual.etiqueta ? 'Actualizar diagnóstico' : 'Guardar diagnóstico'}</button>
          ${actual.etiqueta ? `<button class="btn btn-sm btn-fantasma" type="button" data-quitar>Quitar confirmación</button>` : ''}</div>
      </form>` : '';

    const previos = historial.slice(1);
    const hist = previos.length ? `
      <details class="json"><summary>Análisis anteriores (${previos.length})</summary>
        <ul class="lista-simple" style="margin-top:.5rem">${previos.map((d) => `<li><span>${esc(fecha(d.createdAt, { hora: true }))}</span>
          <span>${d.imagenValida === false ? 'No válida' : `${esc(nombreTumor(d.tipoTumor, d.tipoTumorNombre))} · ${pct(d.confianza)}`}</span></li>`).join('')}</ul></details>` : '';

    m.body.innerHTML = `<div class="grid g-2" style="align-items:start">${izquierda}<div class="stack">${resultado}${campoModelo3D(det)}${confirmacion}${hist}</div></div>`;
    activarVisor(m.body);
    activarModelo3D(m.body, det);

    const form = m.body.querySelector('#et-form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        accion(form.querySelector('[type=submit]'), async () => {
          await etiquetasService.guardar(actual.id, form.elements.tipo.value, form.elements.comentario.value.trim());
          ok('Diagnóstico confirmado.');
          await recargar(); alCambiar();
        });
      };
      const q = form.querySelector('[data-quitar]');
      if (q) q.onclick = () => accion(q, async () => { await etiquetasService.eliminar(actual.id); ok('Confirmación eliminada.'); await recargar(); alCambiar(); });
    }
  }

  async function recargar() { await cargar(); pintar(); }

  btnReanalizar.onclick = () => accion(btnReanalizar, async () => {
    m.body.innerHTML = `<div class="grid g-2" style="align-items:start"><div>${src ? visor({ src, escaneando: true }) : ''}</div>${panelAnalizando()}</div>`;
    try { await deteccionesService.analizar(actual.id); ok('Análisis terminado.'); }
    catch (e) { fallo(e); }
    await recargar(); alCambiar();
  });

  btnPdf.onclick = () => accion(btnPdf, async () => {
    const datos = paciente ?? await (usuario.rol === 'paciente' ? pacientesService.obtenerMio() : actual.pacienteId ? pacientesService.obtener(actual.pacienteId) : null).catch(() => null);
    await descargarInforme(() => informeEstudio({ rx: actual, det: historial[0] ?? null, paciente: datos }));
  });

  btnEliminar.onclick = async () => {
    const si = await confirmar({ titulo: 'Eliminar imagen', mensaje: 'La imagen dejará de verse en tu historial y en la evolución. ¿Seguro?', aceptar: 'Eliminar', peligro: true });
    if (!si) return;
    await accion(btnEliminar, async () => { await radiografiasService.eliminar(actual.id); ok('Imagen eliminada.'); m.cerrar(); alCambiar(); });
  };

  try { await cargar(); pintar(); }
  catch (e) { m.body.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  return m;
}
