#!/usr/bin/env node
/**
 * stop hook: if the session likely edited GorGox code, remind the agent to
 * finish the regression gate (followup once).
 */
'use strict';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

(async () => {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw && raw.trim()) payload = JSON.parse(raw);
  } catch (_) {
    payload = {};
  }

  // Avoid infinite stop loops
  const status = String(payload.status || payload.reason || '');
  const loopCount = Number(payload.loop_count || payload.followup_count || 0);
  if (loopCount > 0) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  const followup_message = [
    'Before ending: run the GorGox regression gate.',
    '1) Read and follow `.cursor/skills/gorgox-regression-gate/SKILL.md`.',
    '2) Run `node .cursor/skills/gorgox-regression-gate/scripts/smoke.js`.',
    '3) Verify Core Never-Break items (token move, map, combat, action dock, notes).',
    '4) Report PASS/FAIL. Fix any failures — new features must not break older ones.'
  ].join(' ');

  // Only nudge when this looks like a normal agent stop after work
  if (status && /abort|error|cancel/i.test(status)) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({ followup_message }));
  process.exit(0);
})();
