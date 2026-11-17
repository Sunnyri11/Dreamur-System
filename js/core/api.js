/** Cliente HTTP del backend. Todo el frontend habla con la API únicamente a través de este módulo. */
import { CONFIG } from '../../config.js';
import { Session, RAIZ } from './auth.js';

export class ApiError extends Error {
  constructor(status, mensaje, codigo, traceId) {
    super(mensaje);
    this.name = 'ApiError';
    this.status = status;
    this.codigo = codigo;
    this.traceId = traceId;
  }
}

function url(path, query) {
  const u = new URL(CONFIG.API_URL + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

/** Convierte ProblemDetails / ValidationProblemDetails de ASP.NET en un mensaje legible. */
function mensajeDe(data, status) {
  if (data?.errors && typeof data.errors === 'object') {
    const partes = Object.values(data.errors).flat().filter(Boolean);
    if (partes.length) return partes.join(' ');
  }
  if (data?.detail) return data.detail;
  if (data?.title) return data.title;
  if (status === 0) return 'No se pudo conectar con el servidor.';
  return `Error ${status}`;
}

let pendientes = 0;
function ocupado(delta) {
  pendientes = Math.max(0, pendientes + delta);
}

async function request(method, path, { body, query, form, auth = true, timeout, as = 'json' } = {}) {
  const headers = { Accept: as === 'json' ? 'application/json' : '*/*' };
  const token = Session.token();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  const ctrl = new AbortController();
  const limite = timeout ?? CONFIG.TIMEOUT_MS;
  const t = setTimeout(() => ctrl.abort(), limite);
  // Render gratis tarda en despertar: avisamos si la petición supera 5 s.
  const lento = setTimeout(() => window.dispatchEvent(new CustomEvent('api:lento')), 5000);
  ocupado(1);

  let resp;
  try {
    resp = await fetch(url(path, query), { method, headers, body: payload, signal: ctrl.signal });
  } catch (e) {
    const abort = e?.name === 'AbortError';
    throw new ApiError(0, abort
      ? 'El servidor tardó demasiado en responder. Intenta de nuevo en unos segundos.'
      : `No se pudo conectar con el servidor (${CONFIG.API_URL}). Verifica que esté encendido y que config.js apunte al entorno correcto.`);
  } finally {
    clearTimeout(t); clearTimeout(lento); ocupado(-1);
    window.dispatchEvent(new CustomEvent('api:rapido'));
  }

  if (resp.status === 401 && auth && token) {
    Session.cerrar();
    location.replace(RAIZ + 'index.html?expirada=1');
    throw new ApiError(401, 'Tu sesión expiró. Inicia sesión de nuevo.');
  }

  if (!resp.ok) {
    let data = null;
    try { data = await resp.json(); } catch { /* cuerpo vacío */ }
    throw new ApiError(resp.status, mensajeDe(data, resp.status), data?.code, data?.traceId);
  }
  if (resp.status === 204) return null;
  if (as === 'blob') return resp.blob();
  const tipo = resp.headers.get('content-type') || '';
  return tipo.includes('json') ? resp.json() : null;
}

export const api = {
  get: (path, query, opts) => request('GET', path, { query, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, opts),
  upload: (path, form, opts) => request('POST', path, { form, timeout: CONFIG.TIMEOUT_ANALISIS_MS, ...opts }),
  blob: (path, opts) => request('GET', path, { as: 'blob', ...opts }),
};

/** ¿Está despierto el servidor? (no requiere sesión) */
export async function pingApi() {
  try { await request('GET', '/health', { auth: false, timeout: 70_000 }); return true; } catch { return false; }
}

/** ¿Responde el servicio de IA? Usa no-cors: basta con que el host conteste, no necesita CORS. */
export async function pingIA() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    await fetch(CONFIG.IA_URL + CONFIG.IA_RUTA_ESTADO, { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}

/** Imágenes protegidas: se piden con el token y se exponen como URL de objeto (con caché). */
const cacheImagenes = new Map();
export async function urlImagen(radiografiaId) {
  if (cacheImagenes.has(radiografiaId)) return cacheImagenes.get(radiografiaId);
  const p = api.blob(`/api/radiografias/${radiografiaId}/archivo`).then((b) => ({ url: URL.createObjectURL(b), blob: b }));
  cacheImagenes.set(radiografiaId, p);
  p.catch(() => cacheImagenes.delete(radiografiaId));
  return p;
}
export function olvidarImagen(radiografiaId) {
  const p = cacheImagenes.get(radiografiaId);
  cacheImagenes.delete(radiografiaId);
  p?.then((x) => URL.revokeObjectURL(x.url)).catch(() => {});
}
