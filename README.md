# GorGox-Interactive

A self-hosted virtual tabletop for **Dungeons & Dragons 5E** and **Star Wars (SW5E)** campaigns. Runs a Rust server with a browser-based UI — multiple players connect over WebSocket, share a battle map, run combat, and manage character sheets together.

## Quick start (Windows)

### Build

```bat
build.bat
```

### Start

```bat
start.bat
```

Open **http://localhost:3000**, enter your name, choose **DM** or **Player**, pick a campaign style, and connect.

Share the connection URL with players (DM sidebar → **Link for players**).

---

## Campaign styles

| Style | What it enables |
|-------|-----------------|
| **Dungeons & Dragons** | Classic 5E character sheets, spell slots, custom spells, D&D-themed UI |
| **Star Wars (SW5E)** | SW5E character wizard, tech/force powers, Armstech weapon mods, SW compendium browser |

The style is chosen at login and controls which character database and UI theme you get.

---

## Features

### Maps & tokens

- **Upload maps** — image upload with name, grid alignment, width/height settings
- **Save & load maps** — persist token positions, HP, and map state to SQLite
- **Save/load full game** — snapshot entire session state to JSON files in `saves/`
- **Grid-based tokens** — place, move, resize, and remove tokens on a zoomable/pannable canvas
- **Token types** — Player, Enemy, NPC, and Object (custom labeled map markers)
- **Hidden objects** — DM can place tokens/objects that only the DM sees
- **Token display names** — show/hide labels, rename tokens on the fly
- **Enemy portraits** — attach images to enemy templates; instances inherit them
- **Map controls** — zoom in/out, fit to viewport, center on selected token
- **Sync** — pull latest map, tokens, and combat state from the server without reconnecting

### Fog of war / anti-metagame (DM)

- **Player viewport box** — restrict what players can see to a movable/resizable rectangle (fog-style)
- **Hide entire map** — players see nothing until you reveal it
- DM always sees the full map

### Combat

- **Initiative tracker** — start combat, roll initiative, advance turns, end combat
- **HP management** — deal damage and heal from the token sidebar
- **Combat action panel** — quick actions, attacks, bonus actions, spell slots, movement preview
- **Movement highlighting** — green squares show reachable cells during your turn
- **Remove from combat** — drop individual participants without ending the fight
- **DM combat tracker** — top-bar initiative strip for the DM
- **Rolls log** — ability checks, saves, skills, and attacks broadcast to all clients

### Characters

- **Character manager** — create, edit, import (JSON), and delete characters
- **Character selection** — players pick which character they are playing
- **Full character sheets** — abilities, skills, saves, inventory, attacks, features
- **SW5E character wizard** — guided step-by-step creator (species, class, background, equipment, powers)
- **SW5E level-up** — apply new levels with class feature choices
- **Import/export** — JSON import for characters and enemies
- **3D mini URLs** — attach `.stl` / `.glb` models to characters for the 3D arena

### Enemies

- **Enemy database** — searchable library of stat blocks (CR, HP, AC, abilities, actions)
- **Create & edit** — full stat block editor with portrait and 3D mini support
- **Spawn instances** — place `"Goblin 1"`, `"Goblin 2"` from one template without duplicating DB rows
- **Legendary actions** — view legendary action details from enemy sheets
- **NPC sheets** — open stat blocks for NPC tokens on the map

### Player action bar

Resizable bottom panel (DM can toggle on/off for the table) with tabs:

| Tab | Contents |
|-----|----------|
| **Combat** | HP, attacks, bonus actions, reactions, inventory chips |
| **Abilities** | Ability scores, saving throws, skills |
| **Powers** | Tech powers and force powers (Star Wars) |
| **Class** | Class features and progression (Star Wars) |
| **Dice** | Quick dice roller |
| **Notes** | Per-character campaign notes (sessions, NPCs, planets, locations) |

### Spells & powers

- **Custom spell manager** — create, edit, and delete homebrew spells
- **Power types** — D&D spells, SW5E tech powers, and force powers
- **Spell slots** — track and spend slots; long rest restores all
- **Spell/power tooltips** — hover descriptions on the map and in sheets
- **SW5E compendium browser** — browse imported tech/force powers, classes, species, and more (Info panel)

### Armstech (Star Wars)

Weapon modification tracker for SW5E characters — equip blaster/vibro weapon mods, track prerequisites, and manage your engineering build from the character sheet or player action bar.

### Map tools

- **Ruler** — measure distance between two points (feet)
- **Cone & circle templates** — place AoE measurement shapes on the map
- **Ping** — click to ping a location for all players
- **Clear measurements** — DM clears all placed shapes

### Audio

- **Sound board** — play sound effects to all connected clients
- **Sound upload** — upload audio files via REST API; stored in `static/sounds/`
- Sounds play in sync over WebSocket

### 3D arena (experimental)

Optional Three.js overlay — 2D map remains authoritative for combat and positions.

- Toggle **3D** from the top bar
- **Token-linked minis** — characters/enemies with `.stl` / `.glb` URLs render on the battlefield
- **Placed models** — drag-and-drop or upload extra scenery
- **Transform gizmo** — move (snaps to grid), rotate, and scale minis
- **Combat overlay** — movement cells, targeting, and measurement shapes sync to 3D
- Upload models via **`POST /api/arena-stl`** → served from `static/arena_stl/`

### Meshy AI 3D generation (optional)

Generate `.glb` miniatures from character/enemy portraits using the [Meshy image-to-3D API](https://docs.meshy.ai/api/image-to-3d).

- DM tool: **Meshy 3D from Portrait**
- Requires `MESHY_API_KEY` in a `.env` file at the repo root
- Progress streams back via `POST /api/meshy-generate-arena-stl`

### Discord integration (optional)

Link Discord accounts to characters so tokens **highlight when a player speaks** in a voice channel.

**In-game:**

1. Open your character sheet → **Link Discord**
2. Paste your Discord User ID and save

**Discord bot** (`discord-bot/`):

1. Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable **Message Content**, **Server Members**, and **Presence** intents
3. Invite the bot with `Connect`, `Speak`, and `Use Voice Activity` permissions
4. Copy `discord-bot/env-example.txt` to `discord-bot/.env` and fill in:
   - `DISCORD_BOT_TOKEN`
   - `GAME_SERVER_URL` (e.g. `ws://localhost:3000`)
5. Install and run:

```bat
cd discord-bot
npm install
node index.js
```

Or use `discord-bot/start-bot.bat`.

Voice detection requires `libsodium-wrappers` (installed via `npm install`). If encryption fails, reinstall dependencies or install Visual Studio Build Tools for `sodium-native`.

### Info panel

Reference browser for:

- **Connection** — share URL, copy link
- **Conditions** — D&D condition descriptions
- **SW5E compendium** — browse imported game data

### Session log

Three tabs in the sidebar log panel:

- **Rolls** — dice and attack results
- **Chat** — player chat messages
- **System** — connection, map, and session notices

### DM tools

Organized into **Maps**, **Tokens**, and **Tools** menus:

- Upload map, save map state, save/load game, map settings, clear tokens
- Enemy database, character manager, place character/object, remove token
- Sounds, ruler tools, Meshy 3D, sound board, action bar toggle, custom spells, info panel
- **Shutdown server** — graceful server stop (DM only)

---

## Project structure

```
GorGox-Interactive/
├── src/                  # Rust server (Axum + WebSocket + SQLite)
├── static/               # Web UI (app.js, index.html, style.css, 3D arena)
│   ├── data/             # Game data (SW5e compendium JSON, armstech, conditions)
│   └── js/sw5e-builder/  # SW5E character wizard
├── discord-bot/          # Optional Discord voice-highlight bot
├── saves/                # Game state JSON snapshots
├── maps/                 # Uploaded map images
├── enemy_pictures/       # Enemy portrait images
├── scripts/              # Data import/scrape utilities
├── build.bat             # Build release binary
└── start.bat             # Start server
```

---

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws` | WebSocket | Main game protocol |
| `/api/maps` | GET | List maps (compact, no full state blobs) |
| `/api/saves` | GET | List saved game states |
| `/api/saves/:filename` | GET/POST/DELETE | Load, save, or delete a game snapshot |
| `/api/campaign-notes/:id` | GET/PUT | Per-character campaign notes |
| `/api/sounds` | GET/POST | List or upload sound files |
| `/api/sounds/:filename` | DELETE | Remove a sound |
| `/api/arena-stl` | POST | Upload `.stl` / `.glb` for 3D minis |
| `/api/meshy-generate-arena-stl` | POST | Meshy portrait → 3D (NDJSON progress stream) |
| `/api/compendium/sw5e/*` | GET/POST | SW5E compendium browse and player-kit data |

---

## SW5E compendium data (optional)

To regenerate compendium JSON from Foundry packs, place a SW5e clone under `starwars52data/sw5e/packs/` and run:

```bash
node scripts/import-sw5e-packs.mjs
node scripts/sync-sw5e-icons.mjs
```

Output lands in `static/data/sw5e_compendium/`.

---

## Environment variables

Create a `.env` file at the repo root (see `env.example`):

| Variable | Purpose |
|----------|---------|
| `MESHY_API_KEY` | Enable Meshy portrait → 3D generation |

Discord bot variables go in `discord-bot/.env` (see `discord-bot/env-example.txt`).

---

## Troubleshooting

### Build fails on Windows (LNK1104 / “Access is denied”)

Usually Windows Defender, antivirus, or OneDrive locking files during compile.

- Run `build.bat` **as Administrator**
- Add exclusions for this repo folder and `.\target`
- Close anything scanning `target\`, then `cargo clean` and rebuild

### Browser shows old UI / “X is not defined”

Hard refresh after server updates:

- Chrome/Edge: `Ctrl+Shift+R`
- Or DevTools → right-click refresh → **Empty Cache and Hard Reload**

### Players can't connect

- Confirm the server is running and port 3000 is open
- Players use the same URL as the DM (share via **Link for players**)
- If connecting over LAN, use the host machine's IP instead of `localhost`

### Discord bot won't detect voice

- Bot must be invited to your server with voice permissions
- Run `npm install` in `discord-bot/` (needs `libsodium-wrappers` and `@snazzah/davey`)
- Enable required intents in the Discord Developer Portal

---

## Tech stack

- **Server:** Rust, Axum, Tokio, SQLx (SQLite), WebSocket
- **Client:** Vanilla JS, HTML5 Canvas, Three.js (3D arena)
- **Discord bot:** Node.js, discord.js, @discordjs/voice
