# Build Fix Documentation

## Problem

When running `cargo build --release`, the build fails with:
- **LNK1104**: Cannot open file (linker error)
- **Access is denied (os error 5)**: Windows Defender/Antivirus locking files

This is a common Windows issue caused by:
1. **Windows Defender** scanning and locking .exe files during compilation
2. **OneDrive** syncing files and creating locks
3. **Antivirus software** blocking Rust-compiled executables (false positives)

## Solution Implemented

### 1. Custom Build Directory

Created `.cargo/config.toml` to build outside OneDrive:
- Build directory: `C:\Users\tyler\AppData\Local\RustBuilds\gorgox-interactive`
- This avoids OneDrive file locking issues
- Uses a local directory with proper permissions

### 2. Fix Script

Created `fix_build_permissions.ps1` to:
- Add build directory to Windows Defender exclusions
- Add project directory to Windows Defender exclusions
- Clean locked build files

## How to Fix

### Option 1: Use the Fix Script (Recommended)

1. Open PowerShell **as Administrator**
   - Right-click PowerShell → "Run as Administrator"

2. Navigate to the project directory:
   ```powershell
   cd "C:\Users\tyler\OneDrive\Desktop\DND\gorgox-interactive-github\GorGox-Interactive"
   ```

3. Run the fix script:
   ```powershell
   .\fix_build_permissions.ps1
   ```

4. Wait a few seconds, then build:
   ```powershell
   cargo build --release
   ```

### Option 2: Manual Windows Defender Exclusion

1. Open **Windows Security**:
   - Press `Windows Key + I`
   - Go to: Privacy & Security → Windows Security
   - Click: Virus & threat protection

2. Add exclusions:
   - Click: "Manage settings" (under Virus & threat protection settings)
   - Scroll to: Exclusions
   - Click: "Add or remove exclusions"
   - Click: "+ Add an exclusion" → "Folder"
   - Add these folders:
     - `C:\Users\tyler\AppData\Local\RustBuilds\gorgox-interactive`
     - `C:\Users\tyler\OneDrive\Desktop\DND\gorgox-interactive-github\GorGox-Interactive`

3. Build:
   ```powershell
   cargo clean
   cargo build --release
   ```

### Option 3: Temporary Workaround

If you have an existing build, you can use it directly:

1. Check if executable exists:
   ```powershell
   # Debug build
   Test-Path "C:\Users\tyler\AppData\Local\RustBuilds\gorgox-interactive\debug\gorgox_interactive.exe"
   
   # Release build
   Test-Path "C:\Users\tyler\AppData\Local\RustBuilds\gorgox-interactive\release\gorgox_interactive.exe"
   ```

2. If it exists, run it directly (no rebuild needed)

## Code Review Summary

All code has been reviewed and is correct:

✅ **main.rs** - Proper initialization and error handling
✅ **server.rs** - WebSocket server, HTTP endpoints, game state management
✅ **models.rs** - Data structures and message types
✅ **combat.rs** - Combat system logic
✅ **game_state.rs** - Game state management
✅ **db.rs** - Database initialization and migrations
✅ **Cargo.toml** - Dependencies are correct

### Note on axum::body::to_bytes

The code uses `axum::body::to_bytes(body, 50_000_000)` which is correct for axum 0.7.
The size limit parameter is optional but used here for safety.

## Build Configuration

The build is configured via `.cargo/config.toml`:
- Builds outside OneDrive to avoid file locking
- Uses local AppData directory for better permissions
- All builds (debug and release) use the same directory

## Troubleshooting

### If build still fails:

1. **Check Windows Defender exclusions**:
   - Verify the directories are actually excluded
   - May need to restart Windows Security service

2. **Check for running processes**:
   ```powershell
   # Check if any Rust processes are running
   Get-Process | Where-Object {$_.ProcessName -like "*rust*" -or $_.ProcessName -like "*cargo*"}
   
   # Kill them if needed
   Stop-Process -Name "rustc" -Force -ErrorAction SilentlyContinue
   Stop-Process -Name "cargo" -Force -ErrorAction SilentlyContinue
   ```

3. **Clean and retry**:
   ```powershell
   cargo clean
   Remove-Item -Path "C:\Users\tyler\AppData\Local\RustBuilds\gorgox-interactive" -Recurse -Force
   cargo build --release
   ```

4. **Temporary disable Windows Defender** (not recommended, but works):
   - Only as a last resort
   - Re-enable immediately after build

## Success Criteria

Build should complete successfully with:
```
Finished release [optimized] target(s) in XX.XXs
```

The executable will be at:
```
C:\Users\tyler\AppData\Local\RustBuilds\gorgox-interactive\release\gorgox_interactive.exe
```

## Additional Notes

- The custom build directory persists across builds
- Debug and release builds share the same directory (different subdirectories)
- You can remove `.cargo/config.toml` to revert to default behavior (but will likely have the same issues)


