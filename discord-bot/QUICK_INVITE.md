# Quick Bot Invite - FIXED URL

## If you got "requires code grant" error:

Use this URL instead:

```
https://discord.com/api/oauth2/authorize?client_id=1445477259124150416&permissions=36703232&scope=bot
```

## Steps:

1. **Copy the URL above**
2. **Paste it in your browser**
3. **Select your Discord server**
4. **Click "Authorize"**

## What Permissions This Gives:

- View Channels
- Connect (to voice)
- Speak (for voice)
- Use Voice Activity
- Read Message History

## After Inviting:

1. **Check Discord** - Bot should appear in member list
2. **Restart the bot** - Stop (Ctrl+C) and start again
3. **Verify** - Console should show: `Bot is in 1 server(s)`

## Alternative: Use OAuth2 URL Generator

If the direct link still doesn't work:

1. Go to: https://discord.com/developers/applications
2. Click your bot application
3. Go to **"OAuth2"** → **"URL Generator"**
4. Under **"Scopes"**, check **ONLY**:
   - ✅ `bot` (don't check `applications.commands` - that causes code grant error)
5. Under **"Bot Permissions"**, check:
   - ✅ View Channels
   - ✅ Connect
   - ✅ Speak
   - ✅ Use Voice Activity
   - ✅ Read Message History
6. Copy the generated URL and use it


