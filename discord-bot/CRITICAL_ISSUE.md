# Critical Issue: Voice Data Detection Not Working

## The Problem

The bot **cannot detect voice activity** because:

1. ❌ **Encryption packages aren't being detected by @discordjs/voice**
2. ❌ **Voice connections fail with "No compatible encryption modes"**
3. ❌ **Without voice connections, the bot cannot detect speaking**

## Why This Happens

`@discordjs/voice` needs encryption to connect to Discord's voice servers. Even though encryption packages (`sodium-native`, `libsodium-wrappers`) are installed, the library can't detect them at runtime on Windows.

This is a known issue with native Node.js modules on Windows.

## Solutions

### Option 1: Install Visual Studio Build Tools (Recommended)

**This is the ONLY reliable way to fix voice detection on Windows.**

1. Download Visual Studio Build Tools:
   - https://visualstudio.microsoft.com/downloads/
   - Scroll to "Tools for Visual Studio 2022"
   - Download "Build Tools for Visual Studio 2022"

2. Install:
   - Run installer
   - Select "Desktop development with C++"
   - Install

3. Reinstall encryption:
   ```bash
   cd discord-bot
   npm uninstall sodium-native
   npm install sodium-native --force
   ```

4. Restart bot

### Option 2: Use Manual Highlighting

For now, you can manually highlight characters:

```javascript
// In game browser console (F12):
highlightCharacterToken('CHARACTER_ID', 'Username', 3000);
```

### Option 3: Wait for Alternative Implementation

We're exploring alternative methods that don't require voice connections, but this will take time.

## Update (bot code)

The bot was updated to use **`connection.receiver.speaking.on('start' / 'end')`**, which matches **@discordjs/voice v0.14+**. Older code treated `SpeakingMap` like a plain `Map` and never saw speech. Restart the bot after `git pull`.

If the voice connection never reaches **ready**, encryption / native sodium is still the blocker — see Option 1 below.

## Current Status

- ✅ Bot connects to Discord
- ✅ Bot can communicate with game server
- ✅ Manual highlighting works
- ❌ Voice connections fail (encryption issue) — *when this happens, speaking still cannot work*
- ✅ Automatic speaking detection — *when voice is connected and decrypted, uses SpeakingMap events*

## Next Steps

**You MUST install Visual Studio Build Tools for voice detection to work.**

Without it, the bot cannot join voice channels or detect when users speak.


