/** Administración: todos los pacientes del sistema. Ver sus datos y activar/desactivar su cuenta. */
import { montarShell } from '../core/layout.js';
import { esc, fecha, iniciales, nombreCompleto, SEXOS, DOCUMENTOS, edad } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, el, modal, accion, ok, confirmar, debounce, pager, vacio, cargando } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { usuariosService } from '../services/admin.service.js';

const shell = montarShell({ roles: ['admin'], activa: 'pacientes', titulo: 'Pacientes' });
if (shell) iniciar(shell);

function iniciar({ contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Pacientes</h1><p>Todos los pacientes registrados en el sistema.</p></div></div>
    <section class="card"><div class="card-head"><h2>Listado</h2>
      <div class="field" style="min-width:260px"><label class="sr-only" for="buscar">Buscar</label>
        <input class="input" id="buscar" type="search" placeholder="Buscar por nombre, código o documento"></div></div>
      <div id="tabla">${cargando()}</div><div class="pager" id="pager"></div></section>`;
  let pagina = 1, buscar = '';

  async function cargar() {
    $('#tabla').innerHTML = cargando();
    try {
      const r = await pacientesService.listar({ pagina, tamanoPagina: 12, buscar: buscar || undefined });
      if (!r.items.length) { $('#tabla').innerHTML = vacio('usuarios', 'Sin pacientes', buscar ? 'Ningún paciente coincide con la búsqueda.' : 'Todavía no hay pacientes registrados.'); $('#pager').innerHTML = ''; return; }
      $('#tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Paciente</th><th>Documento</th><th>Contacto</th><th>Registro</th><th>Estado</th><th></th></tr></thead><tbody>
        ${r.items.map((p) => `<tr>
          <td><div class="persona"><span class="avatar">${esc(iniciales(p))}</span><div><b>${esc(nombreCompleto(p))}</b><small><span class="codigo">${esc(p.codigo)}</span></small></div></div></td>
          <td>${esc(p.numeroDocumento || '—')}</td>
          <td>${esc(p.correo || '—')}<div class="dim" style="font-size:var(--t-xs)">${esc(p.telefono || '')}</div></td>
          <td>${esc(fecha(p.createdAt))}</td>
          <td>${p.activo == null ? '<span class="badge">Sin cuenta</span>' : `<span class="badge ${p.activo ? 'ok' : 'alerta'}">${p.activo ? 'Activo' : 'Desactivado'}</span>`}</td>
          <td class="acciones"><button class="btn btn-sm" data-ver="${esc(p.personaId)}">${icono('ojo')}Datos</button>
            ${p.usuarioId ? `<button class="btn btn-sm ${p.activo ? 'btn-peligro' : ''}" data-estado="${esc(p.personaId)}">${p.activo ? 'Desactivar' : 'Activar'}</button>
            <button class="btn btn-sm btn-fantasma" data-desb="${esc(p.personaId)}" title="Quitar bloqueo por intentos fallidos">${icono('candado')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
      r.total > r.tamanoPagina ? pager($('#pager'), r, (p) => { pagina = p; cargar(); }) : ($('#pager').innerHTML = '');
      const buscarP = (id) => r.items.find((x) => x.personaId === id);
      $('#tabla').querySelectorAll('[data-ver]').forEach((b) => (b.onclick = () => verDatos(buscarP(b.dataset.ver))));
      $('#tabla').querySelectorAll('[data-estado]').forEach((b) => (b.onclick = async () => {
        const p = buscarP(b.dataset.estado), nuevo = !p.activo;
        const si = await confirmar({ titulo: nuevo ? 'Activar cuenta' : 'Desactivar cuenta', mensaje: `${nombreCompleto(p)} ${nuevo ? 'podrá volver a entrar al sistema.' : 'ya no podrá iniciar sesión.'}`, aceptar: nuevo ? 'Activar' : 'Desactivar', peligro: !nuevo });
        if (si) accion(b, async () => { await usuariosService.cambiarEstado(p.usuarioId, nuevo); ok(nuevo ? 'Cuenta activada.' : 'Cuenta desactivada.'); cargar(); });
      }));
      $('#tabla').querySelectorAll('[data-desb]').forEach((b) => (b.onclick = () => accion(b, async () => { await usuariosService.desbloquear(buscarP(b.dataset.desb).usuarioId); ok('Cuenta desbloqueada.'); })));
    } catch (e) { $('#tabla').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }

  async function verDatos(resumen) {
    const m = modal({ titulo: nombreCompleto(resumen), cuerpo: cargando(), tamano: 'medio' });
    try {
      const d = await pacientesService.obtener(resumen.personaId);
      const f = (t, v) => `<dt>${t}</dt><dd>${v ? esc(v) : '<span class="dim">—</span>'}</dd>`;
      m.body.innerHTML = `<dl class="meta-lista">
        ${f('Código', d.codigo)}${f('Correo', d.correo)}${f('Documento', d.numeroDocumento ? `${DOCUMENTOS[d.tipoDocumento] || d.tipoDocumento || ''} ${d.numeroDocumento}` : '')}
        ${f('Nacimiento', d.fechaNacimiento ? `${fecha(d.fechaNacimiento)} (${edad(d.fechaNacimiento)} años)` : '')}${f('Sexo', SEXOS[d.sexo])}${f('Teléfono', d.telefono)}
        ${f('Dirección', [d.direccion, d.ciudad, d.pais].filter(Boolean).join(', '))}${f('Grupo sanguíneo', d.grupoSanguineo)}
        ${f('Alergias', d.alergias)}${f('Antecedentes', d.antecedentes)}${f('Contacto de emergencia', [d.contactoEmergencia, d.telefonoEmergencia].filter(Boolean).join(' · '))}
        ${f('Consentimiento de datos', d.consentimientoTratamientoDatos ? 'Otorgado' : 'No otorgado')}${f('Uso para entrenamiento', d.consentimientoUsoEntrenamiento ? 'Otorgado' : 'No otorgado')}
        ${f('Registro', fecha(d.createdAt, { hora: true }))}</dl>`;
    } catch (e) { m.body.innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }

  $('#buscar').addEventListener('input', debounce((e) => { buscar = e.target.value.trim(); pagina = 1; cargar(); }, 350));
  cargar();
}
