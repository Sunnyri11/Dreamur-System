/** Confirma el correo con el token recibido (?token=...). */
import { authService } from '../services/auth.service.js';
import { $ } from '../core/ui.js';
import { icono } from '../core/icons.js';
import { esc } from '../core/format.js';

const caja = $('#resultado');
const token = new URLSearchParams(location.search).get('token');

if (!token) {
  caja.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>El enlace de verificación no es válido.</p></div>`;
} else {
  authService.verificar(token)
    .then(() => { caja.innerHTML = `<div class="alerta-caja ok">${icono('check')}<p><b>Correo verificado.</b> Gracias, ya puedes usar todas las funciones.</p></div>`; })
    .catch((e) => { caja.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; });
}
