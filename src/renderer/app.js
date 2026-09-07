'use strict';

/* Renderer controller: state, view switching and all event wiring.
 *
 * Wrapped in an IIFE: contextBridge defines `window.api` as a
 * non-configurable global, so a top-level `const api` in a classic script
 * collides with it. Function scope avoids that entirely. */

(() => {
const V = window.views;
const C = window.clock;
const api = window.api;

const state = {
  view: 'today',
  day: null,
  rows: [],
  reasons: [],
  summary: { Present: 0, Late: 0, Absent: 0, Unrecorded: 0, Total: 0 },
  filter: '',
  people: [],
  showRemoved: false,
  history: [],
  reports: null,
  settings: null,
  info: null,
  update: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const viewsEl = $('#views');

// ---------------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------------

function toast(message, { error = false, action } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' toast--error' : ''}`;
  el.innerHTML = `<span class="toast-mark"></span><span></span>`;
  el.children[1].textContent = message;

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.run();
      dismiss();
    });
    el.appendChild(btn);
  }

  $('#toasts').appendChild(el);
  const timer = setTimeout(dismiss, action ? 7000 : 3200);

  function dismiss() {
    clearTimeout(timer);
    el.classList.add('is-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
  return dismiss;
}

async function guard(promise, errorPrefix = 'Something went wrong') {
  try {
    return await promise;
  } catch (error) {
    toast(`${errorPrefix}: ${error.message}`, { error: true });
    return null;
  }
}

// ---------------------------------------------------------------------------
// modal
// ---------------------------------------------------------------------------

function openModal({ title, subtitle, body, footNote, confirmLabel = 'Save', onConfirm }) {
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${V.esc(title)}</h2>
        ${subtitle ? `<p>${V.esc(subtitle)}</p>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${footNote ? `<span class="foot-note">${V.esc(footNote)}</span>` : ''}
        <button class="btn btn-ghost" data-modal="cancel">Cancel</button>
        ${onConfirm ? `<button class="btn btn-primary" data-modal="ok">${V.esc(confirmLabel)}</button>` : ''}
      </div>
    </div>`;

  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };

  function onKey(event) {
    if (event.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  root.addEventListener('click', async (event) => {
    if (event.target === root || event.target.dataset.modal === 'cancel') return close();
    if (event.target.dataset.modal === 'ok') {
      const keep = await onConfirm(root);
      if (keep !== false) close();
    }
  });

  const firstField = $('textarea, input', root);
  if (firstField) setTimeout(() => firstField.focus(), 40);
  return close;
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

async function loadDay() {
  const data = await guard(api.day.get(state.day), 'Could not load the day');
  if (!data) return;
  state.rows = data.rows;
  state.summary = data.summary;
  state.reasons = data.reasons;
}

function dayNote() {
  const today = state.info?.today;
  if (state.day === today) return `${state.summary.Total} people · ${state.summary.Unrecorded} still to record`;
  if (state.day < today) return 'Filling in a past day';
  return 'A future date';
}

async function renderToday({ reload = true } = {}) {
  if (reload) await loadDay();
  viewsEl.innerHTML = V.todayView({
    day: state.day,
    summary: state.summary,
    note: dayNote(),
  });
  renderRoster();
  wireToday();
}

function renderRoster() {
  const host = $('#roster');
  const hint = $('#today-hint');
  if (!host) return;

  const visible = state.filter
    ? state.rows.filter((r) => r.name.toLowerCase().includes(state.filter))
    : state.rows;

  if (!state.rows.length) {
    host.innerHTML = V.emptyRoster();
    hint.innerHTML = '';
    return;
  }
  if (!visible.length) {
    host.innerHTML = V.noMatches(state.filter);
    hint.innerHTML = '';
    return;
  }

  host.innerHTML =
    visible.map((row, i) => V.personRow(row, i)).join('') +
    `<datalist id="reason-options">${state.reasons
      .map((r) => `<option value="${V.esc(r)}"></option>`)
      .join('')}</datalist>`;

  hint.innerHTML =
    `Keyboard: <span class="kbd">↑</span><span class="kbd">↓</span> to move, ` +
    `<span class="kbd">P</span> present, <span class="kbd">L</span> late, ` +
    `<span class="kbd">A</span> absent, <span class="kbd">⌫</span> clear.`;
}

function updateStatTiles() {
  const map = { Present: '.stat--present', Late: '.stat--late', Absent: '.stat--absent', Unrecorded: '.stat--pending' };
  for (const [key, sel] of Object.entries(map)) {
    const el = $(`${sel} .stat-value`);
    if (el) el.textContent = state.summary[key];
  }
  const note = $('.topbar-title p');
  if (note) note.textContent = dayNote();
}

/** Recompute summary locally so tiles move the instant a button is clicked. */
function recomputeSummary() {
  const summary = { Present: 0, Late: 0, Absent: 0, Unrecorded: 0, Total: state.rows.length };
  for (const row of state.rows) {
    if (row.status) summary[row.status] += 1;
    else summary.Unrecorded += 1;
  }
  state.summary = summary;
}

function repaintRow(personId) {
  const row = state.rows.find((r) => r.person_id === personId);
  const el = $(`.person[data-person="${personId}"]`);
  if (!row || !el) return;

  const status = row.status || '';
  el.classList.remove('is-present', 'is-late', 'is-absent', 'needs-reason', 'has-times');
  if (status) el.classList.add(`is-${status.toLowerCase()}`);
  const needsReason = status === 'Absent' || status === 'Late';
  if (needsReason) el.classList.add('needs-reason');
  if (V.TIME_STATUSES.includes(status)) el.classList.add('has-times');

  $$('.segmented button', el).forEach((btn) =>
    btn.classList.toggle('is-on', btn.dataset.status === status)
  );

  $('.person-meta', el).innerHTML = status ? `<span class="dot"></span>${status}` : 'Not recorded';

  const input = $('.reason-input', el);
  input.value = row.reason || '';
  input.placeholder = status === 'Late' ? 'Why were they late?' : 'Reason for not coming';
  input.tabIndex = needsReason ? 0 : -1;

  repaintTimes(personId);
}

/**
 * Redraw the clock strip from state.
 *
 * Never touches the box the user is currently in: this runs on blur as focus
 * moves to the next field, and writing a value there would fight their typing.
 */
function repaintTimes(personId) {
  const row = state.rows.find((r) => r.person_id === personId);
  const el = $(`.person[data-person="${personId}"] .person-times`);
  if (!row || !el) return;

  $$('.time-input', el).forEach((input) => {
    if (input === document.activeElement) return;
    input.value = C.format(row[input.dataset.field]);
  });

  $('.worked', el).innerHTML = V.workedLabel(row);
}

async function setStatus(personId, status, { focusReason = true } = {}) {
  const row = state.rows.find((r) => r.person_id === personId);
  if (!row) return;

  const keepsReason = status === 'Absent' || status === 'Late';
  row.status = status;
  if (!keepsReason) row.reason = '';
  // Marking someone Absent retracts the claim that they were ever here, so
  // the times go with it — the main process does the same to the record.
  if (!V.TIME_STATUSES.includes(status)) {
    for (const { field } of V.TIME_FIELDS) row[field] = '';
  }

  repaintRow(personId);
  recomputeSummary();
  updateStatTiles();

  await guard(api.day.mark(personId, state.day, status, row.reason || ''), 'Could not save');

  if (keepsReason && focusReason) {
    const input = $(`.person[data-person="${personId}"] .reason-input`);
    if (input) input.focus();
  }
}

async function clearStatus(personId) {
  const row = state.rows.find((r) => r.person_id === personId);
  if (!row || !row.status) return;
  row.status = null;
  row.reason = '';
  for (const { field } of V.TIME_FIELDS) row[field] = '';
  repaintRow(personId);
  recomputeSummary();
  updateStatTiles();
  await guard(api.day.unmark(personId, state.day), 'Could not clear');
}

/**
 * Save one clock box.
 *
 * An empty box clears the time; anything unreadable is put back the way it
 * was rather than saved, because a wrong time is worse than no time.
 */
async function saveTime(personId, field, typed) {
  const row = state.rows.find((r) => r.person_id === personId);
  if (!row || !V.TIME_STATUSES.includes(row.status)) return;

  const parsed = C.parse(typed);
  if (parsed === null) {
    repaintTimes(personId);
    return toast(`“${typed.trim()}” is not a time. Try 8:30, 830 or 5pm.`, { error: true });
  }
  if (parsed === (row[field] || '')) return repaintTimes(personId);

  const previous = row[field] || '';
  row[field] = parsed;
  repaintTimes(personId);

  const saved = await guard(
    api.day.setTimes(personId, state.day, { [field]: parsed }),
    'Could not save the time'
  );
  if (saved === null) {
    row[field] = previous;
    repaintTimes(personId);
  }
}

/**
 * The ⏱ button: whatever the clock says this second.
 *
 * Clicking the button has already moved focus off the input, so its blur
 * handler has run and repaintTimes is free to write the new value in.
 */
function stampNow(personId, field) {
  return saveTime(personId, field, C.nowStored());
}

async function saveReason(personId, value) {
  const row = state.rows.find((r) => r.person_id === personId);
  if (!row || !row.status) return;
  const text = value.trim();
  if (text === (row.reason || '')) return;
  row.reason = text;
  await guard(api.day.mark(personId, state.day, row.status, text), 'Could not save the reason');
  const fresh = await guard(api.day.get(state.day));
  if (fresh) state.reasons = fresh.reasons;
}

function focusRow(delta) {
  const rows = $$('.person');
  if (!rows.length) return;
  const current = document.activeElement?.closest?.('.person');
  let index = current ? rows.indexOf(current) + delta : 0;
  index = Math.max(0, Math.min(rows.length - 1, index));
  const target = rows[index];
  target.setAttribute('tabindex', '-1');
  target.focus();
  target.scrollIntoView({ block: 'nearest' });
}

function wireToday() {
  const body = $('.view');

  body.addEventListener('click', async (event) => {
    const actEl = event.target.closest('[data-act]');
    const act = actEl?.dataset.act;
    const statusBtn = event.target.closest('.segmented button');
    const personEl = event.target.closest('.person');

    if (statusBtn && personEl) {
      return setStatus(Number(personEl.dataset.person), statusBtn.dataset.status);
    }

    if (act === 'stamp' && personEl) {
      return stampNow(Number(personEl.dataset.person), actEl.dataset.field);
    }

    switch (act) {
      case 'prev-day':
        state.day = V.shiftDay(state.day, -1);
        return renderToday();
      case 'next-day':
        state.day = V.shiftDay(state.day, 1);
        return renderToday();
      case 'today':
        state.day = state.info.today;
        return renderToday();
      case 'all-present': {
        if (!state.rows.length) return promptAddPeople();
        const n = await guard(api.day.markAllPresent(state.day), 'Could not mark everyone');
        if (n === 0) return toast('Everyone already has a status for this day.');
        await renderToday();
        return toast(`Marked ${n} ${n === 1 ? 'person' : 'people'} present.`);
      }
      case 'add-people':
        return promptAddPeople();
      case 'add-guest':
        return promptAddGuest();
      case 'clear-day':
        return promptClearDay();
      case 'clear-person':
        return clearStatus(Number(personEl.dataset.person));
      default:
        break;
    }
  });

  const search = $('#today-search');
  search.addEventListener('input', () => {
    state.filter = search.value.trim().toLowerCase();
    renderRoster();
  });

  const dateInput = $('#date-input');
  const commitDate = () => {
    const parsed = V.parseLooseDate(dateInput.value);
    if (!parsed) {
      dateInput.value = state.day;
      return;
    }
    if (parsed !== state.day) {
      state.day = parsed;
      renderToday();
    }
  };
  dateInput.addEventListener('change', commitDate);
  dateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitDate();
  });

  body.addEventListener(
    'blur',
    (event) => {
      const personEl = event.target.closest?.('.person');
      if (!personEl) return;

      if (event.target.classList?.contains('reason-input')) {
        saveReason(Number(personEl.dataset.person), event.target.value);
      } else if (event.target.classList?.contains('time-input')) {
        saveTime(Number(personEl.dataset.person), event.target.dataset.field, event.target.value);
      }
    },
    true
  );

  body.addEventListener('keydown', (event) => {
    const isReason = event.target.classList?.contains('reason-input');
    const isTime = event.target.classList?.contains('time-input');
    if (!isReason && !isTime) return;

    // Enter commits by blurring, which is what already saves. Escape puts the
    // box back the way it was without saving.
    if (event.key === 'Enter') return event.target.blur();
    if (event.key === 'Escape' && isTime) {
      const personEl = event.target.closest('.person');
      const row = state.rows.find((r) => r.person_id === Number(personEl.dataset.person));
      if (row) event.target.value = C.format(row[event.target.dataset.field]);
      event.target.blur();
    }
  });
}

/* Keyboard flow: the difference between 14 clicks and 14 keystrokes. */
document.addEventListener('keydown', (event) => {
  if (state.view !== 'today') return;
  if (!$('#roster')) return;

  const tag = event.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    return focusRow(1);
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    return focusRow(-1);
  }

  const personEl = document.activeElement?.closest?.('.person');
  if (!personEl) return;
  const id = Number(personEl.dataset.person);

  const key = event.key.toLowerCase();
  if (key === 'p') {
    event.preventDefault();
    setStatus(id, 'Present', { focusReason: false });
    focusRow(1);
  } else if (key === 'l') {
    event.preventDefault();
    setStatus(id, 'Late');
  } else if (key === 'a') {
    event.preventDefault();
    setStatus(id, 'Absent');
  } else if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    clearStatus(id);
  }
});

// ---------------------------------------------------------------------------
// dialogs shared across views
// ---------------------------------------------------------------------------

function promptAddPeople() {
  openModal({
    title: 'Add employees',
    subtitle: 'One name per line. Paste a list straight from a spreadsheet if you have one.',
    body: '<textarea id="bulk-names" placeholder="Kareem&#10;Hana&#10;Marwa" spellcheck="false"></textarea>',
    footNote: 'Duplicates are ignored.',
    confirmLabel: 'Add them',
    onConfirm: async (root) => {
      const names = $('#bulk-names', root)
        .value.split('\n')
        .map((line) => line.trim().replace(/[,;]+$/, '').trim())
        .filter(Boolean);
      if (!names.length) return false;

      const added = await guard(api.people.addMany(names), 'Could not add');
      if (added === null) return false;
      await refreshCurrentView();
      toast(`Added ${added} ${added === 1 ? 'employee' : 'employees'}.`);
      return true;
    },
  });
}

function promptAddGuest() {
  openModal({
    title: 'Add a guest',
    subtitle: 'Someone here for today who is not on the employee list.',
    body: '<input class="input" id="guest-name" placeholder="Name" style="width:100%" />',
    confirmLabel: 'Add',
    onConfirm: async (root) => {
      const name = $('#guest-name', root).value.trim();
      if (!name) return false;
      const id = await guard(api.people.add(name, 'walkin'), 'Could not add');
      if (id === null) return false;
      await guard(api.day.mark(id, state.day, 'Present', ''));
      await renderToday();
      toast(`${name} added for today.`);
      return true;
    },
  });
}

async function promptClearDay() {
  const ok = await api.confirm({
    title: 'Clear this day',
    message: `Remove every attendance record for ${state.day}?`,
    detail: 'Other days are not affected.',
    confirmLabel: 'Clear day',
    danger: true,
  });
  if (!ok) return;
  const n = await guard(api.day.clear(state.day), 'Could not clear the day');
  await renderToday();
  toast(`Cleared ${n} ${n === 1 ? 'record' : 'records'}.`);
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

async function renderPeople() {
  viewsEl.innerHTML = V.peopleView();
  await refreshPeople();

  const view = $('.view');
  $('#show-removed').addEventListener('change', (e) => {
    state.showRemoved = e.target.checked;
    refreshPeople();
  });

  const nameInput = $('#new-name');
  const addOne = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const id = await guard(api.people.add(name), 'Could not add');
    if (id === null) return;
    nameInput.value = '';
    await refreshPeople();
    toast(`${name} added.`);
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addOne();
  });

  view.addEventListener('click', async (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    const rowEl = event.target.closest('tr[data-person]');
    const id = rowEl ? Number(rowEl.dataset.person) : null;

    if (act === 'add-one') return addOne();
    if (act === 'add-many') return promptAddPeople();
    if (act === 'rename') return promptRename(id);
    if (act === 'toggle-active') return toggleActive(id);
    if (act === 'promote') return promoteGuest(id);
    if (act === 'delete') return deletePerson(id);
  });

  view.addEventListener('dblclick', (event) => {
    const rowEl = event.target.closest('tr[data-person]');
    if (rowEl) promptRename(Number(rowEl.dataset.person));
  });
}

async function refreshPeople() {
  const people = await guard(
    api.people.list({ includeInactive: state.showRemoved }),
    'Could not load employees'
  );
  if (!people) return;
  state.people = people;

  const counts = await Promise.all(people.map((p) => api.people.count(p.id)));

  $('#people-count').textContent = `${people.length} ${
    people.length === 1 ? 'person' : 'people'
  }`;

  $('#people-body').innerHTML = people
    .map(
      (p, i) => `
      <tr data-person="${p.id}"${p.active ? '' : ' class="muted"'}>
        <td><div class="row-name">${V.avatar(p.name, true)}<span>${V.esc(p.name)}</span></div></td>
        <td>${p.kind === 'roster' ? 'Employee' : '<span class="tag">Guest</span>'}</td>
        <td>${p.active ? 'Active' : '<span class="muted">Removed</span>'}</td>
        <td class="num">${counts[i]}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-act="rename">Rename</button>
          ${p.kind === 'walkin' ? '<button class="btn btn-ghost btn-sm" data-act="promote">Make employee</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-act="toggle-active">${p.active ? 'Remove' : 'Restore'}</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" style="color:var(--danger)">Delete</button>
        </td>
      </tr>`
    )
    .join('');
}

function promptRename(id) {
  const person = state.people.find((p) => p.id === id);
  if (!person) return;
  openModal({
    title: 'Rename',
    subtitle: `Currently “${person.name}”.`,
    body: `<input class="input" id="rename-input" value="${V.esc(person.name)}" style="width:100%" />`,
    confirmLabel: 'Rename',
    onConfirm: async (root) => {
      const name = $('#rename-input', root).value.trim();
      if (!name || name === person.name) return true;
      const result = await guard(api.people.rename(id, name), 'Could not rename');
      if (result === null) return false;
      await refreshPeople();
      toast('Renamed.');
      return true;
    },
  });
}

async function toggleActive(id) {
  const person = state.people.find((p) => p.id === id);
  if (!person) return;
  await guard(api.people.setActive(id, !person.active));
  if (person.active) {
    state.showRemoved = true;
    $('#show-removed').checked = true;
  }
  await refreshPeople();
  toast(person.active ? `${person.name} removed from the daily list.` : `${person.name} restored.`);
}

async function promoteGuest(id) {
  await guard(api.people.promote(id));
  await refreshPeople();
  toast('Now a permanent employee.');
}

async function deletePerson(id) {
  const person = state.people.find((p) => p.id === id);
  if (!person) return;
  const count = await api.people.count(id);
  const ok = await api.confirm({
    title: 'Delete permanently',
    message: `Permanently delete ${person.name}?`,
    detail: count
      ? `This also deletes their ${count} attendance record${count === 1 ? '' : 's'}. ` +
        'This cannot be undone. To keep the history instead, use Remove.'
      : 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await guard(api.people.remove(id), 'Could not delete');
  await refreshPeople();
  toast(`${person.name} deleted.`);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function renderHistory() {
  viewsEl.innerHTML = V.historyView();
  await refreshHistory();

  const view = $('.view');
  ['#h-name', '#h-from', '#h-to'].forEach((sel) =>
    $(sel).addEventListener('change', refreshHistory)
  );
  $('#h-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') refreshHistory();
  });
  $('#h-status').addEventListener('change', refreshHistory);

  view.addEventListener('click', async (event) => {
    const range = event.target.closest('[data-range]')?.dataset.range;
    if (range) {
      const [from, to] =
        range === 'week' ? V.weekBounds() : range === 'month' ? V.monthBounds() : ['', ''];
      $('#h-from').value = from;
      $('#h-to').value = to;
      return refreshHistory();
    }

    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'export-xlsx') return exportRows('xlsx');
    if (act === 'export-csv') return exportRows('csv');

    const rowEl = event.target.closest('tr[data-person]');
    if (rowEl) return showPersonHistory(Number(rowEl.dataset.person));
  });
}

function historyFilters() {
  return {
    nameQuery: $('#h-name').value,
    start: V.parseLooseDate($('#h-from').value),
    end: V.parseLooseDate($('#h-to').value),
    status: $('#h-status').value || null,
  };
}

async function refreshHistory() {
  const rows = await guard(api.history.search(historyFilters()), 'Search failed');
  if (!rows) return;
  state.history = rows;

  $('#history-count').textContent = `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`;

  const body = $('#history-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8">
      <div class="empty" style="padding:48px 0">
        <div class="empty-icon">${V.icons.inbox}</div>
        <h2>Nothing to show</h2>
        <p>No records match these filters.</p>
      </div></td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((r) => {
      const worked = C.formatDuration(C.workedMinutes(r));
      const balance = C.balanceMinutes(r);
      const tone = !balance ? '' : balance > 0 ? ' is-over' : ' is-short';
      return `
      <tr data-person="${r.person_id}">
        <td class="date">${V.esc(r.date)}</td>
        <td><div class="row-name">${V.avatar(r.name, true)}<span>${V.esc(r.name)}</span></div></td>
        <td>${V.statusPill(r.status)}</td>
        <td class="time">${V.timeCell(r.time_in)}</td>
        <td class="time">${V.breakSpan(r)}</td>
        <td class="time">${V.timeCell(r.time_out)}</td>
        <td class="num${tone}"${
          balance ? ` title="${V.esc(C.formatBalance(balance))} against a full day"` : ''
        }>${worked ? V.esc(worked) : '<span class="muted">—</span>'}</td>
        <td>${r.reason ? V.esc(r.reason) : '<span class="muted">—</span>'}</td>
      </tr>`;
    })
    .join('');
}

async function exportRows(format) {
  if (!state.history.length) return toast('Nothing to export with these filters.', { error: true });
  const { start, end } = historyFilters();
  const span = start || end ? `${start || 'start'}_to_${end || state.info.today}` : 'all';
  const name = `attendance_${span}.${format}`;

  const target = await guard(
    format === 'csv' ? api.exports.csv(state.history, name) : api.exports.xlsx(state.history, name),
    'Export failed'
  );
  if (!target) return;
  toast(`Exported ${state.history.length} records.`, {
    action: { label: 'Show file', run: () => api.exports.reveal(target) },
  });
}

async function showPersonHistory(personId) {
  const data = await guard(api.history.person(personId), 'Could not load history');
  if (!data) return;

  const { person, rows } = data;
  const present = rows.filter((r) => r.status === 'Present').length;
  const late = rows.filter((r) => r.status === 'Late').length;
  const absent = rows.filter((r) => r.status === 'Absent').length;
  const rate = rows.length ? Math.round(((present + late) / rows.length) * 100) : 0;

  const totalWorked = rows.reduce((sum, r) => sum + (C.workedMinutes(r) || 0), 0);
  const totalBalance = rows.reduce((sum, r) => sum + (C.balanceMinutes(r) || 0), 0);

  openModal({
    title: person.name,
    subtitle: `${rows.length} recorded ${rows.length === 1 ? 'day' : 'days'}`,
    body: `
      <div class="stat-row">
        <div><span class="n" style="color:var(--present)">${present}</span><span class="l">Present</span></div>
        <div><span class="n" style="color:var(--late)">${late}</span><span class="l">Late</span></div>
        <div><span class="n" style="color:var(--absent)">${absent}</span><span class="l">Absent</span></div>
        <div><span class="n">${rate}%</span><span class="l">Attendance</span></div>
        <div><span class="n">${totalWorked ? V.esc(C.formatDuration(totalWorked)) : '—'}</span><span class="l">Worked</span></div>
        <div><span class="n"${
          totalBalance ? ` style="color:var(--${totalBalance > 0 ? 'present' : 'absent'})"` : ''
        }>${
          totalBalance ? V.esc(C.formatBalance(totalBalance)) : '—'
        }</span><span class="l">Balance</span></div>
      </div>
      <div class="history-list">
        ${
          rows.length
            ? rows
                .map((r) => {
                  const times = [
                    C.format(r.time_in) && `In ${C.format(r.time_in)}`,
                    C.format(r.break_out) &&
                      `Break ${C.format(r.break_out)}–${C.format(r.break_in) || '?'}`,
                    C.format(r.time_out) && `Out ${C.format(r.time_out)}`,
                  ].filter(Boolean);
                  const worked = C.formatDuration(C.workedMinutes(r));
                  const bal = C.balanceMinutes(r);
                  const tone = !bal ? '' : bal > 0 ? ' is-over' : ' is-short';
                  return `<div class="history-row">
                    <span class="date">${V.esc(r.date)}</span>
                    ${V.statusPill(r.status)}
                    <span class="reason">${
                      times.length
                        ? `<span class="times">${V.esc(times.join(' · '))}</span>`
                        : ''
                    }${r.reason ? V.esc(r.reason) : ''}</span>
                    <span class="worked${tone}">${worked ? V.esc(worked) : ''}</span>
                  </div>`;
                })
                .join('')
            : '<p class="muted">No records yet.</p>'
        }
      </div>`,
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function renderReports() {
  viewsEl.innerHTML = V.reportsView();
  await refreshReports();

  const view = $('.view');
  view.addEventListener('click', async (event) => {
    const range = event.target.closest('[data-range]')?.dataset.range;
    if (range) {
      const [from, to] =
        range === 'week' ? V.weekBounds() : range === 'month' ? V.monthBounds() : ['', ''];
      $('#r-from').value = from;
      $('#r-to').value = to;
      return refreshReports();
    }

    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'apply-range') return refreshReports();
    if (act === 'export-report') {
      const { stats, reasons, rows } = state.reports || {};
      if (!rows?.length) return toast('No records in this range.', { error: true });
      const target = await guard(api.exports.report(rows, stats, reasons), 'Export failed');
      if (target) {
        toast('Report saved.', {
          action: { label: 'Show file', run: () => api.exports.reveal(target) },
        });
      }
      return;
    }
    if (act === 'backup') {
      const target = await guard(api.exports.backup(), 'Backup failed');
      if (target) toast('Backup saved.');
      return;
    }
    if (act === 'save-copy') {
      const target = await guard(api.exports.database(), 'Could not save a copy');
      if (target) {
        toast('Copy saved.', {
          action: { label: 'Show file', run: () => api.exports.reveal(target) },
        });
      }
      return;
    }
    if (act === 'check-updates') {
      toast('Checking for updates…');
      return api.update.check();
    }
  });
}

async function refreshReports() {
  const start = V.parseLooseDate($('#r-from').value);
  const end = V.parseLooseDate($('#r-to').value);
  const data = await guard(api.reports.load(start, end), 'Could not build the report');
  if (!data) return;
  state.reports = data;

  const { stats, reasons, overall, rows } = data;
  const absent = rows.filter((r) => r.status === 'Absent').length;
  const late = rows.filter((r) => r.status === 'Late').length;
  const rate = rows.length ? Math.round(((rows.length - absent) / rows.length) * 100) : 0;

  // Hours are added up from the records rather than asked of the database:
  // the figure comes from four columns, which is arithmetic SQL should not do.
  const workedByPerson = new Map();
  const balanceByPerson = new Map();
  let workedTotal = 0;
  let balanceTotal = 0;
  for (const row of rows) {
    const minutes = C.workedMinutes(row);
    if (minutes === null) continue;
    workedByPerson.set(row.person_id, (workedByPerson.get(row.person_id) || 0) + minutes);
    workedTotal += minutes;

    const balance = C.balanceMinutes(row);
    balanceByPerson.set(row.person_id, (balanceByPerson.get(row.person_id) || 0) + balance);
    balanceTotal += balance;
  }

  $('#reports-range').textContent =
    start || end ? `${start || 'the beginning'} → ${end || 'today'}` : 'All time';

  $('#reports-summary').innerHTML = `
    <span><strong>${rows.length}</strong> records</span>
    <span><strong>${rate}%</strong> overall attendance</span>
    <span><strong>${absent}</strong> absences</span>
    <span><strong>${late}</strong> late</span>
    <span><strong>${overall.days}</strong> days recorded</span>
    ${
      workedTotal
        ? `<span><strong>${V.esc(C.formatDuration(workedTotal))}</strong> worked</span>`
        : ''
    }
    ${
      balanceTotal
        ? `<span style="color:var(--${balanceTotal > 0 ? 'present' : 'absent'})"><strong>${V.esc(
            C.formatBalance(balanceTotal)
          )}</strong> against full days</span>`
        : ''
    }
    <span class="muted">${overall.firstDate || '—'} to ${overall.lastDate || '—'}</span>`;

  $('#reports-body').innerHTML = stats
    .map((s) => {
      const recorded = s.recorded || 0;
      const attended = (s.present || 0) + (s.late || 0);
      const pct = recorded ? Math.round((attended / recorded) * 100) : null;
      const cls = pct === null ? '' : pct >= 90 ? '' : pct >= 75 ? ' is-mid' : ' is-low';
      const worked = C.formatDuration(workedByPerson.get(s.person_id) || null);
      const balance = balanceByPerson.get(s.person_id) || 0;
      return `
        <tr>
          <td><div class="row-name">${V.avatar(s.name, true)}<span>${V.esc(s.name)}${
            s.active ? '' : ' <span class="muted">(removed)</span>'
          }</span></div></td>
          <td class="num">${recorded}</td>
          <td class="num">${s.present || 0}</td>
          <td class="num">${s.late || 0}</td>
          <td class="num"${s.absent ? ' style="color:var(--absent);font-weight:560"' : ''}>${s.absent || 0}</td>
          <td class="num">${worked ? V.esc(worked) : '<span class="muted">—</span>'}</td>
          <td class="num${!balance ? '' : balance > 0 ? ' is-over' : ' is-short'}">${
            balance ? V.esc(C.formatBalance(balance)) : '<span class="muted">—</span>'
          }</td>
          <td>
            ${
              pct === null
                ? '<span class="muted">—</span>'
                : `<div style="display:flex;align-items:center;gap:8px">
                     <div class="bar-track"><div class="bar-fill${cls}" style="width:${pct}%"></div></div>
                     <span style="font-variant-numeric:tabular-nums;font-size:12.5px;width:34px;text-align:right">${pct}%</span>
                   </div>`
            }
          </td>
        </tr>`;
    })
    .join('');

  $('#reasons-list').innerHTML = reasons.length
    ? reasons
        .map(
          (r) => `<div class="history-row">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${V.esc(r.reason)}</span>
            <strong style="font-variant-numeric:tabular-nums">${r.n}</strong>
          </div>`
        )
        .join('')
    : '<p class="muted">No reasons recorded yet.</p>';
}


// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function renderSettings() {
  viewsEl.innerHTML = V.settingsView();
  await refreshSettings();

  const view = $('.view');

  view.addEventListener('change', async (event) => {
    const id = event.target.id;
    if (id === 'set-frequency') return saveSetting({ backupFrequency: event.target.value });
    if (id === 'set-theme') {
      const dark = await guard(api.setTheme(event.target.value), 'Could not change the theme');
      if (dark !== null) applyTheme(dark);
      syncThemeSwitch(event.target.value);
      return;
    }
    if (id === 'set-auto-update') return saveSetting({ autoCheckUpdates: event.target.checked });
    if (id === 'set-keep') {
      const saved = await saveSetting({ backupsToKeep: Number(event.target.value) });
      // The main process clamps, so show what actually took effect.
      if (saved) event.target.value = saved.backupsToKeep;
    }
  });

  view.addEventListener('click', async (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    const rowEl = event.target.closest('.backup-row');

    switch (act) {
      case 'backup-now': {
        const target = await guard(api.backups.now(), 'Backup failed');
        if (!target) return;
        await refreshSettings();
        return toast('Backup saved.', {
          action: { label: 'Show file', run: () => api.exports.reveal(target) },
        });
      }
      case 'choose-backup-dir': {
        const saved = await guard(api.settings.chooseBackupDir(), 'Could not change the folder');
        if (!saved) return;
        await refreshSettings();
        return toast('Backups will be kept there from now on.');
      }
      case 'open-backups':
        return guard(api.settings.openPath('backups'), 'Could not open the folder');
      case 'open-data':
        return guard(api.settings.openPath('data'), 'Could not open the folder');
      case 'save-copy': {
        const target = await guard(api.exports.database(), 'Could not save a copy');
        if (target) {
          toast('Copy saved.', {
            action: { label: 'Show file', run: () => api.exports.reveal(target) },
          });
        }
        return;
      }
      case 'restore-backup':
        return confirmRestore(rowEl?.dataset.file, $('.backup-name', rowEl)?.textContent);
      case 'restore-file':
        return confirmRestore(null, 'the file you choose');
      case 'check-updates':
        toast('Checking for updates…');
        return api.update.check();
      default:
        break;
    }
  });
}

async function refreshSettings() {
  const info = await guard(api.settings.get(), 'Could not load settings');
  if (!info) return;
  const backups = (await guard(api.backups.list())) || [];

  state.settings = info;
  $('#settings-body').innerHTML = V.settingsBody(info, backups);
  $('#settings-note').textContent = backups.length
    ? `${backups.length} backup${backups.length === 1 ? '' : 's'} kept`
    : 'No backups yet';

  const version = $('#settings-version');
  if (version) version.textContent = `v${state.info?.version || ''}`;
}

async function saveSetting(patch) {
  const saved = await guard(api.settings.set(patch), 'Could not save that setting');
  if (saved) state.settings = { ...state.settings, values: saved };
  return saved;
}

/**
 * Restoring overwrites everything, so it asks first and says plainly what it
 * is about to replace — and that the current records are copied first.
 */
async function confirmRestore(file, label) {
  const ok = await api.confirm({
    title: 'Restore from a backup',
    message: `Replace all current records with ${label || 'this backup'}?`,
    detail:
      'Everything currently in the app is replaced. A copy of the current ' +
      'records is saved to your backups folder first, so this can be undone.',
    confirmLabel: 'Restore',
    danger: true,
  });
  if (!ok) return;

  const result = await guard(api.backups.restore(file || null), 'Restore failed');
  if (!result) return;

  await refreshSettings();
  toast('Restored. Your previous records were saved as a backup first.');
}

/** Keep the sidebar theme buttons in step with the Settings dropdown. */
function syncThemeSwitch(mode) {
  $$('#theme-switch button').forEach((b) => b.classList.toggle('is-active', b.dataset.theme === mode));
}

// ---------------------------------------------------------------------------
// routing / boot
// ---------------------------------------------------------------------------

const renderers = {
  today: renderToday,
  people: renderPeople,
  history: renderHistory,
  reports: renderReports,
  settings: renderSettings,
};

async function go(view) {
  state.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  await renderers[view]();
}

async function refreshCurrentView() {
  await renderers[state.view]();
}

function wireChrome() {
  $('#nav').addEventListener('click', (event) => {
    const btn = event.target.closest('.nav-item');
    if (btn) go(btn.dataset.view);
  });

  $('#theme-switch').addEventListener('click', async (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    syncThemeSwitch(btn.dataset.theme);
    const dark = await api.setTheme(btn.dataset.theme);
    applyTheme(dark);
    const select = $('#set-theme');
    if (select) select.value = btn.dataset.theme;
  });

  $('#open-folder').addEventListener('click', () => api.openDataFolder());

  api.onThemeChanged(applyTheme);

  // Updates
  api.update.onAvailable((info) => {
    state.update = { ...info, stage: 'available' };
    showUpdateBanner();
  });
  api.update.onProgress((p) => {
    state.update = { ...state.update, stage: 'downloading', percent: p.percent };
    showUpdateBanner();
  });
  api.update.onReady(() => {
    state.update = { ...state.update, stage: 'ready' };
    showUpdateBanner();
  });
  api.update.onNone(() => toast('You are on the latest version.'));
  api.update.onError(({ message }) => toast(`Update check failed: ${message}`, { error: true }));

  $('#update-dismiss').addEventListener('click', () => {
    $('#update-banner').hidden = true;
  });

  $('#update-action').addEventListener('click', async () => {
    if (state.update?.stage === 'ready') return api.update.install();
    $('#update-action').disabled = true;
    await api.update.download();
  });
}

function showUpdateBanner() {
  const banner = $('#update-banner');
  const { stage, version, percent } = state.update || {};
  banner.hidden = false;

  if (stage === 'downloading') {
    $('#update-title').textContent = 'Downloading update…';
    $('#update-sub').textContent = `${Math.round(percent || 0)}%`;
    $('#update-action').disabled = true;
    $('#update-action').textContent = 'Downloading';
  } else if (stage === 'ready') {
    $('#update-title').textContent = `Version ${version} is ready`;
    $('#update-sub').textContent = 'Restart to finish installing. Your data is not affected.';
    $('#update-action').disabled = false;
    $('#update-action').textContent = 'Restart now';
  } else {
    $('#update-title').textContent = `Version ${version} is available`;
    $('#update-sub').textContent = `You have ${state.info?.version || ''}.`;
    $('#update-action').disabled = false;
    $('#update-action').textContent = 'Update';
  }
}

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

async function boot() {
  state.info = await api.info();
  state.day = state.info.today;
  applyTheme(state.info.dark);
  syncThemeSwitch(state.info.theme || 'system');

  $('#version-label').textContent = `v${state.info.version}`;

  if (state.info.usingFallback) {
    toast('This folder is read-only, so data is stored in your user profile instead.');
  }

  wireChrome();
  await go('today');
}

boot();
})();
