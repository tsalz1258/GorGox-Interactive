# Discord Token Highlight Troubleshooting

## Quick Checklist

### ✅ Step 1: Is the Discord Bot Running?

**Check bot console:**
- Should see: `✅ Discord bot logged in as YourBotName#1234!`
- Should see: `✅ Connected to game server!`
- Should see: `✅ Loaded X Discord links`

**If not running:**
```bash
cd discord-bot
npm start
```

### ✅ Step 2: Is the Game Server Running?

**Check game server console:**
- Should see: `Server listening on http://0.0.0.0:3000`

**If not running:**
```bash
start.bat
```

### ✅ Step 3: Is Your Character Linked?

**In-game:**
1. Open your character sheet
2. Click "🔗 Link Discord"
3. Enter your Discord User ID
4. Click "💾 Save Link"
5. Should see: `✅ Success! Discord account linked...`

**Check bot console after linking:**
- Should see: `✅ Saved Discord link: YOUR_USER_ID -> CHARACTER_ID (Character Name)`

**Check file:**
- Open `discord-bot/discord_links.json`
- Should contain: `{"YOUR_USER_ID": "CHARACTER_ID"}`

### ✅ Step 4: Is Your Token on the Map?

**In-game:**
- Your character token must be placed on the map
- Token must have the same `entity_id` as your character's `id`

**To place token:**
1. Select your character from the character list
2. Click "Place Token" or drag to map
3. Token should appear on the grid

### ✅ Step 5: Is Voice Detection Working?

**Check bot console when you speak:**
- Should see: `🔊 YOUR_USERNAME started speaking`
- Should see: `✨ Highlighting character for YOUR_USERNAME (Discord: YOUR_USER_ID, Character: CHARACTER_ID)`

**If you don't see these messages:**
- Make sure you're in a Discord voice channel
- Make sure the bot has "Use Voice Activity" permission
- Try speaking louder or adjusting Discord's voice sensitivity

### ✅ Step 6: Is the Highlight Message Being Sent?

**Check game server console:**
- Should see: `📥 Message from game server: HighlightCharacter` (when bot sends)

**Check game browser console (F12):**
- Should see: `✨ Highlighting character CHARACTER_ID (Discord: YOUR_USERNAME)`
- Should see: `✨ Highlighted X token(s) for character: CHARACTER_ID`

### ✅ Step 7: Is the Token Rendering?

**Check game browser console:**
- Should see highlight animation in console logs
- Token should have purple glow effect

**Visual check:**
- Token should pulse with purple glow
- Should see "🔊 YOUR_USERNAME" label above token
- Effect should last 3 seconds

## Common Issues & Fixes

### Issue: "No character linked for Discord user"

**Cause:** Link not synced between game and bot

**Fix:**
1. Re-link in-game (click "🔗 Link Discord" → Save again)
2. Check `discord-bot/discord_links.json` file exists and has your link
3. Restart the Discord bot to reload links

### Issue: "No tokens found for character_id"

**Cause:** Token not placed on map, or wrong character ID

**Fix:**
1. Place your character token on the map
2. Verify token's `entity_id` matches your character's `id`
3. Check browser console for token placement logs

### Issue: Bot doesn't detect voice

**Cause:** Voice activity not enabled or bot permissions missing

**Fix:**
1. Check Discord server settings → Bot permissions
2. Ensure "Use Voice Activity" is enabled
3. Try speaking louder or adjusting Discord voice sensitivity
4. Make sure you're actually in a voice channel

### Issue: Bot not connected to game server

**Cause:** Game server not running or wrong URL

**Fix:**
1. Check `.env` file: `GAME_SERVER_URL=ws://localhost:3000/ws`
2. Make sure game server is running on port 3000
3. Check bot console for connection errors
4. Try restarting both bot and game server

### Issue: Highlight not visible

**Cause:** Token not rendering or highlight code not working

**Fix:**
1. Check browser console for errors (F12)
2. Make sure token is visible on map
3. Try refreshing the game page (Ctrl+F5)
4. Check that `highlightedTokens` Map is being updated

## Debug Commands

### Check Bot Links:
```bash
# View current links
cat discord-bot/discord_links.json
```

### Check Game Links:
1. Open browser console (F12)
2. Type: `localStorage.getItem('discord_links_map')`
3. Should see your Discord User ID → Character ID mapping

### Test Voice Detection:
1. Join Discord voice channel
2. Speak clearly
3. Watch bot console for: `🔊 USERNAME started speaking`
4. Watch game server console for highlight message
5. Watch game browser console for highlight logs

## Still Not Working?

1. **Check all console logs** (bot, server, browser)
2. **Verify file paths** - `discord-bot/discord_links.json` should exist
3. **Restart everything:**
   - Stop Discord bot (Ctrl+C)
   - Stop game server (Ctrl+C)
   - Restart game server
   - Restart Discord bot
4. **Re-link your account** in-game
5. **Check file permissions** - bot needs write access to `discord-bot/` folder


