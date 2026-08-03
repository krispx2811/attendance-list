'use strict';

/* Shared rendering helpers and the markup for each view. */

const STATUSES = ['Present', 'Late', 'Absent'];

const AVATAR_COLORS = [
  '#5b5bd6', '#0e9f6e', '#c2751a', '#c0392b', '#8e44ad',
  '#0f8f8f', '#d05a1e', '#2b6cb0', '#a03a6e', '#5566bf',
];

/** Stable colour per person so faces stay recognisable between sessions. */
function avatarColor(name) {
  let sum = 0;
  for (const ch of String(name)) sum += ch.codePointAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Escape anything that reaches innerHTML. Names are user input. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function avatar(name, small = false) {
  return `<div class="avatar${small ? ' avatar-sm' : ''}" style="background:${avatarColor(name)}"
    aria-hidden="true">${esc(initials(name))}</div>`;
}

function statusPill(status) {
  if (!status) return '<span class="muted">—</span>';
  return `<span class="pill pill--${status}">${status}</span>`;
}

const icons = {
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
};

// ---------------------------------------------------------------------------
// date helpers
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftDay(iso, delta) {
  const date = fromISO(iso);
  date.setDate(date.getDate() + delta);
  return toISO(date);
}

function longDate(iso) {
  return fromISO(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function parseLooseDate(text) {
  const cleaned = String(text || '').trim().replace(/[./]/g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function weekBounds() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return [toISO(monday), toISO(today)];
}

function monthBounds() {
  const today = new Date();
  return [toISO(new Date(today.getFullYear(), today.getMonth(), 1)), toISO(today)];
}

// ---------------------------------------------------------------------------
// view markup
// ---------------------------------------------------------------------------

function dateNav(day) {
  return `
    <div class="date-nav">
      <button data-act="prev-day" title="Previous day" aria-label="Previous day">${icons.chevronLeft}</button>
      <input id="date-input" value="${esc(day)}" spellcheck="false" aria-label="Date" />
      <button data-act="next-day" title="Next day" aria-label="Next day">${icons.chevronRight}</button>
      <button class="today-btn" data-act="today">Today</button>
    </div>`;
}

function todayView({ day, summary, note }) {
  return `
    <section class="view">
      <header class="topbar">
        <div class="topbar-title">
          <h1>${esc(longDate(day))}</h1>
          <p>${esc(note)}</p>
        </div>
        <div class="topbar-actions">${dateNav(day)}</div>
      </header>

      <div class="view-body">
        <div class="stats">
          <div class="stat stat--present">
            <div class="stat-value">${summary.Present}</div>
            <div class="stat-label">Present</div>
          </div>
          <div class="stat stat--late">
            <div class="stat-value">${summary.Late}</div>
            <div class="stat-label">Late</div>
          </div>
          <div class="stat stat--absent">
            <div class="stat-value">${summary.Absent}</div>
            <div class="stat-label">Absent</div>
          </div>
          <div class="stat stat--pending">
            <div class="stat-value">${summary.Unrecorded}</div>
            <div class="stat-label">Not recorded</div>
          </div>
        </div>

        <div class="toolbar">
          <button class="btn btn-success" data-act="all-present">${icons.check} Mark everyone present</button>
          <button class="btn btn-default" data-act="add-people">${icons.plus} Add employees</button>
          <button class="btn btn-ghost" data-act="add-guest">${icons.plus} Add guest</button>
          <div class="toolbar-spacer"></div>
          <input class="input input-search" id="today-search" type="search"
                 placeholder="Search names…" spellcheck="false" />
          <button class="btn btn-ghost" data-act="clear-day">Clear day</button>
        </div>

        <div class="roster" id="roster"></div>
        <div class="hint-bar" id="today-hint"></div>
      </div>
    </section>`;
}

function personRow(row, index) {
  const status = row.status || '';
  const cls = status ? ` is-${status.toLowerCase()}` : '';
  const needsReason = status === 'Absent' || status === 'Late';
  const isGuest = row.kind === 'walkin';

  const meta = status
    ? `<span class="dot"></span>${status}`
    : 'Not recorded';

  const placeholder = status === 'Late' ? 'Why were they late?' : 'Reason for not coming';

  return `
    <div class="person${cls}${needsReason ? ' needs-reason' : ''}"
         data-person="${row.person_id}" data-index="${index}">
      ${avatar(row.name)}
      <div class="person-id">
        <div class="person-name">${esc(row.name)}${
          isGuest ? ' <span class="tag">Guest</span>' : ''
        }</div>
        <div class="person-meta">${meta}</div>
      </div>
      <div class="segmented" role="group" aria-label="Status for ${esc(row.name)}">
        ${STATUSES.map(
          (s) =>
            `<button data-status="${s}" class="${s === status ? 'is-on' : ''}">${s}</button>`
        ).join('')}
      </div>
      <div class="person-tail">
        <div class="reason-wrap">
          <input class="input reason-input" list="reason-options" value="${esc(row.reason || '')}"
                 placeholder="${placeholder}" spellcheck="false"
                 ${needsReason ? '' : 'tabindex="-1"'} />
        </div>
        <button class="icon-btn" data-act="clear-person" title="Clear" aria-label="Clear status">
          ${icons.x}
        </button>
      </div>
    </div>`;
}

function emptyRoster() {
  return `
    <div class="empty">
      <div class="empty-icon">${icons.users}</div>
      <h2>No employees yet</h2>
      <p>Add everyone once, then each morning you just mark who came in.</p>
      <button class="btn btn-primary" data-act="add-people">${icons.plus} Add your employees</button>
    </div>`;
}

function noMatches(term) {
  return `
    <div class="empty">
      <div class="empty-icon">${icons.search}</div>
      <h2>No one matches “${esc(term)}”</h2>
      <p>Try a different name, or clear the search box.</p>
    </div>`;
}

function peopleView() {
  return `
    <section class="view">
      <header class="topbar">
        <div class="topbar-title">
          <h1>Employees</h1>
          <p id="people-count"></p>
        </div>
        <div class="topbar-actions">
          <button class="btn btn-default" data-act="add-many">${icons.plus} Add several</button>
        </div>
      </header>

      <div class="view-body">
        <div class="toolbar">
          <input class="input" id="new-name" placeholder="New employee's name" style="width:230px" />
          <button class="btn btn-primary" data-act="add-one">Add</button>
          <div class="toolbar-spacer"></div>
          <label class="field-label" style="display:flex;align-items:center;gap:7px;cursor:pointer">
            <input type="checkbox" id="show-removed" /> Show removed
          </label>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th class="num">Days recorded</th>
                <th style="width:1%"></th>
              </tr>
            </thead>
            <tbody id="people-body"></tbody>
          </table>
        </div>
        <div class="hint-bar">Double-click a name to rename.</div>
      </div>
    </section>`;
}

function historyView() {
  return `
    <section class="view">
      <header class="topbar">
        <div class="topbar-title">
          <h1>History</h1>
          <p id="history-count"></p>
        </div>
        <div class="topbar-actions">
          <button class="btn btn-default" data-act="export-xlsx">${icons.download} Excel</button>
          <button class="btn btn-ghost" data-act="export-csv">CSV</button>
        </div>
      </header>

      <div class="view-body">
        <div class="toolbar">
          <input class="input" id="h-name" placeholder="Name contains…" style="width:180px" />
          <input class="input" id="h-from" placeholder="From (YYYY-MM-DD)" style="width:160px" />
          <input class="input" id="h-to" placeholder="To (YYYY-MM-DD)" style="width:160px" />
          <select class="input" id="h-status">
            <option value="">Any status</option>
            <option>Present</option>
            <option>Late</option>
            <option>Absent</option>
          </select>
          <div class="toolbar-spacer"></div>
          <button class="btn btn-ghost btn-sm" data-range="week">This week</button>
          <button class="btn btn-ghost btn-sm" data-range="month">This month</button>
          <button class="btn btn-ghost btn-sm" data-range="all">All time</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Status</th>
                <th>Reason for not coming</th>
              </tr>
            </thead>
            <tbody id="history-body"></tbody>
          </table>
        </div>
        <div class="hint-bar">Click any row to see that person's full history.</div>
      </div>
    </section>`;
}

function reportsView() {
  return `
    <section class="view">
      <header class="topbar">
        <div class="topbar-title">
          <h1>Reports</h1>
          <p id="reports-range"></p>
        </div>
        <div class="topbar-actions">
          <button class="btn btn-default" data-act="export-report">${icons.download} Full report</button>
        </div>
      </header>

      <div class="view-body">
        <div class="toolbar">
          <input class="input" id="r-from" placeholder="From (YYYY-MM-DD)" style="width:160px" />
          <input class="input" id="r-to" placeholder="To (YYYY-MM-DD)" style="width:160px" />
          <button class="btn btn-default btn-sm" data-act="apply-range">Apply</button>
          <button class="btn btn-ghost btn-sm" data-range="week">This week</button>
          <button class="btn btn-ghost btn-sm" data-range="month">This month</button>
          <button class="btn btn-ghost btn-sm" data-range="all">All time</button>
          <div class="toolbar-spacer"></div>
          <button class="btn btn-ghost btn-sm" data-act="backup">Back up now</button>
          <button class="btn btn-ghost btn-sm" data-act="save-copy">Save a copy</button>
          <button class="btn btn-ghost btn-sm" data-act="check-updates">Check for updates</button>
        </div>

        <div class="summary-line" id="reports-summary"></div>

        <div class="grid-2">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th class="num">Days</th>
                  <th class="num">Present</th>
                  <th class="num">Late</th>
                  <th class="num">Absent</th>
                  <th style="width:130px">Attendance</th>
                </tr>
              </thead>
              <tbody id="reports-body"></tbody>
            </table>
          </div>

          <div class="panel">
            <div class="panel-title">Most common reasons</div>
            <div id="reasons-list"></div>
          </div>
        </div>
      </div>
    </section>`;
}

window.views = {
  STATUSES,
  esc,
  avatar,
  avatarColor,
  initials,
  statusPill,
  icons,
  toISO,
  fromISO,
  shiftDay,
  longDate,
  parseLooseDate,
  weekBounds,
  monthBounds,
  todayView,
  personRow,
  emptyRoster,
  noMatches,
  peopleView,
  historyView,
  reportsView,
};
