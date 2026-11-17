/** Dreamur-Detector para el paciente: sube su imagen y la IA responde si es válida y qué encontró. */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { $ } from '../core/ui.js';
import { radiografiasService } from '../services/radiografias.service.js';
import { montarSubida } from '../components/subida.js';
import { galeriaPaginada } from '../components/galeria.js';
import { abrirEstudio } from '../components/estudio.js';

const shell = montarShell({ roles: ['paciente'], activa: 'detector', titulo: 'Dreamur-Detector' });
if (shell) {
  const { usuario, contenido } = shell;
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Dreamur-Detector</h1>
      <p>Sube una resonancia o tomografía de cerebro. La IA comprueba si la imagen es válida, reconoce qué tipo de imagen es y marca zonas sospechosas.</p></div>
      <div class="page-actions"><a class="btn" href="${RAIZ}paciente/evolucion.html">Ver mi evolución</a></div></div>
    <div id="subida"></div>
    <section class="card"><div class="card-head"><div><h2>Mis últimas imágenes</h2><p>Tu médico las ve con el mismo resultado de la IA.</p></div></div><div id="galeria"></div></section>`;

  const galeria = galeriaPaginada($('#galeria'), (pagina) => radiografiasService.listar({ pagina, tamanoPagina: 6 }), {
    alAbrir: (rx) => abrirEstudio(rx, { usuario, alCambiar: () => galeria.recargar() }),
    vacioTexto: 'Aún no has subido imágenes.',
  });
  montarSubida($('#subida'), { propia: true, alListo: () => galeria.recargar() });
}
