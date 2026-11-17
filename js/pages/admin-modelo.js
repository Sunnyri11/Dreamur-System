/** Administración: versiones del modelo de IA, cuál está activo y entrenamientos. */
import { montarShell } from '../core/layout.js';
import { esc, fecha } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, accion, ok, confirmar, vacio, cargando } from '../core/ui.js';
import { modelosService } from '../services/admin.service.js';
import { pingIA } from '../core/api.js';
import { CONFIG } from '../../config.js';

const shell = montarShell({ roles: ['admin'], activa: 'modelo', titulo: 'Modelo de IA' });
if (shell) iniciar(shell);

const ESTADO_ENT = { en_curso: ['info', 'En curso'], iniciado: ['info', 'Iniciado'], completado: ['ok', 'Completado'], error: ['alerta', 'Con error'] };

function metricas(m) {
  if (!m || typeof m !== 'object') return '<span class="dim">—</span>';
  const e = Object.entries(m).filter(([, v]) => typeof v === 'number' || typeof v === 'string').slice(0, 4);
  return e.length ? e.map(([k, v]) => `<span class="badge">${esc(k)}: ${esc(typeof v === 'number' && v <= 1 ? (v * 100).toFixed(1) + '%' : v)}</span>`).join(' ') : '<span class="dim">—</span>';
}

function iniciar({ contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Modelo de IA</h1><p>Versiones de Dreamur-Detector y su historial de entrenamiento.</p></div>
      <div class="page-actions"><button class="btn btn-primario" id="entrenar">${icono('chip')}Iniciar entrenamiento</button></div></div>
    <section class="card"><div class="card-head"><h2>Servicio de IA</h2></div><p id="ia" class="dim">Comprobando…</p>
      <p class="dim" style="font-size:var(--t-xs)">Dirección configurada: <code>${esc(CONFIG.IA_URL)}</code></p></section>
    <section class="card"><div class="card-head"><h2>Versiones</h2></div><div id="versiones">${cargando()}</div></section>
    <section class="card"><div class="card-head"><h2>Entrenamientos</h2></div><div id="entrenamientos">${cargando()}</div></section>`;

  pingIA().then((r) => { $('#ia').innerHTML = r ? `<span class="badge ok">${icono('check')}En línea</span>` : `<span class="badge alerta">${icono('alerta')}Sin respuesta</span> <span class="dim">En Render gratuito puede tardar en despertar.</span>`; })
    .catch(() => { $('#ia').innerHTML = `<span class="badge alerta">${icono('alerta')}Sin respuesta</span>`; });

  async function versiones() {
    try {
      const v = await modelosService.versiones();
      $('#versiones').innerHTML = !v.length ? vacio('chip', 'Sin versiones', 'Aún no hay modelos registrados.') :
        `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Versión</th><th>Arquitectura</th><th>Clases</th><th>Muestras</th><th>Métricas</th><th>Creada</th><th></th></tr></thead><tbody>
        ${v.map((m) => `<tr><td><b>v${esc(m.version)}</b> ${m.activo ? '<span class="badge ok">Activa</span>' : ''}</td><td>${esc(m.arquitectura)}</td>
          <td>${esc((m.tipos || []).join(', ') || '—')}</td><td class="num">${m.nMuestras ?? '—'}</td><td>${metricas(m.metricas)}</td>
          <td>${esc(fecha(m.createdAt))}</td><td class="acciones">${m.activo ? '' : `<button class="btn btn-sm" data-act="${m.id}">Activar</button>`}</td></tr>`).join('')}</tbody></table></div>`;
      $('#versiones').querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
        if (await confirmar({ titulo: 'Activar versión', mensaje: 'Los próximos análisis usarán esta versión del modelo.', aceptar: 'Activar' }))
          accion(b, async () => { await modelosService.activar(Number(b.dataset.act)); ok('Versión activada.'); versiones(); });
      }));
    } catch (e) { $('#versiones').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }
  async function entrenamientos() {
    try {
      const r = await modelosService.entrenamientos({ pagina: 1, tamanoPagina: 10 });
      const items = r.items ?? r;
      $('#entrenamientos').innerHTML = !items.length ? vacio('reloj', 'Sin entrenamientos', 'Inicia uno cuando haya suficientes diagnósticos confirmados.') :
        `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Inicio</th><th>Estado</th><th>Muestras</th><th>Modelo</th><th>Lanzado por</th><th>Fin</th></tr></thead><tbody>
        ${items.map((t) => { const [tono, txt] = ESTADO_ENT[t.estado] || ['', t.estado]; return `<tr><td class="nowrap">${esc(fecha(t.iniciadoEn, { hora: true }))}</td>
          <td><span class="badge ${tono}">${esc(txt)}</span>${t.error ? `<div class="dim" style="font-size:var(--t-xs)">${esc(t.error)}</div>` : ''}</td>
          <td class="num">${t.nMuestras ?? '—'}</td><td>${t.modeloVersionId ? `#${t.modeloVersionId}` : '—'}</td><td>${esc(t.disparadoPor || '—')}</td>
          <td>${t.finalizadoEn ? esc(fecha(t.finalizadoEn, { hora: true })) : '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
    } catch (e) { $('#entrenamientos').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }
  $('#entrenar').onclick = async (ev) => {
    const b = ev.currentTarget;
    if (!(await confirmar({ titulo: 'Iniciar entrenamiento', mensaje: 'Se entrenará una nueva versión con los diagnósticos confirmados por médicos. Puede tardar varios minutos.', aceptar: 'Iniciar' }))) return;
    accion(b, async () => { await modelosService.entrenar(); ok('Entrenamiento iniciado.'); entrenamientos(); });
  };
  versiones(); entrenamientos();
}
