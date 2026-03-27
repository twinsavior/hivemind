const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const http = require('http');

let mainWindow;
let hivemindProcess = null;
const HIVEMIND_PORT = 4000;
const HIVEMIND_DIR = path.resolve(__dirname, '..');

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

function findNode() {
  // Try common node locations on macOS
  const candidates = [
    // nvm
    ...(() => {
      try {
        const nvmDir = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        return versions.map(v => path.join(nvmDir, v, 'bin', 'node'));
      } catch { return []; }
    })(),
    // fnm
    ...(() => {
      try {
        const fnmDir = path.join(process.env.HOME || '', 'Library', 'Application Support', 'fnm', 'node-versions');
        const versions = fs.readdirSync(fnmDir).sort().reverse();
        return versions.map(v => path.join(fnmDir, v, 'installation', 'bin', 'node'));
      } catch { return []; }
    })(),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* skip */ }
  }

  // Last resort: try to find it via shell
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    return execSync(`${shell} -lc 'which node'`, { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch { return 'node'; }
}

function startHivemindServer() {
  return new Promise((resolve, reject) => {
    const tsxCli = path.join(HIVEMIND_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const cliPath = path.join(HIVEMIND_DIR, 'src', 'cli', 'index.ts');
    const nodeBin = findNode();

    // Run tsx directly via node to avoid shebang/PATH issues in macOS GUI apps.
    // Use arch -arm64 to prevent Rosetta from forcing x86_64 on universal node binary.
    console.log('[HIVEMIND] Starting server: arch -arm64', nodeBin, tsxCli, cliPath);

    hivemindProcess = spawn('/usr/bin/arch', ['-arm64', nodeBin, tsxCli, cliPath, 'up'], {
      cwd: HIVEMIND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-log', text);
      }
      // Also check stderr for the dashboard message (some loggers write to stderr)
      if (!started && text.includes('Dashboard running')) {
        started = true;
        resolve();
      }
    });

    hivemindProcess.on('error', (err) => {
      console.error('[HIVEMIND process error]', err.message);
      if (!started) reject(err);
    });

    hivemindProcess.on('exit', (code) => {
      console.error('[HIVEMIND process exit] code:', code);
      hivemindProcess = null;
      if (!started) {
        reject(new Error(`Server exited with code ${code}`));
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

    // Timeout: if server doesn't start in 30s, resolve anyway and let UI show error
    setTimeout(() => {
      if (!started) {
        started = true;
        resolve();
      }
    }, 30000);
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

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

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

let activeWorkDir = HIVEMIND_DIR;
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
    }
  }

  // Ensure page is loaded before sending the ready signal
  await pageReady;
  mainWindow.webContents.send('server-status', 'ready');
});

app.on('window-all-closed', () => {
  // Kill our spawned process
  if (hivemindProcess) {
    hivemindProcess.kill('SIGTERM');
    hivemindProcess = null;
  }
  // Force kill anything on the port to prevent zombies on next launch
  try {
    execSync(`lsof -ti :${HIVEMIND_PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
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
    execSync(`lsof -ti :${HIVEMIND_PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
  } catch { /* ignore */ }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
