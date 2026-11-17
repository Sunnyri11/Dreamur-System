/**
 * Panel del médico: sus pacientes (alta nueva o vinculación), y una bandeja con las imágenes recientes
 * —incluidas las que suben los propios pacientes— indicando si Dreamur-Detector las reconoció como válidas.
 */
import { montarShell } from '../core/layout.js';
import { RAIZ } from '../core/auth.js';
import { esc, fecha, iniciales, nombreCompleto, MODALIDADES, limpiarPayload } from '../core/format.js';
import { icono } from '../core/icons.js';
import { $, el, modal, accion, ok, confirmar, debounce, pager, vacio, cargando, enlazarFuerza, passwordValida } from '../core/ui.js';
import { pacientesService } from '../services/pacientes.service.js';
import { radiografiasService } from '../services/radiografias.service.js';
import { insignias, textoReconocido } from '../components/galeria.js';
import { abrirEstudio } from '../components/estudio.js';
import { campo, camposIdentidad, leerForm, mensajeForm } from '../components/forms.js';

const shell = montarShell({ roles: ['medico'], activa: 'inicio', titulo: 'Mis pacientes' });
if (shell) iniciar(shell);

function iniciar({ usuario, contenido }) {
  contenido.innerHTML = `
    <div class="page-head"><div><h1>Mis pacientes</h1><p>Solo ves a los pacientes que diste de alta o vinculaste.</p></div>
      <div class="page-actions">
        <button class="btn" id="btn-vincular">${icono('enlace')}Vincular paciente existente</button>
        <button class="btn btn-primario" id="btn-nuevo">${icono('mas')}Nuevo paciente</button></div></div>
    <div id="kpis" class="grid g-4"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    <section class="card">
      <div class="card-head"><div><h2>Imágenes recientes de mis pacientes</h2><p>Cada imagen indica si la IA la reconoció como un estudio cerebral válido.</p></div>
        <label class="interruptor"><input type="checkbox" id="solo-pacientes"> Solo las subidas por pacientes</label></div>
      <div id="bandeja">${cargando()}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Lista de pacientes</h2>
        <div class="field" style="min-width:260px"><label class="sr-only" for="buscar">Buscar</label>
          <input class="input" id="buscar" type="search" placeholder="Buscar por nombre, código o documento"></div></div>
      <div id="tabla">${cargando()}</div><div class="pager" id="pager"></div>
    </section>`;

  let pagina = 1, buscar = '';

  // ───── bandeja de imágenes recientes + indicadores ─────
  async function cargarBandeja() {
    try {
      const [r, p] = await Promise.all([
        radiografiasService.listar({ pagina: 1, tamanoPagina: 40 }),
        pacientesService.listar({ pagina: 1, tamanoPagina: 1 }),
      ]);
      const items = r.items;
      const invalidas = items.filter((x) => x.ultimaDeteccion?.imagenValida === false);
      const porRevisar = items.filter((x) => x.ultimaDeteccion && x.ultimaDeteccion.imagenValida !== false && !x.etiqueta);
      const delPaciente = items.filter((x) => x.origen === 'paciente');
      $('#kpis').innerHTML = `
        <div class="kpi"><span class="etq">Pacientes</span><span class="valor num">${p.total}</span><span class="sub">vinculados a ti</span></div>
        <div class="kpi"><span class="etq">Subidas por pacientes</span><span class="valor num">${delPaciente.length}</span><span class="sub">entre las últimas ${items.length} imágenes</span></div>
        <div class="kpi vital"><span class="etq">Válidas por revisar</span><span class="valor num">${porRevisar.length}</span><span class="sub">analizadas, sin tu confirmación</span></div>
        <div class="kpi ${invalidas.length ? 'lesion' : ''}"><span class="etq">No válidas según la IA</span><span class="valor num">${invalidas.length}</span><span class="sub">no son resonancia/TC cerebral</span></div>`;
      bandeja = items;
      pintarBandeja();
    } catch (e) { $('#bandeja').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }
  let bandeja = [];
  function pintarBandeja() {
    const solo = $('#solo-pacientes').checked;
    const lista = bandeja.filter((x) => !solo || x.origen === 'paciente').slice(0, 10);
    if (!lista.length) { $('#bandeja').innerHTML = vacio('imagen', 'Sin imágenes todavía', solo ? 'Ningún paciente ha subido imágenes recientemente.' : 'Cuando tú o tus pacientes suban imágenes aparecerán aquí.'); return; }
    $('#bandeja').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Paciente</th><th>Estudio</th><th>Subida</th><th>Validez e IA</th><th></th></tr></thead><tbody>
      ${lista.map((x) => `<tr>
        <td><div class="persona"><span class="avatar">${esc(iniciales({ nombres: (x.pacienteNombre || '?').split(' ')[0], apellidos: (x.pacienteNombre || '').split(' ').slice(1).join(' ') }))}</span>
          <div><b>${esc(x.pacienteNombre || '—')}</b><small>${esc(x.pacienteCodigo || '')}</small></div></div></td>
        <td>${esc(MODALIDADES[x.modalidad] || x.modalidad)}<div class="dim" style="font-size:var(--t-xs)">${esc(fecha(x.fechaEstudio || x.createdAt))}</div></td>
        <td class="nowrap">${esc(fecha(x.createdAt, { hora: true }))}</td>
        <td><div class="row" style="gap:.35rem">${insignias(x, { mostrarOrigen: true })}</div><div class="dim" style="font-size:var(--t-xs);margin-top:3px">IA: ${esc(textoReconocido(x))}</div></td>
        <td class="acciones"><button class="btn btn-sm" data-ver="${esc(x.id)}">${icono('ojo')}Revisar</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#bandeja').querySelectorAll('[data-ver]').forEach((b) => {
      b.onclick = () => abrirEstudio(bandeja.find((x) => x.id === b.dataset.ver), { usuario, alCambiar: cargarBandeja });
    });
  }
  $('#solo-pacientes').onchange = pintarBandeja;

  // ───── lista de pacientes ─────
  async function cargarPacientes() {
    $('#tabla').innerHTML = cargando();
    try {
      const r = await pacientesService.listar({ pagina, tamanoPagina: 10, buscar: buscar || undefined });
      if (!r.items.length) {
        $('#tabla').innerHTML = vacio('usuarios', buscar ? 'Sin resultados' : 'Aún no tienes pacientes', buscar ? 'Prueba con otro nombre, código o documento.' : 'Da de alta un paciente nuevo o vincula uno que ya se registró con su código PAC-xxxxxx.');
        $('#pager').innerHTML = ''; return;
      }
      $('#tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Paciente</th><th>Documento</th><th>Contacto</th><th>Alta</th><th></th></tr></thead><tbody>
        ${r.items.map((p) => `<tr class="click" data-id="${esc(p.personaId)}">
          <td><div class="persona"><span class="avatar">${esc(iniciales(p))}</span><div><b>${esc(nombreCompleto(p))}</b><small><span class="codigo">${esc(p.codigo)}</span></small></div></div></td>
          <td>${esc(p.numeroDocumento || '—')}</td>
          <td>${esc(p.correo || '—')}<div class="dim" style="font-size:var(--t-xs)">${esc(p.telefono || '')}</div></td>
          <td>${esc(fecha(p.createdAt))}</td>
          <td class="acciones"><a class="btn btn-sm btn-primario" href="${RAIZ}medico/paciente.html?id=${esc(p.personaId)}">Abrir</a>
            <button class="btn btn-sm btn-fantasma" data-quitar="${esc(p.personaId)}" title="Quitar de mi lista" aria-label="Quitar a ${esc(nombreCompleto(p))} de mi lista">${icono('cerrar')}</button></td></tr>`).join('')}
        </tbody></table></div>`;
      r.total > r.tamanoPagina ? pager($('#pager'), r, (p) => { pagina = p; cargarPacientes(); }) : ($('#pager').innerHTML = '');
      $('#tabla').querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', (e) => {
        if (e.target.closest('a,button')) return;
        location.href = `${RAIZ}medico/paciente.html?id=${tr.dataset.id}`;
      }));
      $('#tabla').querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', async () => {
        const p = r.items.find((x) => x.personaId === b.dataset.quitar);
        const si = await confirmar({ titulo: 'Quitar de mi lista', mensaje: `${nombreCompleto(p)} dejará de aparecer en tu lista. No se borra al paciente ni sus datos.`, aceptar: 'Quitar', peligro: true });
        if (!si) return;
        await accion(b, async () => { await pacientesService.desvincular(p.personaId); ok('Paciente quitado de tu lista.'); cargarPacientes(); cargarBandeja(); });
      }));
    } catch (e) { $('#tabla').innerHTML = `<div class="alerta-caja lesion">${icono('alerta')}<p>${esc(e.message)}</p></div>`; }
  }
  $('#buscar').addEventListener('input', debounce((e) => { buscar = e.target.value.trim(); pagina = 1; cargarPacientes(); }, 350));

  // ───── nuevo paciente ─────
  $('#btn-nuevo').onclick = () => {
    const form = el(`<form class="stack" novalidate><div class="form-grid">
      ${campo({ id: 'nombres', etiqueta: 'Nombres', req: true, attrs: 'maxlength="100" minlength="2"' })}
      ${campo({ id: 'apellidos', etiqueta: 'Apellidos', req: true, attrs: 'maxlength="100" minlength="2"' })}
      ${campo({ id: 'correo', etiqueta: 'Correo electrónico', tipo: 'email', req: true, completo: true, attrs: 'maxlength="254"' })}
      <div class="field full"><label for="password" class="req">Contraseña inicial</label><input class="input" id="password" name="password" type="text" autocomplete="off" required>
        <div class="pw-fuerza" aria-hidden="true"><i></i></div><span class="hint">Entrégasela al paciente; podrá cambiarla en su perfil. 8 o más caracteres, con mayúscula, minúscula y número.</span></div>
      ${camposIdentidad()}
      </div>
      <label class="check"><input type="checkbox" name="confirmaConsentimientoDatos" required><span>Confirmo que el paciente aceptó el tratamiento de sus datos personales y de salud. <b>(obligatorio)</b></span></label>
    </form>`);
    const guardar = el(`<button class="btn btn-primario" type="button">${icono('check')}Crear paciente</button>`);
    const m = modal({ titulo: 'Nuevo paciente', cuerpo: form, pie: [guardar], tamano: 'medio' });
    enlazarFuerza(form.password, form.querySelector('.pw-fuerza'));
    const enviar = () => {
      mensajeForm(form, '');
      const d = leerForm(form);
      if (d.nombres.length < 2 || d.apellidos.length < 2) return mensajeForm(form, 'Nombres y apellidos deben tener al menos 2 caracteres.');
      if (!/^\S+@\S+\.\S+$/.test(d.correo)) return mensajeForm(form, 'Escribe un correo electrónico válido.');
      if (!passwordValida(d.password)) return mensajeForm(form, 'La contraseña debe tener 8 o más caracteres, con mayúscula, minúscula y número.');
      if (d.numeroDocumento && !d.tipoDocumento) return mensajeForm(form, 'Indica el tipo de documento junto con el número.');
      if (!d.confirmaConsentimientoDatos) return mensajeForm(form, 'Debes confirmar el consentimiento del paciente.');
      accion(guardar, async () => {
        try {
          const p = await pacientesService.crear(limpiarPayload(d, { cerrados: ['tipoDocumento', 'numeroDocumento', 'fechaNacimiento', 'sexo', 'telefono'] }));
          ok('Paciente creado.'); m.cerrar();
          location.href = `${RAIZ}medico/paciente.html?id=${p.personaId}`;
        } catch (err) { mensajeForm(form, err.message); }
      });
    };
    guardar.onclick = enviar;
    form.onsubmit = (e) => { e.preventDefault(); enviar(); };
  };

  // ───── vincular paciente existente ─────
  $('#btn-vincular').onclick = () => {
    const form = el(`<form class="stack" novalidate>
      <p class="muted">Si el paciente ya se registró por su cuenta, escribe su código (PAC-000123) o su número de documento para añadirlo a tu lista.</p>
      ${campo({ id: 'codigo', etiqueta: 'Código o documento', req: true, attrs: 'maxlength="30" placeholder="PAC-000123"' })}</form>`);
    const b = el(`<button class="btn btn-primario" type="button">${icono('enlace')}Vincular</button>`);
    const m = modal({ titulo: 'Vincular paciente', cuerpo: form, pie: [b] });
    const enviar = () => {
      mensajeForm(form, '');
      const codigo = form.codigo.value.trim();
      if (!codigo) return mensajeForm(form, 'Escribe el código o el documento del paciente.');
      accion(b, async () => {
        try { const p = await pacientesService.vincular(codigo); ok('Paciente vinculado.'); m.cerrar(); location.href = `${RAIZ}medico/paciente.html?id=${p.personaId}`; }
        catch (err) { mensajeForm(form, err.message); }
      });
    };
    b.onclick = enviar;
    form.onsubmit = (e) => { e.preventDefault(); enviar(); };
  };

  cargarBandeja();
  cargarPacientes();
}
