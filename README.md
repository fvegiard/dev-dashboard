# VibeDeck — Dev Observability

Dashboard local (thème sombre violet, style OMP) qui (1) surveille la santé de tes outils de dev, (2) diagnostique l'environnement (PATH, conflits shell, skills, mises à jour), (3) initialise des projets proprement, (4) diagnostique les projets existants, (5) génère des visuels (architecture + kanban) dans le projet.

Interface **click-through** : vue d'ensemble → tu cliques sur un outil ou une erreur → le panneau de détail s'ouvre à droite.

## Vues

| Vue | Contenu |
|-----|---------|
| **Vue d'ensemble** | Cartes de stats + santé des 4 outils + points d'attention |
| **Outils** | Santé des outils + table de résolution des binaires (31 binaires, type `system` / `npm-global` / `managed` / `override` / `not found`) |
| **Diagnostics** | PATH manquants, conflits shell, skills vides, mises à jour (npm/pip/uv) |
| **Init + Doctor** | Initialise ou diagnostique un dossier de projet |
| **Visuels** | Génère `docs/architecture.mmd`, `architecture.html`, `board.json`, `board.html`, `README.md` |

## 🚀 Initialiseur de projet

Entre un chemin de dossier puis :

- **🔎 Détecter** — détecte automatiquement la stack (Node.js, Python, Go, Rust, statique).
- **✨ Initialiser** — crée la structure du projet (manifest, `.gitignore`, `README.md`, fichier source) selon la stack choisie.
- **🩺 Diagnostiquer** — vérifie un projet existant : fichiers manquants, conflits de manifest, recommandations de package manager (ex. `npm` → `pnpm`, `pip` → `uv`).

Stacks supportées : Node.js, Python, Go, Rust, statique (HTML/CSS/JS).

## 🎨 Visuels

Génère dans `<projet>/docs/` :

- `architecture.mmd` — source mermaid (flowchart de la stack)
- `architecture.html` — diagramme rendu (mermaid.js, thème sombre)
- `board.json` — données du tableau (todo / doing / done)
- `board.html` — tableau Kanban
- `README.md` — index des visuels

Les fichiers sont servis via `/api/project/file` (les iframes ne peuvent pas charger `file://` depuis une page http).

## Outils surveillés

| Outil | Logs lus | Santé vérifiée |
|-------|----------|----------------|
| 🤖 Claude Code | `~/.claude/settings.json`, `history.jsonl`, `claude doctor` | JSON valide, pas de réglages dangereux (xhigh/max/unrestricted), doctor OK |
| 🛰️ Antigravity | `AppData\Roaming\Antigravity\logs\main.log`, `language_server.log` | Processus lancé, erreurs dans les logs |
| 🐙 GitHub Copilot | `~/.copilot/logs/github-app.*.log` (dernier) | Processus lancé, erreurs dans le log |
| 🖱️ Cursor | `AppData\Roaming\Cursor\logs\<dernier>\cli.log` | Processus lancé, erreurs dans cli.log |

## Lancer

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\fvegi\dev-dashboard\launch.ps1
```

Ce script :
1. Démarre le serveur Node (`server.js`) sur `http://localhost:8787`
2. Ouvre Chrome avec les flags dev :
   - `--remote-debugging-port=9222` (CDP)
   - `--enable-logging --v=1` (logs verbeux)
   - `--log-file=chrome-debug.log`
   - `--user-data-dir=chrome-profile` (profil isolé)

## Endpoints

- `GET /api/overview` — agrégat rapide (outils + compteurs diagnostics)
- `GET /api/tools` — liste des outils + santé
- `GET /api/tools/registry` — résolution des 31 binaires (chemin + type)
- `GET /api/logs?tool=<id>` — logs d'un outil
- `GET /api/capture` — tout capturer (logs + santé)
- `GET /api/diagnostics` — path, conflits shell, skills, updates
- `GET /api/project/detect?path=X` — détecte la stack d'un dossier
- `POST /api/project/init` — initialise un projet (body : `{ path, stack }`)
- `GET /api/project/doctor?path=X` — diagnostique un projet existant
- `POST /api/project/visuals` — génère les visuels (body : `{ path }`)
- `GET /api/project/file?path=X&name=Y` — sert un fichier de `<projet>/docs/`

## Arrêter

```powershell
Stop-Process -Id <PID du serveur>
```

## Outils

- `tools/reset-chrome-flags.ps1` — nettoie les flags expérimentaux (`chrome://flags`) du profil Chrome principal. Sauvegarde `Local State` avant modification. `-WhatIf` pour simuler.

## Chromium vs Chrome

Les flags dev (`--remote-debugging-port`, `--enable-logging`, `--v=1`) fonctionnent à l'identique dans les deux. Chromium est plus propre (zéro télémétrie Google, plus de flags expérimentaux), mais Chrome marche aussi très bien.

**Important** : `chrome://flags` (profil principal) et les flags en ligne de commande (`launch.ps1`) sont deux choses séparées. Le dashboard utilise son propre profil (`chrome-profile`), donc il reste propre même si ton profil principal est pollué.
