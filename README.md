# Dreamur-Detector · Frontend

Frontend desacoplado en **HTML + CSS + JavaScript puro** (módulos ES nativos, sin bundler ni dependencias).
Habla con el backend ASP.NET por REST + JWT. Estilo "medicina futurista" con la mascota **Dr. Raco**.

## Cambiar entre local y Render (un solo booleano)

Abre `config.js`:

```js
const USAR_RENDER = false;   // false → API e IA en tu PC   |   true → API e IA en Render
```

Y escribe tus URLs en el bloque `ENTORNOS` (`local` y `render`, para `API_URL` e `IA_URL`).
Ninguna otra página se toca.

## Ejecutarlo en local

Debe servirse por HTTP (los módulos ES no funcionan con `file://`):

```bash
cd DreamurDetector.Frontend
python3 -m http.server 5173        # o: npx serve -l 5173 · extensión Live Server (5500)
```

Abre `http://localhost:5173/`. En el backend, el origen del frontend debe estar permitido:
`Cors__Origins__0=http://localhost:5173` y `App__FrontendUrl=http://localhost:5173`
(los correos de verificación/recuperación apuntan a `verificar.html` y `restablecer.html`).

## Desplegar en Render (Static Site)

1. Sube esta carpeta a un repositorio. Crea un **Static Site** con *Publish directory* = raíz, sin build.
2. Pon `USAR_RENDER = true` y tus URLs reales en `config.js`.
3. En el backend (Render): `Cors__Origins__0=https://tu-frontend.onrender.com` y `App__FrontendUrl=https://tu-frontend.onrender.com`.

## Páginas por rol

| Rol | Páginas |
|---|---|
| Público | `index.html` (login) · `registro.html` (solo pacientes) · `olvide.html` · `restablecer.html` · `verificar.html` |
| Paciente | `paciente/inicio` · `detector` (sube imágenes) · `evolucion` (estadísticas, reporte y PDF) · `perfil` |
| Médico | `medico/inicio` (pacientes, alta/vinculación, bandeja de imágenes con validez de la IA) · `detector` · `paciente.html?id=` (ficha: estudios, detector, evolución, reporte, datos) · `perfil` |
| Admin | `admin/inicio` · `pacientes` · `medicos` (registra médicos) · `auditoria` · `modelo` · `perfil` (solo el propio) |

## Dreamur-Detector en paciente y médico

Al subir una imagen se guarda y se analiza vía backend. La respuesta indica **si es válida** (resonancia/TC cerebral)
y **qué tipo de imagen reconoce** (p. ej. resonancia cerebral vs. imagen no médica). Esa validez se muestra al paciente
y, en el panel del médico, en la bandeja, la galería y el detalle del estudio (con insignia "Subida por el paciente").
`IA_URL` solo se usa para indicar si el servicio de IA está en línea; el análisis pasa por el backend.

## Estructura

```
config.js            ← booleano local/Render
css/                 tokens · base · layout · components · auth · pages
js/core/             api · auth/sesión · layout · ui · format · iconos
js/services/         un servicio por recurso del backend
js/components/       visor · resultado · subida · galería · estudio · evolución · informe (PDF) · forms · tabs
js/lib/              pdf (generador propio) · charts · evolucion · precheck
js/pages/            un script por página
```

Aviso: el resultado de la IA es orientativo; no sustituye el diagnóstico médico.
