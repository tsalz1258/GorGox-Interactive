# Complete Flow Test for Discord Highlighting

## Prerequisites

1. ✅ Game server is running (`cargo run`)
2. ✅ Discord bot is running (`start-bot.bat`)
3. ✅ Game client is open in browser (http://localhost:3000)
4. ✅ Character token is placed on the map
5. ✅ Discord account is linked to character

## Step-by-Step Verification

### Step 1: Verify Bot Connection
**In bot console, you should see:**
```
✅ Connected to game server!
✅ Discord bot logged in as YourBot#1234!
Bot is in 1 server(s)
```

**If not:**
- Check `.env` file has `DISCORD_BOT_TOKEN` set
- Check bot is invited to Discord server
- Check game server is running

### Step 2: Verify Discord Link
**In bot console, check for:**
```
✅ Loaded X Discord links
```

**Check `discord_links.json` file:**
```json
{
  "YOUR_DISCORD_USER_ID": "YOUR_CHARACTER_ID"
}
```

**To create link:**
1. In game browser, open character sheet
2. Click "🔗 Link Discord Account" button
3. Enter your Discord User ID (right-click your Discord name → Copy ID)
4. Click "💾 Save Link"
5. Wait 2 seconds, then check `discord_links.json` exists and has your ID

### Step 3: Verify Character Token on Map
**In game browser console (F12), run:**
```javascript
console.log('Tokens:', tokens.map(t => ({ id: t.id, entity_id: t.entity_id, entity_type: t.entity_type })));
```

**Should see your character token with:**
- `entity_type: "Player"`
- `entity_id: "YOUR_CHARACTER_ID"` (matches the one in discord_links.json)

**If token not on map:**
1. Select your character
2. Click on the map to place token

### Step 4: Test Manual Highlight (Skip Voice)
**In game browser console (F12), run:**
```javascript
highlightCharacterToken('YOUR_CHARACTER_ID', 'TestUser', 3000);
```

**Should see:**
- Purple pulsing highlight around your token for 3 seconds
- Console: `✅ Found 1 matching token(s)`

**If not working:**
- Verify character_id matches token.entity_id
- Verify token is on map

### Step 5: Test Bot → Game Server Communication
**In bot console, manually trigger highlight:**
```javascript
// Get your character ID from discord_links.json
// Then in bot console, find the highlightCharacter function and call it
// OR use Node.js REPL:
node
> const bot = require('./index.js');
// Actually, easier to just check if bot can send messages
```

**Check game server console for:**
```
📥 Received HighlightCharacter from Discord bot: character_id=..., discord_user=...
📤 Broadcasting HighlightCharacter to all clients
```

**If not seeing this:**
- Bot WebSocket not connected (check bot console)
- Message format incorrect (check bot code)

### Step 6: Test Voice Detection
**This requires encryption to work!**

1. Join Discord voice channel
2. Bot should join automatically
3. Speak in Discord
4. Check bot console for: `🎤🎤🎤 DETECTED: YourName started speaking!`
5. Check game server console for highlight message
6. Check game browser console for highlight received

**If encryption error:**
- See `FIX_ENCRYPTION.md` for solutions
- Install Visual Studio Build Tools
- Or use manual highlighting for now

## Quick Diagnostic Commands

### In Game Browser Console (F12):
```javascript
// List all tokens
console.log('All tokens:', tokens.map(t => ({ 
    id: t.id, 
    entity_id: t.entity_id, 
    entity_type: t.entity_type,
    x: t.x,
    y: t.y
})));

// List all characters
console.log('All characters:', characters.map(c => ({ 
    id: c.id, 
    name: c.name 
})));

// Test highlight directly
const myCharId = characters.find(c => c.name === 'YOUR_CHARACTER_NAME')?.id;
if (myCharId) {
    highlightCharacterToken(myCharId, 'TestUser', 3000);
} else {
    console.error('Character not found!');
}

// Check Discord links (if accessible)
// This might not work, but try:
fetch('/discord_links.json').then(r => r.json()).then(console.log).catch(console.error);
```

### In Bot Console:
```javascript
// Check if connected
console.log('Connected:', isConnectedToGame);
console.log('WebSocket state:', gameWebSocket?.readyState); // 1 = OPEN

// Check links
console.log('Discord links:', discordLinks);

// Manually trigger highlight (adjust userId)
highlightCharacter('YOUR_DISCORD_USER_ID', 'YourUsername');
```

## Common Issues

### Issue 1: "No tokens found for character_id"
**Cause:** Character ID in Discord link doesn't match token entity_id

**Fix:**
1. Verify character ID in `discord_links.json`
2. Verify token entity_id in game (use console commands above)
3. Re-link if IDs don't match

### Issue 2: "No character linked for Discord user"
**Cause:** Discord link not saved or wrong User ID

**Fix:**
1. Check `discord_links.json` exists
2. Verify User ID is correct (it's a long number, not username)
3. Re-link using in-game button

### Issue 3: Bot not detecting speaking
**Cause:** Encryption not working

**Fix:**
1. See `FIX_ENCRYPTION.md`
2. Install Visual Studio Build Tools
3. Use manual highlighting as workaround

### Issue 4: WebSocket not connected
**Cause:** Game server not running or wrong URL

**Fix:**
1. Verify game server is running (`cargo run`)
2. Check `.env` has correct `GAME_SERVER_URL` (default: `ws://localhost:3000/ws`)
3. Check firewall isn't blocking connection

## Success Indicators

When everything works, you should see:

**When speaking in Discord:**
1. Bot console: `🎤🎤🎤 DETECTED: YourName started speaking!`
2. Bot console: `📤 Sending message: {"type":"HighlightCharacter",...}`
3. Game server console: `📥 Received HighlightCharacter from Discord bot...`
4. Game server console: `📤 Broadcasting HighlightCharacter to all clients`
5. Game browser console: `📥 Received HighlightCharacter message: {...}`
6. Game browser console: `✅ Found 1 matching token(s)`
7. **Visual:** Purple pulsing highlight around your character token

If you see all of these, it's working! 🎉

