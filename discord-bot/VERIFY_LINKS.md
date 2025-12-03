# How to Verify Discord Links Are Working

## Flow Overview

1. **Player links account in game** → Saves to localStorage + Sends to server
2. **Server receives link** → Saves to `discord-bot/discord_links.json`
3. **Bot reloads links** → Reads from `discord_links.json` every 2 seconds

## Step-by-Step Verification

### Step 1: Link Your Account in Game

1. Open your character sheet in the game
2. Click "🔗 Link Discord Account" button
3. Enter your Discord User ID (17-19 digit number)
4. Click "💾 Save Link"
5. Should see: "✅ Success! Discord account linked..."

### Step 2: Check Game Server Console

**You should see:**
```
📥 Received LinkDiscordAccount request: discord_user_id=..., character_id=..., character_name=...
📁 Saving to: discord-bot/discord_links.json
✅ Successfully saved Discord link to discord-bot/discord_links.json: ... -> ...
📊 Total links in file: 1
✅ Verified: Link successfully saved and verified in file
```

**If you see errors:**
- Check if `discord-bot` folder exists
- Check file permissions
- Check game server has write access to that directory

### Step 3: Check discord_links.json File

**File location:** `discord-bot/discord_links.json`

**Should contain:**
```json
{
  "YOUR_DISCORD_USER_ID": "YOUR_CHARACTER_ID"
}
```

**Example:**
```json
{
  "359502720278986753": "c8069000-1c03-4315-9394-fe46c6366477"
}
```

### Step 4: Check Bot Console

**On startup, bot should show:**
```
✅ Loaded 1 Discord link(s) from C:\...\discord_links.json
   📋 Current Discord links:
      • Discord ID: 359502720278986753 → Character ID: c8069000-1c03-4315-9394-fe46c6366477
```

**When file is updated (within 2 seconds):**
```
🔄 Reloaded Discord links: 0 -> 1 link(s)
   📋 Updated links:
      • Discord ID: 359502720278986753 → Character ID: c8069000-1c03-4315-9394-fe46c6366477
```

### Step 5: Test with Bot Command

**In Discord, type:** `!links` or `!debug`

**Should show:**
```
**Bot Status:**
```json
{
  "connectedToGame": true,
  "webSocketState": 1,
  "linkCount": 1,
  "links": {
    "YOUR_DISCORD_ID": "YOUR_CHARACTER_ID"
  }
}
```

## Troubleshooting

### Problem: Server doesn't save the file

**Check:**
1. Game server console for errors
2. File permissions on `discord-bot` folder
3. Path is correct (should be `discord-bot/discord_links.json` relative to where server is running)

**Fix:**
- Ensure `discord-bot` folder exists in the same directory as the game server
- Check server has write permissions

### Problem: Bot doesn't load links

**Check:**
1. Bot console on startup - should show "✅ Loaded X Discord link(s)"
2. File path in bot console matches actual file location
3. File is valid JSON

**Fix:**
- Verify `discord_links.json` is valid JSON
- Check file path in bot `.env` or code matches actual location
- Bot reloads every 2 seconds, so wait a moment after saving

### Problem: Links not syncing

**Check:**
1. Bot console shows "🔄 Reloaded Discord links" message
2. File is being updated (check modification time)
3. No JSON parsing errors in bot console

**Fix:**
- Bot reloads every 2 seconds automatically
- If links don't appear, check for JSON syntax errors
- Manually reload: Restart bot or wait 2 seconds

### Problem: Wrong character ID in link

**Check:**
1. Character ID in `discord_links.json` matches token `entity_id` on map
2. Token is placed on map with correct character

**Fix:**
- Re-link your account in-game
- Verify character ID matches the token on map
- Check browser console: `console.log(tokens.map(t => t.entity_id))`

## Manual Verification Commands

### Check File Exists
```bash
# Windows
dir discord-bot\discord_links.json

# Linux/Mac
ls discord-bot/discord_links.json
```

### View File Contents
```bash
# Windows
type discord-bot\discord_links.json

# Linux/Mac
cat discord-bot/discord_links.json
```

### Test JSON Validity
```bash
# Windows PowerShell
Get-Content discord-bot\discord_links.json | ConvertFrom-Json

# Linux/Mac
cat discord-bot/discord_links.json | python -m json.tool
```

## Expected File Format

```json
{
  "DISCORD_USER_ID_1": "CHARACTER_ID_1",
  "DISCORD_USER_ID_2": "CHARACTER_ID_2"
}
```

- Keys are Discord User IDs (17-19 digit numbers as strings)
- Values are Character IDs (UUIDs)

## Success Indicators

✅ Game shows "Success! Discord account linked"  
✅ Game server console shows "✅ Successfully saved Discord link"  
✅ `discord_links.json` file exists and contains your link  
✅ Bot console shows "✅ Loaded X Discord link(s)"  
✅ `!links` command in Discord shows your link  

If all of these are true, the linking system is working correctly! 🎉

