# Phase 0 baseline

Recorded October 2, 2026, America/New_York. Source commit: `4f3105ac8548412412ef76cb18f536e9aa793dda` (`update`).

## Scope and working tree

The gameplay source was clean at the start of this phase. The only untracked material was the previously created roadmap under `docs/`. No applicable `AGENTS.md` was found in the repository or the checked parent directories.

Phase 0 adds a disposable-session preparation helper, a repeatable two-browser smoke runner, this baseline report, and a roadmap status update. It does not fix the failures identified below or change production gameplay code.

## Build and syntax baseline

- Rust: `rustc 1.90.0`, Cargo `1.90.0`; Node `v24.11.0`.
- `cargo build --offline --locked`: **PASS**, debug executable built from current source.
- `cargo test --offline --locked`: **FAIL before execution**, error E0063 at `src/combat.rs:124` and `:134`. Both existing test fixtures omit the required `CombatParticipant.initiative_bonus` field. The production executable builds; no Rust test was executed successfully.
- Classic JavaScript syntax: **PASS** for `static/app.js`, `action-dock.js`, `ui-shell.js`, `arena3d-boot.js`, and `discord-bot/index.js`.
- Module JavaScript syntax: **PASS** for the active `arena3d.module.js` and all nine SW5E builder modules.
- Cargo's initial sandboxed test attempt was blocked while unpacking a cached dependency. The approved rerun reached the compiler failure above. That permission failure is separate from the source-code test failure.
- The local Cargo lockfile exists but is ignored by Git. These results use that local lockfile and cached dependencies; they do not establish a reproducible fresh-machine build.

## Disposable session

Use `scripts/phase0-session.py`. Each invocation creates a new directory under `target/phase0-sessions/`, which is already ignored by Git. It never deletes or resets an existing session.

Preparation:
- Opens original databases read-only and uses SQLite's backup API for consistent copies.
- Runs integrity checks against the copies; records table counts and SHA-256 fingerprints in `manifest.json`.
- Copies the web assets, notes, `Stone Cavern for S7.json`, and `test.json`.
- Omits the large `static/arena_stl` library unless `--include-3d` is supplied.
- Copies no `.env` or Discord credentials and starts no Discord bot.
- Marks the copied server with `/static/phase0-session.json`; the smoke runner refuses an unmarked or mismatched server.
- Disables `LinkDiscordAccount` in the copied browser script only. The existing Rust handler uses a source-root path, so Discord linking must not be tested against this setup through a direct WebSocket client.
- Sets a dummy Meshy key and the copied compendium path for launch, preventing the executable's source-root `.env` fallback from enabling real Meshy requests.

The test server binds port 3000, as hardcoded by the application. The helper refuses to launch if that port is occupied. It launches from the copied working directory and writes its PID, executable fingerprint, and logs there. The application automatically opens its normal browser page on startup; the automated walkthrough uses separate temporary headless Edge contexts.

Initial copied database inventory:
- D&D: 9 characters, 7 enemy templates, 23 maps, 0 custom spells.
- Star Wars: 9 characters, 7 enemy templates, 24 maps, 1 custom spell, 8,958 compendium rows.
- Both copied databases passed `PRAGMA integrity_check`.
- S7 fixture: Star Wars, 20 tokens, 9 characters, 19 enemy records. The fixture was copied; its full encounter was not used for the controlled combat test.

Commands, from the repository root:

```powershell
cargo build --offline --locked
cargo test --offline --locked
& 'C:/Users/tyler/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B scripts/phase0-session.py --run
```

After preparation prints the new session directory, run the browser checks with that exact directory:

```powershell
node scripts/phase0-smoke.cjs '<printed session directory>' 'C:/Users/tyler/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
```

The helper uses standard-library Python. The smoke runner uses the installed Playwright package, installed Edge, and Node's SQLite API. No dependencies are installed by either helper. Screenshots and `smoke-results.json` go into the test session. A nonzero smoke exit reports baseline failures, rather than claiming the session is healthy.

## Active frontend entry points

`static/index.html` loads:
1. `static/data/armstech_data.js`.
2. `static/arena3d-boot.js`.
3. `static/js/action-dock.js`.
4. `static/js/ui-shell.js`.
5. `static/app.js`.
6. `static/js/sw5e-builder/bootstrap.js` as an ES module.

The boot script dynamically imports `static/arena3d.module.js` on first 3D use. That module is the active arena implementation. `static/arena3d.js` and `static/arena3d.mjs` are not referenced by the current main entry point; retain them until wider use is checked before removal. Three.js loads from unpkg. The standalone `character-sheet.html` is a separate sheet window, updated by the main client.

## Final two-browser results

Final fresh-copy run: `target/phase0-sessions/20261003T015357Z-473114f5`. Machine-readable results are saved in `docs/phase0-smoke-results.json`; screenshots and server logs remain in that disposable session directory.

**7 PASS:** Separate DM/player connections, copied map loading and character selection, player/enemy placement, shared movement, combat/initiative/damage/healing, a verified SQLite map-state write, and full-session JSON save/REST round-trip.

**3 FAIL:** Current-turn recovery on player reconnect; restoring the saved map's current turn; and restoring full-session combat on both clients. In the last check, the DM had active combat with two participants while the player had inactive combat with zero participants; both had two tokens.

**Browser exceptions:** Both DM and player hit the delayed null-selection callback at `app.js:6874` during the run. Passing syntax checks do not imply error-free browser behavior.

The original D&D database, Star Wars database, S7 save, and test save all matched their pre-launch SHA-256 fingerprints after this final run. No production database/save changes were made. Earlier exploratory runs included corrected harness assumptions and are not counted as the final results.

## State ownership and persistence

**Characters:** Shared live `GameState.characters`, plus SQLite character rows. Creation and updates write first to D&D storage and then to Star Wars storage. Detailed imports and resource counters are nested in the JSON string `character_data`. The selected campaign style is not strict character-database isolation.

**Enemy templates and instances:** Templates live in SQLite, selected by template style and merged for listing. Spawned `EnemyInstance` records live in server memory. Browser enemy/NPC objects also carry presentation and stat-block data. A save must preserve both the template reference and instance state, rather than treating an instance as another template.

**HP:** Combat participants, server characters/enemy instances, and client entity caches all hold HP. `DealDamage`/`HealTarget` operate on server combat participants and update their underlying in-memory entities. This handler does not directly persist a character row; other client character updates and save paths must be traced before assuming restart persistence. Targeted damage outside combat needs separate validation.

**Power resources:** The client calculates and edits counters in `character_data`, then sends `UpdateCharacter`. Tech/Force targeting currently spends one point. Costs and effect resolution are not a complete SW5E rules implementation.

**Armstech and preferences:** Armstech loadouts use per-character localStorage keys. Layout, filters, several usage counters, and connection preferences also use browser storage. They are not all part of a full-session save.

**Maps:** Image files live under `static/maps`; metadata and optional `map_state` JSON live in SQLite. `SaveMap` stores tokens, selected entity state, combat, and viewport data. Normal load clears tokens; background load (`clear_tokens:false`) restores saved map state.

**Full sessions:** The browser constructs version `1.0` JSON containing map metadata/image data where available, tokens, characters, enemies, combat, viewport, and canvas state. HTTP save writes this submitted JSON to `saves/`. HTTP get returns JSON; the browser performs restoration with multiple messages and local assignments. There is no single server transaction that restores the submitted session.

**Notes:** Per-character JSON under `campaign_notes/`, with localStorage caching and autosave. Notes are separate from the fields serialized by the current full-session save.

**Logs and measurements:** The server retains up to 200 shared roll/chat entries in memory. Measurement messages are broadcast; measurement shapes are not part of server `GameState`. Full-session JSON does not currently include the shared log history or placed measurement shapes.

**3D and integrations:** Token-linked mini URLs/scales are embedded in character data or enemy actions. Extra arena objects are client-side scene state. Discord voice highlighting is transient; Discord linking has a source-root persistence exception. Optional integration state needs its own defined save policy.

## Confirmed baseline failures and follow-up observations

1. **Rust test fixtures do not compile.** Reproduced by Cargo. Repair fixtures before Phase 1 regression tests are relied upon.
2. **Compendium hydration rolls back on duplicate IDs.** Reproduced on the fresh test server: SQLite error 1555, `UNIQUE constraint failed: sw5e_compendium_entries.id`. Using the loader's ID rule, the imported JSON contains 187 duplicated IDs and 416 extra colliding rows. The old database compendium remains because the refresh is transactional. Deduplication/identity policy needs investigation before changing rows.
3. **Reconnect loses the player's current turn.** Reproduced in separate browser contexts. Connect and `RequestFullState` send `CombatStarted` but no `TurnChanged` for the current participant. A newly connected client receives participants while its turn pointer stays null.
4. **Full-session combat restore is not authoritative.** The browser assigns saved `combatState` locally and places tokens through separate requests without restoring equivalent server combat. The walkthrough checks the DM and player independently, with a valid saved active-combat fixture.
5. **Selected-token timeout can dereference null.** Observed browser stack: `static/app.js:6874`. A delayed HP display callback reads `selectedToken.entity_id` after selection has been cleared. Capture the token identity before scheduling in a later fix.
6. **Saved-map current-turn recovery fails in the two-client sequence.** The database checkpoint contained active combat and the saved turn, but the DM browser had a null turn after background-load restoration. The server restore, auto-initiative, and repeated-turn client behavior need a focused trace before attributing a single cause.

Additional source-level risks requiring targeted reproduction:
- Restoring active combat can trigger the DM's new-combat auto-initiative logic and reroll enemies.
- A repeated `TurnChanged` for the existing turn triggers `manuallyAdvanceTurn()` instead of acting as an idempotent state update.
- Full restore recreates token IDs through `PlaceToken`, while saved combat participants refer to the old IDs.
- `RequestFullState` omits empty-token, cleared-map, and inactive-combat notifications, so stale clients may retain old state.
- The custom-spell UI sends messages whose server handlers currently only log “needs database implementation,” despite the database table existing.
- `autoConnect()` is defined but is not called by the current frontend entry points. Network reconnect and manual Connect after page reload are separate behaviors.

These observations establish Phase 1 priorities; they are not changes made during Phase 0.

## Repeatable manual smoke route

Use a disposable session and two separate browser profiles/contexts (or the two loopback origins) to avoid sharing role/character localStorage.

1. Join as **Phase0 DM**, select Star Wars. Join separately as **Phase0 Player**.
2. Load a copied map. Select a copied character on the player client.
3. Clear test tokens, place the player token, and spawn one numbered enemy instance.
4. Move the player token; confirm both clients show the same cell.
5. Start combat, roll/set initiatives, and advance to the second participant.
6. Apply 2 damage and 1 healing; compare HP on both clients.
7. Save map state and a named full-session JSON snapshot.
8. Close/reopen the player page and press Connect. Compare combat membership, turn pointer, HP, and selected character.
9. End combat/clear test tokens, then background-load the saved map state. Compare against the stored checkpoint, not a client state that may have drifted after reconnect.
10. End combat/clear again, then load the full JSON snapshot. Compare both clients and request a sync; local-only restoration is a failure.
11. Stop the disposable server. A restart-from-save check is reserved for Phase 1 persistence work; no automatic live-session recovery is assumed.

3D rendering, Discord voice, actual Meshy generation, audio playback, every class/archetype, and the full S7 encounter are outside this controlled baseline walkthrough.

## Next delivery

Phase 1 should first repair the test-fixture compilation issue and make active/inactive combat catch-up explicit, including the current turn. Then add focused regression checks and address full-session restore as coordinated server state. Investigate compendium identity collisions alongside that work without silently dropping distinct entries.
