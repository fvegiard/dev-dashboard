# launch.ps1 — Démarre le dashboard + ouvre Chrome avec les flags dev (CDP + logging)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

# 1. Démarre le serveur Node en arrière-plan
Write-Host "Démarrage du serveur dashboard..." -ForegroundColor Cyan
$server = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $dir -PassThru -WindowStyle Hidden
Write-Host "  Serveur PID: $($server.Id)" -ForegroundColor Green

# 2. Attend que le serveur soit prêt
Start-Sleep -Seconds 2

# 3. Ouvre Chrome avec les flags dev
Write-Host "Ouverture de Chrome avec flags dev..." -ForegroundColor Cyan
$flags = @(
  "--remote-debugging-port=9222",
  "--enable-logging",
  "--v=1",
  "--log-file=$dir\chrome-debug.log",
  "--user-data-dir=$dir\chrome-profile",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=TranslateUI",
  "--app=http://localhost:8787"
)
Start-Process -FilePath $chrome -ArgumentList $flags

Write-Host ""
Write-Host "=== DASHBOARD ACTIF ===" -ForegroundColor Green
Write-Host "  Dashboard : http://localhost:8787" -ForegroundColor Cyan
Write-Host "  CDP       : http://localhost:9222/json" -ForegroundColor Cyan
Write-Host "  Logs Chrome : $dir\chrome-debug.log" -ForegroundColor Cyan
Write-Host ""
Write-Host "Pour arrêter : Stop-Process -Id $($server.Id)" -ForegroundColor Yellow
