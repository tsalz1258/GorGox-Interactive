# GorGox feature regression checklist

Run smoke first. Then check every section marked by the impact map. Mark each item PASS / FAIL / SKIP (with reason).

## A — Connection & session

- [ ] Connect as DM
- [ ] Connect as Player (non-DM)
- [ ] Campaign style D&D vs Star Wars still switches theme/DB path
- [ ] Connection status updates (connected/disconnected)
- [ ] Player list updates when someone joins
- [ ] Sync / refresh still pulls map + tokens + combat

## B — Maps & canvas

- [ ] Load / upload map draws image
- [ ] Pan (drag empty space past threshold)
- [ ] Zoom in/out / reset / fit / center-on-token
- [ ] Grid visible when expected
- [ ] CSS-scaled canvas: clicks land on correct cells (`clientToWorld`)
- [ ] No full-map “empty state” overlay blocking clicks

## C — Tokens (critical)

- [ ] Place character / enemy / object (DM)
- [ ] Select token (click)
- [ ] **Move token**: select then click destination
- [ ] **Move token**: press on token, release on new cell
- [ ] Player can move only own character (when not in wrong-turn combat lock)
- [ ] DM can move any token anytime
- [ ] Remove token (DM)
- [ ] Resize token (DM)
- [ ] Hidden-from-players object behavior
- [ ] Token sidebar HP damage/heal inputs still work

## D — Combat

- [ ] Start combat / end combat
- [ ] Initiative / next turn / end my turn
- [ ] Movement range highlight on turn
- [ ] Attack targeting on map still resolves
- [ ] Power/spell targeting (if SW5E/D&D path touched)
- [ ] Rolls appear in Rolls log and broadcast

## E — Action dock / player bar

- [ ] Toggle On/Off (segmented control + any DM toggle)
- [ ] Dock stays between sidebars when docked
- [ ] Resize height; persists after refresh
- [ ] Collapse / expand
- [ ] Tabs: Combat, Abilities, Powers, Class, Dice, Notes
- [ ] Floating mode only via undock control (no accidental float)
- [ ] Dock does not cover and steal all map clicks

## F — Sidebars & shell

- [ ] Left/right collapse toggles
- [ ] Sidebar resize handles (desktop)
- [ ] Log tabs: Rolls / Chat / System
- [ ] DM tool menus (Maps / Tokens / Tools) still open actions
- [ ] Fog / player viewport controls still present for DM

## G — Characters & sheets

- [ ] Select character
- [ ] Open character sheet
- [ ] Character manager create/edit path not obviously broken
- [ ] SW5E builder still loads when Star Wars style (if builder files touched)

## H — Notes

- [ ] Notes tab opens and fills dock height path
- [ ] Create/edit note; survives tab switch
- [ ] Autosave / server save path (`/api/campaign-notes/:id`) when server up

## I — Measurements & tools

- [ ] Ruler toggle on/off (must be able to turn **off**)
- [ ] Cone / circle placement if those tools touched
- [ ] Ping location
- [ ] Clear measurements (DM)

## J — Saves / API

- [ ] `GET /api/test` when server running
- [ ] `GET /api/maps` / `GET /api/saves` respond
- [ ] Save/load game modal still wired if `src/server.rs` or save UI touched

## K — 3D / Meshy / Discord (only if touched)

- [ ] 3D arena toggle; back to 2D
- [ ] Map token move still authoritative after 3D drag sync
- [ ] Discord bot still connects / highlight path if `discord-bot/` edited

## L — Static asset wiring

- [ ] `index.html` loads `action-dock.js` and `ui-shell.js` **before** `app.js`
- [ ] Cache-bust query strings bumped when shipping UI fixes users must pick up
- [ ] Critical element IDs preserved: `playerActionBar`, `mapCanvas`, `tokenInfo`, `playerList`, `sidebarLeft`, `sidebarRight`
