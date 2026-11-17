import { api } from '../core/api.js';
import { Session } from '../core/auth.js';

export const authService = {
  registrar: (body) => api.post('/api/auth/registro', body, { auth: false }),
  async login(correo, password) {
    const r = await api.post('/api/auth/login', { correo, password }, { auth: false });
    Session.guardar(r);
    return r;
  },
  async logout() {
    try { if (Session.token()) await api.post('/api/auth/logout'); } catch { /* la sesión local se cierra igual */ }
    Session.cerrar();
  },
  async cambiarRol(rol) {
    const r = await api.post('/api/auth/cambiar-rol', { rol });
    Session.guardar(r);
    return r;
  },
  async activarRol(datos) {
    const r = await api.post('/api/auth/activar-rol', datos);
    Session.guardar(r);
    return r;
  },
  me: () => api.get('/api/auth/me'),
  cambiarPassword: (passwordActual, passwordNueva) => api.post('/api/auth/cambiar-password', { passwordActual, passwordNueva }),
  olvide: (correo) => api.post('/api/auth/olvide-password', { correo }, { auth: false }),
  restablecer: (token, passwordNueva) => api.post('/api/auth/restablecer-password', { token, passwordNueva }, { auth: false }),
  verificar: (token) => api.post('/api/auth/verificar-correo', { token }, { auth: false }),
  reenviarVerificacionPublica: (correo) => api.post('/api/auth/reenviar-verificacion-publico', { correo }, { auth: false }),
  reenviarVerificacion: () => api.post('/api/auth/reenviar-verificacion'),
};
