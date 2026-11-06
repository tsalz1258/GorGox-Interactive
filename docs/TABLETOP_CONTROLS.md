# Using the improved tabletop

Start the program normally and join as DM or player. Existing maps, character imports and version 1 saves remain usable.

## DM controls

- **Table tools → Encounter panel:** add numbered enemy groups, optionally assign group initiative, then spawn. Select creatures in the list or shift-click their tokens. Batch HP previews name the affected creatures. Conditions can expire after a number of rounds or remain until removed.
- **Undo last action / Ctrl+Z:** undo supported movement, HP, conditions, casting, progression and battlefield changes. History retains up to 30 actions within 32 MiB; portrait-heavy campaigns can retain fewer. An intervening unsupported edit can make undo unavailable.
- **Recovery snapshots:** restore a recent autosave or the state preceding a load. These twelve rotating snapshots are separate from manually named saves.
- **Power casting:** players choose a casting level for leveled powers and see updated dice, cost and upcast rules before casting. At-will powers explain character-level scaling instead of offering an editable casting level. Cast now spends points immediately and writes the target and result to the shared Rolls log, without the full description; no DM approval is required. Electroshock, Explosion and Kolto Pack apply supported HP/condition effects immediately. Other powers record supported numeric effect rolls for manual effect tracking. Full rules remain in the preview. Canceling the dialog spends nothing. Undo restores HP and points together. Concentration checks still require a DM decision.
- **Battlefield tools:** copy selected enemies/objects, move a formation by grid offset, hide/reveal selected tokens, draw rectangles, and choose diagonal distance. Copies have independent instance HP. Player characters cannot be duplicated.
- **3D arena:** dropped scenery and completed scenery transforms save into session extras. Use self-contained STL/GLB models. Scenery embeds its model bytes, capped at 12 MiB and 100 objects per scene. Token movement continues to use the same authoritative positions as 2D. External media and token model URLs still require their original assets.

## Player controls

- Select a character before editing its sheet, spending points, casting or favoriting an action. The selected character determines server-side editing permissions; this remains a trusted-friends tabletop with self-selected DM roles, rather than an authenticated account system.
- Use **Quick actions** to add/remove favorites. Favorites persist in character data and work after reconnecting. Press Escape to cancel targeting. Connection status shows whether actions can be acknowledged.
- Casting level determines point cost. Electroshock, Explosion and Kolto Pack have verified attack/save/healing defaults. Other powers show manual resolution explicitly. Force point maxima for unsupported classes come from imported values or manual sheet edits.
- Level-up previews HP, proficiency, features and tech points before applying. Failed choices do not accumulate HP or features; stale level retries are rejected. Imported wrappers, custom fields and attacks are retained. Zero HP remains zero during progression.
- Species creation applies fixed imported ability bonuses, offers choice controls (including Human alternatives), and derives walking speed from imported traits. Complex species choices require DM review; walking speed has an explicit override. Starting-equipment choices use the class reference and manual inventory selection when the import lacks structured choices. Multiclass progression and unsupported class/archetype effects remain explicit manual work.
- Armstech numeric attack/damage modifications apply to the named modified weapon. Enter that weapon's inventory name in the tracker. Conditional modifications retain their reference text and require manual adjudication. Equipment supports explicit `toHitOverride`, `damageOverride`, `rangeOverride`, `proficient: false`, and existing sheet AC overrides.
- Notes show saving/saved/error state, retain edits during live updates, and debounce separately for each character. Dock placement, scroll and focused editing controls are preserved during synchronization.

## Automatic sight

**Table tools → Battlefield tools → Walls & line of sight** lets the DM turn automatic sight on/off, choose shared party or selected-character vision, and set sight range. Draw walls/doors with two map clicks or enter grid coordinates; open/close doors in the list. Escape cancels unfinished placement. Reveal rectangles and selected-token overrides provide manual control; explicit hiding takes precedence. Settings are saved per map and support undo.

Automatic sight applies to the 2D map. Player 3D access returns when the DM switches it off. Walls do not automate movement, attacks or lighting. See `LINE_OF_SIGHT_SCOPE.md` for exact rules and boundaries.

## Optional integrations

Discord linking reports success after the server writes its links file. Voice highlighting requires the separate bot to be running. No bot messages are sent by linking itself. The links path can be configured with `GORGOX_DISCORD_LINKS_PATH`.

3D requires its Three.js CDN; a load failure leaves 2D usable. Meshy retains its progress/error UI and requires a configured service key. Live Discord voice and paid Meshy generation are not exercised by the disposable test workflow. Soundboard cards are keyboard accessible and searchable.

Full saves include notes, shared measurements, combat, HP/resources, conditions, favorites, Armstech, drawing settings and embedded scenery. Map images and externally referenced media remain paths: copy those assets when moving a campaign. A restore validates the whole snapshot before replacing memory, but database and individual note files are separate persistence operations; an underlying filesystem failure across those stores is not a distributed transaction.
