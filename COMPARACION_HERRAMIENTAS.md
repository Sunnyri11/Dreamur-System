# Dreamur-Detector (cerebro) · Decisiones y comparación de herramientas

| Herramienta | ¿Se usa? | Papel |
|---|---|---|
| PyTorch | Sí | CNN, red neuronal, Grad-CAM, entrenamiento |
| CNN (ResNet18; ResNet50 opcional) | Sí | Extrae el embedding de cada corte |
| Red neuronal (cuello MLP + cabezas) | Sí | Salidas: tipo, malignidad, grado, grado OMS |
| XGBoost | Sí, ×2 | (a) refuerza `tipo` y `malignidad` sobre el embedding; (b) modelo de **progresión** con el historial |
| Grad-CAM (propio) | Sí | Zonas marcadas y su área, que se sigue entre estudios |
| Gemma 3 | Solo texto | Explica el resultado; NO diagnostica |
| pydicom / nibabel | Sí | Leer DICOM, series ZIP y NIfTI |
| Gemma 3 multimodal como clasificador | No | Ver abajo |
| Modelo único para varias zonas del cuerpo | No (ya no aplica) | El proyecto es solo cerebro |

## Conflictos y cómo se resolvieron

**1. Un modelo por modalidad.** MRI y TC se ven muy distinto; mezclarlas en una sola red empeora ambas. Hay un modelo para `mri` y otro para `tc`, con la misma taxonomía.

**2. Datasets con etiquetas distintas.** Cada dataset trae unas etiquetas y otras no. Se usan **cabezas múltiples con pérdida enmascarada**: lo que falta vale −1 y esa cabeza no aprende de esa imagen. Una cabeza (malignidad, grado, grado OMS) solo existe si hay ≥30 etiquetas reales con ≥2 clases. Si no hay cabeza de malignidad, el informe usa el conocimiento general del tipo y lo **marca como tal**.

**3. CNN vs red neuronal vs XGBoost.** Se encadenan: la CNN produce el embedding; la cabeza MLP y XGBoost clasifican sobre él; el peso de la mezcla (0–1) se elige en validación por log-loss. `scripts/comparar.py` muestra los números reales de cada uno.

**4. "Qué tan avanzado" en el cerebro.** Los tumores cerebrales no usan estadios TNM. Se usa el **grado** (bajo/alto y OMS I–IV), el tamaño (área marcada) y la evolución en el tiempo.

**5. Historial y predicción.** Dos niveles, indicando siempre cuál se usó: **reglas** (cambio de área marcada, de probabilidad de malignidad y de grado esperado entre estudios, con tratamientos registrados como cirugía o radioterapia) y **XGBoost de progresión**, que solo se activa cuando hay seguimientos etiquetados suficientes y AUC ≥ 0,6. La proyección del área a 90 días es una cuenta simple, rotulada como no clínica.

**6. Gemma 3.** Es un modelo de lenguaje general, no validado para diagnóstico por imagen, y la versión de 27B no cabe en un servicio normal de Render. Solo recibe el resultado ya calculado (sin imagen ni datos personales) y lo redacta; si falla o no hay clave, se usa la plantilla.

**7. Formatos de subida.** El backend guarda el **original** (JPG/PNG/DICOM/NIfTI/ZIP) en R2 y el servicio lo decodifica: DICOM con ventana y rescale, volúmenes con hasta 12 cortes elegidos por contenido, resumen por los 3 cortes más sospechosos. De DICOM solo se leen la fecha del estudio y la modalidad; el resto de la cabecera (nombre, documento) se descarta.

**8. Entrenar dónde.** En tu PC/Colab (GPU). Render solo carga los pesos desde R2 (`ALLOW_RETRAIN_ENDPOINT=0`).

## Lo que ninguna herramienta resuelve
- Benigno/maligno y grado por imagen son **probabilidades de apoyo**; los define el análisis del tejido.
- El área de Grad-CAM es atención del modelo, no una medición del tumor; cortes distintos entre estudios pueden no ser comparables.
- Sin un dataset de TC cerebral con tumores, no hay modelo de TC.
- Con datasets públicos sin ID de paciente las métricas son optimistas: valida con datos reales de tu hospital.
