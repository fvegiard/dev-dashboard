# reset-chrome-flags.ps1 — Nettoie les flags expérimentaux (chrome://flags) du profil Chrome principal.
#
# Pourquoi : ~90 flags expérimentaux sont activés dans le profil principal, dont plusieurs
# obsolètes ou connus pour casser le rendu et l'embarquement d'iframes.
#
# Ce script sauvegarde "Local State" avant toute modification.
# Usage :  powershell -ExecutionPolicy Bypass -File .\tools\reset-chrome-flags.ps1
#          powershell -ExecutionPolicy Bypass -File .\tools\reset-chrome-flags.ps1 -WhatIf

param(
  [switch]$WhatIf,
  [string]$Profile = "$env:LOCALAPPDATA\Google\Chrome\User Data"
)

$ErrorActionPreference = 'Stop'
$localState = Join-Path $Profile 'Local State'

if (-not (Test-Path $localState)) { throw "Introuvable : $localState" }

# Flags à retirer : obsolètes (no-op), dangereux, ou connus pour casser le rendu / les iframes.
$remove = @(
  'unsafely-treat-insecure-origin-as-secure',   # activé SANS valeur => no-op ; inutile pour localhost
  'enable-experimental-web-platform-features',  # flag "tout expérimental" : casse stockage/iframes
  'enable-javascript-harmony',                  # obsolète depuis des années
  'enable-experimental-webassembly-features',
  'enable-experimental-webassembly-shared-everything@1',
  'enable-experimental-webassembly-stack-switching@1',
  'skia-graphite@1',                            # glitches de rendu connus
  'force-high-performance-gpu',
  'enable-gpu-rasterization@1',
  'enable-zero-copy@1',
  'zero-copy-video-capture@1',
  'trees-in-viz@1',
  'local-network-access-check-webrtc@1',        # bloque fetch() vers le LAN depuis une origine publique
  'local-network-access-check-websockets@1',
  'local-network-access-check-webtransport@1',
  'enable-isolated-web-apps@1',
  'enable-isolated-web-app-dev-mode@1',
  'enable-isolated-web-app-fast-update-check@1',
  'privileged-web-contents@1',
  'webui-refresh-2026@1'
)

$json = Get-Content $localState -Raw -Encoding UTF8 | ConvertFrom-Json
$before = @($json.browser.enabled_labs_experiments)
$after = @($before | Where-Object { $remove -notcontains $_ })

Write-Host "Flags actifs avant : $($before.Count)" -ForegroundColor Cyan
Write-Host "Flags a retirer    : $($before.Count - $after.Count)" -ForegroundColor Yellow
Write-Host "Flags restants     : $($after.Count)" -ForegroundColor Green

if ($WhatIf) {
  Write-Host "`n[WhatIf] Aucune modification ecrite." -ForegroundColor Magenta
  return
}

$backup = "$localState.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $localState $backup
Write-Host "`nSauvegarde : $backup" -ForegroundColor Green

$json.browser.enabled_labs_experiments = $after
$json | ConvertTo-Json -Depth 100 -Compress | Set-Content $localState -Encoding UTF8 -NoNewline

Write-Host "Termine. Relance Chrome pour appliquer." -ForegroundColor Green
Write-Host "Restauration : Copy-Item '$backup' '$localState' -Force" -ForegroundColor DarkGray
