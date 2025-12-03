# Debug Checklist - Voice Not Working

## Step-by-Step Debugging

### 1. Check Bot Console When You Speak

When you speak in Discord, you should see these logs in the bot console:

```
🎤 ===== SPEAKING DETECTED =====
🔊 YOUR_USERNAME (YOUR_USER_ID) started speaking in DnD
   Game server connected: true
   WebSocket ready: true
   Checking for link: Discord User ID YOUR_USER_ID
   All loaded links: {"359502720278986753": "c8069000-1c03-4315-9394-fe46c6366477"}
   ✅ FOUND LINK: Character ID = c8069000-1c03-4315-9394-fe46c6366477
   📤 Sending highlight message to game server...
🎯 highlightCharacter called: userId=YOUR_USER_ID, username=YOUR_USERNAME
✨ Highlighting character for YOUR_USERNAME (Discord: YOUR_USER_ID, Character: CHARACTER_ID)
📤 Sending message: {"type":"HighlightCharacter","character_id":"...","discord_user_id":"...","discord_username":"...","duration":3000}
✅ Message sent successfully!
🎤 ============================
```

**If you DON'T see these logs:**
- The bot is not detecting your voice
- Check: Are you in the same voice channel as the bot?
- Check: Is your microphone working in Discord?
- Check: Does the bot console show "✅ Subscribed to audio from YOUR_USERNAME"?

### 2. Check Game Server Console

When the bot sends a HighlightCharacter message, you should see in the game server console:

```
📥 Received HighlightCharacter from Discord bot: character_id=..., discord_user=... (...)
📤 Broadcasting HighlightCharacter to all clients
```

**If you DON'T see this:**
- The bot is not successfully sending messages
- Check bot console for errors when sending

### 3. Check Browser Console (Game)

In the game browser (press F12), when you speak, you should see:

```
Received: {type: 'HighlightCharacter', character_id: '...', discord_user_id: '...', ...}
📥 Received HighlightCharacter message: {character_id: '...', ...}
🔍 Looking for tokens with entity_id: ...
📊 Current tokens on map: [...]
✨ Highlighting character ... (Discord: ...)
```

**If you DON'T see this:**
- The message is not reaching the browser
- Check: Is the game server running?
- Check: Is the browser connected to the game server?

### 4. Common Issues

#### Issue: "No character linked"
**Solution:**
1. Open your character sheet in-game
2. Click "🔗 Link Discord Account"
3. Enter your Discord User ID (right-click your Discord profile → Copy User ID)
4. Click "💾 Save Link"
5. Wait a few seconds for the bot to reload links
6. Try speaking again

#### Issue: Bot not detecting voice
**Solution:**
1. Make sure you're in the same voice channel as the bot
2. Check Discord voice settings - make sure "Use Voice Activity" is enabled
3. Try speaking louder or adjusting Discord's voice sensitivity
4. Check bot console for "✅ Subscribed to audio from YOUR_USERNAME"

#### Issue: Message sent but no highlight
**Solution:**
1. Make sure your character token is placed on the map
2. Check that the token's `entity_id` matches your character's `id`
3. Check browser console for token lookup errors

### 5. Quick Test

Run this in the browser console (F12) while the game is open:

```javascript
highlightCharacterToken('c8069000-1c03-4315-9394-fe46c6366477', 'Test', 3000);
```

If this works, the highlighting system is fine and the issue is with Discord detection or message sending.


