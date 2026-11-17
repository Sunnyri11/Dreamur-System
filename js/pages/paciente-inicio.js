/** Inicio del paciente: resumen de sus estudios y galería con el resultado de Dreamur-Detector en cada uno. */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { esc } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $ } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { radiografiasService } from '../services/radiografias.service.js';
import { indicadores } from '../components/evolucion-vista.js';
import { galeriaPaginada } from '../components/galeria.js';
import { abrirEstudio } from '../components/estudio.js';
import { ordenar, plural } from '../lib/evolucion.js';

const shell = montarShell({ roles: ['paciente'], activa: 'inicio', titulo: 'Mis estudios' });
if (shell) iniciar(shell);

function iniciar({ usuario, contenido }) {
  contenido.innerHTML = `
    <div class="bienvenida">
      <img src="${RAIZ}assets/img/raco-face.jpg" alt="">
      <div class="grow"><h2>Hola, ${esc(usuario.nombres)}</h2>
        <p>${usuario.codigoPaciente ? `Tu código de paciente es <span class="codigo">${esc(usuario.codigoPaciente)}</span>. ` : ''}Aquí ves tus estudios y lo que Dreamur-Detector encontró en cada uno.</p></div>
      <a class="btn btn-primario" href="${RAIZ}paciente/detector.html">${icono('subir')}Subir una imagen</a>
    </div>
    <div id="kpis"><div class="grid g-4"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>
    <div id="alerta"></div>
    <section class="card">
      <div class="card-head"><div><h2>Mis estudios</h2><p>Toca un estudio para ver la imagen, el resultado y descargar su informe.</p></div>
        <a class="btn btn-sm" href="${RAIZ}paciente/evolucion.html">${icono('tendencia')}Ver mi evolución</a></div>
      <div id="galeria"></div>
    </section>`;

  async function cargarResumen() {
    try {
      const evo = await pacientesService.evolucion(usuario.personaId);
      $('#kpis').innerHTML = indicadores(ordenar(evo.items), evo.totalImagenes);
      const inv = evo.totalInvalidas;
      $('#alerta').innerHTML = inv
        ? `<div class="alerta-caja">${icono('alerta')}<p>La IA no reconoció como estudio cerebral ${plural(inv, 'de tus imágenes', 'de tus imágenes')}. Sube una resonancia (MRI) o tomografía (TC) de cerebro para que pueda analizarla.</p></div>` : '';
    } catch (e) { $('#kpis').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }

  const galeria = galeriaPaginada($('#galeria'), (pagina) => radiografiasService.listar({ pagina, tamanoPagina: 12 }), {
    alAbrir: (rx) => abrirEstudio(rx, { usuario, alCambiar }),
    vacioTexto: 'Sube tu primera resonancia o tomografía desde «Dreamur-Detector».',
  });
  function alCambiar() { galeria.recargar(); cargarResumen(); }
  cargarResumen();
}
