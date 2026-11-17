import { api } from '../core/api.js';

let cache = null;
export const catalogoService = {
  /** Tipos de tumor (incluye «sin_tumor»). Se pide una sola vez por página. */
  async tiposTumor() { return (cache ??= await api.get('/api/catalogo/tipos-tumor').catch((e) => { cache = null; throw e; })); },
};
