/** Evolución y reporte del paciente: estadísticas propias, gráficas, historial y descarga del informe en PDF. */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { esc } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, cargando, accion } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { pintarEvolucion, cajaReporte } from '../components/evolucion-vista.js';
import { abrirEstudio } from '../components/estudio.js';
import { informeEvolucion, descargarInforme } from '../components/informe.js';
import { activarTabs } from '../components/tabs.js';

const shell = montarShell({ roles: ['paciente'], activa: 'evolucion', titulo: 'Mi evolución y reporte' });
if (shell) iniciar(shell);

async function iniciar({ usuario, contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Mi evolución y reporte</h1>
      <p>Cómo van tus resonancias en el tiempo, según Dreamur-Detector y la revisión de tu médico.</p></div>
      <div class="page-actions"><a class="btn" href="${RAIZ}paciente/detector.html">${icono('subir')}Subir imagen</a>
        <button class="btn btn-primario" id="btn-pdf" disabled>${icono('documento')}Descargar informe PDF</button></div></div>
    <div class="tabs" role="tablist" aria-label="Secciones">
      <button class="tab" role="tab" data-tab="estadisticas">Estadísticas</button>
      <button class="tab" role="tab" data-tab="reporte">Reporte</button>
    </div>
    <div class="panel-tab" data-panel="estadisticas"><div id="ev">${cargando('Calculando tu evolución…')}</div></div>
    <div class="panel-tab" data-panel="reporte" hidden><section class="card"><div class="card-head"><h2>Reporte de evolución</h2></div><div id="rep"></div></section></div>`;
  activarTabs(contenido);

  try {
    const [paciente, evo] = await Promise.all([pacientesService.obtenerMio(), pacientesService.evolucion(usuario.personaId)]);
    pintarEvolucion($('#ev'), evo, { paraPaciente: true, alAbrirEstudio: (id) => abrirEstudio({ id }, { usuario, paciente, alCambiar: () => location.reload() }) });
    $('#rep').innerHTML = cajaReporte(paciente, evo, true);
    const btn = $('#btn-pdf');
    btn.disabled = false;
    btn.onclick = () => accion(btn, () => descargarInforme(() => informeEvolucion({ paciente, evo, paraPaciente: true })));
  } catch (e) {
    $('#ev').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`;
  }
}
