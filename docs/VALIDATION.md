# Validation and review checkpoint

## Immediate power casting — October 3, 2026

- Tech and Force powers cast immediately without DM approval. Leveled powers keep their casting-level input; at-will powers explain their character-level scaling without an editable level field. The shared Rolls log records the cast, point cost, available effect rolls, and supported target results, without the power description.
- Changing the level refreshes the preview's dice, cost, save DC, and higher-level rules. All 465 imported power descriptions retain their dice formulas and casting metadata; at-will damage uses character-level scaling.
- Electroshock, Explosion, and Kolto Pack apply their supported effects automatically. Other powers spend points and log their available dice rolls, with complex target effects applied manually. Full rules remain available in the preview.
- All 15 Rust tests, 10 focused DM/player casting checks, and 17 tabletop regression checks pass. Browser checks report no page errors. Results: `power-casting-results.json` and `power-tabletop-results.json`.
- Browser tests ran in an isolated campaign copy on port 3001. Updating the live preview preserved all nine character sheets, both tokens, and session extras, verified against the pre-update snapshot.

Completed October 3, 2026, through Phase 8 after the user reviewed Phase 7 and authorized continuing.

## Completed checks

- `cargo test --offline --locked`: 13 passing Rust tests.
- `cargo build --release --offline --locked`: successful optimized build. The existing Windows launcher can use the updated release executable.
- `node scripts/verify-syntax.cjs`: 27 changed/new JavaScript files parse successfully.
- `node scripts/character-rules-test.cjs`: character calculation checks pass, including equipment, ability damage, Armstech bonuses, imported resource values, and manual overrides.
- DM/player browser regression: 17 checks pass with no page errors. Results: `phase5-7-regression-results.json`.
- Builder and presentation browser checks: 6 checks pass with no page errors. These cover builder search, species choices, level-up validation and undo, notes, copied Discord-link persistence, and actual STL rotation and rendered restore. Results: `progression-presentation-results.json`.
- Real server restart: character HP/resources survive restart; a saved session restores combat, tokens, and session extras. Results: `restart-results.json`.
- Phase 8 sight walkthrough: 8 checks pass without page errors, including actual fog pixels, both DM-selectable modes, door/undo behavior, manual reveal/hide precedence, editing/canceling, validation, cached HP updates, movement, reconnect and map-local restore. Results: `phase8-vision-results.json`.
- Final existing tabletop suite: all 17 checks pass against the Phase 8 backend. Results: `phase8-tabletop-regression-results.json`.
- Actual player 3D presentation: sight prevents opening 3D; disabling sight opens it; enabling sight closes it and restores masked 2D without page errors. Results: `phase8-presentation-results.json`.
- Final restart check loads the saved map from the copied database, including walls, doors and vision mode. Results: `phase8-restart-results.json`.
- `node scripts/vision-geometry-test.cjs`: corners, gaps, range, collinear walls and door rules pass; a 250-wall/50-vision-source benchmark passes. Timings depend on wall layout and machine; cached unrelated updates do not rebuild polygons.
- Source campaign database and save hashes remain unchanged. Results: `source-data-verification.json`.
- `git diff --check`: passes.

The Rust build reports three existing dead-code warnings; these do not prevent the build or tests.

## Reproducing the browser checks

Use a disposable campaign copy, with the normal app stopped so port 3000 is available:

```powershell
python -B scripts/phase0-session.py --run
```

The helper prints the disposable session directory. In a second terminal, substitute that directory below:

```powershell
node scripts/tabletop-regression.cjs <session-directory> <playwright-module-path> 7
node scripts/progression-presentation-smoke.cjs <session-directory> <playwright-module-path>
node scripts/vision-smoke.cjs <session-directory> <playwright-module-path>
python -B scripts/verify-source-data.py <session-directory>/manifest.json
```

The helper copies campaign data, disables paid generation, and directs Discord-link writes into the copy. The browser scripts require Playwright and Microsoft Edge. Replace `<playwright-module-path>` with the installed Playwright module directory, or omit it where Playwright is available as a normal dependency (the tabletop suite still needs its final phase argument).

To verify an actual process restart, run `node scripts/restart-smoke.cjs <session-directory> prepare`, stop only the verified disposable server, then run `python -B scripts/phase0-session.py --reuse <session-directory> --run`. Finally run `node scripts/restart-smoke.cjs <session-directory> verify`. The verify stage loads the saved map from the copied database and compares it to the pre-restart state. Confirm the served `/static/phase0-session.json` marker and the session's `server-process.json` executable/PID before stopping a process.

## Scope of the evidence

Browser checks use separate DM and player contexts on local copied data. Live Discord voice and paid Meshy generation were not exercised. Rules automation covers the supported powers and character calculations documented in `TABLETOP_CONTROLS.md` and `SW5E_RULES.md`; complex species, multiclass progression, and unsupported powers retain manual handling.

The app retains its trusted-friends, self-selected DM model. Private drawings and automatic sight are hidden in the player interface; this is not an authenticated private-network boundary. Automatic sight is opt-in and applies to 2D; player 3D returns when sight is off. Movement, attacks and lighting remain manual. Exact rules are in `LINE_OF_SIGHT_SCOPE.md`.

Review the new controls in `TABLETOP_CONTROLS.md` and the delivered phases in `IMPROVEMENT_ROADMAP.md`.
