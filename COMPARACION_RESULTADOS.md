# Comparación de modelos reales

Métricas sobre el conjunto de PRUEBA (datos que el modelo no vio). Accuracy engaña con clases desbalanceadas: mira F1 macro, el recall por clase y el AUC de malignidad.

## mri · versión 2 (ACTIVA)
Muestras: 7013 · backbone: resnet18 · etiquetas por cabeza: {'tipo': 7013}
Peso de XGBoost en la mezcla: {'tipo': 1.0}

### Cabeza `tipo`

| Modelo | Accuracy | F1 macro | Log-loss | AUC maligno | n |
|---|---|---|---|---|---|
| CNN + red neuronal | 0.9590 | 0.9578 | 0.1675 | – | 1584 |
| XGBoost | 0.9583 | 0.9572 | 0.2003 | – | 1584 |
| Mezcla (producción) | 0.9583 | 0.9572 | 0.2003 | – | 1584 |

Por clase (mezcla):

| Clase | Precisión | Recall (sensibilidad) | F1 |
|---|---|---|---|
| glioma | 0.994 | 0.845 | 0.913 |
| sin_tumor | 0.950 | 0.998 | 0.973 |
| meningioma | 0.904 | 0.995 | 0.947 |
| pituitario | 0.997 | 0.993 | 0.995 |

## mri · versión 1 
Muestras: 7013 · backbone: resnet18 · etiquetas por cabeza: {'tipo': 7013}
Peso de XGBoost en la mezcla: {'tipo': 0.75}

### Cabeza `tipo`

| Modelo | Accuracy | F1 macro | Log-loss | AUC maligno | n |
|---|---|---|---|---|---|
| CNN + red neuronal | 0.9508 | 0.9492 | 0.1939 | – | 1584 |
| XGBoost | 0.9577 | 0.9566 | 0.2278 | – | 1584 |
| Mezcla (producción) | 0.9564 | 0.9553 | 0.1900 | – | 1584 |

Por clase (mezcla):

| Clase | Precisión | Recall (sensibilidad) | F1 |
|---|---|---|---|
| glioma | 0.991 | 0.845 | 0.912 |
| sin_tumor | 0.943 | 0.998 | 0.970 |
| meningioma | 0.908 | 0.990 | 0.947 |
| pituitario | 0.995 | 0.990 | 0.992 |
