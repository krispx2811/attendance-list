'use strict';

/**
 * Filesystem locations.
 *
 * The database lives in the per-user application data folder. It used to sit
 * in a `data` folder beside the .exe, which was easier to find but fatally
 * fragile: the Windows uninstaller deletes the whole installation directory
 * during an update, so every update destroyed the history and the backups
 * with it. Application data survives an update by design.
 *
 * The portable build is the exception. It has no installer, nothing ever
 * uninstalls it, and keeping its data beside the .exe is the entire point —
 * copy the folder and your records travel with it.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ENV_DATA_DIR = 'ATTENDANCE_DATA_DIR';

/**
 * Folder name under %APPDATA%.
 *
 * Spelled out rather than taken from app.getName(), because the NSIS
 * installer writes to this same path while rescuing data from an older
 * version and the two must agree exactly. A rename here is a rename in
 * `build/installer.nsh` too.
 */
const APP_FOLDER = 'attendance-list';

/** Set by the portable build to the folder the .exe was run from. */
const ENV_PORTABLE_DIR = 'PORTABLE_EXECUTABLE_DIR';

let resolved = null;

/** Folder the app runs from: next to the .exe when packaged, repo root in dev. */
function appDir(app) {
  if (app && app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return path.resolve(__dirname, '..', '..');
}

/** Roaming application data — %APPDATA% on Windows. */
function userDataDir(app) {
  if (app) return path.join(app.getPath('appData'), APP_FOLDER);
  return path.join(os.homedir(), `.${APP_FOLDER}`);
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

/** Where a portable build keeps its data, or null when this is not one. */
function portableDir() {
  const beside = process.env[ENV_PORTABLE_DIR];
  return beside ? path.join(path.resolve(beside), 'data') : null;
}

function dataDir(app) {
  const override = process.env[ENV_DATA_DIR];
  if (override) return path.resolve(override);

  if (resolved) return resolved;

  const portable = portableDir();
  if (portable && isWritable(portable)) {
    resolved = portable;
    return resolved;
  }

  const preferred = path.join(userDataDir(app), 'data');
  resolved = isWritable(preferred) ? preferred : path.join(appDir(app), 'data');
  return resolved;
}

/**
 * Where earlier versions kept the database, newest arrangement first.
 *
 * Read on startup so that an existing installation carries its history into
 * the new location instead of opening to an empty list.
 */
function legacyDataDirs(app) {
  const dirs = [path.join(appDir(app), 'data')];
  if (app) {
    dirs.push(path.join(app.getPath('appData'), 'AttendanceList'));
    dirs.push(path.join(app.getPath('userData'), 'data'));
  }
  const current = dataDir(app);
  return dirs.filter((dir) => path.resolve(dir) !== path.resolve(current));
}

const dbPath = (app) => path.join(dataDir(app), 'attendance.db');

/** Default backup folder: somewhere the person can actually find it. */
function defaultBackupDir(app) {
  if (app) {
    try {
      return path.join(app.getPath('documents'), 'Attendance List', 'Backups');
    } catch {
      /* no Documents folder — fall through */
    }
  }
  return path.join(dataDir(app), 'backups');
}

function ensureDirs(app) {
  fs.mkdirSync(dataDir(app), { recursive: true });
}

/** True when the location was set deliberately, e.g. a shared network folder. */
const isCustom = () => Boolean(process.env[ENV_DATA_DIR]);

/**
 * True when the preferred location was not writable and we fell back.
 *
 * A deliberately configured folder is not a fallback, however unusual it
 * looks — warning about someone's own choice trains them to ignore warnings.
 */
function usingFallback(app) {
  if (isCustom()) return false;
  const preferred = portableDir() || path.join(userDataDir(app), 'data');
  return path.resolve(dataDir(app)) !== path.resolve(preferred);
}

/** True when this is the portable build. */
const isPortable = () => Boolean(portableDir());

/** Reset the memoised location. Tests only. */
function _reset() {
  resolved = null;
}

module.exports = {
  ENV_DATA_DIR,
  ENV_PORTABLE_DIR,
  APP_FOLDER,
  appDir,
  userDataDir,
  dataDir,
  dbPath,
  defaultBackupDir,
  legacyDataDirs,
  ensureDirs,
  usingFallback,
  isCustom,
  isPortable,
  _reset,
};
