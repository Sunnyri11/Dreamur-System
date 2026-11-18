/**
 * Modelo 3D opcional de la zona que marcó Dreamur-Detector.
 *
 * - `campoModelo3D(det)`   → un desplegable pequeño y cerrado («Modelo 3D de la zona (opcional)») para el panel del estudio.
 * - `activarModelo3D(raiz, det)` → lo conecta; no pide nada al servidor hasta que se abre.
 * - `abrirVisor3D(modelo)` → ventana con el visor. three.js se descarga solo en ese momento (no pesa en el resto de la app).
 *
 * El modelo se genera en el backend con la imagen original y las zonas de la detección (las mismas que dibuja el visor 2D).
 */
import { esc, fecha } from '../core/format.js';
import { icono } from '../core/icons.js';
import { el, modal, cargando, accion, ok, descargar } from '../core/ui.js';
import { modelos3dService } from '../services/modelos3d.service.js';

const THREE_VERSION = '0.160.1';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

const PLANOS = {
  auto: 'Automático',
  axial: 'Axial (desde arriba)',
  coronal: 'Coronal (de frente)',
  sagital: 'Sagital (de lado)',
};

/* ───────────────────────── Campo en el panel del estudio ───────────────────────── */

/** Solo aparece cuando hay un hallazgo con zona marcada; en cualquier otro caso devuelve ''. */
export function campoModelo3D(det) {
  if (!det || det.imagenValida === false || !det.tieneTumor || !det.zonas?.length) return '';
  estilos();
  return `
    <details class="json m3d" data-m3d>
      <summary>Modelo 3D de la zona (opcional)</summary>
      <div class="m3d-cuerpo" data-m3d-cuerpo>${cargando('Consultando…')}</div>
    </details>`;
}

export function activarModelo3D(raiz, det) {
  const caja = raiz.querySelector('[data-m3d]');
  if (!caja || !det) return;
  const cuerpo = caja.querySelector('[data-m3d-cuerpo]');
  let modelo = null;
  let plano = 'auto';
  let consultado = false;

  const selector = () => `
    <label class="m3d-plano">Corte
      <select class="select" data-plano>
        ${Object.entries(PLANOS).map(([k, v]) => `<option value="${k}"${k === plano ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
    </label>`;

  const nota = `<p class="m3d-nota">Representación aproximada con fines ilustrativos: el cerebro es una malla genérica y solo el
    tumor depende del paciente (zona, tamaño y tipo). No es una reconstrucción real ni un diagnóstico.</p>`;

  function pintar() {
    if (!modelo) {
      cuerpo.innerHTML = `
        <p class="dim" style="margin:0">Crea una vista 3D aproximada del cerebro con la zona que marcó la IA. Es opcional y no cambia el resultado.</p>
        <div class="row">${selector()}<button type="button" class="btn btn-sm btn-primario" data-generar>${icono('cerebro')}Generar modelo 3D</button></div>
        ${nota}`;
    } else {
      const corte = modelo.parametros?.corte;
      const dudoso = corte?.dudoso
        ? `<div class="alerta-caja">${icono('info')}<div><p>No se pudo confirmar el tipo de corte${corte.advertencia ? `: ${esc(corte.advertencia)}` : '.'}
             Si el corte es otro, elígelo y pulsa «Regenerar».</p></div></div>`
        : '';
      cuerpo.innerHTML = `
        <p class="dim" style="margin:0">Generado el ${esc(fecha(modelo.createdAt, { hora: true }))} · ${Math.max(1, Math.round(modelo.tamBytes / 1024))} KB
          ${corte?.plano ? `· corte ${esc(corte.plano)}` : ''}</p>
        ${dudoso}
        <div class="row">
          <button type="button" class="btn btn-sm btn-primario" data-ver>${icono('ojo')}Ver en 3D</button>
          ${selector()}
          <button type="button" class="btn btn-sm" data-regenerar>${icono('refrescar')}Regenerar</button>
        </div>
        ${nota}`;
    }

    cuerpo.querySelector('[data-plano]')?.addEventListener('change', (e) => { plano = e.target.value; });

    const generar = cuerpo.querySelector('[data-generar]');
    if (generar) generar.onclick = () => accion(generar, async () => {
      modelo = await modelos3dService.generar(det.id, { plano, regenerar: false });
      ok('Modelo 3D generado.');
      pintar();
    });

    const regenerar = cuerpo.querySelector('[data-regenerar]');
    if (regenerar) regenerar.onclick = () => accion(regenerar, async () => {
      modelo = await modelos3dService.generar(det.id, { plano, regenerar: true });
      ok('Modelo 3D actualizado.');
      pintar();
    });

    const ver = cuerpo.querySelector('[data-ver]');
    if (ver) ver.onclick = () => abrirVisor3D(modelo);
  }

  // No se consulta nada hasta que el usuario abre el desplegable.
  caja.addEventListener('toggle', async () => {
    if (!caja.open || consultado) return;
    consultado = true;
    try {
      modelo = await modelos3dService.obtener(det.id);
      const corte = modelo?.parametros?.corte;
      if (corte?.origen === 'manual' && PLANOS[corte.plano]) plano = corte.plano;
      pintar();
    } catch (e) {
      consultado = false;                       // permite reintentar al cerrar y abrir
      cuerpo.innerHTML = `<p class="dim" style="margin:0">${esc(e.message)}</p>`;
    }
  });
}

/* ───────────────────────── Visor 3D ───────────────────────── */

let libs = null;
/** Descarga three.js y sus complementos la primera vez que se abre un visor. El brillo (bloom) es opcional. */
function cargarLibs() {
  libs ??= (async () => {
    const [THREE, orbit, gltf] = await Promise.all([
      import(`${CDN}/+esm`),
      import(`${CDN}/examples/jsm/controls/OrbitControls.js/+esm`),
      import(`${CDN}/examples/jsm/loaders/GLTFLoader.js/+esm`),
    ]);
    let post = null;
    try {
      const [composer, render, bloom, salida] = await Promise.all([
        import(`${CDN}/examples/jsm/postprocessing/EffectComposer.js/+esm`),
        import(`${CDN}/examples/jsm/postprocessing/RenderPass.js/+esm`),
        import(`${CDN}/examples/jsm/postprocessing/UnrealBloomPass.js/+esm`),
        import(`${CDN}/examples/jsm/postprocessing/OutputPass.js/+esm`),
      ]);
      post = { EffectComposer: composer.EffectComposer, RenderPass: render.RenderPass, UnrealBloomPass: bloom.UnrealBloomPass, OutputPass: salida.OutputPass };
    } catch { /* sin resplandor: se ve igual, solo menos vistoso */ }
    return { THREE, OrbitControls: orbit.OrbitControls, GLTFLoader: gltf.GLTFLoader, post };
  })().catch((e) => { libs = null; throw e; });
  return libs;
}

/** Monta la escena dentro de `contenedor`. Devuelve { liberar, girar(bool), reiniciar() }. */
async function montarEscena(contenedor, urlGlb, esCancelado) {
  const { THREE, OrbitControls, GLTFLoader, post } = await cargarLibs();

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch { throw new Error('Tu navegador no pudo iniciar WebGL, necesario para ver el modelo 3D.'); }

  const medir = () => [Math.max(1, contenedor.clientWidth), Math.max(1, contenedor.clientHeight)];
  const [w0, h0] = medir();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w0, h0, false);              // el tamaño visible lo manda el CSS (100 %)
  renderer.setClearColor(0x030916, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const gltf = await new Promise((resolver, rechazar) => new GLTFLoader().load(urlGlb, resolver, undefined, rechazar));
  if (esCancelado()) { renderer.dispose(); return null; }

  contenedor.replaceChildren(renderer.domElement);

  const escena = new THREE.Scene();
  escena.add(gltf.scene);
  escena.add(new THREE.AmbientLight(0xffffff, 0.9));
  const luz = new THREE.DirectionalLight(0xffffff, 1.4);
  luz.position.set(2, 3, 4);
  escena.add(luz);

  // Encuadre automático por la caja del modelo (el GLB sale en convención glTF: Y arriba, frente en +Z).
  const caja = new THREE.Box3().setFromObject(gltf.scene);
  const centro = caja.getCenter(new THREE.Vector3());
  const radio = Math.max(caja.getSize(new THREE.Vector3()).length() / 2, 0.01);
  const camara = new THREE.PerspectiveCamera(40, w0 / h0, 0.01, 100);
  const dist = radio / Math.sin(THREE.MathUtils.degToRad(camara.fov / 2));
  camara.position.copy(centro).add(new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(dist * 1.05));
  camara.near = dist / 100;
  camara.far = dist * 10;
  camara.updateProjectionMatrix();

  const controles = new OrbitControls(camara, renderer.domElement);
  controles.target.copy(centro);
  controles.enableDamping = true;
  controles.autoRotate = true;
  controles.autoRotateSpeed = 1.2;
  controles.minDistance = dist * 0.4;
  controles.maxDistance = dist * 3;
  controles.update();
  controles.saveState();

  let composer = null;
  if (post) {
    try {
      composer = new post.EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      composer.setSize(w0, h0);
      composer.addPass(new post.RenderPass(escena, camara));
      composer.addPass(new post.UnrealBloomPass(new THREE.Vector2(w0, h0), 0.8, 0.5, 0.55));
      composer.addPass(new post.OutputPass());
    } catch { composer = null; }
  }

  let vivo = true;
  let cuadro = 0;
  const dibujar = () => {
    if (!vivo) return;
    cuadro = requestAnimationFrame(dibujar);
    controles.update();
    if (composer) composer.render(); else renderer.render(escena, camara);
  };
  dibujar();

  const observador = new ResizeObserver(() => {
    const [w, h] = medir();
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  });
  observador.observe(contenedor);

  return {
    girar: (si) => { controles.autoRotate = si; },
    reiniciar: () => controles.reset(),
    detenerGiroAlTocar: (fn) => controles.addEventListener('start', fn),
    liberar() {
      vivo = false;
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      controles.dispose();
      gltf.scene.traverse((o) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material || [])) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      });
      composer?.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}

/** Abre la ventana del visor para un Modelo3DDto. */
export async function abrirVisor3D(modelo) {
  estilos();
  let escena = null;
  let urlGlb = null;
  let cerrado = false;

  const btnGiro = el(`<button class="btn btn-sm" disabled>${icono('refrescar')}<span>Giro automático: sí</span></button>`);
  const btnReiniciar = el(`<button class="btn btn-sm" disabled>${icono('escaner')}Reiniciar vista</button>`);
  const btnDescargar = el(`<button class="btn btn-sm" disabled>${icono('descargar')}Descargar .glb</button>`);

  const m = modal({
    titulo: 'Modelo 3D de la zona',
    tamano: 'medio',
    cuerpo: `<div class="m3d-lienzo" data-lienzo>${cargando('Preparando el modelo 3D…')}</div>
      <p class="m3d-nota" style="margin-top:.6rem">Arrastra para girar · rueda o pellizco para acercar · clic derecho para mover.
        Representación aproximada: no es una reconstrucción real ni un diagnóstico.</p>`,
    pie: [btnGiro, btnReiniciar, btnDescargar],
    alCerrar: () => {
      cerrado = true;
      escena?.liberar();
      if (urlGlb) URL.revokeObjectURL(urlGlb);
    },
  });
  const lienzo = m.body.querySelector('[data-lienzo]');

  try {
    const blob = await modelos3dService.glb(modelo.id);
    if (cerrado) return;
    btnDescargar.disabled = false;
    btnDescargar.onclick = () => accion(btnDescargar, async () => descargar(blob, `modelo3d-${modelo.id}.glb`));

    urlGlb = URL.createObjectURL(blob);
    escena = await montarEscena(lienzo, urlGlb, () => cerrado);
    if (!escena) return;

    let girando = true;
    const etiqueta = btnGiro.querySelector('span');
    btnGiro.disabled = false;
    btnReiniciar.disabled = false;
    btnGiro.onclick = () => { girando = !girando; escena.girar(girando); etiqueta.textContent = `Giro automático: ${girando ? 'sí' : 'no'}`; };
    btnReiniciar.onclick = () => escena.reiniciar();
    escena.detenerGiroAlTocar(() => { if (girando) { girando = false; escena.girar(false); etiqueta.textContent = 'Giro automático: no'; } });
  } catch (e) {
    if (cerrado) return;
    lienzo.innerHTML = `<div class="alerta-caja lesion" style="margin:1rem">${icono('alerta')}<p>${esc(e.message || 'No se pudo mostrar el modelo 3D.')}</p></div>`;
  }
}

/* ───────────────────────── Estilos (autocontenidos, una sola vez) ───────────────────────── */

function estilos() {
  if (document.getElementById('m3d-css')) return;
  const s = document.createElement('style');
  s.id = 'm3d-css';
  s.textContent = `
    details.m3d > summary { cursor: pointer; }
    .m3d-cuerpo { display: grid; gap: .6rem; padding-top: .6rem; }
    .m3d-plano { display: inline-flex; align-items: center; gap: .4rem; font-size: var(--t-xs); color: var(--tinta-2); }
    .m3d-plano .select { width: auto; min-width: 0; padding: .3rem .5rem; font-size: var(--t-xs); }
    .m3d-nota { margin: 0; font-size: var(--t-xs); color: var(--tinta-3); }
    .m3d-lienzo { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 4 / 3; max-height: 62vh;
      overflow: hidden; border-radius: var(--r-ctrl); background: #030916; border: 1px solid var(--linea); }
    .m3d-lienzo canvas { display: block; width: 100%; height: 100%; touch-action: none; }`;
  document.head.append(s);
}
