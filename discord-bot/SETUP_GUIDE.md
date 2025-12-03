# Quick Setup Guide for Discord Bot

## Step 1: Create Discord Bot (5 minutes)

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** → Name it "GorGox D&D Bot" → **Create**
3. **WAIT** - Let the page fully load (you'll see "General Information" page)
4. Go to **"Bot"** tab (left sidebar) - Click it!
5. Click **"Add Bot"** button (top right) → **"Yes, do it!"**
6. **IMPORTANT:** Scroll down to find **"Privileged Gateway Intents"** section
   - ✅ Enable **PRESENCE INTENT**
   - ✅ Enable **SERVER MEMBERS INTENT**  
   - ✅ Enable **MESSAGE CONTENT INTENT**
   - **Click "Save Changes"** button at the bottom (this is critical!)
7. Above the intents, find **"Token"** section
   - Click **"Reset Token"** → **"Yes, do it!"** → Copy the token
   - Token looks like: `YOUR_BOT_TOKEN_HERE.abc123.def456ghi789jkl012mno345pqr678stu901vwx234yz`
8. **SAVE THE TOKEN** - You can only see it once!

**⚠️ TROUBLESHOOTING Step 1:**
- If "Add Bot" button is grayed out: You might already have a bot. Check the Bot tab.
- If intents won't enable: Make sure you clicked "Add Bot" first, then scroll down.
- If "Save Changes" doesn't work: Try refreshing the page, or use a different browser.
- If token won't show: You need to enable 2FA (Two-Factor Authentication) on your Discord account first.

## Step 2: Invite Bot to Your Server

**IMPORTANT:** Do this AFTER Step 1 is complete and saved!

1. In the same Discord Developer Portal, go to **"OAuth2"** tab (left sidebar)
2. Click **"URL Generator"** sub-tab (under OAuth2)
3. Under **"SCOPES"** section (middle of page), check these boxes:
   - ✅ `bot`
   - ✅ `applications.commands`
4. Scroll down to **"BOT PERMISSIONS"** section (appears after selecting scopes)
5. Check these permissions:
   - ✅ View Channels
   - ✅ Connect (under Voice Permissions)
   - ✅ Speak (under Voice Permissions)
   - ✅ Use Voice Activity (under Voice Permissions)
   - ✅ Read Message History (under Text Permissions)
6. **Scroll to the bottom** - You should see a generated URL in a box that says:
   `https://discord.com/api/oauth2/authorize?client_id=...`
7. **Copy this entire URL**
8. Paste it into a new browser tab and press Enter
9. Select your Discord server → Click **"Authorize"**

**⚠️ TROUBLESHOOTING Step 2:**
- If URL Generator is blank/gray: Make sure you selected `bot` scope first - the URL appears at bottom after selecting scopes.
- If URL doesn't appear: Scroll all the way down, it's at the very bottom below permissions.
- If settings won't save: Make sure you're clicking checkboxes, not just hovering. Try a hard refresh (Ctrl+F5).
- If you get "invalid client" error: Go back to OAuth2 → General, copy the "Client ID" and manually build URL:
  ```
  https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=36703232&scope=bot%20applications.commands
  ```
  (Replace YOUR_CLIENT_ID with your actual Client ID)

## Step 3: Configure Bot

1. In the `discord-bot` folder, copy `env-example.txt` to `.env`
2. Edit `.env` and paste your bot token:
   ```
   DISCORD_BOT_TOKEN=paste_your_token_here
   GAME_SERVER_URL=ws://localhost:3000/ws
   ```
3. Save the file

## Step 4: Install & Run

Open a terminal in the `discord-bot` folder:

```bash
# Install dependencies (first time only)
npm install

# Start the bot
npm start
```

Or on Windows, just double-click `start-bot.bat`

You should see: `✅ Discord bot logged in as YourBotName#1234!`

## Step 5: Link Characters

### Option A: In-Game (Recommended)
1. Open your character sheet in the game
2. Look for "🔗 Link Discord Account" button (we'll add this)
3. Copy your Discord User ID (instructions in the game)
4. Paste and save

### Option B: Discord Command
Type in your Discord text channel:
```
!link YourCharacterName
```

## Testing

1. Make sure your game server is running (`start.bat`)
2. Make sure the Discord bot is running (`start-bot.bat` or `npm start`)
3. Join a voice channel in Discord
4. Speak! Your character token should glow purple in the game
5. Everyone connected should see it highlight!

## Troubleshooting

**Bot doesn't appear in server?**
- Check you completed Step 2 (OAuth2 URL)
- Make sure you have permission to add bots

**Bot doesn't detect voice?**
- Make sure the bot has "Use Voice Activity" permission
- The bot doesn't need to be in the voice channel (it monitors from outside)

**No highlight in game?**
- Check that your character is linked (see Step 5)
- Make sure game server is running on port 3000
- Check bot console for connection errors

**Still not working?**
- Check bot console for error messages
- Verify `.env` file has correct token and server URL
- Make sure both game server and bot are running

