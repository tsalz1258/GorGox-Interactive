# GorGox improvement roadmap

Planned October 2, 2026. Focus: dependable live sessions and the current SW5E campaign.

This document records the implementation plan and phase completion evidence. Phase statuses distinguish delivered features from explicit manual or separately scoped work. Testing uses disposable campaign copies.

## Working approach

- Work in the sequence below, delivering small, usable changes within each phase.
- Preserve existing local changes and protect campaign data. Use copies of databases and saves for destructive or migration testing.
- Keep existing saves and character imports compatible; introduce versioned migrations where necessary.
- Refactor the code involved in each change incrementally rather than rewriting the application first.
- Test changes proportionately. Persistence, migrations, resource calculations, and multiplayer state need meaningful regression coverage.
- End each phase with a two-browser DM/player walkthrough, relevant build/check results, and a record of remaining limitations.
- Maintain D&D behavior while prioritizing SW5E. Keep optional Discord, Meshy, and 3D features optional.

## Phase 0 — Establish the baseline

**Outcome:** A repeatable way to verify improvements without risking the campaign.

Work:
- Inventory the existing staged and unstaged changes and inspect any applicable repository instructions.
- Establish the current Rust build and test status; record pre-existing failures separately.
- Identify which frontend scripts are active, especially the multiple arena implementations.
- Trace character, enemy, HP, power-resource, map, note, and session-save ownership through client and server.
- Set up an isolated test session using copied campaign data.
- Record a smoke-test route: join as DM/player, load a map, select a character, spawn enemies, run combat, save, reconnect, and restore.

Completion checks:
- Existing failures and working behaviors are documented.
- The test workflow uses disposable data and has a clear launch procedure.
- Changes can be compared against the same baseline in later phases.

Status: Complete October 2, 2026. See `PHASE0_BASELINE.md` and `phase0-smoke-results.json`. The application builds; the existing Rust test fixtures do not compile. The final two-browser baseline has seven passing checks and three known failures. Completing the baseline does not mean those failures are fixed.

## Phase 1 — Reliable shared state and saves

**Outcome:** Players see the same session, including after refresh, reconnect, and restore.

Work:
- Define authoritative server state and the scope of a full session save.
- Investigate character mirroring across both databases; establish a compatible storage policy before changing it.
- Make join/reconnect synchronization include the correct combat membership, current turn, HP, resources, and visibility settings.
- Move campaign-critical browser-only state, starting with Armstech, into character/session persistence with a migration path for existing browser data.
- Ensure HP and resource changes are applied once and persist through restart.
- Introduce a versioned save format, validation, atomic file writes, and explicit success/failure feedback.
- Make full restore coordinate server state rather than relying on a sequence of loosely related client updates.
- Document which notes, settings, media, and optional 3D state are included or referenced by saves.

Completion checks:
- DM and player agree after movement, damage, healing, resource spending, and turn advancement.
- Refresh/reconnect restores the correct current turn and character resources without duplicate application.
- Save, restart, and load reproduce the defined session state.
- Representative older saves remain loadable; invalid saves fail without partially replacing the session.
- Browser-stored Armstech data can migrate without silently overwriting newer server data.

Status: Complete. Shared-state fixes verified October 2, 2026: all ten disposable DM/player smoke checks pass with no page errors. Version 2 snapshots retain token IDs, combat turn, HP, character resources, Armstech, notes, viewport, and shared extras. Legacy saves validate. Additional persistence/ownership regressions accompany subsequent phases. Map images and optional external media remain referenced by path; copy the static assets when moving a campaign.

## Phase 2 — Undo and recovery

**Outcome:** Common table mistakes are reversible.

Work:
- Add a server-owned history for token movement and HP changes with bounded retention.
- Let the DM undo supported operations; broadcast the resulting state to every client.
- Define how undo handles removed tokens, intervening edits, and session loads.
- Create recovery snapshots before replacing a session; add bounded autosave/recovery retention.
- Provide a recovery picker with clear timestamps and session names.

Completion checks:
- Undo restores exact prior positions and HP on both clients without applying a change twice.
- Unsupported or stale undo operations produce useful feedback.
- A recovery snapshot can restore the session preceding a load.
- Snapshot retention is bounded and never removes manually named saves.

Status: Complete October 2, 2026. Six disposable two-browser regressions pass (see phase2-regression-results.json): movement/HP undo, replay protection, DM permissions, rejected invalid restores, recoverable pre-load snapshots, and Armstech migration. History is capped at 30 actions and 32 MiB; large portrait-heavy campaigns can retain fewer actions. Recovery is capped at twelve files in saves/recovery. Autosave runs every 30 seconds when the session changes.

## Phase 3 — Faster DM encounters

**Outcome:** Run enemy groups from one practical encounter panel.

Work:
- Consolidate initiative, HP, conditions, enemy attacks, and turn controls.
- Add multi-token selection and batch damage/healing with a preview.
- Spawn numbered groups from templates with separate instance HP.
- Support optional group initiative while retaining individual participants.
- Save reusable encounter presets separately from active session snapshots.
- Add a visible condition tracker with manual removal and optional round/turn expiry.

Completion checks:
- Spawn and run a mixed encounter without duplicating enemy templates.
- Batch operations affect only selected participants and can be undone where supported.
- Turn order remains correct when participants join, leave, or reach zero HP.
- Condition state survives reconnect and session restore.

Status: Complete October 2, 2026. Encounter panel, numbered groups, independent instance HP, batch preview/HP, shared initiative, separate presets, round/turn condition tracking, and shift-click selection are implemented. Seven Rust tests and nine disposable two-browser regressions pass.

## Phase 4 — SW5E power resolution

**Outcome:** Supported powers spend the correct resources and resolve effects consistently.

Work:
- Verify casting costs and rules against authoritative SW5E references and the imported compendium.
- Model casting level, resource cost, range, target type, attack/save, damage/healing, and conditions.
- Deliver an initial set of common attack, save-based damage, and healing powers before expanding coverage.
- Preview affected targets and proposed effects; let the DM adjust or confirm resolution.
- Synchronize spending, rolls, and effects through the server as one operation.
- Handle higher-level casting and concentration/duration tracking where supported.
- Show unsupported effects explicitly and retain manual resolution.

Completion checks:
- Supported casts spend resources exactly once and reject insufficient resources.
- Attack and save outcomes, critical damage where applicable, and half damage follow verified rules.
- Area previews match affected targets; hidden targets are not exposed to players.
- Canceling before commitment changes no resources or HP.
- Outcomes are shared, persisted, and reversible where supported.

Status: Complete. Verified Electroshock, Explosion and Kolto Pack automation; other powers explicitly use DM-reviewed manual effects. Casting, concentration and resource changes are server owned. Eleven Rust tests and twelve DM/player regressions pass; see SW5E_RULES.md and phase4-regression-results.json.

## Phase 5 — Character progression, equipment, and Armstech

**Outcome:** Character choices produce explainable, consistent sheet statistics.

Work:
- Improve species-derived statistics, starting equipment choices, and power-selection limits.
- Verify level-up choices and progression per supported class/archetype.
- Add a before/after level-up preview showing HP, proficiency, features, and resources.
- Establish one calculation path for equipment-derived AC, attack bonuses, damage, and range.
- Apply supported Armstech modifications to weapon statistics and enforce prerequisites.
- Preserve imported/custom attacks and provide explicit overrides for homebrew.
- Explain the components of derived numbers in the sheet.

Completion checks:
- Representative campaign characters retain their imported data and customizations.
- Equipping, unequipping, and modifying supported equipment produces consistent values across sheet and action panel.
- Level-up applies once, persists, and does not grant duplicate features.
- Unsupported class choices and item effects are identified for manual handling.

Status: Complete October 3, 2026. Shared equipment/resource calculations preserve imported attacks and overrides, include ability/modification damage, and prevent shield stacking. Species bonuses/speed and Human choices are validated; missing structured starting-equipment choices have an explicit class-reference/manual path. Level-up resets failed attempts, previews changes, preserves wrappers, applies once through the server, updates HP/proficiency/features/Engineer points, and supports undo. Multiclass and unsupported class/archetype choices remain manual. See character-rules-test.cjs, phase5-7-regression-results.json and progression-presentation-results.json.

## Phase 6 — Player controls and session usability

**Outcome:** Players reach their usual actions quickly without UI disruption.

Work:
- Add favorite attacks/powers and quick access to frequently used resources.
- Improve targeting feedback, cancellation, and result readability.
- Preserve scroll, focus, and dock placement during live updates.
- Improve smaller-screen layout and keyboard access for common operations.
- Clarify character ownership and keep controls aligned with server-side permissions for changed operations.
- Polish note autosave feedback and reconnect status.

Completion checks:
- A player can select a character, attack, cast a supported power, update a resource, and write a note without navigating multiple unrelated panels.
- Incoming updates do not interrupt typing or reset panel scroll.
- DM and player layouts work at desktop and smaller viewport sizes.

Status: Complete October 3, 2026. Shared favorites/quick actions, targeting cancellation, connection feedback, server ownership checks for changed sheet/actions, per-character notes debounce, protected pending edits, focused-input protection, and stable dock placement are delivered. Desktop and 720-pixel viewport checks pass. The app still uses trusted, self-selected DM roles; account authentication is outside this phase.

## Phase 7 — Battlefield and optional integration polish

**Outcome:** Better map preparation and dependable optional presentation features.

Work:
- Extend multi-selection with copy/paste, formation placement, and token-group controls.
- Make movement previews consistent with the chosen diagonal-distance rule.
- Add drawing/reveal tools; investigate walls and line of sight as a separate scoped feature.
- Improve 3D token synchronization and define scenery/transform persistence.
- Improve Discord linking/status and soundboard usability.
- Give Meshy and optional CDN-dependent features clearer progress and failure feedback.

Completion checks:
- Map tools respect player visibility and behave consistently across clients.
- Supported 3D moves update the same authoritative token positions as 2D moves.
- Optional integration failures leave the core tabletop usable.
- Walls/line-of-sight work has its own rules and performance criteria before implementation begins.

Status: Complete October 3, 2026. Formation movement, independent enemy/object copies, token hide/reveal, shared/private drawings, selected diagonal rules, embedded 3D scenery/transform saves, confirmed Discord-link persistence, sound search/keyboard access and optional-model failure feedback are delivered. Real STL loading, rotation, clear and rendered restore pass. Existing Meshy progress/CDN failure controls remain optional; live Discord voice and paid Meshy generation were not exercised. Automatic walls/line of sight remains a separately scoped extension; see LINE_OF_SIGHT_SCOPE.md. The final DM/player suite has seventeen passing checks and the builder/presentation suite six, both without page errors.

## Phase 8 — DM-controlled walls and line of sight

**Outcome:** Optional automatic sight with table rules chosen by the DM.

After reviewing Phase 7, the user authorized continuing and requested DM settings to turn sight on/off and choose shared party or selected-character vision.

Delivered:
- Sight starts off; the DM chooses vision mode and range per map.
- Two-click wall/door placement, coordinate entry, door open/close, segment removal and placement cancellation.
- Sight polygons from token centers, manual map reveals, token overrides and existing hide/viewport precedence.
- Server validation, stale-edit rejection, DM-only edits, undo and versioned map-local persistence.
- Cached sight masks that rebuild for geometry/source changes and reuse geometry during unrelated HP/resource updates.

Status: Complete October 3, 2026. Eight separate DM/player sight checks pass without page errors, thirteen Rust tests pass, and loading the saved map after a real process restart preserves walls, doors and settings. Geometry checks cover corners, gaps, open/closed doors, range and collinear walls; a 250-wall/50-source benchmark passes. Player automatic sight applies to 2D; disabling it restores player 3D access. Movement, lighting and attacks remain manual. See LINE_OF_SIGHT_SCOPE.md and phase8-vision-results.json.

## Code organization across all phases

Extract networking/state synchronization, persistence, combat, character calculations, maps, and audio from `static/app.js` as those areas change. Keep module interfaces explicit and migrate one active feature at a time. Consolidate inactive or duplicate implementations only after verifying their usage. Code organization is continuous supporting work, not a prerequisite for all user-facing improvements.

## Review checkpoint

The user reviewed Phase 7 and authorized continuing. The requested work is now delivered through Phase 8, including the DM vision settings requested during implementation. Further 3D clipping, authentication/private snapshots and additional rules automation are separately scoped extensions. See TABLETOP_CONTROLS.md for the new controls and explicit manual scope, and VALIDATION.md for reproducible checks.
