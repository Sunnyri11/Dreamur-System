# Dreamur-Generate_Model

Servicio Python que genera el modelo 3D de un paciente en formato **GLB**, con el estilo de un cerebro
holográfico azul y el tumor resplandeciente:

| Nodo | Color | Qué es |
|---|---|---|
| `cerebro` | azul semitransparente | Hemisferios con surcos, fisura longitudinal y de Silvio, cerebelo con pliegues y tronco encefálico. Igual para todos |
| `tumor` | según el tipo: glioma rojo, meningioma ámbar, pituitario violeta | Masa con textura tipo frambuesa, ubicada donde Dreamur-Detector dibujó la zona. Brilla (`KHR_materials_emissive_strength`) |
| `vasos` | color del tumor | Red de vasos que baja del tronco, se ramifica y llega al tumor. **Decorativo** (no es anatomía real); se quita con `vasos=false` y quedan solo cerebro y tumor |

No es una red neuronal ni usa dataset: una sola imagen 2D no permite reconstruir el cerebro real, así que el cerebro
es una malla procedural y solo el tumor depende del paciente (zona, tamaño y tipo). Es una **representación
aproximada**: la posición y el tamaño en el plano de la imagen salen de la zona; la profundidad es un valor por
defecto según el tipo (`config.PROFUNDIDAD_POR_TIPO`) o el que se indique. El resultado lo marca con `"aproximado": true`.

## Peso

| Calidad | GLB | Triángulos (cerebro) |
|---|---|---|
| `medio` (defecto) | ~307 KB | 22 026 |
| `bajo` | ~116 KB | 5 706 (menos detalle de surcos) |

Memoria: unos 6 MB extra sobre numpy/scipy (~76 MB en total con las librerías); ~0.2 s la primera vez y ~0.1 s después (la malla base se reutiliza).
Cada zona de tumor suma ~15 KB y los vasos ~32 KB. Geometría cuantizada (int16/int8). Sin torch.

## Detección del tipo de corte (axial / coronal / sagital)

Con `plano: "auto"` (el valor por defecto) y la imagen en `imagen_base64`, el servicio detecta:

- **el plano**, con su confianza y las probabilidades de cada clase (`app/plano.py`, método clásico: forma de la
  cabeza y simetrías, sin red neuronal);
- **la caja de la cabeza**, para que la zona se interprete relativa a la cabeza y no a los márgenes de la imagen;
- **la orientación** cuando se puede saber (frente arriba/abajo en axial, frente a izquierda/derecha en sagital).

Todo queda en `parametros.corte` (`origen`: `imagen` | `manual` | `defecto`, `confianza`, `dudoso`, `advertencia`).
Si el plano se indica a mano, manda sobre la detección. Si no hay imagen o no se lee, se asume axial y se marca
`dudoso: true`. **Si `dudoso` es true, conviene que el front le pida confirmar el corte al usuario.**

**Límites honestos:** los pesos iniciales se ajustaron con cortes *sintéticos* del propio modelo 3D (axial se
reconoce siempre; coronal ~86 % y sagital ~70 % en esas pruebas). **No están validados con resonancias reales.**
Para calibrarlos con tus imágenes, ponlas en carpetas `axial/`, `coronal/`, `sagital/` y ejecuta:

```
python tools/calibrar_plano.py /ruta/dataset
```

Imprime la precisión (validación cruzada) y la matriz de confusión, y guarda `app/plano_modelo.json`, que el servicio
usa automáticamente. Bastan unas 50–100 imágenes por clase.

## API

`POST /generar` (JSON) → `{glb_base64, sha256, tam_bytes, n_triangulos_cerebro, n_triangulos_tumor, tipo_tumor, version_generador, parametros}`
(coincide con las columnas de `modelos_3d`, ver `003_modelos_3d.sql`). `POST /generar.glb` devuelve el binario.
`POST /detectar-corte` solo analiza la imagen. `GET /salud`.

```json
{
  "tipo_tumor": "glioma",
  "zonas": [{"x": 0.42, "y": 0.18, "ancho": 0.16, "alto": 0.16, "puntaje": 0.93}],
  "plano": "auto",
  "imagen_base64": "<la imagen original>",
  "calidad": "medio",
  "vasos": true
}
```

- `x, y, ancho, alto`: la zona de `detecciones_zonas` (normalizada 0–1, `x,y` = esquina superior izquierda).
- `tipo_tumor`: código de `tipos_tumor`. `sin_tumor` (o sin zonas) genera solo el cerebro.
- `plano`: `auto` (defecto), `axial`, `coronal` o `sagital`.
- `profundidad` (opcional, -1 a 1), `semilla` (opcional, forma del tumor; sin ella la misma detección da siempre el mismo archivo).
- `invertir_horizontal` / `invertir_vertical`: por defecto se detectan; se pueden forzar. Convención: izquierda de la
  imagen = derecha del paciente (radiológica); en sagital, frente a la izquierda.
- Si existe `DREAMUR_API_KEY`, se exige la cabecera `X-API-Key`. Imagen máxima: 8 MB (`DREAMUR_MAX_IMAGEN_BYTES`).

Despliegue (Render): `pip install -r requirements.txt` y `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

## Integración prevista

1. El backend ASP.NET llama a `/generar` cuando el paciente o el médico pulsa “Modelar 3D” (opcional), enviando también la imagen.
2. Sube el GLB al bucket en `modelos3d/<paciente_id>/<id>.glb` y guarda la fila en `modelos_3d`; `parametros` (JSONB) conserva el corte detectado.
3. El front lo muestra con three.js (`GLTFLoader` + `OrbitControls`) para rotarlo. Para acercarse al look de la referencia:
   `UnrealBloomPass` para el resplandor y un material con efecto fresnel (borde luminoso) en el nodo `cerebro`. Servir con gzip/brotli.

## Pruebas y vista previa

```
python -m pytest tests
python tools/preview.py salida.png glioma 0.42 0.18 0.16 0.16 axial 62 6   # PNG de comprobación
```

Los tests del detector usan cortes sintéticos (`tests/fantomas.py`): comprueban la coherencia de ejes y convenciones,
no sustituyen una validación con resonancias reales.

## Para mejorar después (opcional)

- Cerebro real: decimar un atlas abierto (p. ej. fsaverage/MNI) a ~20 k triángulos en vez del procedural.
- Forma real del tumor: entrenar una segmentación con un dataset como BraTS en vez de la masa con bultos.
- Detector de corte entrenado con tus imágenes etiquetadas (o como cabeza adicional de la red de Dreamur-Detector).
