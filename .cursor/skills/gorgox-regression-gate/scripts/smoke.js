#!/usr/bin/env node
/**
 * GorGox Interactive automated smoke checks.
 * Exit 0 = pass, 1 = fail.
 *
 * Usage:
 *   node .cursor/skills/gorgox-regression-gate/scripts/smoke.js
 *   node .cursor/skills/gorgox-regression-gate/scripts/smoke.js --rust
 *   node .cursor/skills/gorgox-regression-gate/scripts/smoke.js --url http://127.0.0.1:3000
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const args = new Set(process.argv.slice(2));
const wantRust = args.has('--rust');
const urlIdx = process.argv.indexOf('--url');
const BASE_URL = urlIdx >= 0 && process.argv[urlIdx + 1]
  ? process.argv[urlIdx + 1].replace(/\/$/, '')
  : 'http://127.0.0.1:3000';

const failures = [];
const warnings = [];

function ok(msg) {
  console.log('  PASS  ' + msg);
}
function fail(msg) {
  failures.push(msg);
  console.log('  FAIL  ' + msg);
}
function warn(msg) {
  warnings.push(msg);
  console.log('  WARN  ' + msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function nodeCheck(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], {
    encoding: 'utf8',
    shell: false
  });
  if (r.status === 0) ok('syntax ' + rel);
  else fail('syntax ' + rel + ': ' + (r.stderr || r.stdout || 'unknown error').trim());
}

function mustContain(rel, needles, label) {
  const text = read(rel);
  let missing = 0;
  for (const n of needles) {
    if (!text.includes(n)) {
      missing += 1;
      fail(label + ' missing `' + n + '` in ' + rel);
    }
  }
  if (!missing) ok(label + ' (' + needles.length + ' checks) in ' + rel);
}

console.log('GorGox smoke — root: ' + ROOT);
console.log('');

console.log('1) Required files');
[
  'static/app.js',
  'static/index.html',
  'static/style.css',
  'static/js/action-dock.js',
  'static/js/ui-shell.js',
  'src/server.rs',
  'src/game_state.rs'
].forEach((rel) => {
  if (exists(rel)) ok('exists ' + rel);
  else fail('missing ' + rel);
});

console.log('\n2) JS syntax');
[
  'static/app.js',
  'static/js/action-dock.js',
  'static/js/ui-shell.js'
].forEach((rel) => {
  if (exists(rel)) nodeCheck(rel);
});
if (exists('discord-bot/index.js')) nodeCheck('discord-bot/index.js');

console.log('\n3) Critical client symbols');
mustContain('static/app.js', [
  'function clientToWorld',
  'function clientToCanvasBuffer',
  'function onCanvasMouseDown',
  'function onCanvasMouseUp',
  'function onCanvasMouseMove',
  "type: 'MoveToken'",
  'mapPanCandidate',
  'function updatePlayerActionBarVisibility',
  'function ensurePlayerActionBarExists',
  'playerActionBar',
  'function downloadMapAsPng'
], 'core canvas/action-bar');

mustContain('static/js/action-dock.js', [
  'global.ActionDock',
  'applyLayout',
  'actionDockMode'
], 'action dock module');

mustContain('static/js/ui-shell.js', [
  'global.UIShell',
  'initSidebarResize',
  'renderPlayerCard'
], 'ui-shell module');

console.log('\n4) Index script order & IDs');
if (exists('static/index.html')) {
  const html = read('static/index.html');
  const dockPos = html.indexOf('action-dock.js');
  const shellPos = html.indexOf('ui-shell.js');
  const appPos = html.indexOf('/static/app.js');
  if (dockPos >= 0 && appPos >= 0 && dockPos < appPos) ok('action-dock.js loads before app.js');
  else fail('action-dock.js must load before app.js in index.html');
  if (shellPos >= 0 && appPos >= 0 && shellPos < appPos) ok('ui-shell.js loads before app.js');
  else fail('ui-shell.js must load before app.js in index.html');

  [
    'id="mapCanvas"',
    'id="playerActionBar"',
    'id="tokenInfo"',
    'id="playerList"',
    'id="sidebarLeft"',
    'id="sidebarRight"'
  ].forEach((id) => {
    if (html.includes(id)) ok('html has ' + id);
    else fail('html missing ' + id);
  });

  if (/id="mapEmptyState"/.test(html)) {
    fail('mapEmptyState overlay present — blocks / confuses map interaction');
  } else {
    ok('no mapEmptyState overlay');
  }
}

console.log('\n5) Known-bad regression patterns');
if (exists('static/app.js')) {
  const app = read('static/app.js');
  // Old broken mouse math (unscaled) still used as primary path
  const badMouse = /const mouseX = \(e\.clientX - rect\.left - panX\) \/ zoom/;
  if (badMouse.test(app)) {
    fail('legacy unscaled mouse math still present (breaks CSS-scaled canvas)');
  } else {
    ok('no legacy unscaled mouseX formula');
  }

  // Empty click must not unconditionally pan-lock MoveToken
  const emptyPan = /} else \{\s*isDragging = true;\s*dragStartX = e\.clientX - panX;/s;
  if (emptyPan.test(app)) {
    fail('empty-cell mousedown still forces isDragging=true (blocks MoveToken)');
  } else {
    ok('empty-cell pan uses mapPanCandidate threshold path');
  }

  if (!app.includes('clientToWorld(')) fail('clientToWorld() never called');
  else ok('clientToWorld() is used');
}

console.log('\n6) Server MoveToken path');
if (exists('src/server.rs')) {
  mustContain('src/server.rs', ['ClientMessage::MoveToken', 'move_token'], 'server MoveToken');
}
if (exists('src/game_state.rs')) {
  mustContain('src/game_state.rs', ['fn move_token'], 'game_state move_token');
}

if (wantRust) {
  console.log('\n7) cargo check');
  const cargo = spawnSync('cargo', ['check', '--quiet'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 300000
  });
  if (cargo.status === 0) ok('cargo check');
  else fail('cargo check failed: ' + (cargo.stderr || cargo.stdout || '').split('\n').slice(-20).join('\n'));
} else {
  console.log('\n7) cargo check skipped (pass --rust to enable)');
}

console.log('\n8) Live server probe (optional)');
(async () => {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    const res = await fetch(BASE_URL + '/api/test', { signal: ac.signal });
    clearTimeout(t);
    if (res.ok) ok('GET ' + BASE_URL + '/api/test → ' + res.status);
    else warn('GET /api/test → HTTP ' + res.status);
  } catch (e) {
    warn('server not reachable at ' + BASE_URL + ' (' + (e.cause && e.cause.code ? e.cause.code : e.message) + ') — start with start.bat for live checks');
  }

  console.log('');
  if (warnings.length) {
    console.log('Warnings (' + warnings.length + '):');
    warnings.forEach((w) => console.log('  - ' + w));
  }
  if (failures.length) {
    console.log('FAILED (' + failures.length + '):');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('SMOKE PASS');
  process.exit(0);
})();
