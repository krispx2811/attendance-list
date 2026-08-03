'use strict';

/* Storage and export tests. No Electron, no GUI — plain `npm test`. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Fresh module registry + temp data dir per test, so nothing leaks between. */
function withDb(fn) {
  return async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-test-'));
    process.env.ATTENDANCE_DATA_DIR = dir;

    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(ROOT, 'src'))) delete require.cache[key];
    }
    const paths = require(path.join(ROOT, 'src/main/paths'));
    paths._reset();
    const db = require(path.join(ROOT, 'src/main/db'));
    db.connect(null);

    try {
      await fn(db, { t, dir, paths });
    } finally {
      db.close();
      delete process.env.ATTENDANCE_DATA_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

test('adding the same name twice reuses one person, whatever the case',
  withDb((db) => {
    const first = db.addPerson('Amina Hassan');
    const second = db.addPerson('amina hassan');
    assert.equal(first, second);
    assert.equal(db.listPeople().length, 1);
  }));

test('re-adding a removed person restores them', withDb((db) => {
  const id = db.addPerson('Sam');
  db.setPersonActive(id, false);
  assert.equal(db.listPeople().length, 0);

  assert.equal(db.addPerson('Sam'), id);
  assert.equal(db.listPeople().length, 1);
}));

test('renaming onto an existing name is rejected', withDb((db) => {
  db.addPerson('Alice');
  const bob = db.addPerson('Bob');
  assert.throws(() => db.renamePerson(bob, 'alice'), /already named/i);
}));

test('an empty name is rejected', withDb((db) => {
  assert.throws(() => db.addPerson('   '), /cannot be empty/i);
}));

// ---------------------------------------------------------------------------
// marking
// ---------------------------------------------------------------------------

test('re-marking someone updates instead of duplicating', withDb((db) => {
  const id = db.addPerson('Dana');
  db.mark(id, '2026-08-03', 'Absent', 'Sick');
  db.mark(id, '2026-08-03', 'Late', 'Traffic');

  const rows = db.search();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'Late');
  assert.equal(rows[0].reason, 'Traffic');
}));

test('marking someone present clears any reason', withDb((db) => {
  const id = db.addPerson('Eli');
  db.mark(id, '2026-08-03', 'Absent', 'Sick');
  db.mark(id, '2026-08-03', 'Present', 'Sick');
  assert.equal(db.search()[0].reason, '');
}));

test('an unknown status is rejected', withDb((db) => {
  const id = db.addPerson('Fay');
  assert.throws(() => db.mark(id, '2026-08-03', 'Maybe'), /Unknown status/);
}));

test('unmarking removes the record', withDb((db) => {
  const id = db.addPerson('Gus');
  db.mark(id, '2026-08-03', 'Present');
  db.unmark(id, '2026-08-03');
  assert.equal(db.search().length, 0);
}));

// ---------------------------------------------------------------------------
// the day view
// ---------------------------------------------------------------------------

test('a day lists employees plus only that day\'s guests', withDb((db) => {
  db.addPerson('Roster Person');
  const guest = db.addPerson('Walk In', db.KIND_WALKIN);
  db.mark(guest, '2026-08-03', 'Present');

  const marked = db.getDay('2026-08-03').map((r) => r.name).sort();
  const other = db.getDay('2026-08-04').map((r) => r.name).sort();

  assert.deepEqual(marked, ['Roster Person', 'Walk In']);
  assert.deepEqual(other, ['Roster Person']);
}));

test('a removed person still appears on days they were marked', withDb((db) => {
  const id = db.addPerson('Past Employee');
  db.mark(id, '2026-07-01', 'Absent', 'Holiday');
  db.setPersonActive(id, false);

  const names = db.getDay('2026-07-01').map((r) => r.name);
  assert.ok(names.includes('Past Employee'));
}));

test('the day summary counts people with no status yet', withDb((db) => {
  const a = db.addPerson('A');
  db.addPerson('B');
  db.mark(a, '2026-08-03', 'Absent', 'Sick');

  const summary = db.daySummary('2026-08-03');
  assert.equal(summary.Absent, 1);
  assert.equal(summary.Unrecorded, 1);
  assert.equal(summary.Total, 2);
}));

test('markAllPresent only touches people with no status', withDb((db) => {
  const a = db.addPerson('A');
  db.addPerson('B');
  db.addPerson('C');
  db.mark(a, '2026-08-03', 'Absent', 'Sick');

  const pending = db.getDay('2026-08-03').filter((r) => !r.status).map((r) => r.person_id);
  db.markMany(pending, '2026-08-03', 'Present');

  const summary = db.daySummary('2026-08-03');
  assert.equal(summary.Present, 2);
  assert.equal(summary.Absent, 1, 'the existing absence must survive');
}));

// ---------------------------------------------------------------------------
// search / stats
// ---------------------------------------------------------------------------

test('search filters by name, range and status', withDb((db) => {
  const a = db.addPerson('Hana');
  const b = db.addPerson('Omar');
  db.mark(a, '2026-08-01', 'Absent', 'Sick');
  db.mark(a, '2026-08-05', 'Present');
  db.mark(b, '2026-08-05', 'Absent', 'Sick');

  assert.equal(db.search({ nameQuery: 'han' }).length, 2);
  assert.equal(db.search({ start: '2026-08-02' }).length, 2);
  assert.equal(db.search({ end: '2026-08-01' }).length, 1);
  assert.equal(db.search({ status: 'Absent' }).length, 2);
}));

test('per-person stats include people with nothing in range', withDb((db) => {
  const a = db.addPerson('Ines');
  db.addPerson('Nobody');
  db.mark(a, '2026-08-01', 'Present');
  db.mark(a, '2026-08-02', 'Absent', 'Sick');
  db.mark(a, '2026-08-03', 'Late', 'Bus');

  const stats = Object.fromEntries(db.perPersonStats().map((s) => [s.name, s]));
  assert.equal(stats.Ines.recorded, 3);
  assert.equal(stats.Ines.absent, 1);
  assert.equal(stats.Nobody.recorded, 0);
}));

test('stats respect the date range', withDb((db) => {
  const a = db.addPerson('Jo');
  db.mark(a, '2026-07-01', 'Present');
  db.mark(a, '2026-08-01', 'Absent', 'Sick');

  const stats = Object.fromEntries(
    db.perPersonStats('2026-08-01').map((s) => [s.name, s])
  );
  assert.equal(stats.Jo.recorded, 1);
  assert.equal(stats.Jo.absent, 1);
}));

test('known reasons come back most frequent first', withDb((db) => {
  const a = db.addPerson('K');
  const b = db.addPerson('L');
  db.mark(a, '2026-08-01', 'Absent', 'Sick');
  db.mark(b, '2026-08-01', 'Absent', 'Sick');
  db.mark(a, '2026-08-02', 'Absent', 'Holiday');

  assert.equal(db.knownReasons()[0], 'Sick');
}));

// ---------------------------------------------------------------------------
// default employees
// ---------------------------------------------------------------------------

test('a new database is seeded with the default employees', withDb((db) => {
  assert.equal(db.seedDefaultPeople(), db.DEFAULT_EMPLOYEES.length);
  const names = db.listPeople().map((p) => p.name);
  for (const expected of db.DEFAULT_EMPLOYEES) assert.ok(names.includes(expected));
}));

test('seeding is skipped once anyone exists', withDb((db) => {
  db.addPerson('Only Me');
  assert.equal(db.seedDefaultPeople(), 0);
  assert.deepEqual(db.listPeople().map((p) => p.name), ['Only Me']);
}));

test('seeding does not resurrect a removed default', withDb((db) => {
  db.seedDefaultPeople();
  const target = db.listPeople()[0];
  db.setPersonActive(target.id, false);

  db.seedDefaultPeople();
  const active = db.listPeople().map((p) => p.name);
  assert.ok(!active.includes(target.name));
}));

test('default names are stored exactly as written', withDb((db) => {
  db.seedDefaultPeople();
  const names = db.listPeople().map((p) => p.name);
  assert.ok(names.includes('Sara ahmed al balushi'));
  assert.ok(names.includes('Sara al balushi'));
}));

// ---------------------------------------------------------------------------
// deletion / backup
// ---------------------------------------------------------------------------

test('deleting a person cascades to their records', withDb((db) => {
  const id = db.addPerson('Mia');
  db.mark(id, '2026-08-03', 'Present');
  db.deletePerson(id);
  assert.equal(db.search().length, 0);
}));

test('a backup is readable and carries rows still in the WAL',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Noor');
    db.mark(id, '2026-08-03', 'Absent', 'Sick');

    const target = await db.backupNow();
    assert.ok(fs.existsSync(target));

    const Database = require('better-sqlite3');
    const copy = new Database(target, { readonly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM attendance').get().n, 1);
    assert.equal(copy.prepare('SELECT name FROM people').get().name, 'Noor');
    copy.close();
    assert.ok(target.startsWith(dir));
  }));

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

test('CSV export contains the records and quotes commas',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Priya');
    db.mark(id, '2026-08-03', 'Absent', 'Doctor, then school run');

    const exporter = require(path.join(ROOT, 'src/main/exporter'));
    const target = path.join(dir, 'out.csv');
    exporter.exportCsv(db.search(), target);

    const text = fs.readFileSync(target, 'utf8');
    assert.ok(text.includes('Priya'));
    assert.ok(text.includes('"Doctor, then school run"'), 'commas must be quoted');
    assert.ok(text.startsWith('﻿'), 'a BOM keeps Excel happy with accents');
  }));

test('Excel export writes a readable workbook',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Rami');
    db.mark(id, '2026-08-03', 'Absent', 'Sick');

    const exporter = require(path.join(ROOT, 'src/main/exporter'));
    const target = path.join(dir, 'out.xlsx');
    await exporter.exportXlsx(db.search(), target);

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const sheet = wb.getWorksheet('Attendance');
    assert.equal(sheet.getRow(1).getCell(1).value, 'Date');
    assert.equal(sheet.getRow(2).getCell(2).value, 'Rami');
    assert.equal(sheet.getRow(2).getCell(3).value, 'Absent');
  }));

test('the full report has three sheets', withDb(async (db, { dir }) => {
  const id = db.addPerson('Sami');
  db.mark(id, '2026-08-03', 'Absent', 'Sick');

  const exporter = require(path.join(ROOT, 'src/main/exporter'));
  const target = path.join(dir, 'report.xlsx');
  await exporter.exportSummaryXlsx(
    db.search(), db.perPersonStats(), db.reasonStats(), target
  );

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(target);
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Records', 'Summary', 'Reasons']);
}));

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

test('the data folder sits beside the app, and falls back when read-only', () => {
  delete process.env.ATTENDANCE_DATA_DIR;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, 'src'))) delete require.cache[key];
  }
  const paths = require(path.join(ROOT, 'src/main/paths'));

  paths._reset();
  assert.equal(paths.dataDir(null), path.join(paths.appDir(null), 'data'));
  assert.equal(paths.usingFallback(null), false);

  paths._reset();
  const readOnly = { getPath: () => path.join(os.tmpdir(), 'attendance-fallback') };
  const original = fs.mkdirSync;
  fs.mkdirSync = (dir, ...rest) => {
    if (String(dir).endsWith(path.join('', 'data'))) throw new Error('read-only');
    return original(dir, ...rest);
  };
  try {
    assert.ok(paths.dataDir(readOnly).includes('attendance-fallback'));
  } finally {
    fs.mkdirSync = original;
    paths._reset();
  }
});
