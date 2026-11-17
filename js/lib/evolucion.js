/**
 * Lógica clínica del lado del cliente: cómo se nombra un hallazgo, qué cuenta como «mejor» o «peor»
 * y cómo se resume la evolución de un paciente. La usan la pantalla y el PDF, para que ambos digan lo mismo.
 * Datos de entrada: items de GET /api/pacientes/{id}/evolucion.
 */
import { nombreTumor, tipoImagen, MODALIDADES, parseFecha, fecha } from '../core/format.js';

/** Qué tipo de imagen debería reconocer la IA según la modalidad que indicó quien la subió. */
const ESPERADO = { mri: 'resonancia_cerebral', tc: 'tc_cerebral', mri_cerebro: 'resonancia_cerebral', tc_cerebro: 'tc_cerebral' };
export const modalidadNombre = (m) => MODALIDADES[m] || m || '—';
export const coincideModalidad = (modalidad, tipo) => !tipo || !ESPERADO[modalidad] || ESPERADO[modalidad] === tipo;

export const fechaItem = (i) => parseFecha(i.fechaEstudio || i.createdAt);

/** Orden cronológico ascendente (el primer estudio primero). */
export const ordenar = (items) =>
  [...items].sort((a, b) => fechaItem(a) - fechaItem(b) || new Date(a.createdAt) - new Date(b.createdAt));

/**
 * Lo que se muestra como resultado de un estudio. El diagnóstico confirmado por un médico manda sobre el de la IA.
 * @returns {{clave:'no_valida'|'tumor'|'sin_tumor', tono:'alerta'|'lesion'|'ok', texto:string, confirmado:boolean}}
 */
export function hallazgo(i) {
  if (i.imagenValida === false) return { clave: 'no_valida', tono: 'alerta', texto: 'Imagen no válida', confirmado: false };
  if (i.etiquetaTipo) {
    const tumor = i.etiquetaTipo !== 'sin_tumor';
    return { clave: tumor ? 'tumor' : 'sin_tumor', tono: tumor ? 'lesion' : 'ok', texto: nombreTumor(i.etiquetaTipo), confirmado: true };
  }
  return i.tieneTumor
    ? { clave: 'tumor', tono: 'lesion', texto: nombreTumor(i.tipoTumor, i.tipoTumorNombre), confirmado: false }
    : { clave: 'sin_tumor', tono: 'ok', texto: 'Sin tumor', confirmado: false };
}

/** Porcentaje de la imagen marcado como sospechoso (0 si el diagnóstico final es «sin tumor»). */
export const areaPct = (i) => (hallazgo(i).clave === 'tumor' ? Math.round((i.areaSospechosa ?? 0) * 1000) / 10 : 0);

export const validos = (items) => items.filter((i) => i.imagenValida !== false);

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
export { plural };

/** Compara los dos últimos estudios válidos. */
export function tendencia(items, paraPaciente = true) {
  const medico = paraPaciente ? 'tu médico' : 'el médico';
  const aviso = `Es una estimación de la IA según el área marcada; no sustituye la valoración de ${medico}.`;
  const v = validos(items);

  if (v.length < 2) {
    return {
      tono: '', icono: 'reloj', aviso,
      titulo: v.length === 0 ? 'Todavía no hay estudios válidos' : 'Falta un estudio para comparar',
      texto: v.length === 0
        ? (paraPaciente ? 'Sube una resonancia o tomografía cerebral para empezar a seguir tu evolución.' : 'Aún no hay resonancias o tomografías cerebrales válidas de este paciente.')
        : (paraPaciente ? 'Con un segundo estudio válido podrás ver si la zona marcada cambia.' : 'Con un segundo estudio válido se podrá ver si la zona marcada cambia.'),
    };
  }
  const ant = v[v.length - 2], act = v[v.length - 1];
  const hA = hallazgo(ant), hB = hallazgo(act);
  const a0 = areaPct(ant), a1 = areaPct(act);
  const fA = fecha(fechaItem(ant)), fB = fecha(fechaItem(act));

  if (hA.clave !== 'tumor' && hB.clave !== 'tumor')
    return { tono: 'ok', icono: 'check', aviso, titulo: 'Sin hallazgos en los últimos estudios', texto: `Los estudios del ${fA} y del ${fB} no muestran zonas sospechosas.` };
  if (hA.clave === 'tumor' && hB.clave !== 'tumor')
    return { tono: 'ok', icono: 'baja', aviso, titulo: 'Sin hallazgo en el estudio más reciente', texto: `Había una zona marcada el ${fA} y el estudio del ${fB} ya no la muestra.` };
  if (hA.clave !== 'tumor' && hB.clave === 'tumor')
    return { tono: 'lesion', icono: 'tendencia', aviso, titulo: 'Hallazgo nuevo', texto: `El estudio del ${fB} marca una zona sospechosa (${hB.texto}) que no aparecía el ${fA}. Conviene que lo revise ${medico}.` };

  const delta = a1 - a0, rel = a0 > 0 ? delta / a0 : 0;
  if (Math.abs(delta) >= 0.5 && rel <= -0.15)
    return { tono: 'ok', icono: 'baja', aviso, titulo: 'La zona marcada es menor', texto: `Pasó de ${a0}% a ${a1}% de la imagen entre los estudios del ${fA} y del ${fB}.` };
  if (Math.abs(delta) >= 0.5 && rel >= 0.15)
    return { tono: 'lesion', icono: 'tendencia', aviso, titulo: 'La zona marcada es mayor', texto: `Pasó de ${a0}% a ${a1}% de la imagen entre los estudios del ${fA} y del ${fB}. Conviene que lo revise ${medico}.` };
  return { tono: '', icono: 'estable', aviso, titulo: 'Sin cambios importantes', texto: `La zona marcada se mantiene alrededor de ${a1}% de la imagen entre los estudios del ${fA} y del ${fB}.` };
}

/** Cifras para los indicadores. `items` ya debe venir ordenado. */
export function resumen(items, totalImagenes = items.length) {
  const v = validos(items);
  const distribucion = {};
  v.forEach((i) => { const t = hallazgo(i).texto; distribucion[t] = (distribucion[t] || 0) + 1; });
  return {
    totalImagenes,
    analizadas: items.length,
    validas: v.length,
    invalidas: items.length - v.length,
    sinAnalizar: Math.max(0, totalImagenes - items.length),
    revisadas: items.filter((i) => i.etiquetaTipo).length,
    conHallazgo: v.filter((i) => hallazgo(i).clave === 'tumor').length,
    ultimo: v[v.length - 1] ?? null,
    distribucion,
    primeraFecha: items.length ? fechaItem(items[0]) : null,
    ultimaFecha: items.length ? fechaItem(items[items.length - 1]) : null,
  };
}

/** Series para las gráficas (solo estudios válidos). Valores en fracción 0..1. */
export function series(items) {
  const v = validos(items);
  return {
    items: v,
    area: v.map((i) => ({ t: fechaItem(i).getTime(), y: areaPct(i) / 100, i })),
    confianza: v.map((i) => ({ t: fechaItem(i).getTime(), y: i.confianza ?? 0, i })),
  };
}

/** Resumen de validez de una radiografía a partir de su «última detección» (para insignias en listas). */
export function validez(det) {
  if (!det) return { clave: 'pendiente', tono: '', texto: 'Sin analizar', ico: 'reloj', detalle: '' };
  if (det.imagenValida === false)
    return { clave: 'invalida', tono: 'alerta', texto: 'Imagen no válida', ico: 'alerta', detalle: tipoImagen(det.tipoImagen) };
  return { clave: 'valida', tono: 'ok', texto: 'Imagen válida', ico: 'check', detalle: tipoImagen(det.tipoImagen) };
}

export { tipoImagen, nombreTumor };
