const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Point Playwright to the bundled Chromium inside the packaged app
if (app.isPackaged) {
  const browsersPath = path.join(process.resourcesPath, 'browsers');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

  // Find the chromium-XXXX directory dynamically and set the exact exe path
  try {
    const dirs = fs.readdirSync(browsersPath).filter(d => d.startsWith('chromium-'));
    if (dirs.length > 0) {
      process.env.PLAYWRIGHT_CHROMIUM_PATH = path.join(
        browsersPath, dirs[0], 'chrome-win64', 'chrome.exe'
      );
    }
  } catch (e) {
    console.error('Failed to locate bundled Chromium:', e.message);
  }
}
const { generatePreview } = require('./engine/detect');
const { AutomationEngine } = require('./engine/AutomationEngine');
const { SharedResources } = require('./engine/SharedResources');

let mainWindow = null;

// ─── State Persistence ──────────────────────────────────────────
function getStateFilePath() {
  return path.join(app.getPath('userData'), 'tab-state.json');
}

function saveState(state) {
  try {
    fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

function loadState() {
  try {
    const filePath = getStateFilePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const state = JSON.parse(raw);
    // Basic validation
    if (!state || !Array.isArray(state.tabs)) return null;
    return state;
  } catch (err) {
    console.error('Failed to load state:', err.message);
    return null;
  }
}

const sharedResources = new SharedResources();
const tabs = new Map(); // tabId -> { engine, captchaResolve, updateInterval, latestProgress, recentLogs }
let nextTabId = 1;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'FBR ATL Status Checker',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  for (const [tabId, tab] of tabs) {
    if (tab.engine) await tab.engine.destroy().catch(() => {});
    if (tab.updateInterval) clearInterval(tab.updateInterval);
  }
  tabs.clear();
  await sharedResources.destroy().catch(() => {});
  app.quit();
});

// ─── IPC: Tab Management ──────────────────────────────────────────

ipcMain.handle('create-tab', () => {
  const tabId = nextTabId++;
  tabs.set(tabId, {
    engine: null,
    captchaResolve: null,
    updateInterval: null,
    latestProgress: null,
    recentLogs: [],
  });
  return tabId;
});

ipcMain.on('close-tab', async (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (tab.engine) {
    tab.engine.stop();
    await tab.engine.destroy().catch(() => {});
  }
  if (tab.updateInterval) clearInterval(tab.updateInterval);
  tabs.delete(tabId);
});

// ─── IPC: File Picker ─────────────────────────────────────────────

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Input Excel File',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Output Directory',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ─── IPC: Preview ─────────────────────────────────────────────────

ipcMain.handle('preview-file', async (_, filePath) => {
  try {
    return await generatePreview(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

// ─── IPC: State Persistence ──────────────────────────────────────

ipcMain.on('save-state', (_, state) => {
  saveState(state);
});

ipcMain.handle('load-state', () => {
  return loadState();
});

// ─── Engine Listener Setup ────────────────────────────────────────

function setupEngineListeners(tabId, tab) {
  const engine = tab.engine;

  engine.on('progress', (data) => {
    tab.latestProgress = data;
  });

  engine.on('log', (data) => {
    tab.recentLogs.push(data);
    if (tab.recentLogs.length > 50) tab.recentLogs.shift();
  });

  engine.on('row-start', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update', {
        tabId,
        eventType: 'row-start',
        srNo: data.srNo,
        buyerName: data.buyerName,
        cnicNtn: data.cnicNtn,
        lookupType: data.type,
        progress: tab.latestProgress,
      });
    }
  });

  engine.on('row-complete', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update', {
        tabId,
        eventType: 'row-complete',
        srNo: data.srNo,
        cnicNtn: data.cnicNtn,
        status: data.status,
        cached: data.cached,
        progress: tab.latestProgress,
      });
    }
  });

  engine.on('captcha-manual', (data) => {
    tab.captchaResolve = data.resolve;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('captcha-required', { tabId, imageBase64: data.imageBase64 });
    }
  });

  engine.on('done', (data) => {
    if (tab.updateInterval) { clearInterval(tab.updateInterval); tab.updateInterval = null; }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('processing-done', { tabId, ...data });
    }
  });

  engine.on('error', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', { tabId, ...data });
    }
  });

  // Batched updates every 2 seconds
  tab.updateInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && tab.latestProgress) {
      const logs = tab.recentLogs.splice(0, tab.recentLogs.length);
      mainWindow.webContents.send('update', {
        tabId,
        eventType: 'tick',
        progress: tab.latestProgress,
        logs,
      });
    }
  }, 2000);
}

// ─── IPC: Start Processing ────────────────────────────────────────

ipcMain.on('start', async (_, { tabId, ...options }) => {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (tab.engine) await tab.engine.destroy().catch(() => {});

  tab.engine = new AutomationEngine({
    tabId,
    sharedResources,
    inputFile: options.filePath,
    outputFile: options.outputFile,
    headless: options.headless,
    cnicCol: options.cnicCol,
    atlCol: options.atlCol,
  });

  tab.recentLogs = [];
  tab.latestProgress = null;

  setupEngineListeners(tabId, tab);
  tab.engine.start();
});

// ─── IPC: Controls ────────────────────────────────────────────────

ipcMain.on('pause', (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (tab && tab.engine) tab.engine.pause();
});

ipcMain.on('resume', (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (tab && tab.engine) tab.engine.resume();
});

ipcMain.on('stop', async (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (tab && tab.engine) {
    tab.engine.stop();
    if (tab.updateInterval) { clearInterval(tab.updateInterval); tab.updateInterval = null; }
  }
});

ipcMain.on('show-browser', async () => {
  // Find headless engines that need switching
  const headlessEngines = [];
  for (const [tid, t] of tabs) {
    const mode = sharedResources.tabModes.get(tid);
    if (t.engine && t.engine.page && !t.engine.stopped && mode === 'headless') {
      headlessEngines.push({ tabId: tid, tab: t, wasPaused: t.engine.paused });
    }
  }

  if (headlessEngines.length === 0) return;

  // Pause headless engines and wait for them to ACTUALLY reach the pause point (no timeout)
  const pausePromises = [];
  for (const { tab: t, wasPaused } of headlessEngines) {
    if (!wasPaused) {
      const pausePromise = new Promise(resolve => {
        t.engine.once('actually-paused', resolve);
      });
      t.engine.pause();
      pausePromises.push(pausePromise);
    }
  }

  if (pausePromises.length > 0) await Promise.all(pausePromises);

  // Now all headless engines are safely paused between rows — switch them
  const switched = await sharedResources.switchAllToVisible();

  // Update page refs and resume
  for (const [tid, page] of switched) {
    const t = tabs.get(tid);
    if (t && t.engine) t.engine.page = page;
  }

  for (const { tab: t, wasPaused } of headlessEngines) {
    if (!wasPaused && t.engine && !t.engine.stopped) {
      t.engine.resume();
    }
  }
});

ipcMain.on('captcha-response', (_, { tabId, text }) => {
  const tab = tabs.get(tabId);
  if (tab && tab.captchaResolve) {
    tab.captchaResolve(text);
    tab.captchaResolve = null;
  }
});

ipcMain.on('retry-na', async (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (!tab || !tab.engine) return;

  tab.recentLogs = [];
  tab.latestProgress = null;

  // Re-setup the update interval (old one was cleared on done)
  if (tab.updateInterval) clearInterval(tab.updateInterval);
  tab.updateInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && tab.latestProgress) {
      const logs = tab.recentLogs.splice(0, tab.recentLogs.length);
      mainWindow.webContents.send('update', { tabId, eventType: 'tick', progress: tab.latestProgress, logs });
    }
  }, 2000);

  tab.engine.retryNARows();
});

ipcMain.on('open-output', (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (tab && tab.engine && tab.engine.outputFile) {
    shell.openPath(tab.engine.outputFile);
  }
});

ipcMain.on('new-file', async (_, { tabId }) => {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (tab.engine) await tab.engine.destroy().catch(() => {});
  tab.engine = null;
  if (tab.updateInterval) { clearInterval(tab.updateInterval); tab.updateInterval = null; }
});
