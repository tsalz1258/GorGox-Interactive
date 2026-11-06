# Walls and line of sight

Phase 8 adds opt-in automatic sight on the 2D map. The user requested DM settings for switching it on/off and choosing shared party or selected-character vision.

## Table rules

- Automatic sight starts **off**. Each map retains its own versioned settings, walls, doors, reveal rectangles and token overrides in full session saves.
- **Shared party vision:** players see the union of sight from placed, non-hidden player-character tokens. **Selected character only:** each player sees from tokens belonging to their currently selected character. A character without a placed token supplies no sight.
- Sight starts at a token's rendered center (the center of its placement grid cell, including larger tokens). A target is visible when its center is in sight or in a DM reveal rectangle. Default sight range is 120 feet; the DM can set 5–1000 feet. This is a table setting, not an inferred species or lighting rule.
- Walls and closed doors block sight. Open doors do not. Solid corners block a ray through the endpoint; an actual gap permits sight. Do not put a vision source directly on a wall segment: the boundary is treated as blocked.
- Walls affect sight only. Movement, projectile collision, cover, lighting, darkvision and concealment remain DM adjudications.
- **Reveal rectangle** exposes map art and normally visible tokens in the rectangle. **Always reveal** exposes selected tokens even outside sight, without revealing the surrounding map. **Use automatic sight** removes that override. Existing explicit **Hide selected** and **Hide entire map** controls take precedence.
- The existing player viewport clips sight further when enabled. The DM always sees the map and tokens, with wall/door guides.

## Controls and persistence

Open **Table tools → Battlefield tools → Walls & line of sight**. Enable sight, select the vision mode and range, then draw walls or doors by clicking two endpoints on the map. Endpoints snap to half-grid increments. Escape or Cancel placement discards an unfinished segment. Walls can also be entered as `x1,y1,x2,y2` grid coordinates. The wall list provides door open/close and removal controls.

Edits are DM-only, acknowledged by the server, undoable, and checked against the currently loaded map. Stale concurrent edits are rejected instead of overwriting newer settings. Save/restore validation rejects invalid geometry before replacing session state. Limits are 250 walls/doors, 100 reveal rectangles, and settings for 100 maps.

Polygon ray casting uses only wall segments within sight range and caches the resulting mask. Token movement, character selection, doors and sight settings update it; unrelated HP/resource changes reuse it. `scripts/vision-geometry-test.cjs` benchmarks 250 walls and 50 independent vision sources; `scripts/vision-smoke.cjs` checks rendering, DM/player agreement, modes, editing, undo, validation, reconnect and restore.

## Presentation boundaries

Automatic sight is a 2D feature. Player 3D presentation is disabled while it is active; enabling sight closes an already open player arena. Disable automatic sight to restore player 3D access. DM 3D remains available. Arbitrary 3D meshes are not clipped by the 2D polygon, and scenery height does not infer a wall. A future 3D extension needs explicit height and mesh-clipping rules before sharing the sight mask in that renderer.

If hidden information must be inaccessible rather than simply hidden in the UI, server snapshots must be filtered per player. Current clients receive a shared snapshot and apply visibility in rendering. Account authentication and private-state delivery would be prerequisites for that stronger requirement.
