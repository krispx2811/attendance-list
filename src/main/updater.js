'use strict';

/**
 * Auto-update via GitHub Releases.
 *
 * electron-updater handles the download and the swap-on-restart, which on
 * Windows is the fiddly part: a running executable cannot overwrite itself.
 *
 * Every failure path here is deliberately quiet. Being offline, rate-limited
 * or behind a proxy must never interrupt someone recording attendance.
 */

const { app, ipcMain } = require('electron');

const RELEASES_PAGE = 'https://github.com/krispx2811/attendance-list/releases';

let pending = null;

function setupUpdater(getWindow) {
  // Required lazily: electron-updater builds its updater the moment this
  // property is read, and that constructor needs `app` to already exist.
  const { autoUpdater } = require('electron-updater');

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    pending = info;
    send('update:available', {
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      current: app.getVersion(),
    });
  });

  autoUpdater.on('update-not-available', () => send('update:none', { current: app.getVersion() }));

  autoUpdater.on('download-progress', (progress) =>
    send('update:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  );

  autoUpdater.on('update-downloaded', () => send('update:ready', { version: pending?.version }));

  autoUpdater.on('error', (error) =>
    send('update:error', { message: error?.message || 'Update check failed' })
  );

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { ok: true, data: { skipped: 'Updates only apply to the installed app.' } };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, data: { checked: true } };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('update:install', () => {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true, data: true };
  });

  ipcMain.handle('update:page', () => ({ ok: true, data: RELEASES_PAGE }));

  // Check shortly after launch so startup is never blocked on the network.
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  }
}

module.exports = { setupUpdater, RELEASES_PAGE };
