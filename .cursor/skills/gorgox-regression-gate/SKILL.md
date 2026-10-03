---
name: gorgox-regression-gate
description: >-
  Run GorGox Interactive regression testing after code edits so new work does
  not break older features. Use after every edit to static/, src/, discord-bot/,
  or .cursor/; when finishing a feature/bugfix; before saying work is done;
  or when the user asks to verify nothing is broken, smoke-test, or regression-test.
---

# GorGox Regression Gate

New features must not break older ones. After **any** code edit in this repo, run this gate before finishing.

## Mandatory workflow

Copy and track:

```
Regression Gate:
- [ ] 1. Impact map (what can break)
- [ ] 2. Automated smoke (`node .cursor/skills/gorgox-regression-gate/scripts/smoke.js`)
- [ ] 3. Tier checks for touched areas
- [ ] 4. Core never-break suite (always)
- [ ] 5. Fix failures, re-run smoke, re-check core
- [ ] 6. Report results to user
```

Do **not** tell the user the task is complete while any Core Never-Break item is unchecked or failing.

## Step 1 — Impact map

From the diff / edited files, list likely regressions:

| Touched path | High-risk areas |
|--------------|-----------------|
| `static/app.js` | Token move/select, combat, WS messages, action bar, notes, sheets |
| `static/style.css` / `static/index.html` | Canvas hit-testing (CSS scale), overlays blocking map, dock/sidebars |
| `static/js/action-dock.js` / `ui-shell.js` | Dock layout, sidebar resize, action bar visibility |
| `src/**` | MoveToken, combat, maps, saves, API routes |
| `discord-bot/**` | HighlightCharacter / WS connect |
| `static/js/sw5e-builder/**` | Character wizard (must not break map/combat) |

## Step 2 — Automated smoke (always)

From repo root:

```bash
node .cursor/skills/gorgox-regression-gate/scripts/smoke.js
```

Optional: `node .cursor/skills/gorgox-regression-gate/scripts/smoke.js --rust` when `src/` changed.

Fail = stop and fix before more feature work.

## Step 3 — Tier checks

Use [checklist.md](checklist.md).

- **Always**: Core Never-Break (below) + smoke
- **Also run** every checklist section whose files were touched
- **Full checklist** when the change is broad (shell/layout, canvas input, WS protocol, combat) or the user asks for full verification

Prefer executable proof: smoke script, `cargo check`, browser MCP against `http://localhost:3000`, or targeted code-path verification. Do not claim “tested” from reading code alone when the risk is runtime (token move, dock, WS).

## Step 4 — Core Never-Break (always)

These failed before; protect them every time:

1. **Token move (DM + player)** — select token → click destination moves; drag-from-token moves; empty drag still pans. Uses `clientToWorld` / CSS-scale-safe coords.
2. **Connect** — DM and player can connect; roles correct.
3. **Map load** — map image draws; pan/zoom; fit/center controls work.
4. **Combat basics** — start combat, next turn, damage/heal on selected token still wire.
5. **Action bar** — show/hide; stays docked between sidebars (not flying/jumping); resize/collapse do not steal map clicks.
6. **Notes tab** — open Notes; edit persists (no wipe on tab switch/refresh path).
7. **No overlay eat-clicks** — map empty-state overlays must not block the canvas; measurement tool off unless intentional.

## Known regression patterns (reject these)

- Re-adding full-width `cssText !important` on `#playerActionBar`
- Canvas mouse math that ignores CSS scale (`clientX - rect.left - panX` without `clientToWorld`)
- Empty-cell `mousedown` always setting `isDragging = true` (blocks MoveToken on mouseup)
- Leaving `measurementToolType` stuck on after UI work
- Absolute overlays over `.map-view-stack` with `pointer-events` capturing clicks
- Removing `MoveToken` / `clientToWorld` / `ActionDock` / script load order (`action-dock.js` before `app.js`)

## Step 5 — Report format

```markdown
## Regression gate
- Smoke: PASS|FAIL (summary)
- Core never-break: PASS|FAIL
- Extra tiers run: [list]
- Failures found: [none | bullets]
- Fixes applied: [none | bullets]
```

## Additional resources

- Full feature matrix: [checklist.md](checklist.md)
- Smoke script: [scripts/smoke.js](scripts/smoke.js)
