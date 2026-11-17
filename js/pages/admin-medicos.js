/** Administración: todos los médicos y registro de nuevos médicos (solo el admin los crea). */
import { montarShell } from '../core/layout.js';
import { esc, fecha, iniciales, nombreCompleto, limpiarPayload, DOCUMENTOS } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, el, modal, accion, ok, confirmar, debounce, pager, vacio, cargando, enlazarFuerza, passwordValida } from '../core/ui.js';
import { medicosService, usuariosService } from '../services/admin.service.js';
import { campo, leerForm, mensajeForm } from '../components/forms.js';

const shell = montarShell({ roles: ['admin'], activa: 'medicos', titulo: 'Médicos' });
if (shell) iniciar(shell);

function iniciar({ contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Médicos</h1><p>Los médicos no se registran solos: los das de alta tú.</p></div>
      <div class="page-actions"><button class="btn btn-primario" id="nuevo">${icono('mas')}Registrar médico</button></div></div>
    <section class="card"><div class="card-head"><h2>Listado</h2>
      <div class="field" style="min-width:260px"><label class="sr-only" for="buscar">Buscar</label>
        <input class="input" id="buscar" type="search" placeholder="Buscar por nombre, correo o matrícula"></div></div>
      <div id="tabla">${cargando()}</div><div class="pager" id="pager"></div></section>`;
  let pagina = 1, buscar = '';

  async function cargar() {
    $('#tabla').innerHTML = cargando();
    try {
      const r = await medicosService.listar({ pagina, tamanoPagina: 12, buscar: buscar || undefined });
      if (!r.items.length) { $('#tabla').innerHTML = vacio('estetoscopio', 'Sin médicos', buscar ? 'Ningún médico coincide con la búsqueda.' : 'Registra al primer médico con el botón de arriba.'); $('#pager').innerHTML = ''; return; }
      $('#tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Médico</th><th>Matrícula</th><th>Especialidad</th><th>Pacientes</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead><tbody>
        ${r.items.map((m) => `<tr>
          <td><div class="persona"><span class="avatar">${esc(iniciales(m))}</span><div><b>${esc(nombreCompleto(m))}</b><small>${esc(m.correo || '')}</small></div></div></td>
          <td>${esc(m.matricula || '—')}</td><td>${esc(m.especialidad || '—')}</td><td class="num">${m.totalPacientes}</td>
          <td>${m.ultimoAcceso ? esc(fecha(m.ultimoAcceso, { hora: true })) : '<span class="dim">Nunca</span>'}</td>
          <td><span class="badge ${m.activo ? 'ok' : 'alerta'}">${m.activo ? 'Activo' : 'Desactivado'}</span></td>
          <td class="acciones"><button class="btn btn-sm ${m.activo ? 'btn-peligro' : ''}" data-estado="${esc(m.usuarioId)}">${m.activo ? 'Desactivar' : 'Activar'}</button>
            <button class="btn btn-sm btn-fantasma" data-desb="${esc(m.usuarioId)}" title="Quitar bloqueo por intentos fallidos">${icono('candado')}</button></td></tr>`).join('')}
        </tbody></table></div>`;
      r.total > r.tamanoPagina ? pager($('#pager'), r, (p) => { pagina = p; cargar(); }) : ($('#pager').innerHTML = '');
      const por = (id) => r.items.find((x) => x.usuarioId === id);
      $('#tabla').querySelectorAll('[data-estado]').forEach((b) => (b.onclick = async () => {
        const m = por(b.dataset.estado), nuevo = !m.activo;
        const si = await confirmar({ titulo: nuevo ? 'Activar médico' : 'Desactivar médico', mensaje: `${nombreCompleto(m)} ${nuevo ? 'podrá volver a entrar al sistema.' : 'ya no podrá iniciar sesión. Sus pacientes y datos se conservan.'}`, aceptar: nuevo ? 'Activar' : 'Desactivar', peligro: !nuevo });
        if (si) accion(b, async () => { await usuariosService.cambiarEstado(m.usuarioId, nuevo); ok(nuevo ? 'Médico activado.' : 'Médico desactivado.'); cargar(); });
      }));
      $('#tabla').querySelectorAll('[data-desb]').forEach((b) => (b.onclick = () => accion(b, async () => { await usuariosService.desbloquear(b.dataset.desb); ok('Cuenta desbloqueada.'); })));
    } catch (e) { $('#tabla').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }

  $('#nuevo').onclick = () => {
    const form = el(`<form class="stack" novalidate><div class="form-grid">
      ${campo({ id: 'nombres', etiqueta: 'Nombres', req: true, attrs: 'maxlength="100" minlength="2"' })}
      ${campo({ id: 'apellidos', etiqueta: 'Apellidos', req: true, attrs: 'maxlength="100" minlength="2"' })}
      ${campo({ id: 'correo', etiqueta: 'Correo electrónico', tipo: 'email', req: true, completo: true, attrs: 'maxlength="254"' })}
      <div class="field full"><label for="password" class="req">Contraseña inicial</label><input class="input" id="password" name="password" type="text" autocomplete="off" required>
        <div class="pw-fuerza" aria-hidden="true"><i></i></div><span class="hint">8 o más caracteres, con mayúscula, minúscula y número. El médico podrá cambiarla en su perfil.</span></div>
      ${campo({ id: 'matricula', etiqueta: 'Matrícula profesional', attrs: 'maxlength="50"' })}
      ${campo({ id: 'especialidad', etiqueta: 'Especialidad', attrs: 'maxlength="100" placeholder="Neuro-oncología"' })}
      ${campo({ id: 'tipoDocumento', etiqueta: 'Tipo de documento', opciones: DOCUMENTOS })}
      ${campo({ id: 'numeroDocumento', etiqueta: 'Número de documento', attrs: 'maxlength="30" autocomplete="off"' })}
      ${campo({ id: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', attrs: 'maxlength="30"' })}
      </div></form>`);
    const guardar = el(`<button class="btn btn-primario" type="button">${icono('check')}Registrar médico</button>`);
    const m = modal({ titulo: 'Registrar médico', cuerpo: form, pie: [guardar], tamano: 'medio' });
    enlazarFuerza(form.password, form.querySelector('.pw-fuerza'));
    const enviar = () => {
      mensajeForm(form, '');
      const d = leerForm(form);
      if (d.nombres.length < 2 || d.apellidos.length < 2) return mensajeForm(form, 'Nombres y apellidos deben tener al menos 2 caracteres.');
      if (!/^\S+@\S+\.\S+$/.test(d.correo)) return mensajeForm(form, 'Escribe un correo electrónico válido.');
      if (!passwordValida(d.password)) return mensajeForm(form, 'La contraseña debe tener 8 o más caracteres, con mayúscula, minúscula y número.');
      if (d.numeroDocumento && !d.tipoDocumento) return mensajeForm(form, 'Indica el tipo de documento junto con el número.');
      accion(guardar, async () => {
        try { await usuariosService.crear(limpiarPayload({ ...d, rol: 'medico' }, { cerrados: ['tipoDocumento'] })); ok('Médico registrado.'); m.cerrar(); cargar(); }
        catch (err) { mensajeForm(form, err.message); }
      });
    };
    guardar.onclick = enviar;
    form.onsubmit = (e) => { e.preventDefault(); enviar(); };
  };

  $('#buscar').addEventListener('input', debounce((e) => { buscar = e.target.value.trim(); pagina = 1; cargar(); }, 350));
  cargar();
}
