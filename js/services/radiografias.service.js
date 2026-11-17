import { api, olvidarImagen } from '../core/api.js';

export const radiografiasService = {
  listar: (filtro = {}) => api.get('/api/radiografias', filtro),
  obtener: (id) => api.get(`/api/radiografias/${id}`),
  subir: (form) => api.upload('/api/radiografias', form),
  async eliminar(id) { await api.del(`/api/radiografias/${id}`); olvidarImagen(id); },
};

export const deteccionesService = {
  analizar: (radiografiaId) => api.post(`/api/radiografias/${radiografiaId}/detecciones`, undefined, { timeout: 180_000 }),
  historial: (radiografiaId) => api.get(`/api/radiografias/${radiografiaId}/detecciones`),
  obtener: (id) => api.get(`/api/detecciones/${id}`),
};

export const etiquetasService = {
  obtener: (radiografiaId) => api.get(`/api/radiografias/${radiografiaId}/etiqueta`),
  guardar: (radiografiaId, tipoTumor, comentario) => api.put(`/api/radiografias/${radiografiaId}/etiqueta`, { tipoTumor, comentario: comentario || null }),
  eliminar: (radiografiaId) => api.del(`/api/radiografias/${radiografiaId}/etiqueta`),
};
