/** Armazón común de las páginas autenticadas: barra lateral, barra superior, estado de la IA y temporizador de sesión. */
import { CONFIG } from '../../config.js';
import { Session, exigirRol, RAIZ, ir, irHome } from './auth.js';
import { pingIA } from './api.js';
import { authService } from '../services/auth.service.js';
import { icono } from './icons.js';
import { esc, ROLES, nombreCompleto, iniciales, duracion } from './format.js';
import { $, el, toast } from './ui.js';

const NAV = {
  paciente: [
    { id: 'inicio', ruta: 'paciente/inicio.html', texto: 'Mis estudios', ico: 'cerebro' },
    { id: 'detector', ruta: 'paciente/detector.html', texto: 'Dreamur-Detector', ico: 'escaner' },
    { id: 'evolucion', ruta: 'paciente/evolucion.html', texto: 'Mi evolución y reporte', ico: 'tendencia' },
    { id: 'perfil', ruta: 'paciente/perfil.html', texto: 'Mi perfil', ico: 'usuario' },
  ],
  medico: [
    { id: 'inicio', ruta: 'medico/inicio.html', texto: 'Mis pacientes', ico: 'usuarios' },
    { id: 'detector', ruta: 'medico/detector.html', texto: 'Dreamur-Detector', ico: 'escaner' },
    { id: 'perfil', ruta: 'medico/perfil.html', texto: 'Mi perfil', ico: 'usuario' },
  ],
  admin: [
    { id: 'inicio', ruta: 'admin/inicio.html', texto: 'Resumen', ico: 'inicio' },
    { id: 'pacientes', ruta: 'admin/pacientes.html', texto: 'Pacientes', ico: 'usuarios' },
    { id: 'medicos', ruta: 'admin/medicos.html', texto: 'Médicos', ico: 'estetoscopio' },
    { id: 'auditoria', ruta: 'admin/auditoria.html', texto: 'Auditoría', ico: 'escudo' },
    { id: 'modelo', ruta: 'admin/modelo.html', texto: 'Modelo de IA', ico: 'chip' },
    { id: 'perfil', ruta: 'admin/perfil.html', texto: 'Mi perfil', ico: 'usuario' },
  ],
};
const CONTEXTO = { paciente: 'Panel del paciente', medico: 'Panel médico', admin: 'Administración' };

/**
 * @param {{roles: string[], activa: string, titulo?: string}} cfg
 * @returns {{usuario: object, contenido: HTMLElement} | null}
 */
export function montarShell({ roles, activa, titulo }) {
  const usuario = exigirRol(...roles);
  if (!usuario) return null;

  document.title = `${titulo || CONTEXTO[usuario.rol]} · ${CONFIG.APP_NOMBRE}`;
  const items = NAV[usuario.rol].map((n) =>
    `<a href="${RAIZ + n.ruta}" ${n.id === activa ? 'aria-current="page"' : ''}>${icono(n.ico)}${esc(n.texto)}</a>`).join('');
  const nombre = nombreCompleto(usuario);

  const shell = el(`
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="${RAIZ + (usuario.rol === 'paciente' ? 'paciente' : usuario.rol)}/inicio.html">
        <img src="${RAIZ}assets/img/raco-face.jpg" alt="">
        <span class="brand-text">Dreamur-Detector<small>Neuro-oncología asistida</small></span>
      </a>
      <nav class="nav" aria-label="Principal">${items}</nav>
      <div class="sidebar-foot">
        <button class="estado-ia" id="estadoIA" type="button" title="Comprobar de nuevo">
          <span class="punto wait" id="puntoIA"></span><span id="textoIA">Comprobando IA…</span>
        </button>
        <div class="entorno-tag">Entorno: ${CONFIG.USAR_RENDER ? 'Render (producción)' : 'local'}</div>
        <button class="btn btn-fantasma btn-bloque" id="btnSalir">${icono('salir')}Cerrar sesión</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-fantasma btn-icono menu-btn" id="btnMenu" aria-label="Abrir menú">${icono('menu')}</button>
        <div class="topbar-titulo">${esc(CONTEXTO[usuario.rol])}</div>
        ${(usuario.roles?.length ?? 0) > 1 ? `<label class="cambio-rol" title="Cambiar de perfil">Perfil
          <select id="selRol" class="input">${usuario.roles.map((r) => `<option value="${r}" ${r === usuario.rol ? 'selected' : ''}>${esc(ROLES[r])}</option>`).join('')}</select></label>` : ''}
        <span class="sesion-tiempo" id="sesionTiempo" title="La sesión dura 4 horas"></span>
        <a class="user-chip" href="${RAIZ}${usuario.rol}/perfil.html" style="color:inherit;text-decoration:none">
          <span class="avatar">${esc(iniciales(usuario))}</span>
          <span class="txt"><span class="nombre">${esc(nombre)}</span><span class="rol">${esc(ROLES[usuario.rol])}</span></span>
        </a>
      </header>
      <main class="content" id="contenido"></main>
    </div>
  </div>`);

  const app = $('#app');
  app.replaceChildren(shell);

  $('#btnMenu').onclick = () => $('#sidebar').classList.toggle('abierto');
  $('#contenido').addEventListener('click', () => $('#sidebar').classList.remove('abierto'));
  $('#btnSalir').onclick = async () => { await authService.logout(); ir('index.html'); };

  const selRol = $('#selRol');
  if (selRol) selRol.onchange = async () => {
    selRol.disabled = true;
    try { const r = await authService.cambiarRol(selRol.value); irHome(r.usuario.rol); }
    catch (e) { toast(e.message || 'No se pudo cambiar de perfil.', 'error'); selRol.value = usuario.rol; selRol.disabled = false; }
  };

  vigilarSesion();
  vigilarIA();
  vigilarLentitud();
  return { usuario, contenido: $('#contenido') };
}

function vigilarSesion() {
  const el_ = $('#sesionTiempo');
  const tick = async () => {
    const s = Session.segundosRestantes();
    if (s <= 0) {
      toast('Tu sesión de 4 horas terminó. Inicia sesión de nuevo.', 'aviso');
      await authService.logout();
      setTimeout(() => ir('index.html?expirada=1'), 900);
      return;
    }
    el_.textContent = `Sesión: ${duracion(s)}`;
    el_.classList.toggle('pronto', s < 600);
  };
  tick();
  setInterval(tick, 30_000);
}

function vigilarIA() {
  const punto = $('#puntoIA'), texto = $('#textoIA');
  const comprobar = async () => {
    punto.className = 'punto wait'; texto.textContent = 'Comprobando IA…';
    const ok = await pingIA();
    punto.className = `punto ${ok ? 'ok' : 'off'}`;
    texto.textContent = ok ? 'Dreamur-Detector en línea' : 'IA sin respuesta';
  };
  $('#estadoIA').onclick = comprobar;
  comprobar();
  setInterval(comprobar, 90_000);
}

function vigilarLentitud() {
  let banner = null;
  window.addEventListener('api:lento', () => {
    if (banner) return;
    banner = el(`<div class="banner-lento"><span class="spin"></span><span>Conectando con el servidor. Si estaba en reposo puede tardar hasta un minuto.</span></div>`);
    document.body.append(banner);
  });
  window.addEventListener('api:rapido', () => { banner?.remove(); banner = null; });
}
