/** Panel del administrador: totales, modelo activo y últimos movimientos de auditoría. */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { esc, fecha, accionAuditoria } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, vacio } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { medicosService, auditoriaService, modelosService, usuariosService } from '../services/admin.service.js';

const shell = montarShell({ roles: ['admin'], activa: 'inicio', titulo: 'Panel de administración' });
if (shell) iniciar(shell);

async function iniciar({ contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Panel de administración</h1><p>Vista general del sistema Dreamur-Detector.</p></div>
      <div class="page-actions"><a class="btn btn-primario" href="${RAIZ}admin/medicos.html">${icono('mas')}Registrar médico</a></div></div>
    <div id="kpis" class="grid g-4"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    <div class="grid g-2" style="align-items:start">
      <section class="card"><div class="card-head"><h2>Últimos movimientos</h2><a class="btn btn-sm" href="${RAIZ}admin/auditoria.html">Ver auditoría</a></div><div id="aud"></div></section>
      <section class="card"><div class="card-head"><h2>Accesos rápidos</h2></div>
        <div class="stack"><a class="btn" href="${RAIZ}admin/pacientes.html">${icono('usuarios')}Todos los pacientes</a>
          <a class="btn" href="${RAIZ}admin/medicos.html">${icono('estetoscopio')}Todos los médicos</a>
          <a class="btn" href="${RAIZ}admin/modelo.html">${icono('chip')}Modelo de IA</a>
          <a class="btn" href="${RAIZ}admin/perfil.html">${icono('usuario')}Mi perfil</a></div></section>
    </div>`;

  const pedir = (p) => p.catch(() => null);
  const [pac, med, bloq, modelo, aud] = await Promise.all([
    pedir(pacientesService.listar({ pagina: 1, tamanoPagina: 1 })),
    pedir(medicosService.listar({ pagina: 1, tamanoPagina: 1 })),
    pedir(usuariosService.listar({ pagina: 1, tamanoPagina: 1, activo: false })),
    pedir(modelosService.activo()),
    pedir(auditoriaService.listar({ pagina: 1, tamanoPagina: 8 })),
  ]);
  const n = (r) => (r ? r.total : '—');
  $('#kpis').innerHTML = `
    <div class="kpi vital"><span class="etq">Pacientes</span><span class="valor num">${n(pac)}</span><span class="sub">registrados</span></div>
    <div class="kpi"><span class="etq">Médicos</span><span class="valor num">${n(med)}</span><span class="sub">con cuenta</span></div>
    <div class="kpi ${bloq?.total ? 'lesion' : ''}"><span class="etq">Cuentas desactivadas</span><span class="valor num">${n(bloq)}</span><span class="sub">sin acceso al sistema</span></div>
    <div class="kpi"><span class="etq">Modelo de IA activo</span><span class="valor" style="font-size:1.35rem;padding-top:.35rem">${modelo ? `v${esc(modelo.version)}` : 'Ninguno'}</span>
      <span class="sub">${modelo ? esc(modelo.arquitectura) : 'Sin versión activa'}</span></div>`;
  $('#aud').innerHTML = !aud?.items?.length ? vacio('reloj', 'Sin movimientos', 'Aquí verás la actividad reciente.') :
    `<ul class="lista-simple">${aud.items.map((a) => `<li><span><b>${esc(accionAuditoria(a.accion))}</b><br><small class="dim">${esc(a.usuarioNombre || 'Sistema')}</small></span>
      <span class="dim num">${esc(fecha(a.createdAt, { hora: true }))}</span></li>`).join('')}</ul>`;
}
