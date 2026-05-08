# SW5e compendium data audit (pack JSON slices)

## Coverage

- **Classes** (`classes_from_packs.json`): Foundry `system.advancement` includes `HitPoints`, `ScaleValue`, `AbilityScoreImprovement`, `Trait` (armor/weapon/skill grants), `ItemGrant` (links to classfeatures by `_fvtt_id`), `ItemChoice` (archetypes, invocations, feats, etc.). `system.skills` has `{ number, choices[] }` with short codes (`ath`, `lor`, …). `system.saves` lists ability keys. `system.powercasting` has `tech` / `force` (`none`, `full`, …).
- **Class features** (`classfeatures_from_packs.json`): Rich text; `_class_slug`; `_imported_from` path includes level folder (e.g. `classfeatures/engineer/1/...`).
- **Archetypes** (`archetypes_from_packs.json`): `_class_slug`, `system.classIdentifier`; pool entries reference `_fvtt_id` in `ItemChoice` on the class.
- **Species**: Name + description + `_species_slug`; mechanics live in **species features** (`speciesfeatures_from_packs.json`, `_species_slug`). ASI often appears as prose in the feature description ("Your Constitution score increases by 2…").
- **Backgrounds** (`backgrounds_from_packs.json`): `system.skillProficiencies`, `featOptions`, `equipment`, `advancement` may include `ItemChoice` for background feats.

## Gaps / supplements

- **Starting weapon/armor packs** are not always explicit ItemGrant rows labeled "Starting Equipment" in the export; some choices are embedded in Trait/ItemChoice at level 1. The builder resolves what it can from `advancement`, then allows **manual inventory lines** and marks unresolved packs as **DATA_GAP** in `builderMeta.missingData`.
- **Power counts** (e.g. tech powers known at 1st level) are primarily in **class feature prose** ("You learn 6 tech powers…"); the rules module **regex-extracts** counts when present, with safe fallbacks documented in code.
- **Multiclass** is out of scope for the initial wizard (single-class only).
