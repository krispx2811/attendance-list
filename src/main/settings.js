'use strict';

/**
 * User settings.
 *
 * A small JSON file beside the database. Kept deliberately separate from the
 * database so that restoring a backup replaces the records without also
 * dragging back whatever preferences were in force the day it was taken.
 *
 * Every read is defensive: a corrupt or hand-edited file must leave the app
 * working on defaults rather than refusing to start.
 */

const fs = require('node:fs');
const path = require('node:path');

const paths = require('./paths');

const BACKUP_FREQUENCIES = ['launch', 'daily', 'off'];

const MIN_KEEP = 1;
const MAX_KEEP = 365;

function defaults(app) {
  return {
    backupDir: paths.defaultBackupDir(app),
    backupFrequency: 'daily',
    backupsToKeep: 14,
    theme: 'system',
    autoCheckUpdates: true,
  };
}

let cache = null;
let appRef = null;

const settingsFile = (app) => path.join(paths.dataDir(app), 'settings.json');

/** Clamp and sanity-check whatever is on disk against the defaults. */
function coerce(raw, app) {
  const base = defaults(app);
  const value = raw && typeof raw === 'object' ? raw : {};

  const keep = Number(value.backupsToKeep);
  const dir = typeof value.backupDir === 'string' ? value.backupDir.trim() : '';

  return {
    backupDir: dir || base.backupDir,
    backupFrequency: BACKUP_FREQUENCIES.includes(value.backupFrequency)
      ? value.backupFrequency
      : base.backupFrequency,
    backupsToKeep: Number.isFinite(keep)
      ? Math.min(MAX_KEEP, Math.max(MIN_KEEP, Math.round(keep)))
      : base.backupsToKeep,
    theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : base.theme,
    autoCheckUpdates: value.autoCheckUpdates !== false,
  };
}

function load(app) {
  appRef = app || appRef;
  if (cache) return cache;

  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile(appRef), 'utf8'));
  } catch {
    /* missing or unreadable — defaults are the right answer */
  }

  cache = coerce(raw, appRef);
  return cache;
}

/**
 * Merge changes in and write them out.
 *
 * Returns the settings as they ended up, which is not always what was asked
 * for: an out-of-range value is clamped rather than rejected, so the caller
 * needs the result to show what actually took effect.
 */
function save(patch, app) {
  appRef = app || appRef;
  const merged = coerce({ ...load(appRef), ...(patch || {}) }, appRef);

  const file = settingsFile(appRef);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');

  cache = merged;
  return merged;
}

/** Forget the cached copy. Tests, and after the data folder moves. */
function _reset() {
  cache = null;
  appRef = null;
}

module.exports = {
  BACKUP_FREQUENCIES,
  MIN_KEEP,
  MAX_KEEP,
  defaults,
  load,
  save,
  settingsFile,
  _reset,
};
