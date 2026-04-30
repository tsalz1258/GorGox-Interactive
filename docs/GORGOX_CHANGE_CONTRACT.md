# GorGox Interactive — change contract

**Purpose:** Anyone (human or agent) making changes should read this first. It records how the app is *supposed* to behave so refactors do not break core flows.

**Maintenance:** When you add or materially change a feature, update this file in the same PR/change (add a short subsection or bullet under the right heading). If something here is wrong, fix the doc and the code together.

---

## Architecture (one screen)

| Layer | Role |
|--------|------|
| **Rust server** (`src/server.rs`, `src/models.rs`, `src/game_state.rs`, `src/db.rs`, …) | HTTP + WebSocket; SQLite; broadcasts state. |
| **Static client** (`static/app.js`, `static/index.html`, `static/style.css`) | Main UI: map, tokens, combat, sheets, WebSocket client. |
| **3D arena** (`static/arena3d-boot.js`, `static/arena3d.module.js`) | Optional overlay; loaded on demand; must not replace 2D combat. |

**Authoritative API shape:** `ClientMessage` / `ServerMessage` in `src/models.rs` (tagged `type` JSON). Client `sendMessage({ type: ... })` must stay compatible unless you migrate server + all clients.

---

## Invariants (do not break casually)

### WebSocket & identity

- Clients connect with **player name**, **is_dm**, **style** (campaign flavor / which character DB path applies).
- **DM vs player** gates many actions; do not assume all clients can call DM-only messages.
- **Character selection** (`SelectCharacter`) must remain consistent with token `entity_id` and combat participants.

### Maps

- Maps have **image**, **grid_size**, **width**, **height**; tokens use **grid coordinates** consistent with 2D drawing.
- **SaveMap** persists token/state; **list** endpoints must avoid shipping huge `map_state` blobs on every list (compact wire vs full load).
- **LoadMap** / **ClearMap** behavior and token clearing options must stay predictable for reconnects.

### Tokens

- **PlaceToken / MoveToken / RemoveToken / UpdateTokenSize** are the source of truth for the live map.
- **TokenType:** Player, Enemy, NPC, Object — **Object** supports **hidden_from_players** (DM-only visibility).
- **Token id** vs **entity id**: combat and damage often use **token id** as `target_id`; initiative uses **participant_id** when multiple rows share an `entity_id`. Do not collapse these without a migration plan.

### Combat

- **StartCombat**, **RollInitiative**, **NextTurn**, **EndCombat**, **RemoveFromCombat** must stay ordered and broadcast so all clients share one combat timeline.
- **DealDamage / HealTarget** target the **token** id where the UI expects; changing this breaks HP sync.

### Characters

- **CreateCharacter / UpdateCharacter / DeleteCharacter / ListCharacters**; `character_data` is JSON (D&D sheets and **Star Wars / SW5e-style** payloads).
- **UpdateCharacter** payloads must remain compatible with `buildCharacterUpdatePayload` / server row shape (`Character` in `models.rs`).
- **3D mini URL:** `_gorgox_arena_stl_url` inside `character_data` (root or `character` wrapper). Uploads go to **`POST /api/arena-stl`** → `/static/arena_stl/…` (`.stl` / `.glb`).

### Enemies

- **CreateEnemy** is **INSERT OR REPLACE** on templates; **instance-style names** (e.g. `"Goblin 1"`) must **not** create new DB rows (server rejects).
- **SpawnEnemy** creates runtime instances; **EnemyInstanceSpawned** syncs portrait/actions to clients.
- **actions** JSON holds stat block + **sheet_attacks**; parsing/splitting in the client must preserve unknown keys used for tooling (e.g. **`_gorgox_arena_stl_url`** on the template).
- **3D mini URL** for enemies lives in **actions** JSON, on the **template** (instances inherit via template resolution in the client).

### Player map viewport (fog-style)

- **SetPlayerMapViewport** restricts what non-DM clients render; changing canvas clip logic must keep DM full view unless intentionally changed.

### Tools & UX

- **Ruler**, **measurement shapes**, **ping** — broadcast to room; clearing measurements must stay DM/client-consistent.
- **Roll** messages (ability, save, skill, attack) are log/UI sync; changing payload shapes requires server + client updates.

### Custom spells / Star Wars powers

- **SaveCustomSpell / GetCustomSpell / GetAllCustomSpells / DeleteCustomSpell** — used for D&D spells and SW **tech/force** metadata (`power_type`).

### Audio

- **PlaySound** over WebSocket (base64). REST **/api/sounds** for file list/upload — separate from arena model upload.

### HTTP-only APIs

- **GET/POST/DELETE** `/api/saves` — game state JSON snapshots.
- **GET** `/api/maps` — compact map list for UI.
- **GET/PUT** `/api/campaign-notes/:id` — per-campaign notes.
- **POST** `/api/arena-stl` — **`.stl` and `.glb` only**; `DefaultBodyLimit` / body size must allow intended max upload size.

### 3D arena (experimental)

- **2D remains authoritative** for combat, initiative, and token positions.
- **`window.getBattlefieldSnapshotForArena3d()`** in `app.js` feeds map image, dimensions, grid, and **token list + model URLs** to the module.
- **Placed** models: user transform (move/rotate/scale); **Clear 3D** clears placed meshes, not token-linked minis (unless product decision changes — document if it does).
- **Token-linked** models: position/size from snapshot; **rotate-only** in UI so grid sync does not fight manual XZ moves.
- Boot file defines **`window.toggle3DArena`**, **`window.arena3dClearAll`**, **`window.arena3dRotateSelection`** before async module load; do not break inline `onclick` from `index.html`.

### Discord (optional)

- **HighlightCharacter**, **LinkDiscordAccount** — if touched, keep optional behavior so non-Discord games still run.

---

## File hotspots (where bugs hurt most)

| Area | Typical files |
|------|----------------|
| Protocol & types | `src/models.rs` |
| WS routing & DB | `src/server.rs`, `src/game_state.rs`, `src/db.rs` |
| Client orchestration | `static/app.js` |
| Layout / modals | `static/index.html`, `static/style.css` |
| 3D | `static/arena3d.module.js`, `static/arena3d-boot.js` |
| Cache bust | `APP_UI_VERSION` in `app.js`, query strings on `app.js` / `arena3d-boot.js` in `index.html` |

---

## When adding a new feature (checklist)

1. Extend **`ClientMessage` / `ServerMessage`** in `models.rs` if the wire format changes; implement in `server.rs` and **all** relevant client paths in `app.js`.
2. If persistence is involved, update **SQLite** migrations / queries and document the schema here in one line.
3. If the UI loads assets, bump **`APP_UI_VERSION`** and/or script query params so browsers do not stay on stale `app.js`.
4. Append a **short subsection** to this doc: what it does, who may use it (DM/player), and **one invariant** future changes must preserve.
5. Prefer **backward-compatible** JSON (new optional fields) over breaking renames unless you coordinate a full migration.

---

## Version

Last reviewed against the codebase: **2026-04** (approximate). Update this date when you make a substantive edit to this contract.
