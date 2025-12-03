# Quick Verification Checklist

Run through these steps to verify highlighting is working:

## Step 1: Basic Setup ✅

- [ ] Game server running (`cargo run`)
- [ ] Discord bot running (`start-bot.bat` or `node index.js`)
- [ ] Game open in browser (http://localhost:3000)
- [ ] Bot shows "✅ Connected to game server!" in console

## Step 2: Link Your Discord Account 🔗

1. In game browser:
   - Open your character sheet
   - Click "🔗 Link Discord Account"
   - Get your Discord User ID:
     - Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
     - Right-click your name → Copy User ID
   - Paste it into the input field
   - Click "💾 Save Link"

2. Verify link saved:
   - Check `discord-bot/discord_links.json` exists
   - Should contain: `{ "YOUR_DISCORD_ID": "YOUR_CHARACTER_ID" }`
   - Bot console should show: `✅ Loaded 1 Discord links`

## Step 3: Place Character Token on Map 🎯

1. In game browser:
   - Select your character from the character list
   - Click on the map to place the token
   - Verify token appears on map

2. Verify token entity_id:
   - Open browser console (F12)
   - Run: `console.log(tokens.map(t => ({ id: t.id, entity_id: t.entity_id, name: characters.find(c => c.id === t.entity_id)?.name })))`
   - Note your character's `entity_id` (should match character ID)

## Step 4: Test Manual Highlight (No Voice Needed) 🧪

**In Discord, type:** `!testhighlight` or `!test`

**You should see:**
- Bot replies: "✅ Test highlight triggered!"
- In bot console: `🧪 TEST: Manually triggering highlight...`
- In game server console: `📥 Received HighlightCharacter from Discord bot...`
- In game browser console: `📥 Received HighlightCharacter message: {...}`
- **Visual:** Purple pulsing highlight around your token

**If not working, check:**
- Bot console shows character ID being sent
- Game server console shows message received
- Game browser console shows message received
- Token entity_id matches character_id in link

## Step 5: Debug Information 🔍

**In Discord, type:** `!links` or `!debug`

This shows:
- Bot connection status
- WebSocket state
- Current Discord links
- All character IDs linked

## Step 6: Test Voice Detection 🔊 (If Encryption Works)

1. Join a Discord voice channel
2. Bot should join automatically (check bot console)
3. Speak in Discord
4. Should see highlighting automatically

**If encryption error:**
- See `FIX_ENCRYPTION.md`
- Manual highlighting (Step 4) still works!

## Troubleshooting

### Issue: "No character linked!"
**Fix:** Complete Step 2 - Link your Discord account

### Issue: "No tokens found for character_id"
**Fix:** 
1. Make sure token is placed on map (Step 3)
2. Verify character_id in link matches token entity_id
3. Use `!links` command to check IDs

### Issue: Bot not responding to `!test`
**Fix:**
1. Make sure bot is in the Discord server
2. Check bot console for errors
3. Verify bot has permission to read messages

### Issue: Highlight not visible in game
**Fix:**
1. Check browser console (F12) for errors
2. Verify token is on map
3. Try manual test: `highlightCharacterToken('YOUR_CHARACTER_ID', 'Test', 3000)`

## Success! 🎉

If Step 4 works (manual highlight), the entire system is configured correctly!
Voice detection just requires encryption to work (see `FIX_ENCRYPTION.md`).

