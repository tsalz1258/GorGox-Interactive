# GorGox-Interactive

Custom D&D / tabletop virtual tabletop server + web UI.

## Quick start (Windows)

### Build

- Run `build.bat`

### Start

- Run `start.bat`
- Open `http://localhost:3000`

## Troubleshooting

### Build fails on Windows (LNK1104 / “Access is denied (os error 5)”)

This is usually Windows Defender / antivirus or OneDrive locking files during compile/link.

- **Run `build.bat` as Administrator** (right-click → Run as administrator)
- **Add exclusions** (recommended):
  - Project folder: this repo
  - Build folder: `.\target`

If it still fails:

- Close anything that may be scanning/locking `target\` (AV, OneDrive sync, Explorer preview)
- Run a clean build:
  - `cargo clean`
  - then `build.bat` again

### Browser shows old UI / “X is not defined”

That usually means the browser cached an older `static/app.js`.

- Close all tabs for `localhost:3000`
- Re-open and hard refresh:
  - Chrome/Edge: `Ctrl+Shift+R` (or `Ctrl+F5`)
  - Or DevTools → right-click refresh → “Empty Cache and Hard Reload”

## Notes

- The map list endpoint is `GET /api/maps`.
- Save/load game states are in `GET /api/saves` and `GET /api/saves/:filename`.
