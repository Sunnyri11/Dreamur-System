# Datasets de tumores cerebrales: dónde bajarlos y cómo usarlos

**Ningún dataset público trae todo.** Por eso Dreamur usa varios a la vez: cada uno aporta las etiquetas que realmente tiene (tipo, grado, progresión) y lo que falta queda vacío; nunca se inventa.

> Estado de verificación: de **Cheng (figshare)** abrí la página (3.064 imágenes T1 con contraste en archivos `.mat`). Los demás enlaces salen de búsquedas o de mi conocimiento; **las páginas de Kaggle y TCIA no pude abrirlas desde aquí**. Confirma nombre, tamaño, campos y licencia en cada página antes de descargar, acepta sus condiciones de uso y cita la fuente si publicas resultados.

## Qué aporta cada dataset

| Dataset | Modalidad | Aporta | Link |
|---|---|---|---|
| **Brain Tumor MRI** (Kaggle, M. Nickparvar) | MRI | **tipo**: glioma, meningioma, pituitario, sin tumor (alrededor de 7.000 imágenes). Sin grado y sin ID de paciente | https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset |
| **Brain tumor dataset** (Cheng, figshare) | MRI T1 con contraste | 3.064 cortes, 3 tipos (meningioma, glioma, pituitario), con **ID de paciente** y máscaras | https://figshare.com/articles/dataset/brain_tumor_dataset/1512427 |
| **BraTS** (Synapse) | MRI multisecuencia | máscaras de tumor; gliomas con **grado LGG/HGG** en las ediciones antiguas; en 2023 también meningiomas y metástasis | https://www.synapse.org/brats2023 |
| **UCSF-PDGM** (TCIA) | MRI | gliomas con **grado OMS** y marcadores moleculares (*no verificado: confirma los campos*) | buscar "UCSF-PDGM" en https://www.cancerimagingarchive.net/ |
| **UPENN-GBM** (TCIA) | MRI | glioblastoma con datos clínicos (*no verificado*) | buscar "UPENN-GBM" en https://www.cancerimagingarchive.net/ |
| **LUMIERE** (figshare) | MRI seriada | glioblastoma con **estudios en el tiempo y evaluación RANO**: entrena la progresión | https://figshare.com/collections/The_LUMIERE_Dataset_Longitudinal_Glioblastoma_MRI_with_Expert_RANO_Evaluation/5904905 |

**Tomografía (TC) cerebral:** no encontré un dataset público de TC con tumores que pueda recomendarte con confianza (lo que aparece son de hemorragia o comerciales). El sistema **acepta** TC al subir, pero el modelo de TC solo existirá cuando reúnas TC cerebrales etiquetadas (por ejemplo de tu hospital, con consentimiento). Mientras tanto, solo funciona el modelo de MRI.

### Qué pregunta responde cada cabeza

| Pregunta | Cabeza | De dónde aprende |
|---|---|---|
| ¿Qué tipo de tumor es? | `tipo` | Kaggle, Cheng, BraTS 2023 (meningioma/metástasis) |
| ¿Benigno o maligno? | `malignidad` | Solo donde el dataset la defina (metástasis = maligno, sin tumor = no tumoral). Para glioma, meningioma y pituitario **no existe etiqueta por caso** en estos datasets: el informe usa el conocimiento general del tipo y lo **marca como tal** |
| ¿Qué tan agresivo? | `grado` (bajo/alto) y `grado_oms` (I–IV) | BraTS (LGG/HGG), UCSF-PDGM (OMS) |
| ¿Está progresando? | historial + modelo de progresión | LUMIERE y tus propios seguimientos |

**Sobre "qué tan avanzado está":** los tumores cerebrales no se estadifican con TNM como el cáncer de pulmón o mama. La medida equivalente es el **grado OMS** (I–IV), junto con el tamaño y la evolución. Por eso el sistema reporta grado, un indicador de tamaño (área marcada) y su cambio en el tiempo.

## Cómo usar cada dataset

Todos terminan igual: `python -m scripts.ingest ...` (sube a R2 y registra en Neon) y luego `python -m scripts.train --modalidad mri`.

**1. Brain Tumor MRI (Kaggle)**: adaptador listo.
```bash
python -c "import kagglehub; print(kagglehub.dataset_download('masoudnickparvar/brain-tumor-mri-dataset'))"   # necesita tu token de Kaggle
python -m scripts.ingest --adaptador brain_kaggle --root "<carpeta con Training y Testing>"
```
Si ya lo tienes descargado, solo apunta `--root` a esa carpeta. La carpeta `Testing` queda como conjunto de prueba.

**2. Cheng (figshare)**: descarga el zip, conviértelo a PNG y cárgalo (por paciente, sin fuga de datos).
```bash
pip install h5py
python -m scripts.convertir_cheng --origen "D:/datos/cheng_mat" --destino "D:/datos/cheng_png"
python -m scripts.ingest --adaptador manifest --root "D:/datos/cheng_png" --manifest "D:/datos/cheng_png/manifiesto.csv" --fuente-codigo cheng
```
**Revisa el README del dataset:** el convertidor asume `label` 1 = meningioma, 2 = glioma, 3 = pituitario y un campo `PID` con el paciente. Si tu copia difiere, cambia el diccionario `TIPOS` de `scripts/convertir_cheng.py`.

**3. BraTS (grado)**: se elige el corte con más tumor y se carga con manifiesto.
```bash
python -m scripts.manifest_volumenes --root BraTS2020 --layout brats --sufijo flair --tipo glioma \
    --etiquetas-csv grados.csv --salida manifiesto_brats.csv        # grados.csv: caso,grado  (LGG/HGG)
python -m scripts.ingest --adaptador manifest --root BraTS2020 --manifest manifiesto_brats.csv --fuente-codigo brats
```
Para otros tipos (meningioma, metástasis) pon la columna `tipo` en `grados.csv`. Para UCSF-PDGM/UPENN-GBM arma el mismo manifiesto con el `grado_oms` de cada paciente (los campos exactos, confírmalos en TCIA).

**4. Seguimientos (LUMIERE y propios)**: manifiesto con `grupo_ref` = paciente, `fecha` de cada estudio y `progresion` = 1 si progresó respecto al estudio anterior; después `python -m scripts.train_progresion`. *No incluí* la conversión de las hojas de RANO y fechas de LUMIERE a ese CSV: hay que armarla a mano.

**Formato del manifiesto CSV** (`ruta,tipo` son obligatorias; el resto, opcional):
```csv
ruta,tipo,modalidad,secuencia,malignidad,grado,grado_oms,idh,mgmt,grupo_ref,fecha,corte,progresion
BraTS20_001/BraTS20_001_flair.nii.gz,glioma,mri,flair,,alto,IV,salvaje,,BraTS20_001,2020-03-01,77,
```
Tipos válidos: `glioma`, `meningioma`, `pituitario`, `metastasis_cerebral`, `sin_tumor`. `ruta` puede ser imagen, `.dcm`, `.nii/.nii.gz` o `.zip` (serie DICOM).

## Orden recomendado
1. Kaggle (tipo) → entrena y comprueba que todo el flujo funciona.
2. Cheng (tipo, por paciente) → métricas más honestas.
3. BraTS / UCSF-PDGM → habilitan grado.
4. LUMIERE + tus seguimientos → habilitan el modelo de progresión.

## Advertencias que afectan la calidad de verdad
- **Fuga de datos:** el dataset de Kaggle no trae ID de paciente; cortes del mismo paciente pueden caer en entrenamiento y prueba y las métricas salen **infladas**. Cheng sí trae el paciente: úsalo para validar. Y valida siempre con casos de **tu** hospital.
- **Datos de pocos centros y equipos:** funcionan peor con otras máquinas y poblaciones.
- **Resolución y secuencias mezcladas:** mezclar T1, T1c, T2 y FLAIR en un solo modelo baja la precisión; la columna `secuencia` queda registrada para poder separarlas más adelante.
- **Benigno/maligno y grado por imagen no sustituyen a la patología.**
