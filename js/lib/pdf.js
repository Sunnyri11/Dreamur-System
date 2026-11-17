/**
 * Generador de PDF mínimo, sin dependencias: texto Helvetica (WinAnsi), rectángulos, líneas e imágenes JPEG.
 * Origen de coordenadas arriba a la izquierda, unidades en puntos (A4 = 595 × 842).
 */
export const A4 = { w: 595, h: 842 };

const ESPECIALES = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '≥': 0x3e, '≤': 0x3c };
const medidor = document.createElement('canvas').getContext('2d');

export function anchoTexto(txt, size, bold = false) {
  medidor.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
  return medidor.measureText(txt).width;
}

const hex2rgb = (h) => {
  if (Array.isArray(h)) return h;
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbOps = (c) => hex2rgb(c).map((v) => (v / 255).toFixed(3)).join(' ');
const f = (n) => Number(n.toFixed(2));

function aHex(txt) {
  let out = '';
  for (const ch of txt) {
    let code = ESPECIALES[ch] ?? ch.codePointAt(0);
    if (code > 255 || (code < 32 && code !== 9)) code = 0x3f;
    out += code.toString(16).padStart(2, '0');
  }
  return `<${out}>`;
}

export class Pdf {
  constructor({ titulo = 'Documento', autor = 'Dreamur-Detector' } = {}) {
    this.titulo = titulo; this.autor = autor;
    this.paginas = []; this.imagenes = []; this.cur = -1; this.pie = null;
    this.nuevaPagina();
  }

  nuevaPagina() { this.paginas.push({ ops: [], imgs: new Set() }); this.cur = this.paginas.length - 1; return this; }
  get ops() { return this.paginas[this.cur].ops; }

  texto(txt, x, y, { size = 10, bold = false, color = '#0f1b33', align = 'left', ancho } = {}) {
    if (txt == null || txt === '') return this;
    txt = String(txt);
    const w = anchoTexto(txt, size, bold);
    let px = x;
    if (align === 'center') px = x + ((ancho ?? 0) - w) / 2;
    else if (align === 'right') px = x + (ancho ?? 0) - w;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgbOps(color)} rg ${f(px)} ${f(A4.h - y - size * 0.8)} Td ${aHex(txt)} Tj ET`);
    return this;
  }

  /** Párrafo con salto de línea automático. Devuelve la Y siguiente. */
  parrafo(txt, x, y, ancho, { size = 10, bold = false, color = '#0f1b33', interlineado = 1.4 } = {}) {
    const lineas = this.partir(String(txt ?? ''), ancho, size, bold);
    lineas.forEach((l, i) => this.texto(l, x, y + i * size * interlineado, { size, bold, color }));
    return y + lineas.length * size * interlineado;
  }

  partir(txt, ancho, size, bold) {
    const out = [];
    for (const bloque of txt.split('\n')) {
      let linea = '';
      for (const palabra of bloque.split(/\s+/).filter(Boolean)) {
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (anchoTexto(prueba, size, bold) <= ancho || !linea) linea = prueba;
        else { out.push(linea); linea = palabra; }
      }
      out.push(linea);
    }
    return out;
  }

  rect(x, y, w, h, { relleno, borde, grosor = 0.8, radio = 0 } = {}) {
    const X = f(x), Y = f(A4.h - y - h);
    let path;
    if (radio > 0) {
      const r = Math.min(radio, w / 2, h / 2), k = r * 0.5523;
      path = `${X + r} ${Y} m ${X + w - r} ${Y} l ${X + w - r + k} ${Y} ${X + w} ${Y + r - k} ${X + w} ${Y + r} c ` +
        `${X + w} ${Y + h - r} l ${X + w} ${Y + h - r + k} ${X + w - r + k} ${Y + h} ${X + w - r} ${Y + h} c ` +
        `${X + r} ${Y + h} l ${X + r - k} ${Y + h} ${X} ${Y + h - r + k} ${X} ${Y + h - r} c ` +
        `${X} ${Y + r} l ${X} ${Y + r - k} ${X + r - k} ${Y} ${X + r} ${Y} c h`;
    } else path = `${X} ${Y} ${f(w)} ${f(h)} re`;
    const ops = [];
    if (relleno) ops.push(`${rgbOps(relleno)} rg`);
    if (borde) ops.push(`${rgbOps(borde)} RG ${grosor} w`);
    ops.push(path, relleno && borde ? 'B' : relleno ? 'f' : 'S');
    this.ops.push(ops.join(' '));
    return this;
  }

  linea(x1, y1, x2, y2, { color = '#c9d3e4', grosor = 0.8 } = {}) {
    this.ops.push(`${rgbOps(color)} RG ${grosor} w ${f(x1)} ${f(A4.h - y1)} m ${f(x2)} ${f(A4.h - y2)} l S`);
    return this;
  }

  /** @param img {dataUrl, ancho, alto} con dataUrl image/jpeg */
  imagen(img, x, y, w, h) {
    const b64 = img.dataUrl.split(',')[1];
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.imagenes.push({ bytes, w: img.ancho, h: img.alto });
    const id = this.imagenes.length;
    this.paginas[this.cur].imgs.add(id);
    this.ops.push(`q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(A4.h - y - h)} cm /Im${id} Do Q`);
    return this;
  }

  /** Callback (pdf, nPagina, total) que dibuja el pie de cada página al generar el archivo. */
  alPie(fn) { this.pie = fn; return this; }

  blob() {
    if (this.pie) { const total = this.paginas.length, guardada = this.cur; this.paginas.forEach((_, i) => { this.cur = i; this.pie(this, i + 1, total); }); this.cur = guardada; }

    const enc = new TextEncoder();
    const partes = []; let largo = 0; const offs = [];
    const push = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; partes.push(u); largo += u.length; };
    const obj = (n, cuerpo) => { offs[n] = largo; push(`${n} 0 obj\n`); push(cuerpo); push('\nendobj\n'); };

    const nImg = this.imagenes.length, nPag = this.paginas.length;
    const idFont1 = 3, idFont2 = 4, idImg0 = 5, idPag0 = idImg0 + nImg;
    // por página: contenido (idPag0 + 2i) y página (idPag0 + 2i + 1)
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = this.paginas.map((_, i) => `${idPag0 + 2 * i + 1} 0 R`).join(' ');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${nPag} >>`);
    obj(idFont1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(idFont2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.imagenes.forEach((im, i) => {
      offs[idImg0 + i] = largo;
      push(`${idImg0 + i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      push(im.bytes); push('\nendstream\nendobj\n');
    });
    this.paginas.forEach((p, i) => {
      const contenido = enc.encode(p.ops.join('\n'));
      offs[idPag0 + 2 * i] = largo;
      push(`${idPag0 + 2 * i} 0 obj\n<< /Length ${contenido.length} >>\nstream\n`); push(contenido); push('\nendstream\nendobj\n');
      const xo = [...p.imgs].map((id) => `/Im${id} ${idImg0 + id - 1} 0 R`).join(' ');
      obj(idPag0 + 2 * i + 1, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Contents ${idPag0 + 2 * i} 0 R /Resources << /Font << /F1 ${idFont1} 0 R /F2 ${idFont2} 0 R >> /XObject << ${xo} >> >> >>`);
    });
    const total = idPag0 + 2 * nPag;
    const infoId = total;
    obj(infoId, `<< /Title ${aHex(this.titulo)} /Author ${aHex(this.autor)} /Producer (Dreamur-Detector) >>`);
    const xref = largo;
    push(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
    for (let n = 1; n <= infoId; n++) push(`${String(offs[n]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(partes, { type: 'application/pdf' });
  }
}

/** Carga un blob de imagen, lo reduce y lo devuelve como JPEG (con dibujo opcional encima). */
export async function imagenAJpeg(blob, { maxLado = 1100, calidad = 0.86, dibujar } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('No se pudo leer la imagen.')); i.src = url; });
    const esc = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * esc), h = Math.round(img.naturalHeight * esc);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    dibujar?.(ctx, w, h);
    return { dataUrl: c.toDataURL('image/jpeg', calidad), ancho: w, alto: h };
  } finally { URL.revokeObjectURL(url); }
}
