# Discord Bot Integration for GorGox Interactive

This Discord bot connects to your D&D game and highlights player tokens when they speak in Discord voice channels.

## Features

- 🔗 **Link Discord accounts to game characters**
- 🔊 **Detect when players speak in Discord voice channels**
- ✨ **Highlight player tokens in the game when they speak**
- 💬 **Optional: Detect text messages in a designated channel**

## Setup Instructions

### Step 1: Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name (e.g., "GorGox D&D Bot")
3. Go to the "Bot" tab on the left
4. Click "Add Bot" → "Yes, do it!"
5. Under "Privileged Gateway Intents", enable:
   - ✅ PRESENCE INTENT
   - ✅ SERVER MEMBERS INTENT
   - ✅ MESSAGE CONTENT INTENT (if you want text message detection)
6. Click "Reset Token" and copy the bot token (save it securely!)
7. Go to "OAuth2" → "URL Generator"
8. Select scopes:
   - `bot`
   - `applications.commands`
9. Select bot permissions:
   - `View Channels`
   - `Connect` (to voice channels)
   - `Speak` (to join voice)
   - `Use Voice Activity`
   - `Read Message History` (if using text detection)
10. Copy the generated URL and open it in your browser to invite the bot to your Discord server

### Step 2: Install Node.js (if not already installed)

1. Download from https://nodejs.org/
2. Install Node.js (includes npm)

### Step 3: Install Dependencies

Open a terminal in the `discord-bot` folder and run:
```bash
npm install
```

### Step 4: Configure the Bot

1. Copy `.env.example` to `.env`
2. Edit `.env` and fill in:
   - `DISCORD_BOT_TOKEN` - Your bot token from Step 1
   - `GAME_SERVER_URL` - Your game server URL (e.g., `ws://localhost:3000`)
   - `VOICE_CHANNEL_ID` - (Optional) Specific voice channel to monitor
   - `TEXT_CHANNEL_ID` - (Optional) Text channel for linking commands

### Step 5: Start the Bot

```bash
node index.js
```

Or use the provided batch file on Windows:
```bash
start-bot.bat
```

## Usage

### Linking Discord Account to Character

1. In-game: Click your character sheet
2. Look for "🔗 Link Discord Account" button
3. Copy your Discord User ID (instructions provided)
4. Paste it and save

**OR** use a Discord command:
- Type `/link @YourCharacterName` in the designated text channel
- The bot will prompt you to confirm

### How It Works

1. **Voice Detection**: When a linked Discord user speaks in a voice channel, the bot detects it
2. **Game Notification**: Bot sends a WebSocket message to your game server
3. **Token Highlight**: Your character's token in the game glows/pulses
4. **Auto-Clear**: Highlight fades after a few seconds

## Troubleshooting

- **Bot doesn't join voice**: Make sure bot has "Connect" and "Speak" permissions
- **No voice detection**: Check that "Use Voice Activity" permission is enabled
- **Can't link accounts**: Verify the bot can read messages in the text channel
- **Connection issues**: Ensure your game server is running on the configured URL

## Advanced Configuration

See `config.js` for advanced options like:
- Custom highlight colors
- Highlight duration
- Multiple voice channel support
- Text message detection


