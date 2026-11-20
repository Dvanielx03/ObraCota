# Reconstruye y levanta ObraCota en Docker desde esta carpeta.
#   .\desplegar.ps1            solo la landing
#   .\desplegar.ps1 -Datos     landing y PostgreSQL con pgvector
param([switch]$Datos)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker no esta instalado o no esta en el PATH. Instala Docker Desktop y vuelve a intentarlo."
}

$perfil = @()
if ($Datos) { $perfil = @("--profile", "datos") }

docker compose @perfil up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker compose @perfil ps
$puerto = if ($env:LANDING_PORT) { $env:LANDING_PORT } else { "3200" }
Write-Host ""
Write-Host "Landing en http://localhost:$puerto"
