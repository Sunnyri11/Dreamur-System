/** Define una nueva contraseña con el token que llegó por correo (?token=...). */
import { authService } from '../services/auth.service.js';
import { $, accion, enlazarFuerza, passwordValida } from '../core/ui.js';
import { icono } from '../core/icons.js';
import { mensajeForm } from '../components/forms.js';

const token = new URLSearchParams(location.search).get('token');
const form = $('#form');
enlazarFuerza(form.password, $('.pw-fuerza', form));

if (!token) {
  form.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>El enlace no es válido. Solicita uno nuevo desde «Olvidé mi contraseña».</p></div>
    <div class="auth-links"><a href="olvide.html">Solicitar otro enlace</a></div>`;
} else {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    mensajeForm(form, '');
    if (!passwordValida(form.password.value)) return mensajeForm(form, 'La contraseña debe tener 8 o más caracteres, con mayúscula, minúscula y número.');
    if (form.password.value !== form.repite.value) return mensajeForm(form, 'Las contraseñas no coinciden.');
    accion(form.querySelector('[type=submit]'), async () => {
      try {
        await authService.restablecer(token, form.password.value);
        form.innerHTML = `<div class="alerta-caja ok">${icono('check')}<p>Contraseña actualizada. Ya puedes iniciar sesión.</p></div>
          <a class="btn btn-primario btn-bloque" href="index.html">Iniciar sesión</a>`;
      } catch (err) { mensajeForm(form, err.message); }
    });
  });
}
