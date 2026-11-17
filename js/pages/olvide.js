/** Solicitud de enlace para restablecer la contraseña. El servidor responde igual exista o no la cuenta. */
import { authService } from '../services/auth.service.js';
import { $, accion } from '../core/ui.js';
import { icono } from '../core/icons.js';
import { mensajeForm } from '../components/forms.js';

const form = $('#form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  mensajeForm(form, '');
  const correo = form.correo.value.trim();
  if (!correo) return;
  accion(form.querySelector('[type=submit]'), async () => {
    try {
      await authService.olvide(correo);
      form.innerHTML = `<div class="alerta-caja ok">${icono('check')}<p>Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de spam.</p></div>
        <div class="auth-links"><a href="index.html">Volver a iniciar sesión</a></div>`;
    } catch (err) { mensajeForm(form, err.message); }
  });
});
