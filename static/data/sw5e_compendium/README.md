# SW5e compendium JSON (from Foundry packs)

This folder holds **generated** data produced from a local clone of the public SW5e Foundry system packs (for example [sw5e-foundry/sw5e](https://github.com/sw5e-foundry/sw5e) under `packs/`).

## Generate

From the repo root: place your SW5e clone under `starwars52data/sw5e/packs/` (the folder whose **immediate children** are `techpowers/`, `classes/`, …), **or** pass an absolute path:

```bash
node scripts/import-sw5e-packs.mjs --packs "C:/path/to/starwars52data/sw5e/packs"
```

Icons (recommended, so compendium `_icon_url_app` URLs load):

```bash
node scripts/sync-sw5e-icons.mjs --packs "C:/path/to/starwars52data/sw5e/packs"
```

Optional env:

```bash
set SW5E_PACKS_DIR=C:\path\to\starwars52data\sw5e\packs
node scripts/import-sw5e-packs.mjs
```

Default if `--packs` / `SW5E_PACKS_DIR` is omitted: `./starwars52data/sw5e/packs` (repo-relative).

Hydration path override (Rust reads slices from disk): set **`GORGOX_SW5E_COMP_PATH`** to a folder containing `*_from_packs.json` if you keep generated JSON outside `static/data/`.

The client loads tech/force power details (icons, range, school, etc.) from **`GET /api/compendium/sw5e/category-export?category=tech_powers`** (or `force_powers`) after the server hydrates SQLite, then falls back to static `*_from_packs.json` if the API is empty.

Outputs include:

- `techpowers_from_packs.json` / `force_powers_from_packs.json` — shapes compatible with `loadTechPowers` / `loadForcePowers` when served as static JSON.
- Weapons, armor, gear/misc, feats, maneuvers, species, classes, archetypes, class/archetype features, plus **`speciesfeatures`**, **`invocations`**, **`backgrounds`**, **`fighting_styles`**, **`fighting_masteries`**, **`implements`**, **`kits`**, **`manifest.json`** with counts.

## App behavior

When these files exist, the client prefers:

1. `/static/data/sw5e_compendium/techpowers_from_packs.json` (then falls back to legacy `techpowers.json`).
2. `/static/data/sw5e_compendium/force_powers_from_packs.json` (then legacy `force_powers.json`).

Equipment caches (`weapons.json`, `gear.json`, etc.) still load from `static/data/` only; generated `*_from_packs.json` slices are hydrated into SQLite for browse/player-kit.

Icons are mirrored under **`/static/sw5e-assets/packs/Icons`** by `scripts/sync-sw5e-icons.mjs` (do not commit huge binary trees unless your repo policy allows).

Bundled compendium JSON and icons come from the public SW5e Foundry system; retain **license / attribution** alongside any redistribution.
