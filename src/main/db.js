'use strict';

/**
 * SQLite storage.
 *
 * The schema is byte-identical to the one the Python build used, so an
 * existing attendance.db opens unchanged and no one loses history in the
 * move to Electron.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const paths = require('./paths');

const SCHEMA_VERSION = 1;

const STATUS_PRESENT = 'Present';
const STATUS_LATE = 'Late';
const STATUS_ABSENT = 'Absent';
const STATUSES = [STATUS_PRESENT, STATUS_LATE, STATUS_ABSENT];

/** Statuses for which a reason is meaningful. */
const REASON_STATUSES = [STATUS_ABSENT, STATUS_LATE];

const KIND_ROSTER = 'roster';
const KIND_WALKIN = 'walkin';

const BACKUPS_TO_KEEP = 14;

/**
 * Employees a brand-new database starts with, so a fresh install is ready to
 * use immediately. Names are stored exactly as written — capitalisation of a
 * person's own name is not ours to correct.
 */
const DEFAULT_EMPLOYEES = [
  'Kareem',
  'Hana',
  'Marwa',
  'Sara ahmed al balushi',
  'Sara al balushi',
  'Ibad',
  'Khuloud',
  'Laila',
  'Ruqiaya',
  'Jihad',
  'Hamood',
  'Mohammad',
  'Fatma',
];

let db = null;
let appRef = null;

// ---------------------------------------------------------------------------
// connection / schema
// ---------------------------------------------------------------------------

function connect(app, explicitFile) {
  if (db) return db;
  appRef = app || appRef;

  const file = explicitFile || paths.dbPath(appRef);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  migrate();
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function migrate() {
  const current = db.pragma('user_version', { simple: true });

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        kind       TEXT NOT NULL DEFAULT 'roster',
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id          INTEGER PRIMARY KEY,
        person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        date        TEXT NOT NULL,
        status      TEXT NOT NULL,
        reason      TEXT NOT NULL DEFAULT '',
        recorded_at TEXT NOT NULL,
        UNIQUE(person_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
      CREATE INDEX IF NOT EXISTS idx_attendance_person ON attendance(person_id);
    `);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

const now = () => new Date().toISOString().slice(0, 19);
const todayStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

/**
 * Add a person and return their id.
 *
 * An existing name is reused and reactivated, which is what someone means
 * when they re-add a person they had removed.
 */
function addPerson(rawName, kind = KIND_ROSTER) {
  const name = String(rawName || '').trim();
  if (!name) throw new Error('Name cannot be empty.');

  const existing = db
    .prepare('SELECT id, active FROM people WHERE name = ? COLLATE NOCASE')
    .get(name);

  if (existing) {
    if (!existing.active) {
      db.prepare('UPDATE people SET active = 1 WHERE id = ?').run(existing.id);
    }
    return existing.id;
  }

  const info = db
    .prepare('INSERT INTO people (name, kind, active, created_at) VALUES (?, ?, 1, ?)')
    .run(name, kind, now());
  return info.lastInsertRowid;
}

function renamePerson(personId, rawName) {
  const name = String(rawName || '').trim();
  if (!name) throw new Error('Name cannot be empty.');

  const clash = db
    .prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, personId);
  if (clash) throw new Error(`Another person is already named "${name}".`);

  db.prepare('UPDATE people SET name = ? WHERE id = ?').run(name, personId);
}

/** Soft delete / restore. History is always preserved. */
function setPersonActive(personId, active) {
  db.prepare('UPDATE people SET active = ? WHERE id = ?').run(active ? 1 : 0, personId);
}

function promoteToRoster(personId) {
  db.prepare('UPDATE people SET kind = ? WHERE id = ?').run(KIND_ROSTER, personId);
}

/** Permanently remove a person and their attendance records. */
function deletePerson(personId) {
  db.prepare('DELETE FROM people WHERE id = ?').run(personId);
}

function attendanceCount(personId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM attendance WHERE person_id = ?')
    .get(personId).n;
}

function listPeople({ includeInactive = false, kind = null } = {}) {
  let sql = 'SELECT * FROM people WHERE 1=1';
  const args = [];
  if (!includeInactive) sql += ' AND active = 1';
  if (kind) {
    sql += ' AND kind = ?';
    args.push(kind);
  }
  sql += ' ORDER BY name COLLATE NOCASE';
  return db.prepare(sql).all(...args);
}

function getPerson(personId) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
}

/**
 * Fill a brand-new database with DEFAULT_EMPLOYEES.
 *
 * Only ever runs when there are no people at all. Any looser condition would
 * resurrect names the user had deliberately removed.
 */
function seedDefaultPeople() {
  if (db.prepare('SELECT COUNT(*) AS n FROM people').get().n) return 0;
  let added = 0;
  for (const name of DEFAULT_EMPLOYEES) {
    try {
      addPerson(name, KIND_ROSTER);
      added += 1;
    } catch {
      /* skip anything unusable */
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

/**
 * Record a status for a person on a date, replacing any prior entry.
 *
 * The UNIQUE(person_id, date) constraint plus ON CONFLICT is what makes
 * re-marking someone update their row instead of duplicating it.
 */
function mark(personId, day, status, reason = '') {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  const text = REASON_STATUSES.includes(status) ? String(reason || '').trim() : '';

  db.prepare(
    `INSERT INTO attendance (person_id, date, status, reason, recorded_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(person_id, date) DO UPDATE SET
       status      = excluded.status,
       reason      = excluded.reason,
       recorded_at = excluded.recorded_at`
  ).run(personId, day, status, text, now());
}

function markMany(personIds, day, status) {
  const run = db.transaction((ids) => {
    for (const id of ids) mark(id, day, status, '');
  });
  run(personIds);
}

function unmark(personId, day) {
  db.prepare('DELETE FROM attendance WHERE person_id = ? AND date = ?').run(personId, day);
}

/**
 * Everyone relevant to a date, with their status if one was recorded.
 *
 * All active roster members, plus anyone else (guest or since deactivated)
 * who actually has a record that day — so past days render as they were saved.
 */
function getDay(day) {
  return db
    .prepare(
      `SELECT p.id          AS person_id,
              p.name        AS name,
              p.kind        AS kind,
              p.active      AS active,
              a.status      AS status,
              a.reason      AS reason,
              a.recorded_at AS recorded_at
       FROM people p
       LEFT JOIN attendance a ON a.person_id = p.id AND a.date = ?
       WHERE (p.active = 1 AND p.kind = ?) OR a.id IS NOT NULL
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(day, KIND_ROSTER);
}

function daySummary(day) {
  const rows = getDay(day);
  const summary = { Present: 0, Late: 0, Absent: 0, Unrecorded: 0, Total: rows.length };
  for (const row of rows) {
    if (row.status && summary[row.status] !== undefined) summary[row.status] += 1;
    else summary.Unrecorded += 1;
  }
  return summary;
}

function search({ nameQuery = '', start = null, end = null, status = null } = {}) {
  let sql = `
    SELECT a.id, a.date, a.status, a.reason, a.recorded_at,
           p.id AS person_id, p.name AS name, p.kind AS kind
    FROM attendance a
    JOIN people p ON p.id = a.person_id
    WHERE 1=1`;
  const args = [];

  if (String(nameQuery).trim()) {
    sql += ' AND p.name LIKE ? COLLATE NOCASE';
    args.push(`%${String(nameQuery).trim()}%`);
  }
  if (start) {
    sql += ' AND a.date >= ?';
    args.push(start);
  }
  if (end) {
    sql += ' AND a.date <= ?';
    args.push(end);
  }
  if (status) {
    sql += ' AND a.status = ?';
    args.push(status);
  }
  sql += ' ORDER BY a.date DESC, p.name COLLATE NOCASE';
  return db.prepare(sql).all(...args);
}

function personHistory(personId) {
  return db
    .prepare(
      `SELECT a.date, a.status, a.reason, a.recorded_at
       FROM attendance a WHERE a.person_id = ? ORDER BY a.date DESC`
    )
    .all(personId);
}

/** Previously used reasons, most frequent first, for the suggestion list. */
function knownReasons(limit = 25) {
  return db
    .prepare(
      `SELECT reason, COUNT(*) AS n FROM attendance
       WHERE reason != ''
       GROUP BY reason COLLATE NOCASE
       ORDER BY n DESC, reason COLLATE NOCASE
       LIMIT ?`
    )
    .all(limit)
    .map((r) => r.reason);
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

/**
 * Per-person totals over an optional date range.
 *
 * The rate counts Present and Late as attended: someone who showed up late
 * did show up. Absences are listed separately because that is the figure
 * that actually matters.
 */
function perPersonStats(start = null, end = null) {
  const conditions = [];
  const args = [];
  if (start) {
    conditions.push('a.date >= ?');
    args.push(start);
  }
  if (end) {
    conditions.push('a.date <= ?');
    args.push(end);
  }

  // Filter inside the join so people with no rows in range still appear.
  const join =
    'LEFT JOIN attendance a ON a.person_id = p.id' +
    (conditions.length ? ' AND ' + conditions.join(' AND ') : '');

  return db
    .prepare(
      `SELECT p.id AS person_id, p.name AS name, p.kind AS kind, p.active AS active,
              COUNT(a.id) AS recorded,
              SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN a.status = 'Late'    THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN a.status = 'Absent'  THEN 1 ELSE 0 END) AS absent
       FROM people p
       ${join}
       GROUP BY p.id
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(...args);
}

function reasonStats(start = null, end = null, limit = 20) {
  let sql = "SELECT reason, COUNT(*) AS n FROM attendance WHERE reason != ''";
  const args = [];
  if (start) {
    sql += ' AND date >= ?';
    args.push(start);
  }
  if (end) {
    sql += ' AND date <= ?';
    args.push(end);
  }
  sql += ' GROUP BY reason COLLATE NOCASE ORDER BY n DESC, reason COLLATE NOCASE LIMIT ?';
  args.push(limit);
  return db.prepare(sql).all(...args);
}

function overallStats() {
  return {
    people: db.prepare('SELECT COUNT(*) AS n FROM people WHERE active = 1').get().n,
    records: db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,
    days: db.prepare('SELECT COUNT(DISTINCT date) AS n FROM attendance').get().n,
    firstDate: db.prepare('SELECT MIN(date) AS d FROM attendance').get().d,
    lastDate: db.prepare('SELECT MAX(date) AS d FROM attendance').get().d,
  };
}

// ---------------------------------------------------------------------------
// backups
// ---------------------------------------------------------------------------

/**
 * Write a consistent copy into the backups folder.
 *
 * Uses SQLite's online backup rather than a file copy: the database runs in
 * WAL mode, so copying only the .db would drop commits still in the sidecar.
 */
async function backupNow() {
  const dir = paths.backupDir(appRef);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `attendance-${todayStr()}.db`);
  await db.backup(target);
  pruneBackups(dir);
  return target;
}

function pruneBackups(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('attendance-') && f.endsWith('.db'))
    .sort();
  for (const stale of files.slice(0, -BACKUPS_TO_KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, stale));
    } catch {
      /* a failed prune must never break startup */
    }
  }
}

/** Back up at most once a day, on startup. */
async function backupIfStale() {
  const target = path.join(paths.backupDir(appRef), `attendance-${todayStr()}.db`);
  if (fs.existsSync(target)) return null;
  try {
    return await backupNow();
  } catch {
    return null;
  }
}

async function exportDatabaseCopy(destination) {
  await db.backup(destination);
  return destination;
}

module.exports = {
  STATUS_PRESENT,
  STATUS_LATE,
  STATUS_ABSENT,
  STATUSES,
  REASON_STATUSES,
  KIND_ROSTER,
  KIND_WALKIN,
  DEFAULT_EMPLOYEES,
  connect,
  close,
  todayStr,
  addPerson,
  renamePerson,
  setPersonActive,
  promoteToRoster,
  deletePerson,
  attendanceCount,
  listPeople,
  getPerson,
  seedDefaultPeople,
  mark,
  markMany,
  unmark,
  getDay,
  daySummary,
  search,
  personHistory,
  knownReasons,
  perPersonStats,
  reasonStats,
  overallStats,
  backupNow,
  backupIfStale,
  exportDatabaseCopy,
};
