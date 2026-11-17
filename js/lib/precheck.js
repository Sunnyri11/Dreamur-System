/**
 * Preverificación local y aproximada: ¿se parece a una resonancia/TC (escala de grises, fondo oscuro, casi cuadrada)
 * o a una fotografía a color? Sirve para avisar antes de subir. La validación definitiva la hace Dreamur-Detector.
 */
export async function preverificar(file) {
  const bmp = await cargar(file);
  const w0 = bmp.width, h0 = bmp.height;
  const lado = 128, esc = lado / Math.max(w0, h0);
  const w = Math.max(8, Math.round(w0 * esc)), h = Math.max(8, Math.round(h0 * esc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  let colorido = 0, bordeOscuro = 0, bordeTotal = 0, sat = 0;
  const margenX = Math.max(2, Math.round(w * 0.08)), margenY = Math.max(2, Math.round(h * 0.08));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const croma = (mx - mn) / 255;
      sat += croma;
      if (croma > 0.18) colorido++;
      if (x < margenX || x >= w - margenX || y < margenY || y >= h - margenY) {
        bordeTotal++;
        if (0.299 * r + 0.587 * g + 0.114 * b < 40) bordeOscuro++;
      }
    }
  }
  const n = w * h;
  const m = { colorido: colorido / n, saturacion: sat / n, bordeOscuro: bordeOscuro / bordeTotal, aspecto: w0 / h0, ancho: w0, alto: h0 };

  const notas = [];
  if (Math.min(w0, h0) < 200) notas.push('La resolución es baja; la IA puede tener menos precisión.');

  let tipo, titulo, detalle;
  if (m.colorido > 0.3 || m.saturacion > 0.15) {
    tipo = 'foto'; titulo = 'Parece una imagen a color';
    detalle = 'Las resonancias y tomografías suelen ser en escala de grises. Dreamur-Detector confirmará si es válida al analizarla.';
  } else if (m.bordeOscuro > 0.55 && m.aspecto > 0.6 && m.aspecto < 1.7) {
    tipo = 'compatible'; titulo = 'Compatible con una resonancia o TC';
    detalle = 'Escala de grises con fondo oscuro. La IA hará la validación definitiva.';
  } else {
    tipo = 'dudosa'; titulo = 'No es claro que sea una resonancia';
    detalle = 'No se aprecia el fondo oscuro típico de un corte cerebral. La IA lo verificará al analizar.';
  }
  return { tipo, titulo, detalle, notas, metricas: m };
}

async function cargar(file) {
  if ('createImageBitmap' in window) { try { return await createImageBitmap(file); } catch { /* sigue con <img> */ } }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('No se pudo leer la imagen.')); i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}
