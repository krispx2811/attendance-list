'use strict';

/**
 * Times of day.
 *
 * Stored as 24-hour `HH:MM` text — it sorts and compares correctly, matches
 * how dates are already kept in this schema, and carries no timezone. Shown
 * to people as `8:02 AM`, which is how everyone here reads a clock.
 *
 * Loaded by both the renderer (a plain <script>) and the main process
 * (require), so it must not depend on either.
 *
 * Wrapped in a function because renderer scripts share one global lexical
 * scope: a bare top-level `const pad` here collides with the one in views.js
 * and takes the whole interface down with a SyntaxError. Nothing escapes this
 * closure but `clock` itself.
 */

(function (root) {

const STORED = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n) => String(n).padStart(2, '0');

/** True for a storable time, and for '' — meaning "not recorded". */
function isStorable(value) {
  return value === '' || STORED.test(String(value));
}

/**
 * Turn whatever someone typed into `HH:MM`.
 *
 * Returns '' for an empty box and null for anything unreadable, so a caller
 * can tell "they cleared it" from "they made a typo" — one saves, the other
 * has to be rejected.
 *
 * Accepts 8, 830, 08:30, 8.30, 8:30pm, 5 PM, 1700.
 */
function parse(input) {
  let text = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return '';

  let half = null;
  const suffix = /(am|pm|a|p)$/.exec(text);
  if (suffix) {
    half = suffix[1][0];
    text = text.slice(0, suffix.index);
  }
  text = text.replace(/[.\-h]/g, ':');

  let hour;
  let minute;

  const separated = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (separated) {
    hour = Number(separated[1]);
    minute = Number(separated[2]);
  } else if (/^\d{1,2}$/.test(text)) {
    hour = Number(text);
    minute = 0;
  } else if (/^\d{3,4}$/.test(text)) {
    // 830 and 1700 — the way people type a time when they are in a hurry.
    hour = Number(text.slice(0, -2));
    minute = Number(text.slice(-2));
  } else {
    return null;
  }

  if (half === 'a' && hour === 12) hour = 0;
  if (half === 'p' && hour < 12) hour += 12;

  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** `08:02` → `8:02 AM`. Blank stays blank. */
function format(stored) {
  if (!STORED.test(String(stored ?? ''))) return '';
  const [h, m] = String(stored).split(':').map(Number);
  const half = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${half}`;
}

/** The current time, ready to store. */
function nowStored() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const minutesOf = (stored) => {
  if (!STORED.test(String(stored ?? ''))) return null;
  const [h, m] = String(stored).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Minutes actually worked: the day, less the break.
 *
 * Null unless both ends of the day are known — half a day tells you nothing.
 * A break is only deducted when both of its ends are recorded, and a day that
 * comes out backwards (someone typed 5:00 PM as their arrival) is rejected
 * rather than shown as a negative or a wild number.
 */
function workedMinutes(record = {}) {
  const start = minutesOf(record.time_in);
  const end = minutesOf(record.time_out);
  if (start === null || end === null || end <= start) return null;

  let worked = end - start;

  const breakOut = minutesOf(record.break_out);
  const breakIn = minutesOf(record.break_in);
  if (breakOut !== null && breakIn !== null && breakIn > breakOut) {
    worked -= breakIn - breakOut;
  }

  return worked > 0 ? worked : null;
}

/** `513` → `8h 33m`. */
function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Worked time as a number, for a spreadsheet that needs to add it up. */
function workedHours(record) {
  const minutes = workedMinutes(record);
  return minutes === null ? null : Math.round((minutes / 60) * 100) / 100;
}

/** A full day's work. Anything under this is short. */
const STANDARD_DAY_MINUTES = 8 * 60;

/**
 * Minutes over (positive) or under (negative) a full day.
 *
 * Null while the day is still incomplete — someone who has not clocked out
 * yet is neither short nor owed anything, they are simply still here.
 */
function balanceMinutes(record) {
  const worked = workedMinutes(record);
  return worked === null ? null : worked - STANDARD_DAY_MINUTES;
}

/** How far short of a full day someone fell. Zero once they worked their hours. */
function shortfallMinutes(record) {
  const balance = balanceMinutes(record);
  return balance === null ? null : Math.max(0, -balance);
}

/** How much someone worked beyond a full day. Zero when they did not. */
function overtimeMinutes(record) {
  const balance = balanceMinutes(record);
  return balance === null ? null : Math.max(0, balance);
}

const asHours = (minutes) =>
  minutes === null ? null : Math.round((minutes / 60) * 100) / 100;

/** Shortfall and overtime as numbers, for a spreadsheet that adds them up. */
const shortfallHours = (record) => asHours(shortfallMinutes(record));
const overtimeHours = (record) => asHours(overtimeMinutes(record));

/**
 * A balance with its sign: `+1h`, `−35m`, or '' for a day worked exactly.
 *
 * The minus is a real minus sign rather than a hyphen so it lines up with the
 * digits either side of it.
 */
function formatBalance(minutes) {
  if (minutes === null || minutes === undefined || minutes === 0) return '';
  return `${minutes > 0 ? '+' : '−'}${formatDuration(Math.abs(minutes))}`;
}

const clock = {
  STANDARD_DAY_MINUTES,
  isStorable,
  parse,
  format,
  nowStored,
  workedMinutes,
  workedHours,
  balanceMinutes,
  shortfallMinutes,
  shortfallHours,
  overtimeMinutes,
  overtimeHours,
  formatDuration,
  formatBalance,
};

if (typeof module === 'object' && module.exports) {
  module.exports = clock;
} else {
  root.clock = clock;
}

})(typeof globalThis === 'object' ? globalThis : this);
