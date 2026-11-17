/** Visor de imagen con las zonas sospechosas dibujadas encima (coordenadas normalizadas 0..1). */
import { esc } from '../core/format.js';

const n2 = (n) => (n * 100).toFixed(2);

/**
 * @param {{src:string, zonas?:Array, escaneando?:boolean, invalida?:boolean, alt?:string}} o
 * `escaneando` activa la línea de barrido mientras la IA trabaja; `invalida` pinta el marco en ámbar.
 */
export function visor({ src, zonas = [], escaneando = false, invalida = false, alt = 'Imagen del estudio' } = {}) {
  const clases = ['visor', escaneando && 'escaneando', invalida && 'invalida', zonas.length && 'hallazgo'].filter(Boolean).join(' ');
  const marcas = zonas.map((z, i) => `
    <div class="zona ${z.y < 0.08 ? 'borde' : ''}" style="left:${n2(z.x)}%;top:${n2(z.y)}%;width:${n2(z.ancho)}%;height:${n2(z.alto)}%">
      <span>Zona ${i + 1}${z.puntaje != null ? ` · ${Math.round(z.puntaje * 100)}%` : ''}</span>
    </div>`).join('');
  return `
    <div class="${clases}" data-visor>
      <div class="lienzo"><img src="${esc(src)}" alt="${esc(alt)}" draggable="false"><div class="zonas">${marcas}</div></div>
    </div>
    ${zonas.length ? `<div class="visor-barra">
      <label class="interruptor"><input type="checkbox" data-zonas checked> Mostrar zonas marcadas por la IA</label>
      <span class="dim" style="font-size:var(--t-xs)">${zonas.length} zona${zonas.length === 1 ? '' : 's'} sospechosa${zonas.length === 1 ? '' : 's'}</span>
    </div>` : ''}`;
}

/** Conecta el interruptor «Mostrar zonas». Llamar después de insertar el visor en el DOM. */
export function activarVisor(raiz) {
  const sw = raiz.querySelector('[data-zonas]');
  if (!sw) return;
  sw.addEventListener('change', () => {
    const z = raiz.querySelector('[data-visor] .zonas');
    if (z) z.hidden = !sw.checked;
  });
}
