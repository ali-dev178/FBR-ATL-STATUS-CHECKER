const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { generatePreview } = require('./engine/detect');
const { AutomationEngine } = require('./engine/AutomationEngine');

let mainWindow = null;
let engine = null;
let captchaResolve = null;
let updateInterval = null;
let latestProgress = null;
let recentLogs = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
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
  if (engine) await engine.destroy().catch(() => {});
  if (updateInterval) clearInterval(updateInterval);
  app.quit();
});

// ─── IPC: File Picker ──────────────────────────────────────────────────────

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Input Excel File',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ─── IPC: Preview ──────────────────────────────────────────────────────────

ipcMain.handle('preview-file', async (_, filePath) => {
  try {
    return await generatePreview(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

// ─── IPC: Start Processing ─────────────────────────────────────────────────

ipcMain.on('start', async (_, options) => {
  if (engine) await engine.destroy().catch(() => {});

  const outputFile = options.filePath.replace(/\.xlsx$/i, '_results.xlsx');

  engine = new AutomationEngine({
    inputFile: options.filePath,
    outputFile,
    headless: options.headless,
    cnicCol: options.cnicCol,
    atlCol: options.atlCol,
  });

  recentLogs = [];
  latestProgress = null;

  // Listen to engine events
  engine.on('progress', (data) => {
    latestProgress = data;
  });

  engine.on('log', (data) => {
    recentLogs.push(data);
    // Keep only last 50 logs
    if (recentLogs.length > 50) recentLogs.shift();
  });

  engine.on('row-start', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update', {
        eventType: 'row-start',
        srNo: data.srNo,
        buyerName: data.buyerName,
        cnicNtn: data.cnicNtn,
        lookupType: data.type,
        progress: latestProgress,
      });
    }
  });

  engine.on('row-complete', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update', {
        eventType: 'row-complete',
        srNo: data.srNo,
        cnicNtn: data.cnicNtn,
        status: data.status,
        cached: data.cached,
        progress: latestProgress,
      });
    }
  });

  engine.on('captcha-manual', (data) => {
    captchaResolve = data.resolve;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('captcha-required', { imageBase64: data.imageBase64 });
    }
  });

  engine.on('done', (data) => {
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('processing-done', data);
    }
  });

  engine.on('error', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', data);
    }
  });

  // Batched updates every 2 seconds
  updateInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && latestProgress) {
      const logs = recentLogs.splice(0, recentLogs.length);
      mainWindow.webContents.send('update', {
        eventType: 'tick',
        progress: latestProgress,
        logs,
      });
    }
  }, 2000);

  engine.start();
});

// ─── IPC: Controls ─────────────────────────────────────────────────────────

ipcMain.on('pause', () => { if (engine) engine.pause(); });
ipcMain.on('resume', () => { if (engine) engine.resume(); });
ipcMain.on('stop', async () => {
  if (engine) {
    engine.stop();
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
  }
});

ipcMain.on('show-browser', async () => { if (engine) await engine.showBrowser(); });

ipcMain.on('captcha-response', (_, text) => {
  if (captchaResolve) {
    captchaResolve(text);
    captchaResolve = null;
  }
});

ipcMain.on('retry-na', async () => { if (engine) engine.retryNARows(); });

ipcMain.on('open-output', () => {
  if (engine && engine.outputFile) {
    shell.openPath(engine.outputFile);
  }
});

ipcMain.on('new-file', async () => {
  if (engine) await engine.destroy().catch(() => {});
  engine = null;
  if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
});
