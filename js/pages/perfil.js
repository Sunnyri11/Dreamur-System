/**
 * Mi perfil: lo usan paciente, médico y administrador (cada uno solo ve y edita sus propios datos).
 * Cada rol tiene su campos propios: clínicos (paciente), matrícula y especialidad (médico), nivel (admin).
 */
import { montarShell } from '../core/layout.js';
import { Session, ir, irHome } from '../core/auth.js';
import { esc, fecha, ROLES, iniciales, nombreCompleto, limpiarPayload } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, accion, ok, fallo, confirmar, cargando, enlazarFuerza, passwordValida } from '../core/ui.js';
import { perfilService } from '../services/perfil.service.js';
import { authService } from '../services/auth.service.js';
import { pacientesService } from '../services/pacientes.service.js';
import { campo, camposIdentidad, leerForm, mensajeForm, GRUPOS_SANGUINEOS } from '../components/forms.js';

const shell = montarShell({ roles: ['paciente', 'medico', 'admin'], activa: 'perfil', titulo: 'Mi perfil' });
if (shell) iniciar(shell);

async function iniciar({ usuario, contenido }) {
  contenido.innerHTML = cargando('Cargando tu perfil…');
  let p;
  try { p = await perfilService.obtener(); }
  catch (e) { contenido.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; return; }
  pintar(contenido, p);
}

function pintar(contenido, p) {
  const rol = p.rol;
  const especificos = rol === 'paciente' ? `
      <div class="full"><h3 style="margin-top:.6rem">Datos clínicos</h3><p class="hint" style="margin:.2rem 0 0">Ayudan a tu médico a interpretar tus estudios.</p></div>
      ${campo({ id: 'grupoSanguineo', etiqueta: 'Grupo sanguíneo', valor: p.grupoSanguineo, opciones: GRUPOS_SANGUINEOS })}
      ${campo({ id: 'contactoEmergencia', etiqueta: 'Contacto de emergencia', valor: p.contactoEmergencia, attrs: 'maxlength="150"' })}
      ${campo({ id: 'telefonoEmergencia', etiqueta: 'Teléfono de emergencia', tipo: 'tel', valor: p.telefonoEmergencia, attrs: 'maxlength="30"' })}
      <span></span>
      ${campo({ id: 'alergias', etiqueta: 'Alergias', valor: p.alergias, filas: 2, completo: true, attrs: 'maxlength="1000"' })}
      ${campo({ id: 'antecedentes', etiqueta: 'Antecedentes médicos', valor: p.antecedentes, filas: 3, completo: true, attrs: 'maxlength="2000"' })}`
    : rol === 'medico' ? `
      <div class="full"><h3 style="margin-top:.6rem">Datos profesionales</h3></div>
      ${campo({ id: 'matricula', etiqueta: 'Matrícula profesional', valor: p.matricula, attrs: 'maxlength="50"' })}
      ${campo({ id: 'especialidad', etiqueta: 'Especialidad', valor: p.especialidad, attrs: 'maxlength="100"' })}`
    : `
      <div class="full"><h3 style="margin-top:.6rem">Administración</h3></div>
      <div class="field"><label>Nivel de administrador</label><input class="input" value="${esc(p.nivelAdmin === 'superadmin' ? 'Superadministrador' : 'Administrador')}" readonly></div>`;

  contenido.innerHTML = `
    <div class="page-head"><div><h1>Mi perfil</h1><p>Consulta y edita tus datos personales. Solo tú puedes modificar esta información.</p></div></div>
    <div class="grid g-main">
      <section class="card">
        <div class="card-head"><div class="paciente-cab" style="gap:.9rem"><span class="avatar" style="width:52px;height:52px;font-size:1rem">${esc(iniciales(p))}</span>
          <div><h2 style="font-size:1.15rem">${esc(nombreCompleto(p))}</h2><div class="meta"><span class="badge info">${esc(ROLES[rol])}</span>
          ${p.codigoPaciente ? `<span class="codigo">${esc(p.codigoPaciente)}</span>` : ''}</div></div></div></div>
        <form class="stack" id="perfil-form" novalidate>
          <div class="form-grid">
            ${campo({ id: 'nombres', etiqueta: 'Nombres', valor: p.nombres, req: true, attrs: 'maxlength="100" minlength="2" autocomplete="given-name"' })}
            ${campo({ id: 'apellidos', etiqueta: 'Apellidos', valor: p.apellidos, req: true, attrs: 'maxlength="100" minlength="2" autocomplete="family-name"' })}
            ${camposIdentidad(p)}
            ${campo({ id: 'ciudad', etiqueta: 'Ciudad', valor: p.ciudad, attrs: 'maxlength="100" autocomplete="address-level2"' })}
            ${campo({ id: 'pais', etiqueta: 'País (código de 2 letras)', valor: p.pais, attrs: 'maxlength="2" style="text-transform:uppercase" placeholder="BO"' })}
            ${campo({ id: 'direccion', etiqueta: 'Dirección', valor: p.direccion, completo: true, attrs: 'maxlength="250" autocomplete="street-address"' })}
            ${especificos}
          </div>
          <div class="row"><button class="btn btn-primario" type="submit">${icono('check')}Guardar cambios</button></div>
        </form>
      </section>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Mi cuenta</h2></div>
          <dl class="ficha" style="grid-template-columns:1fr">
            <div><dt>Correo electrónico</dt><dd>${esc(p.correo || '—')}
              ${p.correoVerificado ? '<span class="badge ok" style="margin-left:.4rem">Verificado</span>' : '<span class="badge alerta" style="margin-left:.4rem">Sin verificar</span>'}</dd></div>
            <div><dt>Rol</dt><dd>${esc(ROLES[rol])}</dd></div>
            <div><dt>Último acceso</dt><dd>${esc(fecha(p.ultimoAcceso, { hora: true }))}</dd></div>
            <div><dt>Cuenta creada</dt><dd>${esc(fecha(p.creadoEn))}</dd></div>
          </dl>
          ${p.correoVerificado ? '' : `<button class="btn btn-sm" id="btn-verificar" style="margin-top:1rem">${icono('correo')}Reenviar correo de verificación</button>`}
        </section>

        <section class="card">
          <div class="card-head"><h2>Cambiar contraseña</h2></div>
          <form class="stack" id="pw-form" novalidate>
            <div class="field"><label for="pw-actual">Contraseña actual</label><input class="input" id="pw-actual" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="pw-nueva">Nueva contraseña</label><input class="input" id="pw-nueva" type="password" autocomplete="new-password" required>
              <div class="pw-fuerza" aria-hidden="true"><i></i></div><span class="hint">8 o más caracteres, con mayúscula, minúscula y número.</span></div>
            <div class="field"><label for="pw-repite">Repite la nueva contraseña</label><input class="input" id="pw-repite" type="password" autocomplete="new-password" required></div>
            <button class="btn" type="submit">${icono('candado')}Actualizar contraseña</button>
          </form>
        </section>

        ${rol === 'paciente' ? '<section class="card" id="consentimientos"></section>' : ''}
        ${activables(rol, Session.usuario()?.roles).length ? '<section class="card" id="activar-perfil"></section>' : ''}
      </div>
    </div>`;

  // ───── activar otro perfil (médico/admin pueden ser también paciente; admin también médico) ─────
  const caja = $('#activar-perfil', contenido);
  if (caja) pintarActivar(caja, activables(rol, Session.usuario()?.roles));

  // ───── datos personales ─────
  const form = $('#perfil-form', contenido);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    mensajeForm(form, '');
    const d = leerForm(form);
    if (d.nombres.length < 2 || d.apellidos.length < 2) return mensajeForm(form, 'Nombres y apellidos deben tener al menos 2 caracteres.');
    if (d.numeroDocumento && !d.tipoDocumento) return mensajeForm(form, 'Indica el tipo de documento junto con el número.');
    if (d.pais) d.pais = d.pais.toUpperCase();
    if (d.pais && d.pais.length !== 2) return mensajeForm(form, 'El país debe ser un código de 2 letras (por ejemplo BO).');
    accion(form.querySelector('[type=submit]'), async () => {
      const nuevo = await perfilService.actualizar(limpiarPayload(d, { cerrados: ['nombres', 'apellidos', 'tipoDocumento', 'sexo', 'grupoSanguineo', 'pais', 'fechaNacimiento'] }));
      Session.actualizarUsuario({ nombres: nuevo.nombres, apellidos: nuevo.apellidos });
      const chip = document.querySelector('.user-chip');
      if (chip) { chip.querySelector('.nombre').textContent = nombreCompleto(nuevo); chip.querySelector('.avatar').textContent = iniciales(nuevo); }
      ok('Perfil actualizado.');
    });
  });

  // ───── verificación de correo ─────
  $('#btn-verificar', contenido)?.addEventListener('click', (e) =>
    accion(e.currentTarget, async () => { await authService.reenviarVerificacion(); ok('Te enviamos un correo de verificación.'); }));

  // ───── contraseña ─────
  const pw = $('#pw-form', contenido);
  enlazarFuerza($('#pw-nueva', pw), $('.pw-fuerza', pw));
  pw.addEventListener('submit', (e) => {
    e.preventDefault();
    mensajeForm(pw, '');
    const actual = $('#pw-actual', pw).value, nueva = $('#pw-nueva', pw).value, repite = $('#pw-repite', pw).value;
    if (!actual) return mensajeForm(pw, 'Escribe tu contraseña actual.');
    if (!passwordValida(nueva)) return mensajeForm(pw, 'La nueva contraseña debe tener 8 o más caracteres, con mayúscula, minúscula y número.');
    if (nueva !== repite) return mensajeForm(pw, 'Las contraseñas nuevas no coinciden.');
    accion(pw.querySelector('[type=submit]'), async () => {
      await authService.cambiarPassword(actual, nueva);
      ok('Contraseña actualizada. Inicia sesión de nuevo.');
      Session.cerrar();                         // el servidor ya cerró esta sesión
      setTimeout(() => ir('index.html?pwcambiada=1'), 1200);
    });
  });

  if (rol === 'paciente') consentimientos($('#consentimientos', contenido), p.personaId);
}

// ───── consentimientos (solo paciente) ─────
async function consentimientos(caja, personaId) {
  caja.innerHTML = `<div class="card-head"><h2>Privacidad y consentimientos</h2></div>${cargando()}`;
  let lista = [];
  try { lista = await pacientesService.consentimientos(personaId); }
  catch (e) { caja.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; return; }

  const vigente = (tipo) => lista.filter((c) => c.tipo === tipo).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const fila = (tipo, titulo, texto) => {
    const v = vigente(tipo);
    return `<div class="consent-fila"><div><b>${titulo}</b><p>${texto}</p>${v ? `<p class="dim">Última actualización: ${esc(fecha(v.createdAt))}</p>` : ''}</div>
      <label class="interruptor-sw"><input type="checkbox" data-tipo="${tipo}" ${v?.otorgado ? 'checked' : ''} aria-label="${titulo}"><span></span></label></div>`;
  };
  caja.innerHTML = `<div class="card-head"><h2>Privacidad y consentimientos</h2></div>
    ${fila('tratamiento_datos', 'Tratamiento de mis datos', 'Permite que tu médico vea tus estudios y que la IA los analice.')}
    ${fila('uso_entrenamiento', 'Ayudar a mejorar la IA', 'Permite usar tus imágenes confirmadas por un médico para reentrenar el modelo. Es opcional.')}`;

  caja.querySelectorAll('input[data-tipo]').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const nuevo = chk.checked;
      if (chk.dataset.tipo === 'tratamiento_datos' && !nuevo) {
        const si = await confirmar({ titulo: 'Retirar consentimiento', mensaje: 'Sin este consentimiento no podremos analizar tus nuevas imágenes. ¿Quieres retirarlo?', aceptar: 'Retirar', peligro: true });
        if (!si) { chk.checked = true; return; }
      }
      chk.disabled = true;
      try { await pacientesService.registrarConsentimiento(chk.dataset.tipo, nuevo); ok('Preferencia guardada.'); }
      catch (e) { chk.checked = !nuevo; fallo(e); }
      finally { chk.disabled = false; }
    });
  });
}

/** Perfiles que este usuario aún puede activar. Un paciente nunca puede ser médico ni administrador. */
function activables(rolActivo, roles = []) {
  const tiene = new Set(roles);
  const out = [];
  if (!tiene.has('paciente') && tiene.size && (tiene.has('medico') || tiene.has('admin'))) out.push('paciente');
  if (!tiene.has('medico') && tiene.has('admin')) out.push('medico');
  return out;
}

function pintarActivar(caja, lista) {
  caja.innerHTML = `
    <div class="card-head"><h2>Activar otro perfil</h2></div>
    <p class="hint">Tu cuenta puede tener más de un perfil y cambiar entre ellos desde la barra superior.</p>
    <form class="stack" id="activar-form" novalidate>
      <div class="field"><label for="act-rol">Perfil a activar</label>
        <select class="input" id="act-rol">${lista.map((r) => `<option value="${r}">${esc(ROLES[r])}</option>`).join('')}</select></div>
      <div id="act-paciente">
        <label class="check"><input type="checkbox" id="act-datos"> Acepto el tratamiento de mis datos de salud.</label>
        <label class="check"><input type="checkbox" id="act-entrena"> Permito usar mis imágenes anonimizadas para mejorar la IA (opcional).</label>
      </div>
      <div id="act-medico" class="oculto form-grid">
        ${campo({ id: 'act-matricula', etiqueta: 'Matrícula profesional', attrs: 'maxlength="50"' })}
        ${campo({ id: 'act-especialidad', etiqueta: 'Especialidad', attrs: 'maxlength="100"' })}
      </div>
      <button class="btn" type="submit">${icono('check')}Activar perfil</button>
    </form>`;
  const form = $('#activar-form', caja), sel = $('#act-rol', caja);
  const refrescar = () => {
    $('#act-paciente', caja).classList.toggle('oculto', sel.value !== 'paciente');
    $('#act-medico', caja).classList.toggle('oculto', sel.value !== 'medico');
  };
  sel.onchange = refrescar; refrescar();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    mensajeForm(form, '');
    const rolNuevo = sel.value;
    if (rolNuevo === 'paciente' && !$('#act-datos', caja).checked)
      return mensajeForm(form, 'Debes aceptar el tratamiento de datos para activar el perfil de paciente.');
    accion(form.querySelector('[type=submit]'), async () => {
      try {
        const r = await authService.activarRol({
          rol: rolNuevo,
          aceptaTratamientoDatos: $('#act-datos', caja).checked,
          aceptaUsoEntrenamiento: $('#act-entrena', caja).checked,
          matricula: $('#act-matricula', caja)?.value.trim() || null,
          especialidad: $('#act-especialidad', caja)?.value.trim() || null,
        });
        ok(`Perfil de ${ROLES[rolNuevo].toLowerCase()} activado.`);
        irHome(r.usuario.rol);
      } catch (err) { mensajeForm(form, err.message); }
    });
  });
}
