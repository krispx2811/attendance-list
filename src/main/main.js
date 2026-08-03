'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, shell, nativeTheme } = require('electron');

const paths = require('./paths');
const db = require('./db');
const registerIpc = require('./ipc');
const { setupUpdater } = require('./updater');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0e11' : '#ffffff',
    // A hidden title bar with an overlay keeps the native window controls
    // while letting the app own the whole surface.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? false
        : {
            color: '#00000000',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#f4f4f5' : '#3f3f46',
            height: 44,
          },
    trafficLightPosition: { x: 16, y: 15 },
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Show only once painted, so there is no white flash on launch.
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // In development, surface renderer errors in the terminal — otherwise a
  // thrown exception in the UI just leaves a blank pane with no clue why.
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`);
    });
  }

  // External links open in the real browser, never inside the app frame.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
    if (process.platform !== 'darwin') {
      mainWindow.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f4f4f5' : '#3f3f46',
        height: 44,
      });
    }
  });

  return mainWindow;
}

/** Move a database left by the Python build into the current data folder. */
function adoptLegacyDatabase() {
  try {
    const target = paths.dbPath(app);
    if (fs.existsSync(target) || process.env[paths.ENV_DATA_DIR]) return;

    const candidates = [
      path.join(app.getPath('appData'), 'AttendanceList', 'attendance.db'),
      path.join(app.getPath('home'), 'Library', 'Application Support', 'AttendanceList', 'attendance.db'),
    ];
    const legacy = candidates.find((p) => fs.existsSync(p));
    if (!legacy) return;

    paths.ensureDirs(app);
    fs.copyFileSync(legacy, target);
    fs.renameSync(legacy, legacy + '.migrated');
  } catch {
    // Never let a migration problem stop the app from opening.
  }
}

app.whenReady().then(async () => {
  try {
    paths.ensureDirs(app);
    adoptLegacyDatabase();
    db.connect(app);
    db.seedDefaultPeople();
    await db.backupIfStale();
  } catch (error) {
    dialog.showErrorBox(
      'Attendance List — could not open your data',
      `${error.message}\n\nData folder: ${paths.dataDir(app)}`
    );
    app.quit();
    return;
  }

  registerIpc({ app, getWindow: () => mainWindow });
  createWindow();
  setupUpdater(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  db.close();
});
