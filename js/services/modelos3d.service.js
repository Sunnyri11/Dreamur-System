import { api } from '../core/api.js';

/** El generador en Render gratis puede tardar en despertar: mismo margen que el análisis. */
const T_GENERAR = 180_000;

export const modelos3dService = {
  /** Modelo 3D vigente de una detección; `null` si todavía no se generó (el backend responde 204). */
  obtener: (deteccionId) => api.get(`/api/detecciones/${deteccionId}/modelo3d`),

  /**
   * Genera el modelo con la imagen y las zonas de la detección. Opciones: { plano, calidad, vasos, regenerar }.
   * Sin `regenerar`, si ya existe uno lo devuelve sin generar otro.
   */
  generar: (deteccionId, opciones = {}) =>
    api.post(`/api/detecciones/${deteccionId}/modelo3d`, opciones, { timeout: T_GENERAR }),

  /** Archivo .glb como Blob (ruta protegida: se pide con el token). */
  glb: (modeloId) => api.blob(`/api/modelos3d/${modeloId}/archivo`, { timeout: T_GENERAR }),
};
