import base64
import httpx

BASE_URL = "http://127.0.0.1:8000"
RUTA_IMAGEN = r"C:\Users\ALUMNO\Downloads\images (2).jpg"

# 1. Leer la imagen y convertirla a Base64
with open(RUTA_IMAGEN, "rb") as img_file:
  imagen_b64 = base64.b64encode(img_file.read()).decode("utf-8")

# 2. Probar /detectar-corte con la imagen real
resp_corte = httpx.post(
    f"{BASE_URL}/detectar-corte", json={"imagen_base64": imagen_b64}
)
print("Resultado de /detectar-corte:", resp_corte.json())

# 3. Generar el modelo 3D .glb usando la imagen y plano="auto"
payload = {
    "tipo_tumor": "pituitario",
    "zonas": [
        {"x": 0.40, "y": 0.40, "ancho": 0.12, "alto": 0.14, "puntaje": 0.95}
    ],
    "plano": "auto",
    "imagen_base64": imagen_b64,
    "calidad": "medio",
    "vasos": True,
}

r = httpx.post(f"{BASE_URL}/generar.glb", json=payload)
print("Status /generar.glb:", r.status_code)

if r.status_code == 200:
  with open("modelo_paciente.glb", "wb") as f:
    f.write(r.content)
  print("Modelo guardado con éxito: modelo_paciente.glb")
else:
  print("Error:", r.text)
