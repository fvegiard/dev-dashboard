const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 8787;
const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

function run(cmd, timeout = 20000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, windowsHide: true, shell: 'powershell.exe' });
  } catch (e) {
    return (e.stdout || '') + '\n' + (e.stderr || '');
  }
}

function runJson(script, timeout = 20000) {
  const out = run(script, timeout).trim();
  try { return JSON.parse(out); } catch { return null; }
}

// Retourne uniquement stdout (utile pour les commandes qui sortent en code non-zéro
// mais écrivent du JSON sur stdout, ex: npm outdated --json)
function runOut(cmd, timeout = 20000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, windowsHide: true, shell: 'powershell.exe' });
  } catch (e) {
    return e.stdout || '';
  }
}

function processRunning(pattern) {
  const out = run(`Get-Process | Where-Object { $_.ProcessName -like '*${pattern}*' } | Select-Object -First 1 -ExpandProperty ProcessName`);
  return out.trim().length > 0;
}

// Vérifie si un outil CLI est INSTALLÉ (sur le PATH), pas s'il tourne.
// (pnpm/yarn/uv sont des CLI, pas des daemons — Get-Process ne les voit jamais.)
function toolInstalled(name) {
  const out = run(`Get-Command ${name} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source`);
  return out.trim().length > 0;
}

// Version Go détectée une seule fois au démarrage (pour un go.mod correct).
let GO_VERSION = '1.22';
try {
  const m = runOut('go version', 5000).trim().match(/go(\d+\.\d+)/);
  if (m) GO_VERSION = m[1];
} catch {}

function tailFile(file, lines = 60) {
  try {
    const data = fs.readFileSync(file, 'utf8');
    const arr = data.split(/\r?\n/).filter(Boolean);
    return arr.slice(-lines);
  } catch { return null; }
}

function latestFile(dir, pattern) {
  try {
    const files = fs.readdirSync(dir).filter(f => pattern.test(f)).map(f => path.join(dir, f));
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files[0] || null;
  } catch { return null; }
}

function countErrors(lines) {
  if (!lines) return 0;
  const re = /(error|critical|fatal|exception|failed|crash)/i;
  return lines.filter(l => re.test(l)).length;
}

// ===================== OUTILS (santé + logs) =====================

const tools = [
  {
    id: 'claude', name: 'Claude Code', icon: '🤖',
    health() {
      const issues = [];
      const sp = path.join(HOME, '.claude', 'settings.json');
      if (!fs.existsSync(sp)) issues.push('settings.json introuvable');
      else {
        try {
          const raw = fs.readFileSync(sp, 'utf8');
          JSON.parse(raw);
          if (/"(xhigh|max)"\s*:/.test(raw)) issues.push('effort xhigh/max détecté');
          if (/"ultracode"\s*:/.test(raw)) issues.push('clé invalide "ultracode"');
          if (/"unrestricted"/.test(raw)) issues.push('workflowSizeGuideline unrestricted');
        } catch { issues.push('settings.json JSON invalide'); }
      }
      const doc = run('claude doctor');
      if (!/No installation issues found/.test(doc)) issues.push('claude doctor signale un problème');
      return { status: issues.length ? 'warn' : 'ok', issues, running: processRunning('claude') };
    },
    capture() {
      const files = [];
      const sp = path.join(HOME, '.claude', 'settings.json');
      if (fs.existsSync(sp)) files.push({ label: 'settings.json', lines: fs.readFileSync(sp, 'utf8').split(/\r?\n/) });
      const hist = path.join(HOME, '.claude', 'history.jsonl');
      if (fs.existsSync(hist)) files.push({ label: 'history.jsonl (dernières lignes)', lines: tailFile(hist, 20) });
      files.push({ label: 'claude doctor', lines: run('claude doctor').split(/\r?\n/) });
      return files;
    }
  },
  {
    id: 'antigravity', name: 'Antigravity', icon: '🛰️',
    health() {
      const issues = [];
      const running = processRunning('Antigravity');
      if (!running) issues.push('processus non lancé');
      const main = path.join(APPDATA, 'Antigravity', 'logs', 'main.log');
      const errs = countErrors(tailFile(main, 100));
      if (errs > 0) issues.push(`${errs} erreur(s) dans main.log`);
      return { status: issues.length ? 'warn' : 'ok', issues, running };
    },
    capture() {
      const files = [];
      const logDir = path.join(APPDATA, 'Antigravity', 'logs');
      for (const f of ['main.log', 'language_server.log']) {
        const p = path.join(logDir, f);
        if (fs.existsSync(p)) files.push({ label: f, lines: tailFile(p, 80) });
      }
      return files;
    }
  },
  {
    id: 'copilot', name: 'GitHub Copilot', icon: '🐙',
    health() {
      const issues = [];
      const running = processRunning('Copilot');
      if (!running) issues.push('processus non lancé');
      const latest = latestFile(path.join(HOME, '.copilot', 'logs'), /github-app\.\d+\.log$/);
      if (latest) {
        const errs = countErrors(tailFile(latest, 200));
        if (errs > 0) issues.push(`${errs} erreur(s) dans le dernier log`);
      }
      return { status: issues.length ? 'warn' : 'ok', issues, running };
    },
    capture() {
      const files = [];
      const latest = latestFile(path.join(HOME, '.copilot', 'logs'), /github-app\.\d+\.log$/);
      if (latest) files.push({ label: path.basename(latest), lines: tailFile(latest, 80) });
      return files;
    }
  },
  {
    id: 'cursor', name: 'Cursor', icon: '🖱️',
    health() {
      const issues = [];
      const running = processRunning('Cursor');
      if (!running) issues.push('processus non lancé');
      const latestDir = latestFile(path.join(APPDATA, 'Cursor', 'logs'), /^\d+T\d+$/);
      if (latestDir) {
        const errs = countErrors(tailFile(path.join(latestDir, 'cli.log'), 200));
        if (errs > 0) issues.push(`${errs} erreur(s) dans cli.log`);
      }
      return { status: issues.length ? 'warn' : 'ok', issues, running };
    },
    capture() {
      const files = [];
      const latestDir = latestFile(path.join(APPDATA, 'Cursor', 'logs'), /^\d+T\d+$/);
      if (latestDir) {
        const cli = path.join(latestDir, 'cli.log');
        if (fs.existsSync(cli)) files.push({ label: 'cli.log', lines: tailFile(cli, 80) });
      }
      return files;
    }
  }
];

// ===================== DIAGNOSTICS (pi-style) =====================

const PATH_TOOLS = ['claude','node','npm','npx','git','python','py','pip','uv','uvx','code','cursor','docker','gh','pnpm','yarn','bun','go','cargo','rustc','java','mise','winget','scoop'];

const SKILL_DIRS = [
  { label: 'Claude Code', dir: path.join(HOME, '.claude', 'skills') },
  { label: 'GitHub Copilot', dir: path.join(HOME, '.copilot', 'skills') },
  { label: 'Cursor', dir: path.join(HOME, '.cursor', 'skills') },
  { label: 'Codex', dir: path.join(HOME, '.codex', 'skills') },
  { label: 'Agents', dir: path.join(HOME, '.agents', 'skills') },
  { label: 'Pi', dir: path.join(HOME, '.pi', 'skills') },
  { label: 'Antigravity', dir: path.join(HOME, '.gemini', 'antigravity', 'builtin', 'skills') },
  { label: 'Desktop Commander', dir: path.join(HOME, '.desktop-commander', 'skills') }
];

function checkPathAndConflicts() {
  const script = `
$tools = @(${PATH_TOOLS.map(t => `'${t}'`).join(',')});
$path = @(); $conflicts = @();
foreach ($n in $tools) {
  $all = @(Get-Command $n -All -ErrorAction SilentlyContinue);
  if ($all.Count -eq 0) { $path += [pscustomobject]@{ tool=$n; found=$false; path=$null } }
  else {
    $path += [pscustomobject]@{ tool=$n; found=$true; path=$all[0].Source };
    if ($all.Count -gt 1) { $conflicts += [pscustomobject]@{ tool=$n; count=$all.Count; paths=@($all | ForEach-Object { $_.Source }) } }
  }
}
[pscustomobject]@{ path=$path; conflicts=$conflicts } | ConvertTo-Json -Depth 5 -Compress`;
  return runJson(script) || { path: [], conflicts: [] };
}

function checkSkills() {
  return SKILL_DIRS.map(s => {
    const exists = fs.existsSync(s.dir);
    let names = [];
    if (exists) {
      try { names = fs.readdirSync(s.dir).filter(n => !n.startsWith('.')); } catch {}
    }
    return { label: s.label, dir: s.dir, exists, count: names.length, names };
  });
}

function checkUpdates() {
  const updates = [];
  const npmOut = runOut('npm outdated -g --json --silent', 30000).trim();
  try {
    const j = JSON.parse(npmOut);
    for (const [pkg, info] of Object.entries(j)) {
      updates.push({ manager: 'npm', name: pkg, current: info.current, latest: info.latest });
    }
  } catch {}
  const pipOut = runOut('pip list --outdated --format=json', 30000).trim();
  try {
    const j = JSON.parse(pipOut);
    for (const p of j) updates.push({ manager: 'pip', name: p.name, current: p.version, latest: p.latest_version });
  } catch {}
  const uvOut = runOut('uv tool list', 15000).trim();
  for (const l of uvOut.split(/\r?\n/)) {
    const m = l.match(/^(\S+)\s+(v?[\d.]+)/);
    if (m) updates.push({ manager: 'uv', name: m[1], current: m[2], latest: null });
  }
  return updates;
}

function diagnostics() {
  const pc = checkPathAndConflicts();
  return {
    path: pc.path,
    conflicts: pc.conflicts,
    skills: checkSkills(),
    updates: checkUpdates()
  };
}

// ===================== RÉSOLUTION DES OUTILS (façon pi dashboard) =====================

const TOOL_REGISTRY = [
  { name: 'node',         hint: 'winget install OpenJS.NodeJS.LTS' },
  { name: 'npm',          hint: 'inclus avec Node.js' },
  { name: 'npx',          hint: 'inclus avec Node.js' },
  { name: 'pnpm',         hint: 'npm i -g pnpm' },
  { name: 'yarn',         hint: 'npm i -g yarn' },
  { name: 'bun',          hint: 'winget install Oven-sh.Bun' },
  { name: 'git',          hint: 'winget install --id Git.Git -e' },
  { name: 'gh',           hint: 'winget install --id GitHub.cli -e' },
  { name: 'python',       hint: 'winget install Python.Python.3.13' },
  { name: 'pip',          hint: 'inclus avec Python' },
  { name: 'uv',           hint: 'winget install astral-sh.uv' },
  { name: 'go',           hint: 'winget install GoLang.Go' },
  { name: 'cargo',        hint: 'winget install Rustlang.Rustup' },
  { name: 'rustc',        hint: 'winget install Rustlang.Rustup' },
  { name: 'docker',       hint: 'winget install Docker.DockerDesktop' },
  { name: 'code',         hint: 'winget install Microsoft.VisualStudioCode' },
  { name: 'cursor',       hint: 'https://cursor.com/download' },
  { name: 'claude',       hint: 'npm i -g @anthropic-ai/claude-code' },
  { name: 'java',         hint: 'winget install Microsoft.OpenJDK.21' },
  { name: 'mise',         hint: 'winget install jdx.mise' },
  { name: 'winget',       hint: 'inclus avec Windows' },
  { name: 'scoop',        hint: 'irm get.scoop.sh | iex' },
  { name: 'zrok',         hint: 'winget install netfoundry.zrok' },
  { name: 'ngrok',        hint: 'winget install ngrok.ngrok' },
  { name: 'tailscale',    hint: 'winget install Tailscale.Tailscale' },
  { name: 'zerotier-cli', hint: 'winget install ZeroTier.ZeroTierOne' },
  { name: 'bash',         hint: 'inclus avec Git for Windows' },
  { name: 'powershell',   hint: 'inclus avec Windows' },
  { name: 'wt',           hint: 'winget install Microsoft.WindowsTerminal' },
  { name: 'tasklist',     hint: 'inclus avec Windows' },
  { name: 'taskkill',     hint: 'inclus avec Windows' }
];

// Classe un binaire selon son origine (mêmes libellés que le pi dashboard).
function classifyTool(p) {
  if (!p) return 'not found';
  const low = p.toLowerCase();
  if (low.includes('\\appdata\\local\\programs\\')) return 'managed';
  if (low.includes('\\appdata\\roaming\\npm\\')) return 'npm-global';
  if (low.includes('\\appdata\\local\\microsoft\\windowsapps\\')) return 'override';
  if (low.includes('\\windows\\system32') || low.includes('\\program files')) return 'system';
  return 'system';
}

function resolveTools() {
  const names = TOOL_REGISTRY.map(t => t.name);
  const script = `
$names = @(${names.map(n => `'${n}'`).join(',')});
$out = @();
foreach ($n in $names) {
  $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1;
  if ($c) { $out += [pscustomobject]@{ name=$n; path=$c.Source } }
  else { $out += [pscustomobject]@{ name=$n; path=$null } }
}
$out | ConvertTo-Json -Depth 3 -Compress`;
  const raw = runJson(script) || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const byName = {};
  for (const r of arr) byName[r.name] = r.path;
  return TOOL_REGISTRY.map(t => {
    const p = byName[t.name] || null;
    return { name: t.name, path: p, kind: classifyTool(p), ok: !!p, hint: t.hint };
  });
}

// ===================== PROJET (init + doctor) =====================

const GITIGNORE = `node_modules/
dist/
build/
__pycache__/
*.pyc
.env
.DS_Store
.vscode/
.idea/
`;

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project';
}

function readme(name, stackLabel) {
  return `# ${name}

Projet ${stackLabel} initialisé automatiquement.

## Démarrage

\`\`\`bash
# installer les dépendances
# lancer le serveur de dev
\`\`\`

## Structure

\`\`\`
src/          # code source
tests/        # tests
\`\`\`
`;
}

const STACKS = {
  node: {
    label: 'Node.js', icon: '🟢',
    detect: ['package.json'],
    manager: 'npm',
    commands: { install: 'npm install', run: 'npm run dev', test: 'npm test' },
    scaffold(name) {
      return {
        'package.json': JSON.stringify({
          name: slug(name), version: '1.0.0', description: '', type: 'module',
          main: 'src/index.js',
          scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js', test: 'node --test' }
        }, null, 2) + '\n',
        '.gitignore': GITIGNORE,
        'README.md': readme(name, 'Node.js'),
        'src/index.js': `// Point d'entrée du projet ${name}\nconsole.log('${name} démarré ✅');\n`
      };
    }
  },
  python: {
    label: 'Python', icon: '🐍',
    detect: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
    manager: 'pip',
    commands: { install: 'pip install -r requirements.txt', run: 'python main.py', test: 'pytest' },
    scaffold(name) {
      return {
        'requirements.txt': '# Dépendances du projet\n',
        '.gitignore': GITIGNORE,
        'README.md': readme(name, 'Python'),
        'main.py': `# Point d'entrée du projet ${name}\ndef main():\n    print("${name} démarré ✅")\n\nif __name__ == "__main__":\n    main()\n`
      };
    }
  },
  go: {
    label: 'Go', icon: '🐹',
    detect: ['go.mod'],
    manager: 'go',
    commands: { install: 'go mod tidy', run: 'go run .', test: 'go test ./...' },
    scaffold(name) {
      return {
        'go.mod': `module ${slug(name)}\n\ngo ${GO_VERSION}\n`,
        '.gitignore': GITIGNORE,
        'README.md': readme(name, 'Go'),
        'main.go': `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("${name} démarré ✅")\n}\n`
      };
    }
  },
  rust: {
    label: 'Rust', icon: '🦀',
    detect: ['Cargo.toml'],
    manager: 'cargo',
    commands: { install: 'cargo build', run: 'cargo run', test: 'cargo test' },
    scaffold(name) {
      return {
        'Cargo.toml': `[package]\nname = "${slug(name)}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`,
        '.gitignore': GITIGNORE + 'target/\n',
        'README.md': readme(name, 'Rust'),
        'src/main.rs': `fn main() {\n    println!("${name} démarré ✅");\n}\n`
      };
    }
  },
  static: {
    label: 'Site statique', icon: '🌐',
    detect: ['index.html'],
    manager: 'npx',
    commands: { install: 'npx serve', run: 'npx serve', test: null },
    scaffold(name) {
      return {
        'index.html': `<!DOCTYPE html>\n<html lang="fr">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>${name}</h1>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
        'style.css': `body { font-family: system-ui, sans-serif; margin: 2rem; }\n`,
        'script.js': `console.log('${name} démarré ✅');\n`,
        '.gitignore': GITIGNORE,
        'README.md': readme(name, 'Site statique')
      };
    }
  }
};

function detectStack(dir) {
  if (!fs.existsSync(dir)) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const [id, stack] of Object.entries(STACKS)) {
    if (stack.detect.some(f => entries.includes(f))) return { id, ...stack };
  }
  return null;
}

function initProject(dir, stackId) {
  const name = path.basename(dir);
  const stack = STACKS[stackId];
  if (!stack) return { error: `Stack inconnue: ${stackId}` };

  const created = [], skipped = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  } catch (e) {
    return { error: `Impossible de créer le dossier: ${e.message}` };
  }

  for (const [rel, content] of Object.entries(stack.scaffold(name))) {
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) { skipped.push(rel); continue; }
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      created.push(rel);
    } catch (e) {
      skipped.push(`${rel} (erreur: ${e.message})`);
    }
  }

  return {
    path: dir, name, stack: { id: stackId, label: stack.label, icon: stack.icon },
    created, skipped, commands: stack.commands, manager: stack.manager
  };
}

function doctorProject(dir) {
  const result = {
    path: dir,
    exists: fs.existsSync(dir),
    stack: null,
    files: [],
    conflicts: [],
    recommendations: []
  };
  if (!result.exists) return result;

  const stack = detectStack(dir);
  result.stack = stack ? { id: stack.id, label: stack.label, icon: stack.icon } : null;

  // Fichiers attendus
  const required = ['.gitignore', 'README.md'];
  if (stack) required.push(...stack.detect);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch {}
  for (const f of required) {
    result.files.push({ name: f, exists: entries.includes(f), required: true });
  }

  // Conflits : plusieurs manifests de stacks différentes
  const manifests = [];
  for (const [id, s] of Object.entries(STACKS)) {
    if (s.detect.some(f => entries.includes(f))) manifests.push(id);
  }
  if (manifests.length > 1) {
    result.conflicts.push({
      type: 'multi-stack',
      message: `Plusieurs stacks détectées: ${manifests.join(', ')}. Choisis-en une seule.`
    });
  }

  // Conflits : plusieurs lockfiles npm
  const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter(f => entries.includes(f));
  if (lockfiles.length > 1) {
    result.conflicts.push({
      type: 'multi-lockfile',
      message: `Plusieurs lockfiles: ${lockfiles.join(', ')}. Garde-en un seul.`
    });
  }

  // Recommandations
  if (!stack) {
    result.recommendations.push({
      type: 'no-stack',
      message: 'Aucune stack détectée. Initialise le projet pour créer la structure.',
      action: 'init'
    });
  } else {
    // Recommander le gestionnaire de paquets (basé sur ce qui est INSTALLÉ)
    if (stack.id === 'node') {
      const hasPnpm = toolInstalled('pnpm');
      const hasYarn = toolInstalled('yarn');
      if (hasPnpm && !entries.includes('pnpm-lock.yaml')) {
        result.recommendations.push({ type: 'manager', message: 'pnpm est installé — utilise `pnpm` plutôt que npm.', action: 'pnpm install' });
      } else if (hasYarn && !entries.includes('yarn.lock')) {
        result.recommendations.push({ type: 'manager', message: 'yarn est installé — utilise `yarn` plutôt que npm.', action: 'yarn install' });
      }
    }
    if (stack.id === 'python') {
      const hasUv = toolInstalled('uv');
      if (hasUv && !entries.includes('uv.lock')) {
        result.recommendations.push({ type: 'manager', message: 'uv est installé — utilise `uv` plutôt que pip.', action: 'uv sync' });
      }
    }
    // Manque de lockfile
    if (stack.id === 'node' && !lockfiles.length) {
      result.recommendations.push({ type: 'lockfile', message: 'Aucun lockfile — lance `npm install` pour le générer.', action: 'npm install' });
    }
    // Manque de .gitignore
    if (!entries.includes('.gitignore')) {
      result.recommendations.push({ type: 'gitignore', message: 'Pas de .gitignore — ajoute-le pour éviter de committer node_modules/.env.', action: 'init' });
    }
  }

  return result;
}

// ===================== GÉNÉRATEURS VISUELS =====================

const ENTRY = { node: 'src/index.js', python: 'main.py', go: 'main.go', rust: 'src/main.rs', static: 'index.html' };

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function mermaidSource(dir, stack) {
  const name = path.basename(dir);
  const label = stack ? stack.label : 'Projet';
  const entry = stack ? (ENTRY[stack.id] || '—') : '—';
  const cmds = stack ? stack.commands : {};
  const L = [];
  L.push('flowchart TD');
  L.push(`  ROOT["📁 ${name}"] --> STACK["${label}"]`);
  L.push('  STACK --> SRC["src/"]');
  L.push('  STACK --> TESTS["tests/"]');
  L.push(`  STACK --> ENTRY["${entry}"]`);
  const chain = [];
  if (cmds.install) chain.push(['INSTALL', cmds.install]);
  if (cmds.run) chain.push(['RUN', cmds.run]);
  if (cmds.test) chain.push(['TEST', cmds.test]);
  let prev = 'ENTRY';
  for (const [id, cmd] of chain) {
    L.push(`  ${prev} --> ${id}["${cmd}"]`);
    prev = id;
  }
  L.push('  classDef root fill:#1a1030,stroke:#a855f7,color:#e8e6f0;');
  L.push('  classDef stack fill:#2a1040,stroke:#c026d3,color:#e8e6f0;');
  L.push('  classDef step fill:#12101c,stroke:#3a3355,color:#c9c4dd;');
  L.push('  class ROOT root;');
  L.push('  class STACK stack;');
  L.push(`  class SRC,TESTS,ENTRY${chain.length ? ',' + chain.map(c => c[0]).join(',') : ''} step;`);
  return L.join('\n') + '\n';
}

function htmlShell(title, body, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
${extraHead}
<style>
  :root { --bg:#08070c; --panel:#12101c; --border:#241f38; --text:#e8e6f0; --muted:#8a86a3; --accent:#c026d3; --accent2:#a855f7; --ok:#22c55e; --warn:#f59e0b; --err:#ef4444; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,"Segoe UI",Roboto,sans-serif; padding:32px; line-height:1.5; }
  h1 { font-size:22px; margin-bottom:6px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:24px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px; }
  pre { font-family:Consolas,monospace; font-size:12px; color:var(--muted); white-space:pre-wrap; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function architectureHtml(dir, stack, mmd) {
  const safe = esc(mmd);
  const body = `
<h1>🏗️ Architecture — ${esc(path.basename(dir))}</h1>
<div class="sub">Généré par VibeDeck · ${new Date().toLocaleString('fr-CA')}</div>
<div class="card"><pre class="mermaid">${safe}</pre></div>
<div class="card" style="margin-top:16px">
  <div class="sub" style="margin:0 0 8px">Source mermaid (architecture.mmd)</div>
  <pre>${safe}</pre>
</div>`;
  const head = `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
window.addEventListener('DOMContentLoaded', () => {
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'dark', themeVariables: {
      primaryColor: '#1a1030', primaryTextColor: '#e8e6f0', primaryBorderColor: '#a855f7',
      lineColor: '#5a4a80', fontFamily: 'Segoe UI'
    }});
  }
});
</script>`;
  return htmlShell(`Architecture — ${path.basename(dir)}`, body, head);
}

function kanbanData(dir, stack, doc) {
  const todo = [], doing = [], done = [];
  for (const f of doc.files) (f.exists ? done : todo).push({ title: f.name, note: f.exists ? 'présent' : 'à créer' });
  for (const r of doc.recommendations) todo.push({ title: r.message, note: r.action || '' });
  if (stack) {
    if (stack.commands.install) todo.push({ title: 'Installer les dépendances', note: stack.commands.install });
    if (stack.commands.run) todo.push({ title: 'Lancer le projet', note: stack.commands.run });
    if (stack.commands.test) todo.push({ title: 'Lancer les tests', note: stack.commands.test });
  }
  return { todo, doing, done };
}

function kanbanHtml(dir, data) {
  const col = (title, items, cls) => `
    <div class="col">
      <div class="chead ${cls}"><span>${title}</span><span class="pill">${items.length}</span></div>
      ${items.length
        ? items.map(i => `<div class="kcard"><div class="kt">${esc(i.title)}</div>${i.note ? `<div class="kn">${esc(i.note)}</div>` : ''}</div>`).join('')
        : '<div class="empty">—</div>'}
    </div>`;
  const body = `
<h1>🗂️ Tableau — ${esc(path.basename(dir))}</h1>
<div class="sub">Généré par VibeDeck · ${new Date().toLocaleString('fr-CA')}</div>
<div class="board">
  ${col('À faire', data.todo, 'todo')}
  ${col('En cours', data.doing, 'doing')}
  ${col('Fait', data.done, 'done')}
</div>`;
  const head = `<style>
  .board { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .col { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:14px; }
  .chead { display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; padding-bottom:10px; margin-bottom:12px; border-bottom:1px solid var(--border); }
  .chead.todo { color:#f472b6; } .chead.doing { color:#22d3ee; } .chead.done { color:#22c55e; }
  .pill { background:rgba(255,255,255,.06); border-radius:20px; padding:1px 9px; font-size:11px; color:var(--muted); }
  .kcard { background:#0d0b14; border:1px solid var(--border); border-radius:9px; padding:11px 13px; margin-bottom:9px; }
  .kt { font-size:13px; }
  .kn { font-size:11px; color:var(--muted); font-family:Consolas,monospace; margin-top:5px; }
  .empty { color:var(--muted); font-size:12px; font-style:italic; }
  </style>`;
  return htmlShell(`Tableau — ${path.basename(dir)}`, body, head);
}

function visualsReadme(dir, stack) {
  return `# Visuels — ${path.basename(dir)}

Généré automatiquement par **VibeDeck**.

| Fichier | Rôle |
|---------|------|
| \`architecture.mmd\` | Source mermaid de l'architecture |
| \`architecture.html\` | Rendu de l'architecture (mermaid.js) |
| \`board.html\` | Tableau Kanban (À faire / En cours / Fait) |
| \`board.json\` | État des cartes (persisté) |

Stack détectée : **${stack ? stack.label : 'aucune'}**
`;
}

function generateVisuals(dir) {
  if (!fs.existsSync(dir)) return { error: 'Dossier introuvable' };
  const stack = detectStack(dir);
  const doc = doctorProject(dir);
  const docsDir = path.join(dir, 'docs');
  const created = [];
  try {
    fs.mkdirSync(docsDir, { recursive: true });
    const mmd = mermaidSource(dir, stack);
    const board = kanbanData(dir, stack, doc);
    const files = {
      'architecture.mmd': mmd,
      'architecture.html': architectureHtml(dir, stack, mmd),
      'board.json': JSON.stringify(board, null, 2) + '\n',
      'board.html': kanbanHtml(dir, board),
      'README.md': visualsReadme(dir, stack)
    };
    for (const [rel, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(docsDir, rel), content, 'utf8');
      created.push('docs/' + rel);
    }
  } catch (e) {
    return { error: e.message };
  }
  return {
    path: dir, docsDir, created,
    stack: stack ? { id: stack.id, label: stack.label, icon: stack.icon } : null
  };
}

// ===================== SERVEUR HTTP =====================

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/tools') {
    const result = tools.map(t => {
      const h = t.health();
      return { id: t.id, name: t.name, icon: t.icon, status: h.status, issues: h.issues, running: h.running };
    });
    return send(res, 200, result);
  }

  if (url.pathname === '/api/logs') {
    const id = url.searchParams.get('tool');
    const t = tools.find(x => x.id === id);
    if (!t) return send(res, 404, { error: 'tool not found' });
    const h = t.health();
    return send(res, 200, { id: t.id, name: t.name, status: h.status, issues: h.issues, files: t.capture() });
  }

  if (url.pathname === '/api/capture') {
    const result = tools.map(t => {
      const h = t.health();
      return { id: t.id, name: t.name, icon: t.icon, status: h.status, issues: h.issues, running: h.running, files: t.capture() };
    });
    return send(res, 200, result);
  }

  if (url.pathname === '/api/diagnostics') {
    return send(res, 200, diagnostics());
  }

  // ---- Projet ----

  if (url.pathname === '/api/project/detect') {
    const dir = url.searchParams.get('path') || '';
    const stack = detectStack(dir);
    return send(res, 200, { path: dir, stack: stack ? { id: stack.id, label: stack.label, icon: stack.icon } : null });
  }

  if (url.pathname === '/api/project/doctor') {
    const dir = url.searchParams.get('path') || '';
    return send(res, 200, doctorProject(dir));
  }

  if (url.pathname === '/api/project/init') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch {}
      const dir = payload.path || '';
      const stack = payload.stack || 'node';
      if (!dir) return send(res, 400, { error: 'Chemin manquant' });
      return send(res, 200, initProject(dir, stack));
    });
    return;
  }

  if (url.pathname === '/api/overview') {
    const pc = checkPathAndConflicts();
    const skills = checkSkills();
    const toolList = tools.map(t => {
      const h = t.health();
      return { id: t.id, name: t.name, icon: t.icon, status: h.status, issues: h.issues, running: h.running };
    });
    return send(res, 200, {
      tools: toolList,
      pathMissing: pc.path.filter(p => !p.found).length,
      pathTotal: pc.path.length,
      conflicts: pc.conflicts.length,
      skillsEmpty: skills.filter(s => !s.exists).length,
      skillsTotal: skills.length
    });
  }

  if (url.pathname === '/api/tools/registry') {
    return send(res, 200, resolveTools());
  }

  if (url.pathname === '/api/project/visuals') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch {}
      const dir = payload.path || '';
      if (!dir) return send(res, 400, { error: 'Chemin manquant' });
      return send(res, 200, generateVisuals(dir));
    });
    return;
  }

  // Sert un fichier généré dans <projet>/docs/ (les iframes ne peuvent pas charger file://)
  if (url.pathname === '/api/project/file') {
    const dir = url.searchParams.get('path') || '';
    const name = url.searchParams.get('name') || '';
    if (!dir || !name) { res.writeHead(400); return res.end('Bad request'); }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.writeHead(400); return res.end('Bad name'); }
    const docsDir = path.resolve(dir, 'docs');
    const target = path.resolve(docsDir, name);
    if (!target.startsWith(docsDir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    return fs.readFile(target, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(target);
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.mmd': 'text/plain; charset=utf-8',
        '.md': 'text/plain; charset=utf-8'
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
      res.end(data);
    });
  }

  // Fichiers statiques
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, 'public', filePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.mmd': 'text/plain; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard démarré : http://localhost:${PORT}`);
  console.log(`CDP (Chrome DevTools) : http://localhost:9222`);
});
