# 🚨 URGENT: Bot Not in Discord Server!

## Problem
Your bot is running but shows: **"Bot is in 0 server(s)"**

This means the bot is **NOT in your Discord server**, so it can't detect voice or messages!

## Quick Fix: Invite Bot to Server

### Method 1: Use OAuth2 URL Generator (Recommended)

1. Go to: https://discord.com/developers/applications
2. Click on your application ("GorGox D&D Bot" or similar)
3. Go to **"OAuth2"** → **"URL Generator"**
4. Under **"Scopes"**, check:
   - ✅ `bot`
   - ✅ `applications.commands`
5. Under **"Bot Permissions"**, check:
   - ✅ View Channels
   - ✅ Connect
   - ✅ Speak
   - ✅ Use Voice Activity
   - ✅ Read Message History
6. **Copy the generated URL** at the bottom
7. **Paste it in your browser** and authorize the bot for your server

### Method 2: Manual URL (If URL Generator Doesn't Work)

1. Go to: https://discord.com/developers/applications
2. Click your application
3. Go to **"OAuth2"** → **"General"**
4. Copy your **"Client ID"** (should be: `1445477259124150416` based on your bot)
5. Use this URL (replace YOUR_CLIENT_ID with your Client ID):
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=36703232&scope=bot%20applications.commands
   ```
   
   **For your bot, use:**
   ```
   https://discord.com/api/oauth2/authorize?client_id=1445477259124150416&permissions=36703232&scope=bot%20applications.commands
   ```
6. Open this URL in your browser
7. Select your Discord server
8. Click **"Authorize"**

### Method 3: Quick Invite Link (FIXED)

**Use this corrected URL (removes code grant requirement):**

```
https://discord.com/api/oauth2/authorize?client_id=1445477259124150416&permissions=36703232&scope=bot
```

**OR try with just bot scope:**
```
https://discord.com/api/oauth2/authorize?client_id=1445477259124150416&permissions=36703232&scope=bot
```

**Note:** The error "requires code grant" happens when using `applications.commands` scope incorrectly. The URL above should work.

## After Inviting

1. **Restart the bot** (stop and start again)
2. You should see: **"Bot is in 1 server(s)"** or more
3. The bot will now be able to:
   - Detect when you join voice channels
   - Detect when you speak
   - Respond to commands

## Verify Bot is in Server

1. Open your Discord server
2. Look for your bot in the member list (right sidebar)
3. The bot should show as "D&D Bot" or similar
4. The bot status should show as online/active

## Test Voice Detection

Once the bot is in your server:

1. Join a Discord voice channel
2. Check bot console - you should see:
   ```
   🔊 VoiceStateUpdate event triggered
   👤 User: YOUR_USERNAME
   📍 User joined channel: [Channel Name]
   ```
3. Speak - you should see:
   ```
   🎤 DETECTED: YOUR_USERNAME started speaking!
   ```

## Still Not Working?

- Make sure you selected the **correct Discord server** when authorizing
- Check that the bot appears in your server's member list
- Verify bot permissions in server settings
- Try restarting Discord app
- Try removing and re-inviting the bot

