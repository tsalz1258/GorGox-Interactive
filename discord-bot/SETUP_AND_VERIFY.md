# Complete Setup and Verification Guide

## Overview

The Discord highlighting system works like this:

1. **Bot joins Discord voice channel** → Detects when users speak
2. **Bot looks up character** → Checks `discord_links.json` for Discord User ID → Character ID mapping
3. **Bot sends message** → Sends `HighlightCharacter` message to game server via WebSocket
4. **Game server broadcasts** → Forwards message to all connected game clients
5. **Game client highlights** → Finds token with matching `entity_id` and displays purple pulsing highlight

## Quick Start

### 1. Start Everything

```bash
# Terminal 1: Start game server
cargo run

# Terminal 2: Start Discord bot
cd discord-bot
start-bot.bat
# OR: node index.js
```

### 2. Link Your Account

1. Open game in browser: http://localhost:3000
2. Open your character sheet
3. Click "🔗 Link Discord Account"
4. Get your Discord User ID:
   - Enable Developer Mode: Discord Settings → Advanced → Developer Mode
   - Right-click your Discord username → Copy User ID
5. Paste User ID and click "💾 Save Link"

### 3. Place Token on Map

1. Select your character from character list
2. Click on the map to place token
3. Token should appear

### 4. Test It!

**In Discord, type:** `!testhighlight`

You should see:
- ✅ Purple pulsing highlight around your character token
- ✅ Bot console shows message being sent
- ✅ Game server console shows message received
- ✅ Game browser console shows highlight triggered

## Troubleshooting

### Problem: "No character linked!"

**Solution:**
1. Make sure you completed Step 2 (Link Account)
2. Check `discord-bot/discord_links.json` exists and contains your Discord User ID
3. Bot reloads links every 2 seconds - wait a moment after saving

### Problem: "No tokens found for character_id"

**Solution:**
1. Make sure token is placed on map (Step 3)
2. Check character ID in link matches token entity_id:
   - In game browser console (F12): `console.log(tokens.map(t => t.entity_id))`
   - Compare with character ID in `discord_links.json`
3. Re-link if IDs don't match

### Problem: Bot not responding to commands

**Solution:**
1. Check bot is in your Discord server
2. Check bot console for errors
3. Verify bot has permission to read messages in the channel

### Problem: No highlighting when speaking (encryption error)

**Solution:**
1. This is expected if encryption isn't working
2. Manual highlighting still works! Use `!testhighlight` command
3. To fix voice detection, see `FIX_ENCRYPTION.md`
4. Or install Visual Studio Build Tools for Windows

### Problem: Highlight not visible

**Solution:**
1. Check browser console (F12) for errors
2. Verify token is on map
3. Try manual test in browser console:
   ```javascript
   highlightCharacterToken('YOUR_CHARACTER_ID', 'Test', 3000);
   ```

## Verification Commands

### Discord Bot Commands

- `!testhighlight` or `!test` - Manually trigger highlight (no voice needed)
- `!links` or `!debug` - Show bot status and current links

### Browser Console Commands (F12)

```javascript
// List all tokens with their entity IDs
console.log(tokens.map(t => ({ 
    id: t.id, 
    entity_id: t.entity_id, 
    name: characters.find(c => c.id === t.entity_id)?.name 
})));

// List all characters
console.log(characters.map(c => ({ id: c.id, name: c.name })));

// Test highlight manually
highlightCharacterToken('YOUR_CHARACTER_ID', 'Test', 3000);
```

## File Locations

- **Discord links:** `discord-bot/discord_links.json`
- **Bot config:** `discord-bot/.env`
- **Game server:** Runs on port 3000
- **Bot WebSocket:** Connects to `ws://localhost:3000/ws`

## Expected Console Output

### When everything works:

**Bot Console:**
```
✅ Connected to game server!
✅ Loaded 1 Discord links
🧪 TEST: Manually triggering highlight for username (userId) -> characterId
📤 Sending message: {"type":"HighlightCharacter",...}
✅ Message sent successfully!
```

**Game Server Console:**
```
📥 Received HighlightCharacter from Discord bot: character_id=..., discord_user=...
📤 Broadcasting HighlightCharacter to all clients
```

**Game Browser Console:**
```
📥 Received HighlightCharacter message: {character_id: '...', ...}
🔍 Looking for tokens with entity_id: ...
✅ Found 1 matching token(s)
✨ Highlighted 1 token(s) for character: ...
```

## Next Steps

1. ✅ Complete setup (Steps 1-3)
2. ✅ Test with `!testhighlight` command
3. ✅ If manual test works, system is configured correctly!
4. ⚠️ If voice detection doesn't work, see `FIX_ENCRYPTION.md`

The manual highlight test (`!testhighlight`) bypasses voice detection entirely - if it works, everything is configured correctly, and you just need to fix encryption for automatic voice detection.

