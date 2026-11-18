/**
 * Dreamur-Detector · configuración del frontend.
 *
 * Cambia UNA sola línea para pasar de desarrollo local a producción en Render:
 *
 *     const USAR_RENDER = false;   // local   → API en tu PC y IA en tu PC
 *     const USAR_RENDER = true;    // Render  → API y IA desplegadas
 *
 * No hay que tocar ningún otro archivo. Todas las páginas leen este módulo.
 */
const USAR_RENDER = true;

const ENTORNOS = {
  local: {
    API_URL: 'http://localhost:5000',   // dotnet run --project src/DreamurDetector.Api
    IA_URL:  'http://localhost:8001',   // servicio de Dreamur-Detector (modelo)
  },
  render: {
    API_URL: 'https://dreamur-system.onrender.com',   
    IA_URL:  'https://dreamur-detector.duckdns.org',
    IA_MODEL: 'https://dreamur-generate.duckdns.org',
  },
};

const entorno = USAR_RENDER ? 'render' : 'local';

export const CONFIG = Object.freeze({
  APP_NOMBRE: 'Dreamur-Detector',
  ENTORNO: entorno,
  USAR_RENDER,

  /** Backend ASP.NET (todas las llamadas de datos, autenticación y análisis pasan por aquí). */
  API_URL: ENTORNOS[entorno].API_URL.replace(/\/+$/, ''),

  /**
   * Servicio de IA Dreamur-Detector. El análisis de imágenes lo hace el backend
   * (así queda guardado y auditado); el frontend usa esta URL para mostrar si la IA está en línea.
   * Debe ser la misma IA que el backend tiene en Detector__BaseUrl.
   */
  IA_URL: ENTORNOS[entorno].IA_URL.replace(/\/+$/, ''),
  IA_RUTA_ESTADO: '/health',

  /** Tiempos máximos de espera (Render gratis tarda hasta ~60 s en despertar). */
  TIMEOUT_MS: 60_000,
  TIMEOUT_ANALISIS_MS: 180_000,

  /** Debe coincidir con Jwt:ExpiraMinutos del backend (240 = 4 horas). Solo se usa si el servidor no informa la expiración. */
  SESION_MINUTOS: 240,

  /** Imágenes: mismas reglas que el backend. */
  MAX_ARCHIVO_MB: 20,
  TIPOS_IMAGEN: ['image/jpeg', 'image/png', 'image/webp'],

  DEBUG: !USAR_RENDER,
});
