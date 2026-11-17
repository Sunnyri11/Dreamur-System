/** Registro: solo pacientes. Los médicos los da de alta el administrador. */
import { Session, irHome } from '../core/auth.js';
import { authService } from '../services/auth.service.js';
import { $, accion, enlazarFuerza, passwordValida } from '../core/ui.js';
import { limpiarPayload, esc } from '../core/format.js';
import { icono } from '../core/icons.js';
import { leerForm, mensajeForm } from '../components/forms.js';

if (Session.valida() && Session.usuario()) irHome(Session.usuario().rol);

const form = $('#form');
form.fechaNacimiento.max = new Date().toISOString().slice(0, 10);
enlazarFuerza(form.password, $('.pw-fuerza', form));

form.addEventListener('submit', (e) => {
  e.preventDefault();
  mensajeForm(form, '');
  const d = leerForm(form);
  if (d.nombres.length < 2 || d.apellidos.length < 2) return mensajeForm(form, 'Nombres y apellidos deben tener al menos 2 caracteres.');
  if (!/^\S+@\S+\.\S+$/.test(d.correo)) return mensajeForm(form, 'Escribe un correo electrónico válido.');
  if (!passwordValida(d.password)) return mensajeForm(form, 'La contraseña debe tener 8 o más caracteres, con mayúscula, minúscula y número.');
  if (d.password !== form.repite.value) return mensajeForm(form, 'Las contraseñas no coinciden.');
  if (d.numeroDocumento && !d.tipoDocumento) return mensajeForm(form, 'Indica el tipo de documento junto con el número.');
  if (!d.aceptaTratamientoDatos) return mensajeForm(form, 'Debes aceptar el tratamiento de datos para crear la cuenta.');

  const cuerpo = limpiarPayload({
    nombres: d.nombres, apellidos: d.apellidos, correo: d.correo, password: d.password,
    tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento, fechaNacimiento: d.fechaNacimiento,
    sexo: d.sexo, telefono: d.telefono,
    aceptaTratamientoDatos: true, aceptaUsoEntrenamiento: !!d.aceptaUsoEntrenamiento,
  }, { cerrados: ['tipoDocumento', 'numeroDocumento', 'fechaNacimiento', 'sexo', 'telefono'] });

  accion(form.querySelector('[type=submit]'), async () => {
    try {
      const r = await authService.registrar(cuerpo);
      if (r?.accessToken) { Session.guardar(r); irHome('paciente'); return; }   // confirmación desactivada en el servidor
      pantallaConfirmar(cuerpo.correo);
    } catch (err) { mensajeForm(form, err.message); }
  });
});

/** El paciente debe confirmar su cuenta con el enlace que llega por correo (Brevo) antes de iniciar sesión. */
function pantallaConfirmar(correo) {
  form.innerHTML = `
    <div class="alerta-caja ok">${icono('check')}<div><p><b>Cuenta creada. Confirma tu correo.</b></p>
      <p class="dim" style="margin-top:.3rem">Enviamos un enlace a <b>${esc(correo)}</b>. Ábrelo para activar tu cuenta y luego inicia sesión. Revisa también la carpeta de spam.</p></div></div>
    <p class="msg-form" role="status" aria-live="polite" id="reenvio"></p>
    <div class="row"><button class="btn" type="button" id="reenviar">${icono('refrescar')}Reenviar correo</button>
      <a class="btn btn-primario" href="index.html">Ir a iniciar sesión</a></div>`;
  const b = $('#reenviar');
  b.onclick = () => accion(b, async () => {
    try { await authService.reenviarVerificacionPublica(correo); $('#reenvio').textContent = 'Listo: si falta confirmar la cuenta, te llegará un nuevo enlace.'; }
    catch (e) { $('#reenvio').textContent = e.message; }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
