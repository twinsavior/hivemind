const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const http = require('http');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let hivemindProcess = null;
let serverErrors = []; // Collect errors for user-facing dialog
const HIVEMIND_PORT = Number(process.env.HIVEMIND_DASHBOARD_PORT) || 4000;
const HIVEMIND_DIR = path.resolve(__dirname, '..');
const HIVEMIND_HOME = path.join(os.homedir(), '.hivemind');

// ── Check if HIVEMIND server is already running ──────────────────────────────

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${HIVEMIND_PORT}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

// ── Start HIVEMIND server in background ──────────────────────────────────────

async function findNode() {
  // Try common node locations on macOS
  const candidates = [];

  // nvm
  try {
    const nvmDir = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
    const versions = await fs.promises.readdir(nvmDir).catch(() => []);
    versions.sort().reverse();
    for (const v of versions) candidates.push(path.join(nvmDir, v, 'bin', 'node'));
  } catch { /* skip */ }

  // fnm
  try {
    const fnmDir = path.join(process.env.HOME || '', 'Library', 'Application Support', 'fnm', 'node-versions');
    const versions = await fs.promises.readdir(fnmDir).catch(() => []);
    versions.sort().reverse();
    for (const v of versions) candidates.push(path.join(fnmDir, v, 'installation', 'bin', 'node'));
  } catch { /* skip */ }

  candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node');

  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate);
      return candidate;
    } catch { /* skip */ }
  }

  // Last resort: try to find it via shell
  try {
    const shellBin = process.env.SHELL || '/bin/zsh';
    const { stdout } = await execAsync(`${shellBin} -lc 'which node'`, { timeout: 5000 });
    return stdout.trim() || null;
  } catch { return null; }
}

async function showErrorDialog(title, message) {
  await dialog.showMessageBox({
    type: 'error',
    title: title,
    message: message,
    buttons: ['OK'],
  });
}

async function setupPackagedEnvironment() {
  // Create ~/.hivemind/ directory structure
  const dirs = [HIVEMIND_HOME, path.join(HIVEMIND_HOME, 'data'), path.join(HIVEMIND_HOME, 'skills')];
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
  }

  // Auto-create hivemind.yaml if missing
  const configPath = path.join(HIVEMIND_HOME, 'hivemind.yaml');
  try {
    await fs.promises.access(configPath);
  } catch {
    const defaultConfig = `name: "hivemind"
version: "1.0.0"

llm:
  primary:
    provider: claude-code
    model: claude-code
    maxTokens: 16000

agents:
  coordinator:
    id: nova-1
    name: Nova
    role: coordinator
  scout:
    id: scout-1
    name: Scout Alpha
    role: research
  builder:
    id: builder-1
    name: Builder Prime
    role: code
  sentinel:
    id: sentinel-1
    name: Sentinel Watch
    role: monitor
  oracle:
    id: oracle-1
    name: Oracle Insight
    role: analysis
  courier:
    id: courier-1
    name: Courier Express
    role: communications
`;
    await fs.promises.writeFile(configPath, defaultConfig);
    console.log('[HIVEMIND] Created default config at', configPath);
  }

  // Copy bundled skills to ~/.hivemind/skills/ if they don't exist there yet
  const bundledSkillsDir = path.join(process.resourcesPath, 'skills');
  const userSkillsDir = path.join(HIVEMIND_HOME, 'skills');
  try {
    await fs.promises.access(bundledSkillsDir);
    const bundledSkills = await fs.promises.readdir(bundledSkillsDir);
    for (const skill of bundledSkills) {
      const src = path.join(bundledSkillsDir, skill);
      const dest = path.join(userSkillsDir, skill);
      try {
        await fs.promises.access(dest);
      } catch {
        const stat = await fs.promises.stat(src);
        if (stat.isDirectory()) {
          await copyDirAsync(src, dest);
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[HIVEMIND] Failed to copy bundled skills:', e.message);
  }

  return configPath;
}

async function copyDirAsync(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirAsync(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Ensure native Node modules (better-sqlite3) match the user's Node version.
 * The app bundles modules built for Node 22 (CI), but the user may have a
 * different version. On first launch (or after Node upgrade), rebuild once.
 */
async function ensureNativeModules(nodeBin, nodeModulesDir) {
  const markerFile = path.join(HIVEMIND_HOME, '.native-module-version');
  let currentNodeVersion = '';
  try {
    const { stdout } = await execAsync(`"${nodeBin}" --version`, { timeout: 5000 });
    currentNodeVersion = stdout.trim(); // e.g. "v23.1.0"
  } catch { return; } // Can't detect — skip, let it fail naturally

  // Check if we already rebuilt for this Node version
  try {
    const marker = await fs.promises.readFile(markerFile, 'utf-8');
    if (marker.trim() === currentNodeVersion) return; // Already matching
  } catch { /* no marker yet — need to rebuild */ }

  console.log(`[HIVEMIND] Rebuilding native modules for ${currentNodeVersion}...`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-status', 'rebuilding');
  }

  try {
    const npmBin = path.join(path.dirname(nodeBin), 'npm');
    const rebuildCmd = `"${npmBin}" rebuild better-sqlite3 --prefix "${nodeModulesDir}/.."`;
    await execAsync(rebuildCmd, { timeout: 60000, cwd: nodeModulesDir });
    await fs.promises.writeFile(markerFile, currentNodeVersion);
    console.log(`[HIVEMIND] Native modules rebuilt for ${currentNodeVersion}`);
  } catch (err) {
    console.error('[HIVEMIND] Native module rebuild failed:', err.message);
    // Try npx as fallback (npm might not be co-located with node)
    try {
      await execAsync(`npx --yes node-gyp rebuild --directory="${path.join(nodeModulesDir, 'better-sqlite3')}"`, {
        timeout: 90000,
        env: { ...process.env, npm_config_nodedir: '' },
      });
      await fs.promises.writeFile(markerFile, currentNodeVersion);
      console.log(`[HIVEMIND] Native modules rebuilt via npx for ${currentNodeVersion}`);
    } catch (e2) {
      console.error('[HIVEMIND] npx rebuild also failed:', e2.message);
      // Continue anyway — the server will surface the error with a clear message
    }
  }
}

async function startHivemindServer() {
  return new Promise(async (resolve, reject) => {
    serverErrors = [];

    // ── Validate Node.js ──
    const nodeBin = await findNode();
    if (!nodeBin) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Node.js Required',
        message: 'HIVEMIND needs Node.js to run.\n\nClick "Download" to open the Node.js installer (no terminal needed), then restart HIVEMIND.',
        buttons: ['Download Node.js', 'Cancel'],
        defaultId: 0,
      });
      if (response === 0) {
        shell.openExternal('https://nodejs.org/');
      }
      reject(new Error('Node.js not found'));
      return;
    }

    let spawnCmd, spawnArgs, cwd;

    if (app.isPackaged) {
      // ── Validate bundle ──
      const serverDir = path.join(process.resourcesPath, 'server');
      const cliPath = path.join(serverDir, 'cli', 'index.js');
      const nodeModulesDir = path.join(process.resourcesPath, 'node_modules');

      try { await fs.promises.access(cliPath); } catch {
        const msg = `Server files are missing from the app bundle.\n\nExpected: ${cliPath}\n\nPlease reinstall HIVEMIND.`;
        await showErrorDialog('Corrupted Installation', msg);
        reject(new Error(msg));
        return;
      }

      try { await fs.promises.access(nodeModulesDir); } catch {
        const msg = `Server dependencies are missing from the app bundle.\n\nExpected: ${nodeModulesDir}\n\nPlease reinstall HIVEMIND.`;
        await showErrorDialog('Corrupted Installation', msg);
        reject(new Error(msg));
        return;
      }

      // Setup ~/.hivemind/ environment
      const configPath = await setupPackagedEnvironment();
      cwd = HIVEMIND_HOME;

      // Rebuild native modules if Node version changed since last build
      await ensureNativeModules(nodeBin, nodeModulesDir);

      if (process.platform === 'darwin') {
        spawnCmd = '/usr/bin/arch';
        spawnArgs = ['-arm64', nodeBin, cliPath, 'up', '--config', configPath];
      } else {
        spawnCmd = nodeBin;
        spawnArgs = [cliPath, 'up', '--config', configPath];
      }

      console.log('[HIVEMIND] Starting packaged server:', spawnCmd, spawnArgs.join(' '));
    } else {
      // Dev mode: run TypeScript source via tsx
      const tsxCli = path.join(HIVEMIND_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const cliPath = path.join(HIVEMIND_DIR, 'src', 'cli', 'index.ts');
      cwd = HIVEMIND_DIR;

      if (process.platform === 'darwin') {
        spawnCmd = '/usr/bin/arch';
        spawnArgs = ['-arm64', nodeBin, tsxCli, cliPath, 'up'];
      } else {
        spawnCmd = nodeBin;
        spawnArgs = [tsxCli, cliPath, 'up'];
      }

      console.log('[HIVEMIND] Starting dev server:', spawnCmd, spawnArgs.join(' '));
    }

    const spawnEnv = { ...process.env, FORCE_COLOR: '0' };
    if (app.isPackaged) {
      spawnEnv.NODE_PATH = path.join(process.resourcesPath, 'node_modules');
      // Tell the server where bundled dependencies live (for Claude Code CLI discovery)
      spawnEnv.HIVEMIND_RESOURCES_PATH = process.resourcesPath;
    }

    hivemindProcess = spawn(spawnCmd, spawnArgs, {
      cwd: cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
      detached: false,
    });

    let started = false;

    hivemindProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-log', text);
      }
      if (!started && text.includes('Dashboard running')) {
        started = true;
        resolve();
      }
    });

    hivemindProcess.stderr.on('data', (data) => {
      const text = data.toString();
      console.error('[HIVEMIND stderr]', text);
      serverErrors.push(text);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-log', text);
      }
      if (!started && text.includes('Dashboard running')) {
        started = true;
        resolve();
      }
    });

    hivemindProcess.on('error', (err) => {
      console.error('[HIVEMIND process error]', err.message);
      serverErrors.push(err.message);
      if (!started) {
        showErrorDialog('Server Failed to Start', `HIVEMIND server could not start:\n\n${err.message}`);
        reject(err);
      }
    });

    hivemindProcess.on('exit', (code) => {
      console.error('[HIVEMIND process exit] code:', code);
      hivemindProcess = null;
      if (!started) {
        const errorSummary = serverErrors.slice(-5).join('\n').slice(0, 500);
        const msg = `Server exited with code ${code}.\n\n${errorSummary || 'No error details available.'}\n\nMake sure Node.js 22+ and Claude Code CLI are installed.`;
        showErrorDialog('Server Failed to Start', msg);
        reject(new Error(msg));
      } else {
        // Auto-restart if the server crashes after it was already running
        console.log('[HIVEMIND] Server died unexpectedly, restarting in 2 seconds...');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('server-status', 'restarting');
        }
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            console.log('[HIVEMIND] Restarting server...');
            startHivemindServer()
              .then(() => {
                console.log('[HIVEMIND] Server restarted successfully');
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('server-status', 'ready');
                }
              })
              .catch((err) => {
                console.error('[HIVEMIND] Server restart failed:', err.message);
              });
          }
        }, 2000);
      }
    });

    // Timeout: if server doesn't start in 60s, show error
    setTimeout(() => {
      if (!started) {
        started = true;
        const errorSummary = serverErrors.slice(-3).join('\n').slice(0, 300);
        console.error('[HIVEMIND] Server startup timed out after 60s');
        if (errorSummary) {
          console.error('[HIVEMIND] Last errors:', errorSummary);
        }
        // Resolve anyway so the UI loads — it will show "server offline" state
        resolve();
      }
    }, 60000);
  });
}

// ── Create the main window ───────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { port: String(HIVEMIND_PORT) },
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Auto-update ──────────────────────────────────────────────────────────────

function sendUpdateStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', data);
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    console.log('[HIVEMIND] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[HIVEMIND] Update available:', info.version);
    sendUpdateStatus({ event: 'update-available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[HIVEMIND] App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      event: 'update-progress',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[HIVEMIND] Update downloaded:', info.version);
    sendUpdateStatus({ event: 'update-downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    // Swallow update errors — don't bother the user
    console.log('[HIVEMIND] Update error:', err.message);
  });
}

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('check-for-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { version: result?.updateInfo?.version || null };
  } catch (err) {
    return { error: err.message };
  }
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('send-task', async (_event, { description, agentId }) => {
  try {
    const body = JSON.stringify({ description, agentId: agentId || undefined });
    return await httpPost(`http://localhost:${HIVEMIND_PORT}/api/tasks`, body);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-agents', async () => {
  try {
    return await httpGet(`http://localhost:${HIVEMIND_PORT}/api/agents`);
  } catch (err) {
    return { agents: [], error: err.message };
  }
});

ipcMain.handle('get-health', async () => {
  try {
    return await httpGet(`http://localhost:${HIVEMIND_PORT}/api/health`);
  } catch (err) {
    return { status: 'offline', error: err.message };
  }
});

ipcMain.handle('get-metrics', async () => {
  try {
    return await httpGet(`http://localhost:${HIVEMIND_PORT}/api/metrics`);
  } catch (err) {
    return { error: err.message };
  }
});

// ── Folder / Repo Picker ──────────────────────────────────────────────────

let activeWorkDir = app.isPackaged ? (process.env.HOME || process.env.USERPROFILE || HIVEMIND_DIR) : HIVEMIND_DIR;
const recentFolders = [];
const RECENT_FILE = path.join(app.getPath('userData'), 'recent-folders.json');

function loadRecentFolders() {
  try {
    const data = fs.readFileSync(RECENT_FILE, 'utf-8');
    const items = JSON.parse(data);
    recentFolders.length = 0;
    recentFolders.push(...items.slice(0, 10));
  } catch { /* no file yet */ }
}

function saveRecentFolders() {
  try {
    fs.mkdirSync(path.dirname(RECENT_FILE), { recursive: true });
    fs.writeFileSync(RECENT_FILE, JSON.stringify(recentFolders, null, 2));
  } catch { /* ignore */ }
}

function addToRecent(folderPath) {
  // Remove if already exists, then add to front
  const idx = recentFolders.findIndex(f => f.path === folderPath);
  if (idx >= 0) recentFolders.splice(idx, 1);

  // Detect git info
  let gitRepo = null;
  let gitBranch = null;
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: folderPath, timeout: 3000 }).toString().trim();
    const remote = execSync('git remote get-url origin', { cwd: folderPath, timeout: 3000 }).toString().trim();
    gitBranch = execSync('git branch --show-current', { cwd: folderPath, timeout: 3000 }).toString().trim();
    // Extract repo name from remote URL
    const match = remote.match(/[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
    gitRepo = match ? match[1] : path.basename(gitRoot);
  } catch { /* not a git repo */ }

  recentFolders.unshift({
    path: folderPath,
    name: path.basename(folderPath),
    gitRepo,
    gitBranch,
    lastUsed: Date.now(),
  });
  if (recentFolders.length > 10) recentFolders.pop();
  saveRecentFolders();
}

ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select project folder',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  addToRecent(folderPath);
  activeWorkDir = folderPath;
  // Notify server of workdir change
  try {
    await httpPost(`http://localhost:${HIVEMIND_PORT}/api/workdir`, JSON.stringify({ path: folderPath }));
  } catch { /* ignore */ }
  return { path: folderPath, recent: recentFolders };
});

ipcMain.handle('set-folder', async (_event, folderPath) => {
  addToRecent(folderPath);
  activeWorkDir = folderPath;
  try {
    await httpPost(`http://localhost:${HIVEMIND_PORT}/api/workdir`, JSON.stringify({ path: folderPath }));
  } catch { /* ignore */ }
  return { path: folderPath, recent: recentFolders };
});

ipcMain.handle('get-recent-folders', () => {
  loadRecentFolders();
  return { folders: recentFolders, active: activeWorkDir };
});

ipcMain.handle('get-active-folder', () => {
  return { path: activeWorkDir, name: path.basename(activeWorkDir) };
});

// ── Image / File Attachments ──────────────────────────────────────────────

const ATTACHMENTS_DIR = path.join(app.getPath('temp'), 'hivemind-attachments');

ipcMain.handle('save-attachment', async (_event, { name, base64Data }) => {
  try {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    // Generate unique filename
    const ext = path.extname(name) || '.png';
    const safeName = `attach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`;
    const filePath = path.join(ATTACHMENTS_DIR, safeName);
    // base64Data might have a data URI prefix
    const raw = base64Data.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(raw, 'base64'));
    return { path: filePath, name: safeName };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('browse-images', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    title: 'Attach images',
  });
  if (result.canceled) return [];
  return result.filePaths.map(p => ({ path: p, name: path.basename(p) }));
});

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 600000,  // 10 minutes — tool-using tasks can take a while
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  loadRecentFolders();
  // Ensure the hivemind project folder is in recents on first launch
  if (recentFolders.length === 0) {
    addToRecent(HIVEMIND_DIR);
  }
  createWindow();

  // Wait for the renderer to finish loading before sending IPC messages
  const pageReady = new Promise((resolve) => {
    mainWindow.webContents.once('did-finish-load', resolve);
  });

  // Check if server is already running
  const running = await checkServer();
  if (running) {
    console.log('[HIVEMIND] Server already running on port', HIVEMIND_PORT);
  } else {
    // Start fresh
    try {
      await startHivemindServer();
      console.log('[HIVEMIND] Server started successfully');
    } catch (err) {
      console.error('[HIVEMIND] Failed to start server:', err.message);
      // Error dialog already shown by startHivemindServer
    }
  }

  // Ensure page is loaded before sending the ready signal
  await pageReady;
  mainWindow.webContents.send('server-status', 'ready');

  // Auto-update (only in packaged builds)
  if (app.isPackaged) {
    setupAutoUpdater();
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[HIVEMIND] Update check failed:', err.message);
    });

    // Check every 4 hours
    setInterval(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.log('[HIVEMIND] Periodic update check failed:', err.message);
      });
    }, 4 * 60 * 60 * 1000);
  }
});

app.on('window-all-closed', () => {
  // Kill our spawned process
  if (hivemindProcess) {
    hivemindProcess.kill('SIGTERM');
    hivemindProcess = null;
  }
  // Force kill anything on the port to prevent zombies on next launch
  try {
    if (process.platform === 'win32') {
      execSync(`netstat -ano | findstr :${HIVEMIND_PORT} | findstr LISTENING > nul && for /f "tokens=5" %a in ('netstat -ano ^| findstr :${HIVEMIND_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`, { timeout: 3000 });
    } else {
      execSync(`lsof -ti :${HIVEMIND_PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
    }
  } catch { /* ignore */ }
  app.quit();
});

// Also handle before-quit for edge cases (Cmd+Q, dock quit)
app.on('before-quit', () => {
  if (hivemindProcess) {
    hivemindProcess.kill('SIGKILL');
    hivemindProcess = null;
  }
  try {
    if (process.platform === 'win32') {
      execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${HIVEMIND_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`, { timeout: 3000 });
    } else {
      execSync(`lsof -ti :${HIVEMIND_PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
    }
  } catch { /* ignore */ }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
