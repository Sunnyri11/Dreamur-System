/** Inicio de sesión. Redirige al panel que corresponde al rol (el JWT dura 4 horas). */
import { CONFIG } from '../../config.js';
import { Session, irHome } from '../core/auth.js';
import { pingApi } from '../core/api.js';
import { authService } from '../services/auth.service.js';
import { $, el, accion } from '../core/ui.js';
import { icono } from '../core/icons.js';
import { esc } from '../core/format.js';

const params = new URLSearchParams(location.search);

// Si ya hay una sesión vigente, directo a su panel.
if (!params.has('expirada') && Session.valida() && Session.usuario()) irHome(Session.usuario().rol);

const aviso = $('#aviso');
const mensajes = {
  expirada: ['alerta-caja', 'alerta', 'Tu sesión terminó (dura 4 horas). Inicia sesión de nuevo.'],
  pwcambiada: ['alerta-caja ok', 'check', 'Contraseña actualizada. Inicia sesión con la nueva.'],
};
for (const [k, [cls, ico, txt]] of Object.entries(mensajes)) {
  if (params.has(k)) aviso.append(el(`<div class="${cls} sesion-expirada">${icono(ico)}<p>${esc(txt)}</p></div>`));
}

const form = $('#form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  aviso.querySelectorAll('[data-error]').forEach((n) => n.remove());
  const correo = form.correo.value.trim(), password = form.password.value;
  if (!correo || !password) return;
  accion(form.querySelector('[type=submit]'), async () => {
    try {
      const r = await authService.login(correo, password);
      irHome(r.usuario.rol);
    } catch (err) {
      const caja = el(`<div class="alerta-caja lesion" data-error role="alert">${icono('alerta')}<div class="stack" style="gap:.6rem"><p>${esc(err.message)}</p></div></div>`);
      if (err.codigo === 'correo_no_verificado') {
        const b = el(`<button class="btn btn-sm" type="button">${icono('refrescar')}Reenviar correo de confirmación</button>`);
        b.onclick = () => accion(b, async () => {
          try { await authService.reenviarVerificacionPublica(correo); caja.querySelector('p').textContent = 'Te enviamos un nuevo enlace de confirmación. Revisa tu correo (y el spam).'; b.remove(); }
          catch (e2) { caja.querySelector('p').textContent = e2.message; }
        });
        caja.querySelector('.stack').append(b);
      }
      aviso.append(caja);
      form.password.select();
    }
  });
});

// Estado del servidor (en Render gratis puede estar dormido y tardar hasta un minuto).
const punto = $('#puntoApi'), texto = $('#textoApi');
const lento = setTimeout(() => { texto.textContent = 'Despertando el servidor… puede tardar hasta un minuto'; }, 4000);
pingApi().then((ok) => {
  clearTimeout(lento);
  punto.className = `punto ${ok ? 'ok' : 'off'}`;
  texto.textContent = ok
    ? `Servidor en línea · ${CONFIG.USAR_RENDER ? 'Render' : 'local'}`
    : `Sin conexión con el servidor (${CONFIG.API_URL}). Revisa config.js.`;
});
