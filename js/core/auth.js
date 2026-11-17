/** Sesión del usuario (token JWT de 4 h) y guardas de acceso por rol. */
import { CONFIG } from '../../config.js';

const KEY = 'dreamur.sesion.v1';

/** Raíz del sitio, calculada desde la ubicación de este módulo: funciona desde cualquier carpeta. */
export const RAIZ = new URL('../../', import.meta.url).href;

export const HOME = {
  paciente: 'paciente/inicio.html',
  medico: 'medico/inicio.html',
  admin: 'admin/inicio.html',
};

function leerAlmacen() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export const Session = {
  guardar(resp) {
    const expira = resp.expiraEn ? Date.parse(resp.expiraEn) : Date.now() + (resp.expiraEnSegundos ?? CONFIG.SESION_MINUTOS * 60) * 1000;
    const datos = { token: resp.accessToken, expira, usuario: resp.usuario };
    try { localStorage.setItem(KEY, JSON.stringify(datos)); } catch { /* modo privado: la sesión dura lo que dure la pestaña */ Session._mem = datos; }
  },
  leer() { return leerAlmacen() || Session._mem || null; },
  token() { return Session.valida() ? Session.leer().token : null; },
  usuario() { return Session.leer()?.usuario ?? null; },
  actualizarUsuario(parcial) {
    const s = Session.leer(); if (!s) return;
    s.usuario = { ...s.usuario, ...parcial };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { Session._mem = s; }
  },
  segundosRestantes() { const s = Session.leer(); return s ? Math.floor((s.expira - Date.now()) / 1000) : 0; },
  valida() { const s = Session.leer(); return !!(s && s.token && s.expira > Date.now()); },
  cerrar() { try { localStorage.removeItem(KEY); } catch { /* nada */ } Session._mem = null; },
  _mem: null,
};

export function ir(ruta) { location.href = RAIZ + ruta; }
export function irHome(rol) { ir(HOME[rol] || 'index.html'); }

/**
 * Protege una página: si no hay sesión válida o el rol no corresponde, redirige.
 * @returns {object|null} el usuario si puede entrar.
 */
export function exigirRol(...roles) {
  const u = Session.usuario();
  if (!Session.valida() || !u) {
    const habia = !!Session.leer();
    Session.cerrar();
    location.replace(RAIZ + 'index.html' + (habia ? '?expirada=1' : ''));
    return null;
  }
  if (roles.length && !roles.includes(u.rol)) { irHome(u.rol); return null; }
  return u;
}
