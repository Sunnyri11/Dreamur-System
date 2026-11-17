import { api } from '../core/api.js';

export const pacientesService = {
  listar: (filtro = {}) => api.get('/api/pacientes', filtro),
  obtener: (id) => api.get(`/api/pacientes/${id}`),
  obtenerMio: () => api.get('/api/pacientes/me'),
  actualizar: (id, body) => api.patch(`/api/pacientes/${id}`, body),
  crear: (body) => api.post('/api/pacientes', body),
  vincular: (codigo) => api.post('/api/pacientes/vincular', { codigo }),
  desvincular: (id) => api.del(`/api/pacientes/${id}/vinculo`),
  evolucion: (id) => api.get(`/api/pacientes/${id}/evolucion`),
  consentimientos: (id) => api.get(`/api/pacientes/${id}/consentimientos`),
  registrarConsentimiento: (tipo, otorgado) => api.post('/api/pacientes/me/consentimientos', { tipo, otorgado }),
};
