#!/usr/bin/env node
/**
 * afterFileEdit hook: run GorGox smoke when VTT-relevant files change,
 * and inject follow-up context so the agent runs the regression skill.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function relFromRoot(filePath, root) {
  const abs = path.resolve(filePath);
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  return rel;
}

function isRelevant(rel) {
  return /^(static\/|src\/|discord-bot\/|\.cursor\/skills\/gorgox-regression-gate\/)/.test(rel)
    || /\.(js|css|html|rs)$/.test(rel);
}

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw && raw.trim()) payload = JSON.parse(raw);
  } catch (_) {
    payload = {};
  }

  const candidates = []
    .concat(payload.file_path ? [payload.file_path] : [])
    .concat(payload.path ? [payload.path] : [])
    .concat(Array.isArray(payload.files) ? payload.files : [])
    .concat(payload.uri ? [payload.uri] : []);

  const rels = candidates
    .filter(Boolean)
    .map((p) => relFromRoot(String(p).replace(/^file:\/\//, ''), root));

  const relevant = rels.filter(isRelevant);
  if (!relevant.length && rels.length) {
    // Non-relevant edit — stay quiet
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  const smokePath = path.join(root, '.cursor', 'skills', 'gorgox-regression-gate', 'scripts', 'smoke.js');
  const wantRust = relevant.some((r) => r.startsWith('src/') || r.endsWith('.rs'));
  const args = [smokePath];
  if (wantRust) args.push('--rust');

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: wantRust ? 300000 : 60000
  });

  const out = ((result.stdout || '') + (result.stderr || '')).trim();
  const passed = result.status === 0;
  const edited = (relevant.length ? relevant : rels).slice(0, 8).join(', ') || '(unknown file)';

  const additional_context = [
    'GorGox regression gate (afterFileEdit):',
    '- Edited: ' + edited,
    '- Automated smoke: ' + (passed ? 'PASS' : 'FAIL'),
    passed ? null : '- Smoke output (tail):',
    passed ? null : out.split(/\r?\n/).slice(-40).join('\n'),
    '- REQUIRED: follow project skill `.cursor/skills/gorgox-regression-gate/SKILL.md` before finishing.',
    '- Re-verify Core Never-Break (token move, connect, map, combat basics, action dock, notes).',
    '- New features must not break older ones. Fix smoke/core failures before claiming done.'
  ].filter((line) => line !== null).join('\n');

  process.stdout.write(JSON.stringify({ additional_context }));
  process.exit(0);
})();
