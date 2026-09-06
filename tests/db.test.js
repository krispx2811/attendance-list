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
// the clock
// ---------------------------------------------------------------------------

const clock = require(path.join(ROOT, 'src/shared/clock'));

test('the clock reads a time however it was typed', () => {
  const cases = {
    '8': '08:00',
    '830': '08:30',
    '0830': '08:30',
    '8:30': '08:30',
    '8.30': '08:30',
    '17:00': '17:00',
    '1700': '17:00',
    '5pm': '17:00',
    '5 PM': '17:00',
    '8:30 am': '08:30',
    '12am': '00:00',
    '12pm': '12:00',
    '12:15am': '00:15',
    '8:02 AM': '08:02',
  };
  for (const [typed, stored] of Object.entries(cases)) {
    assert.equal(clock.parse(typed), stored, `${typed} should read as ${stored}`);
  }
});

test('an empty box clears, but nonsense is refused', () => {
  assert.equal(clock.parse(''), '', 'empty means "not recorded"');
  assert.equal(clock.parse('   '), '');
  for (const bad of ['noon', '25:00', '8:75', 'abc', '99', '12:3']) {
    assert.equal(clock.parse(bad), null, `${bad} is not a time`);
  }
});

test('times are shown on a 12-hour clock', () => {
  assert.equal(clock.format('08:02'), '8:02 AM');
  assert.equal(clock.format('17:00'), '5:00 PM');
  assert.equal(clock.format('00:30'), '12:30 AM');
  assert.equal(clock.format('12:00'), '12:00 PM');
  assert.equal(clock.format(''), '');
  assert.equal(clock.format('nonsense'), '');
});

test('hours worked take the break out of the day', () => {
  assert.equal(
    clock.workedMinutes({
      time_in: '08:00', break_out: '12:30', break_in: '13:00', time_out: '17:00',
    }),
    510,
    'nine hours less a half-hour break'
  );

  assert.equal(
    clock.workedMinutes({ time_in: '08:00', time_out: '17:00' }),
    540,
    'no break recorded means none is deducted'
  );

  assert.equal(
    clock.workedMinutes({ time_in: '08:00', break_out: '12:30', time_out: '17:00' }),
    540,
    'half a break cannot be deducted'
  );
});

test('an incomplete or backwards day yields no total', () => {
  assert.equal(clock.workedMinutes({ time_in: '08:00' }), null);
  assert.equal(clock.workedMinutes({ time_out: '17:00' }), null);
  assert.equal(clock.workedMinutes({}), null);
  assert.equal(
    clock.workedMinutes({ time_in: '17:00', time_out: '08:00' }),
    null,
    'a day that runs backwards is a typo, not a night shift'
  );
});

test('a full day is eight hours, and anything less is short', () => {
  // 08:00 to 16:30 is eight and a half hours, less a half-hour break.
  const fullDay = {
    time_in: '08:00', break_out: '12:30', break_in: '13:00', time_out: '16:30',
  };
  assert.equal(clock.workedMinutes(fullDay), 480);
  assert.equal(clock.shortfallMinutes(fullDay), 0, 'exactly eight hours is not short');

  const shortDay = {
    time_in: '08:00', break_out: '12:30', break_in: '13:00', time_out: '16:00',
  };
  assert.equal(clock.shortfallMinutes(shortDay), 30);
  assert.equal(clock.shortfallHours(shortDay), 0.5);

  const longDay = { time_in: '08:00', time_out: '18:00' };
  assert.equal(clock.shortfallMinutes(longDay), 0, 'overtime is not a negative shortfall');
  assert.equal(clock.overtimeMinutes(longDay), 120, 'two hours over');
  assert.equal(clock.overtimeHours(longDay), 2);
});

test('the balance is signed, and reads with its sign', () => {
  const over = { time_in: '08:00', time_out: '17:00' };
  const under = { time_in: '09:00', time_out: '16:00' };
  const exact = { time_in: '08:00', time_out: '16:00' };

  assert.equal(clock.balanceMinutes(over), 60);
  assert.equal(clock.balanceMinutes(under), -60);
  assert.equal(clock.balanceMinutes(exact), 0);
  assert.equal(clock.balanceMinutes({ time_in: '08:00' }), null);

  assert.equal(clock.formatBalance(60), '+1h');
  assert.equal(clock.formatBalance(-35), '−35m');
  assert.equal(clock.formatBalance(0), '', 'a day worked exactly needs no annotation');
  assert.equal(clock.formatBalance(null), '');
});

test('an unfinished day is not counted as short', () => {
  assert.equal(
    clock.shortfallMinutes({ time_in: '08:00' }),
    null,
    'someone who has not clocked out yet is still here, not short'
  );
  assert.equal(clock.shortfallMinutes({}), null);
});

test('a long break is what makes an otherwise long day short', () => {
  assert.equal(
    clock.shortfallMinutes({
      time_in: '08:00', break_out: '12:00', break_in: '14:00', time_out: '17:00',
    }),
    60,
    'nine hours on site less a two-hour break is seven hours worked'
  );
});

test('durations read the way people say them', () => {
  assert.equal(clock.formatDuration(513), '8h 33m');
  assert.equal(clock.formatDuration(480), '8h');
  assert.equal(clock.formatDuration(45), '45m');
  assert.equal(clock.formatDuration(null), '');
});

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
// times of day
// ---------------------------------------------------------------------------

test('times are saved and read back on the day', withDb((db) => {
  const id = db.addPerson('Tariq');
  db.mark(id, '2026-08-03', 'Present');
  db.setTimes(id, '2026-08-03', {
    time_in: '08:02',
    break_out: '12:30',
    break_in: '13:05',
    time_out: '17:00',
  });

  const row = db.getDay('2026-08-03').find((r) => r.person_id === id);
  assert.equal(row.time_in, '08:02');
  assert.equal(row.break_out, '12:30');
  assert.equal(row.break_in, '13:05');
  assert.equal(row.time_out, '17:00');
}));

test('one time can be set without disturbing the others', withDb((db) => {
  const id = db.addPerson('Uma');
  db.mark(id, '2026-08-03', 'Present');
  db.setTimes(id, '2026-08-03', { time_in: '08:00', time_out: '17:00' });
  db.setTimes(id, '2026-08-03', { break_out: '12:00' });

  const row = db.search()[0];
  assert.equal(row.time_in, '08:00');
  assert.equal(row.time_out, '17:00');
  assert.equal(row.break_out, '12:00');
}));

test('an empty string clears a time', withDb((db) => {
  const id = db.addPerson('Vik');
  db.mark(id, '2026-08-03', 'Late');
  db.setTimes(id, '2026-08-03', { time_in: '09:14' });
  db.setTimes(id, '2026-08-03', { time_in: '' });
  assert.equal(db.search()[0].time_in, '');
}));

test('a time that is not HH:MM is rejected', withDb((db) => {
  const id = db.addPerson('Wael');
  db.mark(id, '2026-08-03', 'Present');

  for (const bad of ['8am', '25:00', '08:60', 'noon', '8']) {
    assert.throws(
      () => db.setTimes(id, '2026-08-03', { time_in: bad }),
      /not a valid time/i,
      `${bad} must be rejected`
    );
  }
}));

test('a column outside the known times is refused', withDb((db) => {
  const id = db.addPerson('Xena');
  db.mark(id, '2026-08-03', 'Present');
  assert.throws(
    () => db.setTimes(id, '2026-08-03', { reason: 'nice try' }),
    /no times given/i
  );
}));

test('times need a record to attach to', withDb((db) => {
  const id = db.addPerson('Yara');
  assert.throws(
    () => db.setTimes(id, '2026-08-03', { time_in: '08:00' }),
    /status for the day first/i
  );
}));

test('times cannot be put on someone marked absent', withDb((db) => {
  const id = db.addPerson('Zaid');
  db.mark(id, '2026-08-03', 'Absent', 'Sick');
  assert.throws(
    () => db.setTimes(id, '2026-08-03', { time_in: '08:00' }),
    /do not apply/i
  );
}));

test('correcting Present to Late keeps the times', withDb((db) => {
  const id = db.addPerson('Aisha');
  db.mark(id, '2026-08-03', 'Present');
  db.setTimes(id, '2026-08-03', { time_in: '09:14' });
  db.mark(id, '2026-08-03', 'Late', 'Traffic');

  const row = db.search()[0];
  assert.equal(row.status, 'Late');
  assert.equal(row.time_in, '09:14', 'the arrival time is what proves they were late');
}));

test('marking someone absent wipes their times', withDb((db) => {
  const id = db.addPerson('Bilal');
  db.mark(id, '2026-08-03', 'Present');
  db.setTimes(id, '2026-08-03', { time_in: '08:00', time_out: '17:00' });
  db.mark(id, '2026-08-03', 'Absent', 'Sick');

  const row = db.search()[0];
  assert.equal(row.time_in, '');
  assert.equal(row.time_out, '');
}));

test('an existing database gains the time columns without losing history',
  withDb(async (db, { dir }) => {
    // Rebuild a version 1 database by hand, then let migrate() bring it up.
    db.close();
    const Database = require('better-sqlite3');
    const file = path.join(dir, 'attendance.db');
    for (const stale of [file, `${file}-wal`, `${file}-shm`]) {
      fs.rmSync(stale, { force: true });
    }

    const old = new Database(file);
    old.exec(`
      CREATE TABLE people (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        kind TEXT NOT NULL DEFAULT 'roster', active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL);
      CREATE TABLE attendance (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        date TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
        recorded_at TEXT NOT NULL, UNIQUE(person_id, date));
      INSERT INTO people (id, name, kind, active, created_at)
        VALUES (1, 'Old Timer', 'roster', 1, '2026-01-01T00:00:00');
      INSERT INTO attendance (person_id, date, status, reason, recorded_at)
        VALUES (1, '2026-01-02', 'Late', 'Traffic', '2026-01-02T09:00:00');
    `);
    old.pragma('user_version = 1');
    old.close();

    db.connect(null, file);

    const rows = db.search();
    assert.equal(rows.length, 1, 'the old record must survive');
    assert.equal(rows[0].reason, 'Traffic');
    assert.equal(rows[0].time_in, '', 'old records simply have no times');

    db.setTimes(1, '2026-01-02', { time_in: '08:00' });
    assert.equal(db.search()[0].time_in, '08:00');
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
    assert.equal(sheet.getRow(2).getCell(3).value, 'Absent',
      'status must stay in column 3, which is what the row tinting looks at');
  }));

test('exported times are readable and the hours are worked out',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Salim');
    db.mark(id, '2026-08-03', 'Late', 'Traffic');
    db.setTimes(id, '2026-08-03', {
      time_in: '09:14', break_out: '12:30', break_in: '13:00', time_out: '17:00',
    });

    const exporter = require(path.join(ROOT, 'src/main/exporter'));
    const target = path.join(dir, 'times.xlsx');
    await exporter.exportXlsx(db.search(), target);

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const row = wb.getWorksheet('Attendance').getRow(2);

    assert.equal(row.getCell(4).value, '9:14 AM');
    assert.equal(row.getCell(5).value, '12:30 PM');
    assert.equal(row.getCell(6).value, '1:00 PM');
    assert.equal(row.getCell(7).value, '5:00 PM');
    assert.equal(row.getCell(8).value, '7h 16m');
    assert.equal(row.getCell(9).value, '\u221244m', 'and how it compares to a full day');
  }));

test('the summary sheet totals the hours per person',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Thuraya');
    for (const day of ['2026-08-03', '2026-08-04']) {
      db.mark(id, day, 'Present');
      db.setTimes(id, day, { time_in: '08:00', time_out: '16:00' });
    }

    const exporter = require(path.join(ROOT, 'src/main/exporter'));
    const target = path.join(dir, 'report.xlsx');
    await exporter.exportSummaryXlsx(
      db.search(), db.perPersonStats(), db.reasonStats(), target
    );

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const summary = wb.getWorksheet('Summary');
    assert.equal(summary.getRow(1).getCell(7).value, 'Hours worked');
    assert.equal(summary.getRow(2).getCell(7).value, 16, 'two eight-hour days');
    assert.equal(summary.getRow(1).getCell(8).value, 'Short by');
    assert.equal(summary.getRow(2).getCell(8).value, 0, 'both days were full');
    assert.equal(summary.getRow(1).getCell(9).value, 'Overtime');
    assert.equal(summary.getRow(2).getCell(9).value, 0, 'and neither ran over');
  }));

test('the summary sheet adds up how far short someone fell',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Nawal');
    db.mark(id, '2026-08-03', 'Present');
    db.setTimes(id, '2026-08-03', { time_in: '09:00', time_out: '16:00' });
    db.mark(id, '2026-08-04', 'Late', 'Traffic');
    db.setTimes(id, '2026-08-04', { time_in: '09:30', time_out: '16:00' });

    const exporter = require(path.join(ROOT, 'src/main/exporter'));
    const target = path.join(dir, 'short.xlsx');
    await exporter.exportSummaryXlsx(
      db.search(), db.perPersonStats(), db.reasonStats(), target
    );

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const row = wb.getWorksheet('Summary').getRow(2);
    assert.equal(row.getCell(7).value, 13.5, 'seven hours plus six and a half');
    assert.equal(row.getCell(8).value, 2.5, 'one hour short plus an hour and a half');
    assert.equal(row.getCell(9).value, 0, 'neither day ran over');
  }));

test('the summary sheet keeps overtime and shortfall apart',
  withDb(async (db, { dir }) => {
    const id = db.addPerson('Omar');
    db.mark(id, '2026-08-03', 'Present');
    db.setTimes(id, '2026-08-03', { time_in: '08:00', time_out: '18:00' });
    db.mark(id, '2026-08-04', 'Present');
    db.setTimes(id, '2026-08-04', { time_in: '09:00', time_out: '16:00' });

    const exporter = require(path.join(ROOT, 'src/main/exporter'));
    const target = path.join(dir, 'both.xlsx');
    await exporter.exportSummaryXlsx(
      db.search(), db.perPersonStats(), db.reasonStats(), target
    );

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const row = wb.getWorksheet('Summary').getRow(2);
    assert.equal(row.getCell(8).value, 1, 'the short day, not netted away');
    assert.equal(row.getCell(9).value, 2, 'the long day, kept separate');
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
