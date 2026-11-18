# ---------- Compilación ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restaurar primero (capa cacheable)
COPY Directory.Build.props DreamurDetector.slnx ./
COPY src/DreamurDetector.Domain/*.csproj src/DreamurDetector.Domain/
COPY src/DreamurDetector.Application/*.csproj src/DreamurDetector.Application/
COPY src/DreamurDetector.Infrastructure/*.csproj src/DreamurDetector.Infrastructure/
COPY src/DreamurDetector.Api/*.csproj src/DreamurDetector.Api/
RUN dotnet restore src/DreamurDetector.Api/DreamurDetector.Api.csproj

# db/ se incrusta en el ensamblado (actualizar_tablas.sql), por eso se copia antes de publicar.
COPY db/ db/
COPY src/ src/

# Mismo comando que usarías a mano:  dotnet publish -c Release -o ./dist
WORKDIR /src/src/DreamurDetector.Api
RUN dotnet publish -c Release -o ./dist --no-restore

# ---------- Ejecución ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /src/src/DreamurDetector.Api/dist ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    DOTNET_gcServer=0 \
    DOTNET_EnableDiagnostics=0

# Render define PORT (Program.cs lo lee). 8080 es el valor por defecto local.
ENV PORT=8080
EXPOSE 8080

# Sin privilegios de root (el usuario "app" ya viene en la imagen).
USER $APP_UID
ENTRYPOINT ["dotnet", "DreamurDetector.Api.dll"]
