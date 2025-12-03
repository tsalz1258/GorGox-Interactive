# How to Fix Voice Encryption Issues

## The Problem

The bot is getting "No compatible encryption modes" errors, which means it cannot:
- Join voice channels
- Detect when users speak
- Highlight characters automatically

## Solution 1: Install Visual Studio Build Tools (Recommended)

1. Download Visual Studio Build Tools:
   - Go to: https://visualstudio.microsoft.com/downloads/
   - Scroll down to "Tools for Visual Studio 2022"
   - Download "Build Tools for Visual Studio 2022"

2. Install Build Tools:
   - Run the installer
   - Select "Desktop development with C++" workload
   - Click "Install"

3. Reinstall sodium-native:
   ```bash
   cd discord-bot
   npm uninstall sodium-native
   npm install sodium-native --force
   ```

4. Restart the bot

## Solution 2: Use Manual Highlighting

Since automatic voice detection requires encryption, you can manually trigger highlights:

1. In the game, open browser console (F12)
2. Run: `highlightCharacterToken('CHARACTER_ID', 'Username', 3000)`
3. This will highlight the character for 3 seconds

## Solution 3: Wait for Encryption Fix

We're working on alternative detection methods that don't require voice connections.

## Current Status

- ✅ Bot connects to Discord
- ✅ Bot can join voice channels (but encryption fails)
- ❌ Cannot detect speaking (requires encryption)
- ✅ Manual highlighting works

## Next Steps

Try Solution 1 first - installing Visual Studio Build Tools usually fixes the encryption issue on Windows.


