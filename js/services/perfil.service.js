import { api } from '../core/api.js';

export const perfilService = {
  obtener: () => api.get('/api/perfil'),
  actualizar: (body) => api.patch('/api/perfil', body),
};
