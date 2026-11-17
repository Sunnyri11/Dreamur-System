/** Administración: registro de auditoría con filtros por acción y fechas. */
import { montarShell } from '../core/layout.js';
import { esc, fecha, accionAuditoria, AUDITORIA } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, pager, vacio, cargando } from '../core/ui.js';
import { auditoriaService } from '../services/admin.service.js';
import { opciones } from '../components/forms.js';

const shell = montarShell({ roles: ['admin'], activa: 'auditoria', titulo: 'Auditoría' });
if (shell) iniciar(shell);

function iniciar({ contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Auditoría</h1><p>Quién hizo qué y cuándo. Los registros no se pueden editar ni borrar.</p></div></div>
    <section class="card"><form class="filtros" id="filtros">
      <div class="field"><label for="accion">Acción</label><select class="select" id="accion">${opciones(AUDITORIA, '', 'Todas')}</select></div>
      <div class="field"><label for="desde">Desde</label><input class="input" type="date" id="desde"></div>
      <div class="field"><label for="hasta">Hasta</label><input class="input" type="date" id="hasta"></div>
      <div class="field"><label>&nbsp;</label><button class="btn" type="button" id="limpiar">Limpiar</button></div></form>
      <div id="tabla">${cargando()}</div><div class="pager" id="pager"></div></section>`;
  let pagina = 1;

  async function cargar() {
    $('#tabla').innerHTML = cargando();
    const f = { pagina, tamanoPagina: 15 };
    if ($('#accion').value) f.accion = $('#accion').value;
    if ($('#desde').value) f.desde = new Date(`${$('#desde').value}T00:00:00`).toISOString();
    if ($('#hasta').value) f.hasta = new Date(`${$('#hasta').value}T23:59:59`).toISOString();
    try {
      const r = await auditoriaService.listar(f);
      if (!r.items.length) { $('#tabla').innerHTML = vacio('reloj', 'Sin registros', 'No hay movimientos con esos filtros.'); $('#pager').innerHTML = ''; return; }
      $('#tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>IP</th><th>Detalle</th></tr></thead><tbody>
        ${r.items.map((a) => `<tr><td class="num">${esc(fecha(a.createdAt, { hora: true }))}</td><td>${esc(a.usuarioNombre || 'Sistema')}</td>
          <td><span class="badge ${/fallido|bloqueada|eliminad|desactivad/.test(a.accion) ? 'alerta' : ''}">${esc(accionAuditoria(a.accion))}</span></td>
          <td>${esc(a.entidad || '—')}</td><td class="num">${esc(a.ip || '—')}</td>
          <td>${a.detalle ? `<details class="json"><summary>Ver</summary><pre>${esc(JSON.stringify(a.detalle, null, 2))}</pre></details>` : '<span class="dim">—</span>'}</td></tr>`).join('')}
        </tbody></table></div>`;
      r.total > r.tamanoPagina ? pager($('#pager'), r, (p) => { pagina = p; cargar(); }) : ($('#pager').innerHTML = '');
    } catch (e) { $('#tabla').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }
  ['accion', 'desde', 'hasta'].forEach((id) => ($(`#${id}`).onchange = () => { pagina = 1; cargar(); }));
  $('#limpiar').onclick = () => { $('#filtros').reset(); pagina = 1; cargar(); };
  cargar();
}
