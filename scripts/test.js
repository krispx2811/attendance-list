#!/usr/bin/env node
'use strict';

/**
 * Test runner.
 *
 * Runs the suite through Electron's bundled Node (ELECTRON_RUN_AS_NODE) so
 * the native better-sqlite3 binding is loaded under exactly the ABI the app
 * itself uses. Running under the system Node can pass while the packaged app
 * fails, which is the worst kind of green build.
 *
 * Falls back to the system Node when Electron is not installed.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const args = ['--test', 'tests/db.test.js'];

let command = process.execPath;
const env = { ...process.env };

try {
  const electron = require('electron');
  if (typeof electron === 'string' && fs.existsSync(electron)) {
    command = electron;
    env.ELECTRON_RUN_AS_NODE = '1';
    console.log('Running tests under Electron’s Node runtime.\n');
  }
} catch {
  console.log('Electron not found — running tests under the system Node.\n');
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env,
});

process.exit(result.status ?? 1);
