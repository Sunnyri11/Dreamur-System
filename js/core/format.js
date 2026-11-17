/** Utilidades de formato y etiquetas legibles. */

const LOCALE = 'es-BO';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fecha(iso, { hora = false } = {}) {
  if (!iso) return '—';
  const d = parseFecha(iso);
  if (isNaN(d)) return '—';
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  if (hora) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleString(LOCALE, opts).replace(/\./g, '');
}

/** "2026-05-03" (DateOnly) se interpreta como fecha local, no UTC, para no restar un día. */
export function parseFecha(v) {
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  return new Date(v);
}

export const fechaCorta = (iso) => {
  if (!iso) return '';
  const d = parseFecha(iso);
  return d.toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' }).replace(/\./g, '');
};

export function edad(fechaNac) {
  if (!fechaNac) return null;
  const n = parseFecha(fechaNac), h = new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) e--;
  return e;
}

export const pct = (x, dec = 0) => (x == null ? '—' : `${(x * 100).toFixed(dec)}%`);
export const nombreCompleto = (o) => [o?.nombres, o?.apellidos].filter(Boolean).join(' ');
export const iniciales = (o) => ((o?.nombres?.[0] || '') + (o?.apellidos?.[0] || '')).toUpperCase() || '?';

export function duracion(seg) {
  if (seg <= 0) return '0 min';
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
  return h ? `${h} h ${m} min` : `${Math.max(m, 1)} min`;
}

export const ROLES = { paciente: 'Paciente', medico: 'Médico', admin: 'Administrador' };
export const MODALIDADES = { mri: 'Resonancia magnética', tc: 'Tomografía (TC)' };
/** Claves antiguas: se resuelven pero no aparecen al listar opciones. */
const legado = (obj, extra) => { for (const [k, v] of Object.entries(extra)) Object.defineProperty(obj, k, { value: v, enumerable: false }); };
legado(MODALIDADES, { mri_cerebro: 'Resonancia magnética', tc_cerebro: 'Tomografía (TC)' });
export const ESTADOS = { subido: 'Sin analizar', analizado: 'Analizado', revisado: 'Revisado por médico' };
legado(ESTADOS, { subida: 'Sin analizar', analizada: 'Analizado', revisada: 'Revisado por médico' });
export const ORIGENES = { paciente: 'Subida por el paciente', personal: 'Subida por el médico', dataset: 'Dataset de entrenamiento' };
export const SEXOS = { F: 'Femenino', M: 'Masculino', otro: 'Otro', no_indica: 'Prefiere no indicar' };
export const DOCUMENTOS = { CI: 'Cédula de identidad', DNI: 'DNI', PASAPORTE: 'Pasaporte', OTRO: 'Otro' };

/** Lo que la IA dice que es la imagen. Claves tal como las devuelve el servicio de Dreamur-Detector. */
const TIPOS_IMAGEN = {
  resonancia_cerebral: 'Resonancia cerebral',
  tc_cerebral: 'Tomografía cerebral',
  radiografia_torax: 'Radiografía de tórax',
  otra_imagen_medica: 'Otra imagen médica',
  imagen_no_medica: 'Imagen no médica (foto, captura o dibujo)',
  fotografia: 'Fotografía común',
  documento: 'Documento o captura de pantalla',
};
export function tipoImagen(t) {
  if (!t) return 'Sin identificar';
  return TIPOS_IMAGEN[t] || t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const TUMORES = {
  sin_tumor: 'Sin tumor', glioma: 'Glioma', meningioma: 'Meningioma', pituitario: 'Tumor pituitario',
};
export const nombreTumor = (codigo, nombre) =>
  nombre || TUMORES[codigo] || (codigo ? codigo.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

export const AUDITORIA = {
  login: 'Inicio de sesión', login_fallido: 'Intento fallido', logout: 'Cierre de sesión', registro: 'Registro',
  cuenta_bloqueada: 'Cuenta bloqueada', cambio_password: 'Cambio de contraseña', password_reset: 'Contraseña restablecida',
  password_reset_solicitado: 'Recuperación solicitada', correo_verificado: 'Correo verificado',
  radiografia_subida: 'Imagen subida', radiografia_eliminada: 'Imagen eliminada', deteccion: 'Análisis de IA',
  etiqueta_guardada: 'Diagnóstico confirmado', etiqueta_eliminada: 'Diagnóstico eliminado',
  paciente_creado_por_medico: 'Paciente creado', paciente_vinculado: 'Paciente vinculado', paciente_desvinculado: 'Paciente desvinculado',
  paciente_actualizado: 'Paciente actualizado', perfil_actualizado: 'Perfil actualizado', consentimiento: 'Consentimiento',
  usuario_creado: 'Usuario creado', usuario_activado: 'Usuario activado', usuario_desactivado: 'Usuario desactivado',
  usuario_desbloqueado: 'Usuario desbloqueado', modelo_activado: 'Modelo activado',
  entrenamiento_iniciado: 'Entrenamiento iniciado', entrenamiento_completado: 'Entrenamiento completado', entrenamiento_error: 'Entrenamiento con error',
};
export const accionAuditoria = (a) => AUDITORIA[a] || a.replace(/_/g, ' ');

/** Quita campos vacíos para PATCH: los de lista cerrada se omiten; los de texto vacío borran el valor. */
export function limpiarPayload(obj, { cerrados = [] } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (v === '' && cerrados.includes(k)) continue;
    out[k] = v;
  }
  return out;
}
