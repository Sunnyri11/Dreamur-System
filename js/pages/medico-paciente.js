/** Ficha del paciente para el médico: estudios, Dreamur-Detector, evolución, reporte PDF y datos personales. */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { esc, fecha, edad, nombreCompleto, iniciales, limpiarPayload } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, accion, ok, cargando } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { radiografiasService } from '../services/radiografias.service.js';
import { montarSubida } from '../components/subida.js';
import { galeriaPaginada } from '../components/galeria.js';
import { abrirEstudio } from '../components/estudio.js';
import { pintarEvolucion, cajaReporte } from '../components/evolucion-vista.js';
import { informeEvolucion, descargarInforme } from '../components/informe.js';
import { activarTabs } from '../components/tabs.js';
import { camposIdentidad, leerForm, mensajeForm, campo, opciones, GRUPOS_SANGUINEOS } from '../components/forms.js';

const shell = montarShell({ roles: ['medico'], activa: 'inicio', titulo: 'Ficha del paciente' });
if (shell) iniciar(shell);

async function iniciar({ usuario, contenido }) {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { location.replace(`${RAIZ}medico/inicio.html`); return; }
  contenido.innerHTML = cargando('Cargando ficha…');

  let paciente;
  try { paciente = await pacientesService.obtener(id); }
  catch (e) {
    contenido.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<div><p>${esc(e.message)}</p><p><a href="${RAIZ}medico/inicio.html">Volver a mis pacientes</a></p></div></div>`;
    return;
  }

  contenido.innerHTML = `
    <div class="page-head"><div class="persona grande"><span class="avatar">${esc(iniciales(paciente))}</span>
      <div><h1>${esc(nombreCompleto(paciente))}</h1>
        <p><span class="codigo">${esc(paciente.codigo)}</span>${paciente.fechaNacimiento ? ` · ${esc(edad(paciente.fechaNacimiento))} años` : ''}${paciente.correo ? ` · ${esc(paciente.correo)}` : ''}</p></div></div>
      <div class="page-actions"><a class="btn" href="${RAIZ}medico/inicio.html">${icono('usuarios')}Mis pacientes</a></div></div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="estudios">Estudios</button>
      <button class="tab" role="tab" data-tab="detector">Dreamur-Detector</button>
      <button class="tab" role="tab" data-tab="evolucion">Evolución</button>
      <button class="tab" role="tab" data-tab="reporte">Reporte</button>
      <button class="tab" role="tab" data-tab="datos">Datos</button></div>
    <div class="panel-tab" data-panel="estudios"><section class="card"><div class="card-head"><div><h2>Estudios del paciente</h2>
      <p>Incluye las imágenes que subió el propio paciente, con la validez que determinó la IA.</p></div></div><div id="galeria"></div></section></div>
    <div class="panel-tab" data-panel="detector" hidden><div id="subida"></div></div>
    <div class="panel-tab" data-panel="evolucion" hidden><div id="evo">${cargando()}</div></div>
    <div class="panel-tab" data-panel="reporte" hidden><section class="card"><div class="card-head"><h2>Reporte de evolución</h2>
      <button class="btn btn-primario" id="pdf">${icono('documento')}Descargar PDF</button></div><div id="rep">${cargando()}</div></section></div>
    <div class="panel-tab" data-panel="datos" hidden><section class="card"><div class="card-head"><h2>Datos personales</h2></div><div id="datos"></div></section></div>`;

  const abrir = (rx) => abrirEstudio(rx, { usuario, paciente, alCambiar: () => { galeria.recargar(); evo = null; if (tabActual === 'evolucion' || tabActual === 'reporte') cargarEvolucion(); } });
  const galeria = galeriaPaginada($('#galeria'), (pagina) => radiografiasService.listar({ pagina, tamanoPagina: 9, pacienteId: id }), {
    alAbrir: abrir, mostrarOrigen: true, vacioTexto: 'Este paciente aún no tiene imágenes. Sube la primera desde la pestaña Dreamur-Detector.',
  });
  montarSubida($('#subida'), { pacienteId: id, propia: false, alListo: () => { galeria.recargar(); evo = null; } });

  // ───── evolución y reporte ─────
  let evo = null, tabActual = 'estudios';
  async function cargarEvolucion() {
    try {
      if (!evo) evo = await pacientesService.evolucion(id);
      pintarEvolucion($('#evo'), evo, { paraPaciente: false, alAbrirEstudio: (rid) => abrir({ id: rid }) });
      $('#rep').innerHTML = cajaReporte(paciente, evo, false);
    } catch (e) {
      const msg = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`;
      $('#evo').innerHTML = msg; $('#rep').innerHTML = msg;
    }
  }
  $('#pdf').onclick = (ev) => accion(ev.currentTarget, async () => {
    if (!evo) evo = await pacientesService.evolucion(id);
    await descargarInforme(() => informeEvolucion({ paciente, evo, paraPaciente: false }));
  });
  activarTabs(contenido, { alCambiar: (t) => { tabActual = t; if (t === 'evolucion' || t === 'reporte') cargarEvolucion(); } });

  // ───── datos personales (editables por el médico vinculado) ─────
  function pintarDatos() {
    $('#datos').innerHTML = `<form class="stack" novalidate><div class="form-grid">
      ${campo({ id: 'nombres', etiqueta: 'Nombres', valor: paciente.nombres, req: true, attrs: 'maxlength="100" minlength="2"' })}
      ${campo({ id: 'apellidos', etiqueta: 'Apellidos', valor: paciente.apellidos, req: true, attrs: 'maxlength="100" minlength="2"' })}
      ${camposIdentidad(paciente)}
      ${campo({ id: 'direccion', etiqueta: 'Dirección', valor: paciente.direccion, completo: true, attrs: 'maxlength="250"' })}
      ${campo({ id: 'ciudad', etiqueta: 'Ciudad', valor: paciente.ciudad, attrs: 'maxlength="100"' })}
      ${campo({ id: 'pais', etiqueta: 'País (código de 2 letras)', valor: paciente.pais, attrs: 'maxlength="2" minlength="2" placeholder="BO"' })}
      ${campo({ id: 'grupoSanguineo', etiqueta: 'Grupo sanguíneo', valor: paciente.grupoSanguineo, opciones: GRUPOS_SANGUINEOS })}
      ${campo({ id: 'contactoEmergencia', etiqueta: 'Contacto de emergencia', valor: paciente.contactoEmergencia, attrs: 'maxlength="150"' })}
      ${campo({ id: 'telefonoEmergencia', etiqueta: 'Teléfono de emergencia', tipo: 'tel', valor: paciente.telefonoEmergencia, attrs: 'maxlength="30"' })}
      ${campo({ id: 'alergias', etiqueta: 'Alergias', valor: paciente.alergias, completo: true, filas: 2, attrs: 'maxlength="1000"' })}
      ${campo({ id: 'antecedentes', etiqueta: 'Antecedentes médicos', valor: paciente.antecedentes, completo: true, filas: 3, attrs: 'maxlength="2000"' })}
      </div>
      <div class="row"><button class="btn btn-primario" type="submit">${icono('check')}Guardar cambios</button>
        <span class="dim">Alta: ${esc(fecha(paciente.createdAt))}</span></div></form>`;
    const form = $('#datos form');
    form.onsubmit = (e) => {
      e.preventDefault();
      mensajeForm(form, '');
      const d = leerForm(form);
      if (d.nombres.length < 2 || d.apellidos.length < 2) return mensajeForm(form, 'Nombres y apellidos deben tener al menos 2 caracteres.');
      if (d.pais && d.pais.length !== 2) return mensajeForm(form, 'El país se indica con 2 letras (por ejemplo BO).');
      if (d.pais) d.pais = d.pais.toUpperCase();
      accion(form.querySelector('[type=submit]'), async () => {
        try {
          paciente = await pacientesService.actualizar(id, limpiarPayload(d, { cerrados: ['tipoDocumento', 'sexo', 'grupoSanguineo', 'fechaNacimiento', 'pais'] }));
          ok('Datos del paciente actualizados.'); pintarDatos();
        } catch (err) { mensajeForm(form, err.message); }
      });
    };
  }
  pintarDatos();
}
