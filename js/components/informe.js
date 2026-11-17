/**
 * Informes en PDF, armados en el navegador (sin servidor ni librerías):
 *   · informeEvolucion → todo el historial de un paciente, con gráficas y tendencia
 *   · informeEstudio   → un solo estudio con la imagen y las zonas marcadas
 */
import { Pdf, A4, imagenAJpeg } from '../lib/pdf.js';
import { lineaComoImagen } from '../lib/charts.js';
import { urlImagen } from '../core/api.js';
import { RAIZ } from '../core/auth.js';
import { descargar } from '../core/ui.js';
import { fecha, pct, edad, tipoImagen, nombreTumor, ESTADOS, ORIGENES, SEXOS, DOCUMENTOS } from '../core/format.js';
import { hallazgo, areaPct, resumen, series, tendencia, fechaItem, ordenar, modalidadNombre, coincideModalidad } from '../lib/evolucion.js';
import { deteccionesService } from '../services/radiografias.service.js';

const M = 44;
const ANCHO = A4.w - 2 * M;
const TOPE = 84;          // donde empieza el contenido (debajo de la franja superior)
const BASE = A4.h - 56;   // límite inferior (encima del pie)
const C = {
  navy: '#0a1630', cian: '#0e96ba', tinta: '#1c2842', gris: '#68768e', linea: '#d6dfed', claro: '#f2f6fc',
  lesion: '#c92c64', ok: '#148c62', alerta: '#ba740a', blanco: '#ffffff',
};
const TONO = { ok: C.ok, lesion: C.lesion, alerta: C.alerta, info: C.cian, '': C.gris };

/** Cursor de escritura: lleva la posición vertical y salta de página cuando hace falta. */
class Hoja {
  constructor(pdf) { this.p = pdf; this.y = TOPE; }

  espacio(h) { if (this.y + h > BASE) { this.p.nuevaPagina(); this.y = TOPE; } }

  grande(titulo, sub) {
    this.p.texto(titulo, M, this.y, { size: 22, bold: true, color: C.navy });
    this.p.texto(sub, M, this.y + 30, { size: 9.5, color: C.gris });
    this.y += 52;
  }

  titulo(t) {
    this.espacio(50);
    this.y += 8;
    this.p.texto(t, M, this.y, { size: 12.5, bold: true, color: C.navy });
    this.p.linea(M, this.y + 19, A4.w - M, this.y + 19, { color: C.cian, grosor: 1 });
    this.y += 30;
  }

  parrafo(t, { size = 10, color = C.tinta, bold = false } = {}) {
    for (const l of this.p.partir(String(t ?? ''), ANCHO, size, bold)) {
      this.espacio(size * 1.5);
      this.p.texto(l, M, this.y, { size, bold, color });
      this.y += size * 1.45;
    }
    this.y += 4;
  }

  /** Pares etiqueta / valor en dos columnas. */
  pares(lista) {
    const ancho = ANCHO / 2 - 12;
    for (let i = 0; i < lista.length; i += 2) {
      const fila = lista.slice(i, i + 2).map(([k, v]) => [k, this.p.partir(String(v ?? '—'), ancho, 10, false)]);
      const alto = 14 + Math.max(...fila.map(([, ls]) => ls.length)) * 13 + 6;
      this.espacio(alto);
      fila.forEach(([k, ls], j) => {
        const x = M + j * (ANCHO / 2);
        this.p.texto(k, x, this.y, { size: 8, color: C.gris });
        ls.forEach((l, n) => this.p.texto(l, x, this.y + 13 + n * 13, { size: 10, color: C.tinta }));
      });
      this.y += alto;
    }
  }

  /** Tabla con encabezado repetido en cada página. cols: [{t, w}]; celdas: texto o {t, color}. */
  tabla(cols, filas) {
    const encabezado = () => {
      this.p.rect(M, this.y, ANCHO, 20, { relleno: C.claro });
      let x = M;
      cols.forEach((c) => { this.p.texto(c.t, x + 5, this.y + 6, { size: 8.5, bold: true, color: C.navy }); x += c.w; });
      this.y += 20;
    };
    this.espacio(60);
    encabezado();
    for (const fila of filas) {
      const celdas = fila.map((c, i) => {
        const o = typeof c === 'object' ? c : { t: c };
        return { ...o, ls: this.p.partir(String(o.t ?? '—'), cols[i].w - 9, 8.5, !!o.color) };
      });
      const alto = Math.max(...celdas.map((c) => c.ls.length)) * 11.5 + 9;
      if (this.y + alto > BASE) { this.p.nuevaPagina(); this.y = TOPE; encabezado(); }
      let x = M;
      celdas.forEach((c, i) => {
        c.ls.forEach((l, n) => this.p.texto(l, x + 5, this.y + 5 + n * 11.5, { size: 8.5, color: c.color ?? C.tinta, bold: !!c.color }));
        x += cols[i].w;
      });
      this.p.linea(M, this.y + alto, A4.w - M, this.y + alto, { color: C.linea, grosor: 0.5 });
      this.y += alto;
    }
    this.y += 6;
  }

  /** Gráfica de línea (misma que en pantalla, con tema claro). */
  grafica(titulo, nota, puntos, opciones) {
    const ancho = 900, alto = 280, h = ANCHO * alto / ancho;
    this.espacio(h + 34);
    this.p.texto(titulo, M, this.y, { size: 10, bold: true, color: C.tinta });
    this.p.texto(nota, M, this.y + 13, { size: 8, color: C.gris });
    this.y += 28;
    this.p.imagen(lineaComoImagen(puntos, { ancho, alto, ...opciones }), M, this.y, ANCHO, h);
    this.p.rect(M, this.y, ANCHO, h, { borde: C.linea, grosor: 0.6 });
    this.y += h + 12;
  }

  /** Imagen del estudio (con zonas ya dibujadas). Devuelve dónde quedó, para escribir texto al lado. */
  imagen(jpeg, { maxW = 250, maxH = 250 } = {}) {
    const k = Math.min(maxW / jpeg.ancho, maxH / jpeg.alto);
    const w = jpeg.ancho * k, h = jpeg.alto * k;
    this.espacio(h + 16);
    this.p.imagen(jpeg, M, this.y, w, h);
    this.p.rect(M, this.y, w, h, { borde: C.linea, grosor: 0.8 });
    const y0 = this.y;
    this.y += h + 8;
    return { x: M + w + 18, y: y0, w, h };
  }
}

/** Franja superior y pie, dibujados en cada página al generar el archivo. */
function marco(pdf, n, total, logo, generado) {
  pdf.rect(0, 0, A4.w, 58, { relleno: C.navy });
  if (logo) pdf.imagen(logo, M, 9, 40, 40);
  pdf.texto('Dreamur-Detector', M + 52, 15, { size: 15, bold: true, color: C.blanco });
  pdf.texto('Apoyo al diagnóstico de tumores cerebrales', M + 52, 36, { size: 8.5, color: '#96bee8' });
  pdf.texto(`Página ${n} de ${total}`, A4.w - M, 25, { size: 8.5, color: '#c8d7f0', align: 'right', ancho: 0 });
  pdf.linea(M, A4.h - 44, A4.w - M, A4.h - 44, { color: C.linea });
  pdf.texto('Documento generado automáticamente. Es un apoyo y no reemplaza la valoración de un médico.', M, A4.h - 36, { size: 7.5, color: C.gris });
  pdf.texto(generado, A4.w - M, A4.h - 36, { size: 7.5, color: C.gris, align: 'right', ancho: 0 });
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sello = () => new Date().toISOString().slice(0, 10);
const nombreDe = (p) => `${p.nombres} ${p.apellidos}`.trim();

async function logo() {
  try { const r = await fetch(`${RAIZ}assets/img/raco-face.jpg`); return await imagenAJpeg(await r.blob(), { maxLado: 160 }); }
  catch { return null; }
}

/** Foto del estudio con las zonas marcadas dibujadas encima (se incrusta como JPEG). */
async function fotoConZonas(radiografiaId, zonas, maxLado = 900) {
  const { blob } = await urlImagen(radiografiaId);
  return imagenAJpeg(blob, {
    maxLado,
    dibujar: (ctx, w, h) => {
      ctx.strokeStyle = C.lesion; ctx.lineWidth = Math.max(2, w / 220);
      zonas.forEach((z) => ctx.strokeRect(z.x * w, z.y * h, z.ancho * w, z.alto * h));
    },
  });
}

function datosPaciente(h, p) {
  h.titulo('Datos del paciente');
  h.pares([
    ['Nombre', nombreDe(p)],
    ['Código de paciente', p.codigo || '—'],
    ['Documento', p.numeroDocumento ? `${DOCUMENTOS[p.tipoDocumento] || ''} ${p.numeroDocumento}`.trim() : 'Sin indicar'],
    ['Fecha de nacimiento', p.fechaNacimiento ? `${fecha(p.fechaNacimiento)} (${edad(p.fechaNacimiento)} años)` : 'Sin indicar'],
    ['Sexo', SEXOS[p.sexo] || 'Sin indicar'],
    ['Grupo sanguíneo', p.grupoSanguineo || 'Sin indicar'],
    ['Alergias', p.alergias || 'Sin indicar'],
    ['Antecedentes', p.antecedentes || 'Sin indicar'],
  ]);
}

// ═══════════════════════════ Informe de evolución ═══════════════════════════
/** @param {{paciente: object, evo: {items: object[], totalImagenes: number}, paraPaciente?: boolean}} d */
export async function informeEvolucion({ paciente, evo, paraPaciente = false }) {
  const nombre = nombreDe(paciente);
  const pdf = new Pdf({ titulo: `Informe de evolución - ${nombre}` });
  const marca = await logo();
  const h = new Hoja(pdf);
  const items = ordenar(evo.items);
  const r = resumen(items, evo.totalImagenes);
  const s = series(items);
  const t = tendencia(items, paraPaciente);

  h.grande('Informe de evolución', `Paciente ${nombre} · generado el ${fecha(new Date(), { hora: true })}`);
  datosPaciente(h, paciente);

  h.titulo('Resumen');
  h.pares([
    ['Imágenes subidas', String(r.totalImagenes)],
    ['Estudios válidos analizados', String(r.validas)],
    ['Imágenes no válidas', String(r.invalidas)],
    ['Sin analizar', String(r.sinAnalizar)],
    ['Estudios con hallazgo', String(r.conHallazgo)],
    ['Revisados por un médico', String(r.revisadas)],
    ['Primer estudio', r.primeraFecha ? fecha(r.primeraFecha) : '—'],
    ['Último estudio', r.ultimaFecha ? fecha(r.ultimaFecha) : '—'],
  ]);

  h.titulo('Tendencia');
  h.parrafo(t.titulo, { size: 11, bold: true, color: TONO[t.tono] });
  h.parrafo(t.texto);
  h.parrafo(t.aviso, { size: 8.5, color: C.gris });

  if (s.items.length) {
    h.titulo('Evolución por estudio');
    h.grafica('Zona marcada por la IA', 'Porcentaje de la imagen que ocupa la zona sospechosa.', s.area, { color: '#c92c64' });
    h.grafica('Confianza de la IA', 'Qué tan segura estuvo la IA de cada resultado.', s.confianza, { color: '#0e96ba', max: 1 });
  }

  h.titulo('Historial de estudios');
  if (!items.length) h.parrafo('Todavía no hay estudios analizados.');
  else {
    h.tabla(
      [{ t: 'Fecha', w: 62 }, { t: 'Estudio', w: 80 }, { t: 'Imagen (según la IA)', w: 118 }, { t: 'Resultado', w: 98 }, { t: 'Confianza', w: 48 }, { t: 'Zona', w: 36 }, { t: 'Médico', w: 57 }],
      items.map((i) => {
        const hh = hallazgo(i);
        return [
          fecha(fechaItem(i)),
          modalidadNombre(i.modalidad),
          `${i.imagenValida === false ? 'No válida' : 'Válida'}: ${tipoImagen(i.tipoImagen)}`,
          { t: hh.texto, color: TONO[hh.tono] },
          i.imagenValida === false ? '—' : pct(i.confianza),
          i.imagenValida === false ? '—' : `${areaPct(i)}%`,
          i.etiquetaTipo ? 'Confirmado' : 'Sin revisar',
        ];
      }),
    );
  }

  // Último estudio válido, con sus zonas marcadas.
  const ultimo = s.items.at(-1);
  if (ultimo) {
    try {
      const det = await deteccionesService.obtener(ultimo.deteccionId);
      const jpeg = await fotoConZonas(ultimo.radiografiaId, det.zonas, 800);
      h.titulo(`Último estudio válido (${fecha(fechaItem(ultimo))})`);
      h.espacio(250);
      const pos = h.imagen(jpeg, { maxW: 240, maxH: 240 });
      const hh = hallazgo(ultimo);
      let y = pos.y + 2;
      const linea = (txt, o = {}) => { pdf.texto(txt, pos.x, y, { size: 10, color: C.tinta, ...o }); y += 16; };
      linea(hh.texto, { size: 13, bold: true, color: TONO[hh.tono] });
      linea(`Tipo de imagen: ${tipoImagen(ultimo.tipoImagen)}`);
      linea(`Confianza de la IA: ${pct(ultimo.confianza)}`);
      linea(`Zonas marcadas: ${ultimo.numeroZonas}. Área total: ${areaPct(ultimo)}% de la imagen`);
      if (ultimo.etiquetaTipo) linea(`Confirmado por un médico: ${nombreTumor(ultimo.etiquetaTipo)}`);
    } catch { /* si la imagen no se puede leer, el informe sigue sin ella */ }
  }

  const generado = `Generado el ${fecha(new Date(), { hora: true })}`;
  pdf.alPie((p, n, tot) => marco(p, n, tot, marca, generado));
  return { blob: pdf.blob(), nombre: `informe-evolucion-${slug(nombre)}-${sello()}.pdf` };
}

// ═══════════════════════════ Informe de un estudio ═══════════════════════════
/** @param {{rx: object, det: object|null, paciente?: object|null}} d */
export async function informeEstudio({ rx, det, paciente = null }) {
  const nombre = paciente ? nombreDe(paciente) : rx.pacienteNombre || 'Paciente';
  const pdf = new Pdf({ titulo: `Informe de estudio - ${nombre}` });
  const marca = await logo();
  const h = new Hoja(pdf);

  h.grande('Informe del estudio', `Paciente ${nombre} · estudio del ${fecha(rx.fechaEstudio || rx.createdAt)}`);
  if (paciente) datosPaciente(h, paciente);

  h.titulo('Datos del estudio');
  h.pares([
    ['Tipo de estudio indicado', modalidadNombre(rx.modalidad)],
    ['Fecha del estudio', fecha(rx.fechaEstudio || rx.createdAt)],
    ['Subido el', fecha(rx.createdAt, { hora: true })],
    ['Origen', ORIGENES[rx.origen] || rx.origen],
    ['Estado', ESTADOS[rx.estado] || rx.estado],
    ['Notas', rx.notas || 'Sin notas'],
  ]);

  h.titulo('Resultado de Dreamur-Detector');
  if (!det) {
    h.parrafo('Este estudio todavía no fue analizado.');
  } else {
    const invalida = det.imagenValida === false;
    h.parrafo(
      invalida ? 'Imagen no válida para el análisis'
        : det.tieneTumor ? `Posible ${nombreTumor(det.tipoTumor, det.tipoTumorNombre).toLowerCase()}` : 'Sin hallazgos compatibles con tumor',
      { size: 13, bold: true, color: invalida ? C.alerta : det.tieneTumor ? C.lesion : C.ok });
    h.pares([
      ['Tipo de imagen reconocido por la IA', tipoImagen(det.tipoImagen)],
      ['Analizado el', fecha(det.createdAt, { hora: true })],
      ...(invalida ? [] : [['Confianza de la IA', pct(det.confianza)], ['Zonas marcadas', String(det.zonas.length)]]),
    ]);
    if (invalida) {
      h.parrafo(det.mensaje || 'La imagen no parece una resonancia ni una tomografía de cerebro, por eso no se informa un resultado de tumor.');
    } else {
      if (!coincideModalidad(rx.modalidad, det.tipoImagen))
        h.parrafo(`Nota: se indicó ${modalidadNombre(rx.modalidad)}, pero la IA reconoció ${tipoImagen(det.tipoImagen)}.`, { size: 9, color: C.alerta });
      const probs = det.probabilidades ? Object.entries(det.probabilidades).sort((a, b) => b[1] - a[1]) : [];
      if (probs.length) {
        h.titulo('Probabilidad por tipo');
        probs.forEach(([k, p]) => {
          h.espacio(18);
          pdf.texto(nombreTumor(k), M, h.y, { size: 9.5, color: C.tinta });
          pdf.rect(M + 130, h.y + 1, 280, 8, { relleno: C.claro });
          pdf.rect(M + 130, h.y + 1, Math.max(1, 280 * p), 8, { relleno: C.cian });
          pdf.texto(pct(p), M + 420, h.y, { size: 9.5, color: C.tinta });
          h.y += 17;
        });
      }
    }
    try {
      const jpeg = await fotoConZonas(rx.id, invalida ? [] : det.zonas, 900);
      h.titulo('Imagen');
      h.imagen(jpeg, { maxW: 300, maxH: 300 });
    } catch { /* sin imagen */ }
  }

  if (rx.etiqueta) {
    h.titulo('Diagnóstico confirmado por un médico');
    h.parrafo(nombreTumor(rx.etiqueta.tipoTumor), { size: 12, bold: true });
    if (rx.etiqueta.comentario) h.parrafo(rx.etiqueta.comentario);
  }

  const generado = `Generado el ${fecha(new Date(), { hora: true })}`;
  pdf.alPie((p, n, tot) => marco(p, n, tot, marca, generado));
  return { blob: pdf.blob(), nombre: `informe-estudio-${slug(nombre)}-${sello()}.pdf` };
}

/** Genera y descarga. `armar` es una función async que devuelve {blob, nombre}. */
export async function descargarInforme(armar) {
  const { blob, nombre } = await armar();
  descargar(blob, nombre);
}
