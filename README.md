# Dreamur-Detector · Backend (ASP.NET 10)

API REST para el apoyo a la detección de **tumores cerebrales** (MRI / TC). Se conecta a PostgreSQL en **Neon**, guarda las imágenes en un bucket (R2/S3), llama al servicio ML de Dreamur-Detector y se despliega en **Render**.

## Arquitectura (biblioteca de clases por capas)

| Proyecto | Contenido |
|---|---|
| `DreamurDetector.Domain` | Entidades (1:1 con `db/actualizar_tablas.sql`) y constantes (roles, estados, modalidades) |
| `DreamurDetector.Application` | DTOs con validación, interfaces de servicios, opciones de configuración, excepciones |
| `DreamurDetector.Infrastructure` | EF Core + Npgsql, JWT, hash PBKDF2, servicios, storage S3/Local, cliente ML, email |
| `DreamurDetector.Api` | Controllers, middleware, Swagger, JWT bearer, CORS, rate limiting, `Program.cs` |

## Autenticación (JWT de 4 horas)

- `POST /api/auth/login` devuelve `accessToken` (HS256) que vence a las **4 h exactas** (`Jwt:ExpiraMinutos=240`, sin tolerancia de reloj).
- Roles: `paciente`, `medico`, `admin`. Todo endpoint exige sesión salvo los marcados `[AllowAnonymous]`.
- Contraseñas con PBKDF2-SHA512 (210 000 iteraciones). Política: 8+ caracteres, mayúscula, minúscula y número.
- Bloqueo tras 5 intentos fallidos (15 min), desbloqueo manual por admin.
- `logout` revoca el token al instante (tabla `tokens_revocados`); un usuario desactivado pierde acceso en la siguiente petición.
- Verificación de correo, recuperación de contraseña (token de un solo uso, solo se guarda su hash), cambio de contraseña.
- Rate limiting en login/registro/recuperación (10 por minuto por IP) y auditoría de acciones sensibles.

## Endpoints principales

| Área | Rutas |
|---|---|
| Auth | `POST /api/auth/{registro,login,logout,cambiar-password,olvide-password,restablecer-password,verificar-correo,reenviar-verificacion}`, `GET /api/auth/me` |
| Perfil (todos los roles) | `GET/PATCH /api/perfil` — datos personales + los propios del rol (clínicos, matrícula/especialidad, nivel admin). `null` = no cambia, `""` = borrar |
| Pacientes | `GET /api/pacientes` (médico: solo sus vinculados; admin: todos), `POST /api/pacientes` (médico crea un paciente suyo), `POST /api/pacientes/vincular` (por código `PAC-xxxxxx` o documento), `DELETE /api/pacientes/{id}/vinculo`, `GET /api/pacientes/me`, `GET/PATCH /api/pacientes/{id}`, `GET /api/pacientes/{id}/evolucion`, `GET /api/pacientes/{id}/consentimientos`, `POST /api/pacientes/me/consentimientos` |
| Médicos (admin) | `GET /api/medicos` (lista con estado y nº de pacientes); alta con `POST /api/usuarios` (rol `medico`); activar/desactivar y desbloquear en `/api/usuarios/{id}/...` (usa `usuarioId` del `MedicoDto`) |
| Radiografías | `POST/GET /api/radiografias`, `GET/DELETE /api/radiografias/{id}`, `GET /api/radiografias/{id}/archivo` |
| Detecciones | `POST/GET /api/radiografias/{id}/detecciones`, `GET /api/detecciones/{id}` (incluyen `imagenValida`, `tipoImagen`, `mensaje`) |
| Etiquetas | `GET/PUT/DELETE /api/radiografias/{id}/etiqueta` (PUT/DELETE: médico/admin) |
| Catálogo | `GET /api/catalogo/tipos-tumor` |
| Modelos | `GET /api/modelos`, `GET /api/modelos/activo`, `POST /api/modelos/{id}/activar`, `GET/POST /api/entrenamientos`, `POST /api/entrenamientos/{id}/completar` (callback ML con `X-Api-Key`) |
| Admin | `/api/usuarios` (crear médicos/admins, activar/desactivar, desbloquear), `GET /api/auditoria` (con `usuarioNombre`) |
| Sistema | `GET /health` (sin BD), `GET /health/ready` (con BD), Swagger en `/swagger` |

### Reglas de acceso
- **Paciente**: solo sus datos, imágenes, detecciones y evolución.
- **Médico**: solo los pacientes **vinculados** (tabla `medico_pacientes`): los que él crea o los que vincula con su código/documento. Puede subir imágenes, analizarlas, etiquetar y editar los datos clínicos de esos pacientes.
- **Administrador**: ve todo (pacientes, médicos, auditoría, dataset) pero solo edita su propio perfil; da de alta a los médicos.
- Si la IA no reconoce una imagen cerebral (`imagenValida=false`) se guarda como `sin_tumor` sin zonas y el resultado no debe interpretarse.

## Puesta en marcha

### 1. Neon
1. Copia la cadena de conexión de Neon (formato `postgresql://...`) y úsala como `DATABASE_URL`. El backend la convierte solo y fuerza SSL.
2. **No hace falta ejecutar nada a mano**: al arrancar el backend aplica `db/actualizar_tablas.sql`. También puedes pegarlo en el editor SQL de Neon.
   - Solo usa `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` e `INSERT ... ON CONFLICT DO NOTHING`.
   - No hay `DROP`, `TRUNCATE` ni `DELETE`: el entrenamiento de Dreamur-Detector (`modelo_versiones`, `entrenamientos`, `etiquetas`, `detecciones`) se conserva intacto aunque lo ejecutes muchas veces.
   - Sirve para una base vacía (crea todo) y para una existente (solo añade lo que falta).
   - Revisa que los códigos del catálogo `sin_tumor/glioma/meningioma/pituitario` coincidan con las clases de tu modelo.

### 2. Local
```bash
cd DreamurDetector.Backend
dotnet restore
# Edita src/DreamurDetector.Api/appsettings.Development.json (cadena de Neon) o usa user-secrets
dotnet run --project src/DreamurDetector.Api
# Swagger: http://localhost:5000/swagger   (el puerto lo imprime dotnet run)
```
El admin inicial sale de `Seed:AdminCorreo` / `Seed:AdminPassword` (solo si no existe ningún admin). Cambia esa clave tras el primer login.

### 3. Render (Docker)
1. Sube la carpeta a un repo de GitHub.
2. En Render: **New → Blueprint** y elige el repo (usa `render.yaml` + `Dockerfile`), o crea un Web Service con runtime Docker.
3. El `Dockerfile` ejecuta `dotnet publish -c Release -o ./dist` (el mismo comando que puedes correr a mano en `src/DreamurDetector.Api`) y arranca desde esa carpeta.
4. Completa las variables marcadas `sync: false` (ver `.env.example`). `Jwt__Key` se genera sola.
5. Health check: `/health`. No uses `/health/ready` como health check: mantendría despierto a Neon y gastaría horas de cómputo.
6. En el plan gratuito de Render el disco es efímero, por eso las imágenes van a un bucket (`Storage__Provider=S3`). Con `Local` se pierden en cada despliegue.

### 4. CORS público
Cualquier página puede llamar a la API (`AllowAnyOrigin`). Es seguro porque la sesión viaja en el encabezado `Authorization` (JWT), no en cookies. Para restringirlo: `Cors__Restringir=true` y `Cors__Origins=https://a.com,https://b.com`.

### 5. Confirmación de cuenta con Brevo
1. En Brevo: **Senders, Domains & Dedicated IPs → Senders**: añade y verifica el remitente (el correo que pondrás en `Email__Remitente`).
2. **SMTP & API → API Keys**: crea una clave y ponla en `Email__BrevoApiKey` (`xkeysib-...`).
3. Pon `App__FrontendUrl` con la URL pública del frontend: los enlaces del correo abren `verificar.html?token=...` y `restablecer.html?token=...`.
4. Se usa la **API HTTPS** de Brevo y no el relé SMTP, porque Render gratis bloquea los puertos SMTP salientes.

Flujo (con `Auth__RequerirCorreoVerificado=true`, el valor por defecto):
- `POST /api/auth/registro` crea la cuenta, envía el correo y responde **202** (sin sesión).
- El paciente abre el enlace → `POST /api/auth/verificar-correo`. Después inicia sesión.
- Si intenta entrar sin confirmar, `login` responde **403** con `code: "correo_no_verificado"`.
- `POST /api/auth/reenviar-verificacion-publico` `{ "correo": "..." }` reenvía el enlace sin sesión (responde igual exista o no la cuenta).
- Las cuentas creadas por un médico o por el administrador nacen confirmadas.
- Si ya tenías pacientes registrados sin confirmar, deberán usar el reenvío (o pon `Auth__RequerirCorreoVerificado=false`).

### 6. Dreamur-Detector en Oracle Cloud
`Detector__BaseUrl` apunta a tu servicio de IA en Oracle (p. ej. `http://IP_PUBLICA:8001`). El backend de Render lo llama de servidor a servidor, así que `http` funciona.
Abre el puerto en la VCN (Security List / NSG) **y** en el firewall de Ubuntu (`sudo iptables -I INPUT -p tcp --dport 8001 -j ACCEPT`). Protege el servicio con `Detector__ApiKey` (cabecera `X-Api-Key`).

## Contrato asumido con el servicio ML

Ajusta `External/DetectorClient.cs` si tu servicio es distinto.

```
POST {Detector:BaseUrl}/predict   multipart: file, region="cerebro"
  -> { "imagen_valida": true,
       "tipo_imagen": "resonancia_cerebral",   // resonancia_cerebral | tc_cerebral | radiografia_torax | otra_imagen_medica | imagen_no_medica
       "mensaje": null,                        // explicación cuando la imagen no es válida
       "tipo_tumor": "glioma", "confianza": 0.93,
       "probabilidades": { "glioma": 0.93, "meningioma": 0.04, ... },
       "zonas": [ { "x": 0.3, "y": 0.4, "ancho": 0.2, "alto": 0.2, "puntaje": 0.9 } ],
       "modelo_version": 3 }
POST {Detector:BaseUrl}/train     json: { entrenamiento_id, region, callback_url }
  -> al terminar, el ML llama a POST /api/entrenamientos/{id}/completar con X-Api-Key = Detector:CallbackApiKey
     body: { "estado": "completado", "modeloVersionId": 4, "nMuestras": 1200 }
```
Zonas normalizadas entre 0 y 1 (lo exige el `CHECK` de la tabla).
Si `imagen_valida=false` (p.ej. una foto normal o una radiografía de tórax), `tipo_tumor` puede ser `null`, no hay `zonas`, y `confianza` es la de la clasificación del tipo de imagen. Si `imagen_valida` no viene en la respuesta se asume `true`.

## Notas
- Esta versión solo admite `region = cerebro` (modalidades `mri_cerebro`, `tc_cerebro`), aunque el esquema también contempla tórax.
- Correo: Brevo (`Email__BrevoApiKey`) > SMTP (`Email__Host`) > solo log. Sin ninguno, los enlaces de confirmación/recuperación se escriben en el log del servidor (útil en desarrollo; `appsettings.Development.json` desactiva la confirmación obligatoria).
- Un logout o cambio de contraseña invalida el token usado, no los emitidos en otros dispositivos.
- No hay refresh token: pasadas las 4 horas se vuelve a iniciar sesión.
- Las versiones de paquetes NuGet son flotantes (`10.0.*`, `4.*`); fíjalas tras el primer `dotnet restore` si quieres builds reproducibles.


## Esquema real de Neon y multi-rol
- El backend se adaptó al esquema real de Neon: `radiografias` del código = tabla `estudios`, `radiografia_archivos` = `estudio_archivos`;
  modalidades `mri`/`tc`; estados `subido`/`analizado`/`revisado`. Las rutas REST (`/api/radiografias`) no cambian.
- `db/actualizar_tablas.sql` solo agrega lo que falta (tokens_revocados, medico_pacientes, columnas de validez de imagen en detecciones,
  correos ligados a usuario y reglas de roles). Es idempotente y no toca el entrenamiento de Dreamur-Detector.
- Multi-rol: un médico puede ser también paciente; un admin también médico y paciente; un paciente nunca médico ni admin
  (reglas en la base + validación en API). `POST /api/auth/cambiar-rol` y `POST /api/auth/activar-rol`; el JWT lleva el rol activo.
