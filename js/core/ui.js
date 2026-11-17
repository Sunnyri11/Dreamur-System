/** Piezas de interfaz reutilizables: toasts, modales, confirmaciones, estados vacíos. */
import { icono } from './icons.js';
import { esc } from './format.js';

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Crea un elemento a partir de HTML. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ───── Toasts ───── */
function contenedorToasts() {
  let c = $('.toasts');
  if (!c) { c = el('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.append(c); }
  return c;
}
export function toast(mensaje, tipo = 'info', ms = 4800) {
  const ico = tipo === 'ok' ? 'check' : tipo === 'error' ? 'alerta' : tipo === 'aviso' ? 'alerta' : 'info';
  const t = el(`<div class="toast ${tipo}">${icono(ico)}<div>${esc(mensaje)}</div></div>`);
  contenedorToasts().append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, tipo === 'error' ? ms + 2500 : ms);
}
export const ok = (m) => toast(m, 'ok');
export const fallo = (e) => toast(e?.message || String(e), 'error');

/* ───── Modales ───── */
let modalesAbiertos = 0;
export function modal({ titulo, cuerpo = '', pie = null, tamano = '', alCerrar } = {}) {
  const previo = document.activeElement;
  const fondo = el(`<div class="modal-fondo">
    <div class="modal ${tamano}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-head"><h2>${esc(titulo)}</h2><button class="btn btn-fantasma btn-icono" data-cerrar aria-label="Cerrar">${icono('cerrar')}</button></div>
      <div class="modal-body"></div>
      ${pie ? '<div class="modal-foot"></div>' : ''}
    </div></div>`);
  const body = $('.modal-body', fondo);
  if (typeof cuerpo === 'string') body.innerHTML = cuerpo; else body.append(cuerpo);
  const foot = $('.modal-foot', fondo);
  if (foot && pie) { if (typeof pie === 'string') foot.innerHTML = pie; else foot.append(...[].concat(pie)); }

  const cerrar = () => {
    document.removeEventListener('keydown', onKey);
    fondo.remove();
    if (--modalesAbiertos <= 0) { document.body.style.overflow = ''; modalesAbiertos = 0; }
    previo?.focus?.();
    alCerrar?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && fondo === [...$$('.modal-fondo')].pop()) cerrar(); };
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
  $('[data-cerrar]', fondo).addEventListener('click', cerrar);
  document.addEventListener('keydown', onKey);
  document.body.append(fondo);
  modalesAbiertos++;
  document.body.style.overflow = 'hidden';
  (fondo.querySelector('input:not([type=hidden]), select, textarea') || $('.btn', fondo))?.focus?.();
  return { fondo, body, foot, cerrar };
}

export function confirmar({ titulo = 'Confirmar', mensaje = '', aceptar = 'Aceptar', peligro = false } = {}) {
  return new Promise((resolve) => {
    const bC = el('<button class="btn">Cancelar</button>');
    const bA = el(`<button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}">${esc(aceptar)}</button>`);
    let respondido = false;
    const fin = (v) => { if (respondido) return; respondido = true; resolve(v); };
    const m = modal({ titulo, cuerpo: `<p>${esc(mensaje)}</p>`, pie: [bC, bA], alCerrar: () => fin(false) });
    bC.onclick = () => m.cerrar();
    bA.onclick = () => { fin(true); m.cerrar(); };
  });
}

/* ───── Estados ───── */
export const cargando = (texto = 'Cargando…') => `<div class="cargando"><span class="spin"></span>${esc(texto)}</div>`;
export const vacio = (ico, titulo, texto = '') =>
  `<div class="vacio">${icono(ico)}<b>${esc(titulo)}</b>${texto ? `<p>${esc(texto)}</p>` : ''}</div>`;
export const esqueleto = (n = 3, alto = 90) => `<div class="grid">${'<div class="skeleton" style="min-height:' + alto + 'px"></div>'.repeat(n)}</div>`;

/** Ejecuta una acción de un botón: bloquea, muestra spinner, captura errores como toast. */
export async function accion(boton, fn) {
  if (boton) { boton.setAttribute('aria-busy', 'true'); boton._html = boton.innerHTML; boton.innerHTML = `<span class="spin"></span>${boton.textContent.trim()}`; }
  try { return await fn(); }
  catch (e) { fallo(e); return undefined; }
  finally { if (boton) { boton.removeAttribute('aria-busy'); boton.innerHTML = boton._html; } }
}

export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const leerComoURL = (file) => URL.createObjectURL(file);

export function badge(texto, tipo = '', ico = '') {
  return `<span class="badge ${tipo}">${ico ? icono(ico) : ''}${esc(texto)}</span>`;
}

/** Paginador reutilizable. Devuelve HTML y conecta eventos al contenedor. */
export function pager(contenedor, { pagina, tamanoPagina, total, totalPaginas }, alCambiar) {
  const desde = total === 0 ? 0 : (pagina - 1) * tamanoPagina + 1;
  const hasta = Math.min(total, pagina * tamanoPagina);
  contenedor.innerHTML = `<span>${desde}–${hasta} de ${total}</span>
    <span class="row"><button class="btn btn-sm" data-p="-1" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button>
    <span class="num">Página ${pagina} de ${Math.max(1, totalPaginas)}</span>
    <button class="btn btn-sm" data-p="1" ${pagina >= totalPaginas ? 'disabled' : ''}>Siguiente</button></span>`;
  contenedor.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => alCambiar(pagina + Number(b.dataset.p)));
}

/** Fuerza de contraseña 0..4 (misma política del backend: 8+, mayúscula, minúscula, número). */
export function fuerzaPassword(p) {
  let n = 0;
  if (p.length >= 8) n++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++;
  if (/\d/.test(p)) n++;
  if (p.length >= 12 || /[^A-Za-z0-9]/.test(p)) n++;
  return n;
}
export const passwordValida = (p) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,100}$/.test(p);

export function enlazarFuerza(input, barra) {
  const colores = ['#ff6f9c', '#ff6f9c', '#ffc45c', '#5ad7ff', '#44efc2'];
  input.addEventListener('input', () => {
    const n = input.value ? fuerzaPassword(input.value) : 0;
    const i = barra.querySelector('i'); i.style.width = `${(n / 4) * 100}%`; i.style.background = colores[n];
  });
}
