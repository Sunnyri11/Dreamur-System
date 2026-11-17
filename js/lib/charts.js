/**
 * Gráfica de línea sobre canvas, sin dependencias.
 * Marcas según la guía de visualización: línea de 2 px, puntos ≥ 8 px con anillo del color de la superficie,
 * rejilla de 1 px recesiva, área al ~10 %, solo se etiqueta el último valor; el resto va en la ayuda (tooltip) y en la tabla.
 * Los mismos dibujos sirven para pantalla (tema oscuro) y para el PDF (tema claro).
 */
const TEMAS = {
  oscuro: { fondo: '#0b1a38', rejilla: 'rgba(164,184,217,.16)', texto: '#a4b8d9', fuerte: '#e8f1ff' },
  claro: { fondo: '#ffffff', rejilla: '#dde5f1', texto: '#4b5b78', fuerte: '#0f1b33' },
};
const FUENTE = '12px "IBM Plex Sans", "Segoe UI", Arial, sans-serif';

const NICE = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.75, 1];
const niceMax = (v) => NICE.find((n) => n >= v) ?? 1;

function etiquetasX(puntos, ancho) {
  const maxLabels = Math.max(2, Math.floor(ancho / 78));
  const n = puntos.length;
  const idx = new Set();
  if (n <= maxLabels) puntos.forEach((_, i) => idx.add(i));
  else for (let k = 0; k < maxLabels; k++) idx.add(Math.round((k * (n - 1)) / (maxLabels - 1)));
  return idx;
}

const fmtFecha = (t, conAnio) => new Date(t).toLocaleDateString('es-BO', conAnio ? { day: '2-digit', month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short' }).replace(/\./g, '');

/**
 * @param puntos [{t: ms, y: 0..1, etiqueta?: string}] ordenados por t
 * @param o {color, tema, max, hover (índice), formato (fn y→texto)}
 * @returns posiciones de los puntos (para detectar el hover)
 */
export function dibujarLinea(ctx, W, H, puntos, o = {}) {
  const T = TEMAS[o.tema || 'oscuro'];
  const color = o.color || '#00a3d6';
  const fmt = o.formato || ((y) => `${Math.round(y * 100)}%`);
  const m = { l: 46, r: 40, t: 16, b: 32 };
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = T.fondo; ctx.fillRect(0, 0, W, H);
  ctx.font = FUENTE;

  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const ymax = o.max ?? niceMax(Math.max(0.0001, ...puntos.map((p) => p.y)) * 1.15);
  const yPos = (v) => m.t + ph - (v / ymax) * ph;

  // rejilla y eje Y
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4, y = Math.round(yPos(v)) + .5;
    ctx.strokeStyle = T.rejilla; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
    ctx.fillStyle = T.texto; ctx.fillText(fmt(v), m.l - 8, y);
  }

  if (!puntos.length) return [];
  const t0 = puntos[0].t, t1 = puntos[puntos.length - 1].t;
  const xPos = (t) => (t1 === t0 ? m.l + pw / 2 : m.l + ((t - t0) / (t1 - t0)) * pw);
  const pos = puntos.map((p) => ({ x: xPos(p.t), y: yPos(p.y), p }));

  // eje X (solo algunas fechas)
  const conAnio = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = T.texto;
  const mostrar = etiquetasX(puntos, pw);
  pos.forEach((q, i) => { if (mostrar.has(i)) ctx.fillText(fmtFecha(q.p.t, conAnio), Math.min(Math.max(q.x, m.l + 22), W - m.r + 10), H - m.b + 10); });

  // área y línea
  if (pos.length > 1) {
    ctx.beginPath(); ctx.moveTo(pos[0].x, m.t + ph);
    pos.forEach((q) => ctx.lineTo(q.x, q.y));
    ctx.lineTo(pos[pos.length - 1].x, m.t + ph); ctx.closePath();
    ctx.globalAlpha = 0.1; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); pos.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }

  // puntos con anillo de superficie (el hover agranda el activo)
  pos.forEach((q, i) => {
    const r = i === o.hover ? 6 : 4.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, r + 2, 0, Math.PI * 2); ctx.fillStyle = T.fondo; ctx.fill();
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  });

  // etiqueta directa del último valor
  const u = pos[pos.length - 1];
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.fuerte; ctx.font = `600 ${FUENTE}`;
  ctx.fillText(fmt(u.p.y), Math.min(u.x + 11, W - m.r + 2), Math.max(u.y - 12, m.t + 6));
  ctx.font = FUENTE;
  return pos;
}

/** Gráfica interactiva en pantalla (con tooltip). */
export function lineaTiempo(contenedor, puntos, o = {}) {
  contenedor.classList.add('grafica');
  contenedor.innerHTML = '<canvas role="img"></canvas><div class="tooltip" hidden></div>';
  const canvas = contenedor.querySelector('canvas');
  const tip = contenedor.querySelector('.tooltip');
  canvas.setAttribute('aria-label', o.descripcion || 'Gráfica de evolución');
  let pos = [], hover = -1, W = 0, H = 0;

  const pintar = () => {
    W = contenedor.clientWidth; H = o.alto || 220;
    if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pos = dibujarLinea(ctx, W, H, puntos, { ...o, hover });
  };
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left;
    let best = -1, d = 28;
    pos.forEach((q, i) => { const dd = Math.abs(q.x - x); if (dd < d) { d = dd; best = i; } });
    if (best !== hover) { hover = best; pintar(); }
    if (best < 0) { tip.hidden = true; return; }
    const q = pos[best];
    tip.hidden = false; tip.style.left = `${q.x}px`; tip.style.top = `${q.y}px`;
    tip.innerHTML = o.tooltip ? o.tooltip(q.p) : `<b>${(o.formato || ((v) => Math.round(v * 100) + '%'))(q.p.y)}</b>${q.p.etiqueta || ''}`;
  });
  canvas.addEventListener('mouseleave', () => { hover = -1; tip.hidden = true; pintar(); });
  new ResizeObserver(pintar).observe(contenedor);
  pintar();
  return { redibujar: pintar };
}

/** Imagen JPEG de la gráfica (tema claro) para incrustarla en el PDF. */
export function lineaComoImagen(puntos, o = {}) {
  const W = o.ancho || 900, H = o.alto || 340;
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const ctx = c.getContext('2d'); ctx.scale(2, 2);
  dibujarLinea(ctx, W, H, puntos, { ...o, tema: 'claro' });
  return { dataUrl: c.toDataURL('image/jpeg', 0.92), ancho: W, alto: H };
}
