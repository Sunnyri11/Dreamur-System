import { api } from '../core/api.js';

export const usuariosService = {
  listar: (filtro = {}) => api.get('/api/usuarios', filtro),
  crear: (body) => api.post('/api/usuarios', body),
  cambiarEstado: (id, activo) => api.patch(`/api/usuarios/${id}/estado`, { activo }),
  desbloquear: (id) => api.post(`/api/usuarios/${id}/desbloquear`),
};

export const medicosService = {
  listar: (filtro = {}) => api.get('/api/medicos', filtro),
};

export const auditoriaService = {
  listar: (filtro = {}) => api.get('/api/auditoria', filtro),
};

export const modelosService = {
  versiones: () => api.get('/api/modelos'),
  activo: () => api.get('/api/modelos/activo'),
  activar: (id) => api.post(`/api/modelos/${id}/activar`),
  entrenamientos: (filtro = {}) => api.get('/api/entrenamientos', filtro),
  entrenar: () => api.post('/api/entrenamientos'),
};
