'use strict';

/**
 * IPC surface.
 *
 * The renderer has no Node access at all; every capability it has is one of
 * the named channels below. Each handler validates its own arguments rather
 * than trusting the renderer.
 */

const path = require('node:path');
const { ipcMain, dialog, shell, nativeTheme } = require('electron');

const db = require('./db');
const paths = require('./paths');
const exporter = require('./exporter');

function registerIpc({ app, getWindow }) {
  const win = () => getWindow();

  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });

  // -- meta ---------------------------------------------------------------
  // Read the version from our own package.json: app.getVersion() reports
  // Electron's version when running unpackaged.
  const appVersion = app.isPackaged
    ? app.getVersion()
    : require('../../package.json').version;

  handle('app:info', () => ({
    version: appVersion,
    dataDir: paths.dataDir(app),
    usingFallback: paths.usingFallback(app),
    platform: process.platform,
    dark: nativeTheme.shouldUseDarkColors,
    today: db.todayStr(),
  }));

  handle('app:openDataFolder', () => {
    shell.openPath(paths.dataDir(app));
    return true;
  });

  handle('app:setTheme', (mode) => {
    if (!['system', 'light', 'dark'].includes(mode)) throw new Error('Unknown theme');
    nativeTheme.themeSource = mode;
    return nativeTheme.shouldUseDarkColors;
  });

  // -- people -------------------------------------------------------------
  handle('people:list', (opts) => db.listPeople(opts || {}));
  handle('people:add', (name, kind) => db.addPerson(name, kind || db.KIND_ROSTER));
  handle('people:addMany', (names) => {
    if (!Array.isArray(names)) throw new Error('Expected a list of names');
    let added = 0;
    for (const name of names) {
      try {
        db.addPerson(name, db.KIND_ROSTER);
        added += 1;
      } catch {
        /* skip unusable entries, report the rest */
      }
    }
    return added;
  });
  handle('people:rename', (id, name) => db.renamePerson(id, name));
  handle('people:setActive', (id, active) => db.setPersonActive(id, active));
  handle('people:promote', (id) => db.promoteToRoster(id));
  handle('people:delete', (id) => db.deletePerson(id));
  handle('people:count', (id) => db.attendanceCount(id));

  // -- attendance ---------------------------------------------------------
  handle('day:get', (day) => ({
    rows: db.getDay(day),
    summary: db.daySummary(day),
    reasons: db.knownReasons(),
  }));
  handle('day:mark', (id, day, status, reason) => db.mark(id, day, status, reason));
  handle('day:markAllPresent', (day) => {
    const pending = db.getDay(day).filter((r) => !r.status).map((r) => r.person_id);
    db.markMany(pending, day, db.STATUS_PRESENT);
    return pending.length;
  });
  handle('day:unmark', (id, day) => db.unmark(id, day));
  handle('day:clear', (day) => {
    let cleared = 0;
    for (const row of db.getDay(day)) {
      if (row.status) {
        db.unmark(row.person_id, day);
        cleared += 1;
      }
    }
    return cleared;
  });

  // -- history / reports --------------------------------------------------
  handle('history:search', (filters) => db.search(filters || {}));
  handle('history:person', (id) => ({
    person: db.getPerson(id),
    rows: db.personHistory(id),
  }));
  handle('reports:load', (start, end) => ({
    stats: db.perPersonStats(start, end),
    reasons: db.reasonStats(start, end),
    overall: db.overallStats(),
    rows: db.search({ start, end }),
  }));

  // -- exports ------------------------------------------------------------
  const askSave = async (defaultName, filters) => {
    const result = await dialog.showSaveDialog(win(), {
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters,
    });
    return result.canceled ? null : result.filePath;
  };

  handle('export:csv', async (rows, defaultName) => {
    const target = await askSave(defaultName || 'attendance.csv', [
      { name: 'CSV file', extensions: ['csv'] },
    ]);
    if (!target) return null;
    exporter.exportCsv(rows, target);
    return target;
  });

  handle('export:xlsx', async (rows, defaultName) => {
    const target = await askSave(defaultName || 'attendance.xlsx', [
      { name: 'Excel workbook', extensions: ['xlsx'] },
    ]);
    if (!target) return null;
    await exporter.exportXlsx(rows, target);
    return target;
  });

  handle('export:report', async (rows, stats, reasons) => {
    const target = await askSave('attendance-report.xlsx', [
      { name: 'Excel workbook', extensions: ['xlsx'] },
    ]);
    if (!target) return null;
    await exporter.exportSummaryXlsx(rows, stats, reasons, target);
    return target;
  });

  handle('export:database', async () => {
    const target = await askSave(`attendance-${db.todayStr()}.db`, [
      { name: 'Database file', extensions: ['db'] },
    ]);
    if (!target) return null;
    await db.exportDatabaseCopy(target);
    return target;
  });

  handle('backup:now', () => db.backupNow());

  handle('shell:showItem', (filePath) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  // -- confirmations ------------------------------------------------------
  handle('dialog:confirm', async ({ title, message, detail, confirmLabel, danger }) => {
    const result = await dialog.showMessageBox(win(), {
      type: danger ? 'warning' : 'question',
      buttons: [confirmLabel || 'Confirm', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: title || 'Confirm',
      message: message || '',
      detail: detail || '',
      noLink: true,
    });
    return result.response === 0;
  });
}

module.exports = registerIpc;
