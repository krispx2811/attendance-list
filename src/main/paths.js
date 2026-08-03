'use strict';

/**
 * Filesystem locations.
 *
 * The database lives in a `data` folder beside the application so everything
 * to do with attendance sits in one place you can see, copy or back up by
 * hand. Where that folder is not writable — Program Files, a locked-down
 * share — we fall back to the per-user data directory rather than failing.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ENV_DATA_DIR = 'ATTENDANCE_DATA_DIR';

let resolved = null;

/** Folder the app runs from: next to the .exe when packaged, repo root in dev. */
function appDir(app) {
  if (app && app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return path.resolve(__dirname, '..', '..');
}

function userDataDir(app) {
  if (app) return app.getPath('userData');
  return path.join(os.homedir(), '.attendance-list');
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function dataDir(app) {
  const override = process.env[ENV_DATA_DIR];
  if (override) return path.resolve(override);

  if (resolved) return resolved;

  const beside = path.join(appDir(app), 'data');
  resolved = isWritable(beside) ? beside : path.join(userDataDir(app), 'data');
  return resolved;
}

const dbPath = (app) => path.join(dataDir(app), 'attendance.db');
const backupDir = (app) => path.join(dataDir(app), 'backups');

function ensureDirs(app) {
  fs.mkdirSync(dataDir(app), { recursive: true });
  fs.mkdirSync(backupDir(app), { recursive: true });
}

/** True when the app folder was read-only and we fell back. */
function usingFallback(app) {
  return dataDir(app) !== path.join(appDir(app), 'data');
}

/** Reset the memoised location. Tests only. */
function _reset() {
  resolved = null;
}

module.exports = {
  ENV_DATA_DIR,
  appDir,
  userDataDir,
  dataDir,
  dbPath,
  backupDir,
  ensureDirs,
  usingFallback,
  _reset,
};
