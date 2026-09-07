'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, shell, nativeTheme } = require('electron');

const paths = require('./paths');
const db = require('./db');
const settings = require('./settings');
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

/**
 * Carry an existing database into the current data folder.
 *
 * Versions up to 2.1.0 kept the database beside the .exe, which the Windows
 * uninstaller deletes during an update. Anyone whose data is still there —
 * or in the folder the Python build used — gets it moved somewhere safe the
 * first time this version runs.
 *
 * The whole folder is copied, not just the .db, so the daily backups come
 * along too. The original is left where it is: if anything about this goes
 * wrong, the records are still in the old place.
 */
function adoptExistingData() {
  try {
    const target = paths.dbPath(app);
    if (fs.existsSync(target) || process.env[paths.ENV_DATA_DIR]) return;

    for (const dir of paths.legacyDataDirs(app)) {
      const candidate = fs.existsSync(path.join(dir, 'attendance.db'))
        ? dir
        : fs.existsSync(path.join(dir, 'data', 'attendance.db'))
          ? path.join(dir, 'data')
          : null;
      if (!candidate) continue;

      paths.ensureDirs(app);
      fs.cpSync(candidate, path.dirname(target), { recursive: true, force: false });
      log(`Adopted existing data from ${candidate}`);
      return;
    }
  } catch (error) {
    // Never let this stop the app opening: worst case it starts empty and
    // the old folder is still there to restore from by hand.
    log(`Could not adopt existing data: ${error.message}`);
  }
}

function log(message) {
  if (!app.isPackaged) console.log(`[attendance] ${message}`);
}

app.whenReady().then(async () => {
  try {
    paths.ensureDirs(app);
    adoptExistingData();
    db.connect(app);
    db.seedDefaultPeople();
    nativeTheme.themeSource = settings.load(app).theme;
    await db.backupIfDue();
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
