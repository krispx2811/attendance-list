'use strict';

/**
 * The renderer's entire view of the outside world.
 *
 * contextIsolation is on and nodeIntegration off, so the UI can only do what
 * is listed here. Every call unwraps the {ok, data, error} envelope the main
 * process returns and throws on failure, so renderer code can use plain
 * try/catch.
 */

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result) throw new Error(`No response from ${channel}`);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const on = (channel, handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  info: () => call('app:info'),
  openDataFolder: () => call('app:openDataFolder'),
  setTheme: (mode) => call('app:setTheme', mode),
  onThemeChanged: (handler) => on('theme:changed', handler),

  people: {
    list: (opts) => call('people:list', opts),
    add: (name, kind) => call('people:add', name, kind),
    addMany: (names) => call('people:addMany', names),
    rename: (id, name) => call('people:rename', id, name),
    setActive: (id, active) => call('people:setActive', id, active),
    promote: (id) => call('people:promote', id),
    remove: (id) => call('people:delete', id),
    count: (id) => call('people:count', id),
  },

  day: {
    get: (day) => call('day:get', day),
    mark: (id, day, status, reason) => call('day:mark', id, day, status, reason),
    markAllPresent: (day) => call('day:markAllPresent', day),
    unmark: (id, day) => call('day:unmark', id, day),
    clear: (day) => call('day:clear', day),
  },

  history: {
    search: (filters) => call('history:search', filters),
    person: (id) => call('history:person', id),
  },

  reports: {
    load: (start, end) => call('reports:load', start, end),
  },

  exports: {
    csv: (rows, name) => call('export:csv', rows, name),
    xlsx: (rows, name) => call('export:xlsx', rows, name),
    report: (rows, stats, reasons) => call('export:report', rows, stats, reasons),
    database: () => call('export:database'),
    backup: () => call('backup:now'),
    reveal: (filePath) => call('shell:showItem', filePath),
  },

  confirm: (options) => call('dialog:confirm', options),

  update: {
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    page: () => call('update:page'),
    onAvailable: (handler) => on('update:available', handler),
    onNone: (handler) => on('update:none', handler),
    onProgress: (handler) => on('update:progress', handler),
    onReady: (handler) => on('update:ready', handler),
    onError: (handler) => on('update:error', handler),
  },
});
