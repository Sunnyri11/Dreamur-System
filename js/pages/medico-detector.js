/** Dreamur-Detector para el médico: elige a uno de sus pacientes, sube la imagen y la IA la analiza. */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { esc, nombreCompleto } from '../core/format.js';
import { $, cargando } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { radiografiasService } from '../services/radiografias.service.js';
import { montarSubida } from '../components/subida.js';
import { galeriaPaginada } from '../components/galeria.js';
import { abrirEstudio } from '../components/estudio.js';

const shell = montarShell({ roles: ['medico'], activa: 'detector', titulo: 'Dreamur-Detector' });
if (shell) iniciar(shell);

async function iniciar({ usuario, contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Dreamur-Detector</h1>
      <p>Elige a un paciente y sube su resonancia o tomografía. La IA comprueba si la imagen es válida, reconoce su tipo y marca zonas sospechosas.</p></div></div>
    <section class="card"><div class="field" style="max-width:460px"><label for="paciente">Paciente</label>
      <select class="select" id="paciente"><option value="">Cargando pacientes…</option></select></div>
      <p class="dim" id="aviso" style="margin-top:.6rem" hidden></p></section>
    <div id="subida"></div>
    <section class="card"><div class="card-head"><div><h2>Últimas imágenes del paciente</h2></div>
      <a class="btn btn-sm" id="ficha" href="#" hidden>Abrir ficha completa</a></div><div id="galeria">${cargando()}</div></section>`;

  let pacientes = [];
  try { pacientes = (await pacientesService.listar({ pagina: 1, tamanoPagina: 100 })).items; } catch { /* se avisa abajo */ }
  const sel = $('#paciente');
  if (!pacientes.length) {
    sel.innerHTML = '<option value="">Sin pacientes</option>'; sel.disabled = true;
    $('#aviso').hidden = false;
    $('#aviso').innerHTML = `Aún no tienes pacientes. <a href="${RAIZ}medico/inicio.html">Da de alta o vincula uno</a> para usar el detector.`;
    $('#galeria').innerHTML = '';
    return;
  }
  sel.innerHTML = '<option value="">Selecciona un paciente…</option>' +
    pacientes.map((p) => `<option value="${esc(p.personaId)}">${esc(nombreCompleto(p))} · ${esc(p.codigo)}</option>`).join('');

  const subida = montarSubida($('#subida'), { pacienteId: null, propia: false, alListo: () => galeria?.recargar() });
  let galeria = null;

  function elegir(id) {
    subida.setPaciente(id || null);
    $('#ficha').hidden = !id;
    if (id) $('#ficha').href = `${RAIZ}medico/paciente.html?id=${id}`;
    if (!id) { $('#galeria').innerHTML = '<p class="dim">Selecciona un paciente para ver sus imágenes.</p>'; galeria = null; return; }
    galeria = galeriaPaginada($('#galeria'), (pagina) => radiografiasService.listar({ pagina, tamanoPagina: 6, pacienteId: id }), {
      mostrarOrigen: true,
      alAbrir: (rx) => abrirEstudio(rx, { usuario, paciente: pacientes.find((p) => p.personaId === id), alCambiar: () => galeria.recargar() }),
      vacioTexto: 'Este paciente aún no tiene imágenes.',
    });
  }
  sel.onchange = () => elegir(sel.value);

  const pre = new URLSearchParams(location.search).get('paciente');
  if (pre && pacientes.some((p) => p.personaId === pre)) { sel.value = pre; elegir(pre); }
  else elegir(null);
}
