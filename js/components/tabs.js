/**
 * Pestañas accesibles.
 * Marcado esperado:
 *   <div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="a">…</button> …</div>
 *   <div class="panel-tab" data-panel="a">…</div> …
 * La primera se abre por defecto, o la indicada en el hash de la URL (#a).
 */
export function activarTabs(raiz, { alCambiar } = {}) {
  const botones = [...raiz.querySelectorAll('[data-tab]')];
  const paneles = [...raiz.querySelectorAll('[data-panel]')];
  const abiertos = new Set();

  function abrir(id, { historial = true } = {}) {
    if (!botones.some((b) => b.dataset.tab === id)) id = botones[0]?.dataset.tab;
    botones.forEach((b) => {
      const activo = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(activo));
      b.tabIndex = activo ? 0 : -1;
    });
    paneles.forEach((p) => { p.hidden = p.dataset.panel !== id; });
    if (historial) history.replaceState(null, '', `#${id}`);
    const primera = !abiertos.has(id);
    abiertos.add(id);
    alCambiar?.(id, primera);
  }

  botones.forEach((b, i) => {
    b.addEventListener('click', () => abrir(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = botones[(i + (e.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length];
      n.focus(); abrir(n.dataset.tab);
    });
  });
  abrir(location.hash.slice(1), { historial: false });
  return { abrir };
}
