# One-command setup for Windows (PowerShell):  .\setup.ps1   or   .\setup.ps1 -Https
param([switch]$Https)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required: https://docs.docker.com/desktop/' }

if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Host 'Created .env from .env.example' }

function Get-EnvValue($name) {
  $line = Get-Content .env | Where-Object { $_ -match "^$name=" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return (($line -split '=', 2)[1] -replace '\s*#.*$', '').Trim()
}

$model = Get-EnvValue 'OLLAMA_MODEL'; if (-not $model) { $model = 'qwen2.5:7b' }
$profileArgs = @()
if ($Https) {
  if (-not (Get-EnvValue 'DOMAIN')) { throw 'Set DOMAIN in .env for -Https' }
  $profileArgs = @('--profile', 'https')
}

Write-Host '==> Building and starting containers'
docker compose @profileArgs up -d --build
if ($LASTEXITCODE) { throw 'docker compose failed' }

Write-Host "==> Pulling LLM: $model (several GB, first time only)"
docker compose exec -T ollama ollama pull $model
if ($LASTEXITCODE) { throw 'ollama pull failed' }

Write-Host '==> Downloading speech models'
docker compose exec -T api python -m app.download
if ($LASTEXITCODE) { throw 'model download failed' }

if (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Host '==> Installing frontend dependencies'
  Push-Location frontend; npm ci; Pop-Location
}

$port = Get-EnvValue 'API_PORT'; if (-not $port) { $port = '8000' }
Write-Host ''
Write-Host "Done. API: http://localhost:$port/api/health"
Write-Host 'Start the app:  cd frontend; npm run dev   (then open http://localhost:5173)'
