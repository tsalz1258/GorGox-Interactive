# Testing Discord Highlight Feature

## Quick Test Steps

### 1. Verify Your Setup

**Check Discord Bot:**
```bash
cd discord-bot
node index.js
```

Look for:
- `✅ Discord bot logged in as...`
- `✅ Connected to game server!`
- `✅ Loaded X Discord links` (should show 1 if you linked)

**Check Link File:**
- Open `discord-bot/discord_links.json`
- Should contain: `{"YOUR_DISCORD_USER_ID": "YOUR_CHARACTER_ID"}`
- Example: `{"359502720278986753": "c8069000-1c03-4315-9394-fe46c6366477"}`

### 2. Verify Character Token is Placed

**In the game:**
1. Open your character sheet
2. Make sure your character token is placed on the map
3. Check browser console (F12) - type: `tokens`
4. Look for a token with `entity_id` matching your character ID

### 3. Test Voice Detection

**Join Discord Voice Channel:**
1. Join a voice channel in Discord
2. Speak clearly
3. Watch bot console - should see:
   ```
   🔊 YOUR_USERNAME (YOUR_USER_ID) started speaking
      → Linked to character: YOUR_CHARACTER_ID
   ✨ Highlighting character for YOUR_USERNAME...
   ```

### 4. Check Game Console

**Open browser console (F12) in the game:**
- Should see: `📥 Received HighlightCharacter message: {...}`
- Should see: `🔍 Looking for tokens with entity_id: YOUR_CHARACTER_ID`
- Should see: `✅ Found X matching token(s)`
- Should see: `✨ Highlighted X token(s) for character: YOUR_CHARACTER_ID`

### 5. Visual Check

**On the game map:**
- Your token should have a purple pulsing glow
- Should see "🔊 YOUR_USERNAME" label above token
- Effect should last 3 seconds

## Manual Test (If Voice Not Working)

**In browser console (F12) in the game:**
```javascript
// Replace with your actual character ID
highlightCharacterToken('c8069000-1c03-4315-9394-fe46c6366477', 'Test User', 3000);
```

This will manually trigger a highlight to test if the rendering works.

## Common Issues

### Bot says "No character linked"
- Re-link your account in-game
- Check `discord_links.json` file exists and has your link
- Restart the bot to reload links

### Bot says "No tokens found"
- Place your character token on the map
- Verify token's `entity_id` matches your character's `id`
- Check browser console for token list

### No highlight visible
- Check browser console for errors
- Make sure token is visible on map
- Try manual test above
- Check that `highlightedTokens` Map is being populated

### Voice detection not working
- Make sure you're in a Discord voice channel
- Speak louder or adjust Discord voice sensitivity
- Check bot has "Use Voice Activity" permission


