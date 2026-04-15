// CRITICAL: Initialize encryption BEFORE loading @discordjs/voice
// @discordjs/voice checks for encryption at load time, so we must ensure it's ready
console.log('🔐 Initializing voice encryption...');

const WebSocket = require('ws');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Initialize encryption and THEN load Discord.js and voice
async function initializeEncryption() {
    // Try libsodium-wrappers first (most reliable on Windows)
    try {
        const libsodium = require('libsodium-wrappers');
        console.log('   🔄 Found libsodium-wrappers, waiting for initialization...');
        await libsodium.ready;
        console.log('   ✅ libsodium-wrappers fully initialized!');
        
        // @discordjs/voice checks for encryption in multiple ways
        // We need to ensure it's available in all places it looks
        if (!global.sodium) {
            global.sodium = libsodium;
            console.log('   ✅ Set global.sodium');
        }
        
        // Also ensure it's in require.cache so @discordjs/voice can find it
        // @discordjs/voice checks require('libsodium-wrappers') directly
        const libsodiumPath = require.resolve('libsodium-wrappers');
        console.log('   ✅ libsodium-wrappers path:', libsodiumPath);
        
        // Verify required functions exist
        if (typeof libsodium.crypto_aead_xchacha20poly1305_ietf_encrypt === 'function') {
            console.log('   ✅ Required encryption functions available');
        } else {
            console.error('   ❌ Missing required encryption functions!');
            return false;
        }
        
        return true;
    } catch (e) {
        console.log('   ⚠️ libsodium-wrappers failed:', e.message);
        console.log('   Stack:', e.stack);
    }
    
    // Try sodium-native as fallback
    try {
        const sodiumNative = require('sodium-native');
        console.log('   ✅ sodium-native loaded (native bindings)');
        
        // Make sure it's globally available
        if (!global.sodium) {
            global.sodium = sodiumNative;
        }
        
        return true;
    } catch (e) {
        console.log('   ⚠️ sodium-native not available:', e.message);
    }
    
    return false;
}

// Wrap everything in async function to wait for encryption
(async () => {
    // Wait for encryption, then load Discord.js
    const encryptionReady = await initializeEncryption();
    
    if (!encryptionReady) {
        console.error('');
        console.error('╔════════════════════════════════════════════════════════════╗');
        console.error('║  FATAL: No encryption package available!                    ║');
        console.error('║  Voice detection requires encryption.                       ║');
        console.error('║                                                              ║');
        console.error('║  Please install: npm install libsodium-wrappers            ║');
        console.error('║  Or install Visual Studio Build Tools for sodium-native    ║');
        console.error('╚════════════════════════════════════════════════════════════╝');
        console.error('');
        process.exit(1);
    }
    
    console.log('✅ Encryption ready! Loading Discord.js and voice module...\n');
    console.log('📌 Discord Developer Portal → Bot → enable **MESSAGE CONTENT** + **SERVER MEMBERS** intents if needed.');
    console.log('📌 Voice still requires libsodium working; set DISCORD_VOICE_DEBUG=1 for extra join logs.\n');
    
    // NOW load Discord.js and @discordjs/voice after encryption is ready
    const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
    
    // Verify encryption is still available before loading @discordjs/voice
    try {
        const libsodium = require('libsodium-wrappers');
        if (typeof libsodium.crypto_aead_xchacha20poly1305_ietf_encrypt !== 'function') {
            throw new Error('Encryption functions not available');
        }
        console.log('   ✅ Verified encryption functions before loading @discordjs/voice');
    } catch (e) {
        console.error('   ❌ Encryption verification failed:', e.message);
        process.exit(1);
    }
    
    const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
    
    // Verify encryption detection
    console.log('🔍 Verifying encryption detection after @discordjs/voice load...');
    console.log('   ✅ @discordjs/voice loaded');
    
    // Try to verify @discordjs/voice can see encryption
    try {
        // @discordjs/voice exposes encryption detection through internal methods
        // We can't access them directly, but we can test by checking the module
        console.log('   ✅ Encryption should be detected by @discordjs/voice');
    } catch (e) {
        console.error('   ⚠️ Could not verify encryption detection:', e.message);
    }
    console.log('');
    
    // Startup logging
    console.log('🚀 Starting Discord Bot...');
    console.log('📁 Working directory:', __dirname);
    
    // Load environment variables
    try {
        dotenv.config();
        console.log('✅ Environment variables loaded');
    } catch (error) {
        console.error('❌ Error loading .env file:', error);
    }
    
    // Configuration
    const CONFIG = {
        token: process.env.DISCORD_BOT_TOKEN,
        gameServerUrl: process.env.GAME_SERVER_URL || 'ws://localhost:3000/ws',
        voiceChannelId: process.env.VOICE_CHANNEL_ID || null,
        textChannelId: process.env.TEXT_CHANNEL_ID || null,
        highlightDuration: parseInt(process.env.HIGHLIGHT_DURATION) || 3000,
        highlightColor: process.env.HIGHLIGHT_COLOR || '#4a9eff',
        linksFile: path.join(__dirname, 'discord_links.json')
    };

    console.log('⚙️ Configuration:');
    console.log('   Game Server URL:', CONFIG.gameServerUrl);
    console.log('   Links File:', CONFIG.linksFile);
    console.log('   Token set:', CONFIG.token ? 'Yes (hidden)' : 'NO - THIS IS THE PROBLEM!');
    console.log('');
    
    // All remaining code is inside this async function
    // so it runs AFTER encryption is initialized
    
    // Store Discord User ID -> Character mappings
    let discordLinks = {};
    let gameWebSocket = null;
    let isConnectedToGame = false;
    
    // Load saved links from file
    function loadLinks() {
        try {
            if (fs.existsSync(CONFIG.linksFile)) {
                const data = fs.readFileSync(CONFIG.linksFile, 'utf8');
                discordLinks = JSON.parse(data);
                console.log(`✅ Loaded ${Object.keys(discordLinks).length} Discord link(s) from ${CONFIG.linksFile}`);
                
                // Log each link for verification
                if (Object.keys(discordLinks).length > 0) {
                    console.log('   📋 Current Discord links:');
                    Object.entries(discordLinks).forEach(([discordId, charId]) => {
                        console.log(`      • Discord ID: ${discordId} → Character ID: ${charId}`);
                    });
                }
            } else {
                console.log(`ℹ️ No existing Discord links file found at: ${CONFIG.linksFile}`);
                console.log('   💡 Links will be created when players link their accounts in-game');
            }
        } catch (error) {
            console.error(`❌ Error loading links from ${CONFIG.linksFile}:`, error.message);
            console.error('   Stack:', error.stack);
        }
    }

    // Reload links from file (called periodically to sync with game)
    function reloadLinks() {
        try {
            if (fs.existsSync(CONFIG.linksFile)) {
                const data = fs.readFileSync(CONFIG.linksFile, 'utf8');
                const newLinks = JSON.parse(data);
                const oldCount = Object.keys(discordLinks).length;
                const oldLinks = JSON.stringify(discordLinks);
                discordLinks = newLinks;
                const newCount = Object.keys(discordLinks).length;
                const newLinksStr = JSON.stringify(discordLinks);
                
                if (newCount !== oldCount || oldLinks !== newLinksStr) {
                    console.log(`🔄 Reloaded Discord links: ${oldCount} -> ${newCount} link(s)`);
                    if (newCount > 0) {
                        console.log(`   📋 Updated links:`);
                        Object.entries(discordLinks).forEach(([discordId, charId]) => {
                            console.log(`      • Discord ID: ${discordId} → Character ID: ${charId}`);
                        });
                    }
                }
            } else {
                // File doesn't exist - check if we had links before
                if (Object.keys(discordLinks).length > 0) {
                    console.log(`⚠️ discord_links.json file disappeared! Had ${Object.keys(discordLinks).length} link(s) before.`);
                    discordLinks = {};
                }
            }
        } catch (error) {
            console.error(`❌ Error reloading links from ${CONFIG.linksFile}:`, error.message);
        }
    }

    // Periodically reload links to sync with game (every 2 seconds)
    setInterval(reloadLinks, 2000);
    
    // Save links to file
    function saveLinks() {
    try {
        fs.writeFileSync(CONFIG.linksFile, JSON.stringify(discordLinks, null, 2));
    } catch (error) {
        console.error('❌ Error saving links:', error);
    }
}

    // Connect to game server via WebSocket
    function connectToGameServer() {
    console.log(`🔌 Connecting to game server: ${CONFIG.gameServerUrl}`);
    
    gameWebSocket = new WebSocket(CONFIG.gameServerUrl);
    
    gameWebSocket.on('open', () => {
        console.log('✅ Connected to game server!');
        isConnectedToGame = true;
        
        // Send a special "DiscordBot" connection message
        gameWebSocket.send(JSON.stringify({
            type: 'Connect',
            player_name: 'Discord Bot',
            is_dm: false,
            style: 'dnd'
        }));
    });
    
    gameWebSocket.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('📥 Message from game server:', message.type);
            
            // Handle any messages from the game server if needed
            if (message.type === 'Connected') {
                console.log('✅ Game server confirmed connection');
            }
        } catch (error) {
            console.error('❌ Error parsing message from game server:', error);
        }
    });
    
    gameWebSocket.on('error', (error) => {
        console.error('❌ Game server connection error:', error.message);
        isConnectedToGame = false;
    });
    
    gameWebSocket.on('close', () => {
        console.log('⚠️ Disconnected from game server. Reconnecting in 5 seconds...');
        isConnectedToGame = false;
        setTimeout(connectToGameServer, 5000);
    });
}

    // Send highlight message to game server
    function highlightCharacter(discordUserId, discordUsername) {
    console.log(`🎯 highlightCharacter called: userId=${discordUserId}, username=${discordUsername}`);
    
    if (!isConnectedToGame) {
        console.warn('⚠️ Not connected to game server (isConnectedToGame=false), cannot highlight');
        return;
    }
    
    if (!gameWebSocket) {
        console.warn('⚠️ Game WebSocket is null, cannot highlight');
        return;
    }
    
    if (gameWebSocket.readyState !== WebSocket.OPEN) {
        console.warn(`⚠️ WebSocket not ready. State: ${gameWebSocket.readyState} (OPEN=1), cannot highlight`);
        return;
    }
    
    const characterId = discordLinks[discordUserId];
    if (!characterId) {
        console.log(`⚠️ No character linked for Discord user ${discordUsername} (${discordUserId})`);
        console.log(`   Current links:`, JSON.stringify(discordLinks, null, 2));
        return;
    }
    
    console.log(`✨ Highlighting character for ${discordUsername} (Discord: ${discordUserId}, Character: ${characterId})`);
    
    // Send message to game server to highlight the character
    const message = {
        type: 'HighlightCharacter',
        character_id: characterId,
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        duration: CONFIG.highlightDuration
    };
    
    console.log(`📤 Sending message:`, JSON.stringify(message, null, 2));
    
    try {
        gameWebSocket.send(JSON.stringify(message));
        console.log(`✅ Message sent successfully!`);
    } catch (error) {
        console.error(`❌ Error sending message:`, error);
    }
}

    // Create Discord client
    const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

    // Track speaking status
    const speakingUsers = new Map();
    /** Throttle Opus `data` fallback so we don't call handlers every packet */
    const opusFallbackLastFire = new Map();
    /** Legacy: keyed by channel id; prefer getVoiceConnection(guildId) */
    const voiceConnections = new Map();

    client.once(Events.ClientReady, async () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}!`);
    console.log(`   Bot ID: ${client.user.id}`);
    console.log(`   Bot is in ${client.guilds.cache.size} server(s)`);
    client.user.setActivity('D&D Game', { type: ActivityType.Watching });
    
    // List all servers and channels for debugging
    client.guilds.cache.forEach(guild => {
        console.log(`   📋 Server: ${guild.name} (${guild.id})`);
        const voiceChannels = guild.channels.cache.filter(ch => ch.isVoiceBased());
        console.log(`      Voice channels: ${voiceChannels.size}`);
        
        // List voice channels
        voiceChannels.forEach(channel => {
            const memberCount = channel.members.size;
            console.log(`         🔊 ${channel.name} (${channel.id}) - ${memberCount} member(s)`);
        });
    });
    
    // If a specific voice channel is configured, join it
    if (CONFIG.voiceChannelId) {
        console.log(`🎯 Configured to monitor specific voice channel: ${CONFIG.voiceChannelId}`);
        await joinConfiguredVoiceChannel();
    } else {
        console.log(`ℹ️ No specific voice channel configured - bot will auto-join when users join any channel`);
        console.log(`   To set a specific channel, add VOICE_CHANNEL_ID=your_channel_id to .env file`);
    }
    
    // Connect to game server
    connectToGameServer();
});

    // Join a configured voice channel on startup
    async function joinConfiguredVoiceChannel() {
    try {
        const channelId = CONFIG.voiceChannelId;
        console.log(`   🔍 Looking for voice channel: ${channelId}`);
        
        // Find the channel across all servers
        let targetChannel = null;
        for (const guild of client.guilds.cache.values()) {
            const channel = guild.channels.cache.get(channelId);
            if (channel && channel.isVoiceBased()) {
                targetChannel = channel;
                console.log(`   ✅ Found channel: ${channel.name} in server: ${guild.name}`);
                break;
            }
        }
        
        if (!targetChannel) {
            console.log(`   ⚠️ Voice channel ${channelId} not found!`);
            console.log(`   Make sure:`);
            console.log(`   1. The bot is in the server with that channel`);
            console.log(`   2. The channel ID is correct`);
            console.log(`   3. The channel is a voice channel`);
            return;
        }
        
        // Join the channel
        console.log(`   🤖 Joining voice channel: ${targetChannel.name}...`);
        const voiceDebug = process.env.DISCORD_VOICE_DEBUG === '1';
        const connection = joinVoiceChannel({
            channelId: targetChannel.id,
            guildId: targetChannel.guild.id,
            adapterCreator: targetChannel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
            debug: voiceDebug,
        });
        
        voiceConnections.set(targetChannel.id, connection);
        wireVoiceConnectionLifecycle(connection);
        if (connection.state.status === 'ready') {
            setupSpeakingDetection(connection);
        }
        
    } catch (error) {
        console.error(`   ❌ Error joining configured voice channel:`, error);
    }
}

    function getLiveVoiceChannelFromConnection(connection) {
        if (!connection || !connection.joinConfig) return null;
        const { guildId, channelId } = connection.joinConfig;
        if (!guildId || !channelId) return null;
        const guild = client.guilds.cache.get(guildId);
        return guild ? guild.channels.cache.get(channelId) : null;
    }

    async function resolveVoiceChannel(guild, channelId) {
        if (!guild || !channelId) return null;
        let ch = guild.channels.cache.get(channelId);
        if (ch && ch.isVoiceBased()) return ch;
        try {
            ch = await guild.channels.fetch(channelId);
            return ch && ch.isVoiceBased() ? ch : null;
        } catch (e) {
            console.error(`   ❌ Could not fetch voice channel ${channelId}:`, e.message);
            return null;
        }
    }

    /** One stateChange + error handler per VoiceConnection (@discordjs/voice reuses one connection per guild). */
    function wireVoiceConnectionLifecycle(connection) {
        if (connection._gorgoxLifecycleWired) return;
        connection._gorgoxLifecycleWired = true;
        connection.on('stateChange', (oldS, newS) => {
            console.log(`   🔌 Voice connection state: ${oldS.status} -> ${newS.status}`);
            if (newS.status === 'ready') {
                const ch = getLiveVoiceChannelFromConnection(connection);
                console.log(`   ✅ Voice ready — monitoring: ${ch ? ch.name : connection.joinConfig.channelId}`);
                setupSpeakingDetection(connection);
            }
        });
        connection.on('error', (error) => {
            const msg = error && error.message ? error.message : String(error);
            console.error(`   ❌ Voice connection error:`, msg);
            if (msg.includes('encryption') || msg.includes('compatible encryption')) {
                console.error('   → Fix: ensure libsodium-wrappers works, or install VS Build Tools + sodium-native (see CRITICAL_ISSUE.md)');
            }
        });
    }

    // Monitor voice state changes
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    console.log(`🔊 VoiceStateUpdate: old=${oldState.channelId} new=${newState.channelId}`);
    
    if (!newState.member) {
        console.log(`   ⚠️ No member in newState`);
        return;
    }
    
    if (!newState.member.user) {
        console.log(`   ⚠️ No user in member`);
        return;
    }
    
    if (newState.member.user.bot) {
        console.log(`   ⏭️ Skipping bot user`);
        return;
    }
    
    const username = newState.member.user.username;
    console.log(`   👤 User: ${username}`);
    
    // If user joined a voice channel, ensure bot is in that channel
    if (newState.channelId && newState.channelId !== oldState.channelId) {
        const channel = await resolveVoiceChannel(newState.guild, newState.channelId);
        console.log(`   📍 User ${username} joined: ${channel ? channel.name : '(could not resolve channel)'}`);
        
        if (!channel) {
            console.log(`   ❌ Voice channel missing from cache and fetch failed — check bot permissions & channel id`);
            return;
        }
        
        const voiceDebug = process.env.DISCORD_VOICE_DEBUG === '1';
        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: true,
                debug: voiceDebug,
            });
            voiceConnections.set(channel.id, connection);
            wireVoiceConnectionLifecycle(connection);
            if (connection.state.status === 'ready') {
                setupSpeakingDetection(connection);
            }
        } catch (error) {
            console.error(`   ❌ Error joining voice channel:`, error);
            console.error(`   Error details:`, error.stack);
        }
    }
    
    // If user left the channel, check if bot should leave too
    if (!newState.channelId && oldState.channelId) {
        const channel = await resolveVoiceChannel(oldState.guild, oldState.channelId);
        if (channel) {
            console.log(`   👋 User ${username} left channel: ${channel.name}`);
            const membersInChannel = channel.members.filter(m => !m.user.bot);
            console.log(`   👥 Non-bot members remaining: ${membersInChannel.size}`);
            if (membersInChannel.size === 0) {
                const connection = getVoiceConnection(channel.guild.id) || voiceConnections.get(channel.id);
                if (connection) {
                    connection.destroy();
                    voiceConnections.delete(channel.id);
                    console.log(`   👋 Bot left empty voice channel: ${channel.name}`);
                }
            }
        }
    }
});

    // Setup speaking detection for a voice connection
    // SpeakingMap: 'start'/'end' (userId). Always resolve channel from connection.joinConfig (stale closures broke member lookup).
    // Fallback: subscribe Opus streams — helps if SpeakingMap is quiet on some setups.
    function setupSpeakingDetection(connection) {
        const channel = getLiveVoiceChannelFromConnection(connection);
        const chName = channel ? channel.name : String(connection.joinConfig.channelId || '?');
        console.log(`   🔧 Speaking detection for: ${chName}`);
        console.log(`   👥 Members in channel: ${channel ? channel.members.size : '?'}`);

        if (!connection.receiver || !connection.receiver.speaking) {
            console.error(`   ❌ Voice receiver has no speaking map — connection not fully ready or encryption failed`);
            return;
        }

        const sm = connection.receiver.speaking;
        if (sm._gorgoxSpeakingWired) {
            console.log(`   ℹ️ Speaking listeners already attached`);
            return;
        }
        sm._gorgoxSpeakingWired = true;

        sm.on('start', (userId) => {
            const ch = getLiveVoiceChannelFromConnection(connection);
            if (!ch || !ch.isVoiceBased()) return;
            const member = ch.members.get(userId);
            if (!member || member.user.bot) return;
            const label = member.displayName || member.user.username;
            console.log(`   🎤 SpeakingMap start: ${label} (${userId})`);
            handleUserStartedSpeaking(member, connection);
        });

        sm.on('end', (userId) => {
            speakingUsers.set(userId, false);
            opusFallbackLastFire.delete(userId);
        });

        if (channel) {
            channel.members.forEach((member) => {
                if (member.user.bot) return;
                try {
                    const stream = connection.receiver.subscribe(member.id, { end: { behavior: 'manual' } });
                    if (stream && !stream._gorgoxOpusFallback) {
                        stream._gorgoxOpusFallback = true;
                        stream.on('data', () => {
                            const ch2 = getLiveVoiceChannelFromConnection(connection);
                            if (!ch2) return;
                            const m = ch2.members.get(member.id);
                            if (m && !m.user.bot) handleUserStartedSpeaking(m, connection);
                        });
                    }
                } catch (e) {
                    console.error(`   ⚠️ subscribe ${member.user.username}:`, e.message);
                }
            });
        }

        console.log(`   ✅ Speaking detection active (SpeakingMap + optional Opus stream fallback)`);
    }

    // Handle when user starts speaking
    function handleUserStartedSpeaking(user, connection) {
    const userId = user.user.id;
    const username = user.user.username;
    const wasSpeaking = speakingUsers.get(userId) || false;
    const liveCh = getLiveVoiceChannelFromConnection(connection);
    const channelLabel = (liveCh && liveCh.name) ? liveCh.name : '(voice)';
    
    if (!wasSpeaking) {
        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║  🎤 SPEAKING DETECTED 🎤                                    ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  User: ${username.padEnd(50)} ║`);
        console.log(`║  Discord ID: ${userId.padEnd(45)} ║`);
        console.log(`║  Channel: ${channelLabel.padEnd(49)} ║`);
        console.log(`║  Game server: ${isConnectedToGame ? '✅ Connected' : '❌ Not connected'.padEnd(42)} ║`);
        console.log(`║  WebSocket: ${gameWebSocket && gameWebSocket.readyState === WebSocket.OPEN ? '✅ Ready' : '❌ Not ready'.padEnd(45)} ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝`);
        
        speakingUsers.set(userId, true);
        
        // Reload links immediately before checking (in case they were just added)
        reloadLinks();
        
        // Small delay to ensure links are loaded
        setTimeout(() => {
            // Check if linked
            const characterId = discordLinks[userId];
            console.log(`   🔍 Looking up Discord User ID: ${userId}`);
            console.log(`   📋 All loaded links (${Object.keys(discordLinks).length} total):`, JSON.stringify(discordLinks, null, 2));
            
            if (characterId) {
                console.log(`   ✅ FOUND LINK! Character ID = ${characterId}`);
                console.log(`   📤 Sending highlight message to game server...`);
                highlightCharacter(userId, username);
            } else {
                console.log(`\n   ❌ NO LINK FOUND for ${username} (${userId})\n`);
                console.log(`   💡 TO LINK YOUR DISCORD ACCOUNT:`);
                console.log(`      1. Open the game in your browser`);
                console.log(`      2. Open your character sheet`);
                console.log(`      3. Click "🔗 Link Discord Account" button`);
                console.log(`      4. Enter your Discord User ID: ${userId}`);
                console.log(`      5. Click "💾 Save Link"`);
                console.log(`      6. Wait 2-3 seconds, then try speaking again\n`);
            }
            console.log(``);
        }, 100);
    } else if (process.env.DISCORD_VOICE_VERBOSE === '1') {
        console.log(`   ⏭️ ${username} already marked as speaking, skipping...`);
    }
}

    // Handle text messages for linking (optional)
    client.on(Events.MessageCreate, async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Only process in designated text channel if set
    if (CONFIG.textChannelId && message.channel.id !== CONFIG.textChannelId) {
        return;
    }
    
    // Test command - manually trigger voice channel join
    if (message.content === '!testvoice') {
        const member = message.member;
        if (!member) {
            await message.reply('❌ Could not find your member data');
            return;
        }
        
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            await message.reply('❌ You are not in a voice channel!');
            return;
        }
        
        await message.reply(`🔊 You are in voice channel: ${voiceChannel.name}. Bot will attempt to join...`);
        
        try {
            const voiceDebug = process.env.DISCORD_VOICE_DEBUG === '1';
            let connection = getVoiceConnection(voiceChannel.guild.id);
            if (
                connection &&
                connection.joinConfig.channelId === voiceChannel.id &&
                connection.state.status === 'ready'
            ) {
                wireVoiceConnectionLifecycle(connection);
                setupSpeakingDetection(connection);
                await message.reply(`✅ Bot already connected to ${voiceChannel.name}. Speaking detection refreshed.`);
                return;
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: true,
                debug: voiceDebug,
            });

            voiceConnections.set(voiceChannel.id, connection);
            wireVoiceConnectionLifecycle(connection);
            if (connection.state.status === 'ready') {
                setupSpeakingDetection(connection);
                await message.reply(`✅ Voice already ready in ${voiceChannel.name}!`);
            }

            connection.once('stateChange', (oldState, newState) => {
                if (newState.status === 'ready') {
                    message.reply(`✅ Bot voice ready in: ${voiceChannel.name}!`).catch(() => {});
                }
            });
        } catch (error) {
            console.error(`❌ Error joining voice channel:`, error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }
    
    // Handle linking command (simple version)
    // Format: !link @CharacterName or !link character-name
    if (message.content.startsWith('!link ')) {
        const args = message.content.slice(6).trim();
        const userId = message.author.id;
        const username = message.author.username;
        
        // For now, we'll use character name as ID
        // In production, you'd want a proper lookup
        const characterId = args.toLowerCase().replace(/\s+/g, '-');
        
        discordLinks[userId] = characterId;
        saveLinks();
        
        await message.reply(`✅ Linked your Discord account to character: ${args}`);
        console.log(`🔗 Linked Discord user ${username} (${userId}) to character: ${characterId}`);
    }
    
    // Handle unlink command
    if (message.content === '!unlink') {
        const userId = message.author.id;
        const username = message.author.username;
        
        if (discordLinks[userId]) {
            delete discordLinks[userId];
            saveLinks();
            await message.reply('✅ Unlinked your Discord account from character');
            console.log(`🔓 Unlinked Discord user ${username} (${userId})`);
        } else {
            await message.reply('❌ No character linked to your account');
        }
    }
    
    // TEST COMMAND: Manually trigger highlight (for testing without voice)
    if (message.content === '!testhighlight' || message.content === '!test') {
        const userId = message.author.id;
        const username = message.author.username;
        
        // Reload links first
        reloadLinks();
        
        // Wait a moment for reload
        setTimeout(() => {
            const characterId = discordLinks[userId];
            if (!characterId) {
                message.reply(`❌ No character linked!\n\n**To link:**\n1. Open game in browser\n2. Open your character sheet\n3. Click "🔗 Link Discord Account"\n4. Enter your Discord User ID: \`${userId}\`\n5. Click "💾 Save Link"`);
                console.log(`⚠️ No link found for ${username} (${userId})`);
                console.log(`   Current links:`, JSON.stringify(discordLinks, null, 2));
                return;
            }
            
            console.log(`🧪 TEST: Manually triggering highlight for ${username} (${userId}) -> ${characterId}`);
            highlightCharacter(userId, username);
            message.reply(`✅ Test highlight triggered!\n\nCharacter ID: \`${characterId}\`\nIf your token is on the map, it should highlight now.`);
        }, 500);
    }
    
    // DEBUG COMMAND: Show current links
    if (message.content === '!links' || message.content === '!debug') {
        reloadLinks();
        setTimeout(() => {
            const linksList = Object.entries(discordLinks).map(([discordId, charId]) => {
                return `• Discord ID: \`${discordId}\` → Character ID: \`${charId}\``;
            }).join('\n');
            
            const status = {
                connectedToGame: isConnectedToGame,
                webSocketState: gameWebSocket ? gameWebSocket.readyState : 'null',
                linkCount: Object.keys(discordLinks).length,
                links: discordLinks
            };
            
            message.reply(`**Bot Status:**\n\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\`\n\n**Current Links:**\n${linksList || 'None'}`);
            console.log('📊 Debug status:', status);
        }, 500);
    }
});
    
    // Handle errors
    client.on(Events.Error, error => {
        console.error('❌ Discord client error:', error);
    });
    
    // Handle login errors
    client.on('error', error => {
        console.error('❌ Discord error event:', error);
    });
    
    // Handle warnings
    process.on('warning', warning => {
        console.warn('⚠️ Warning:', warning);
    });
    
    // Handle uncaught errors
    process.on('uncaughtException', error => {
        console.error('❌ Uncaught Exception:', error);
        console.error('Stack:', error.stack);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise);
        console.error('Reason:', reason);
    });
    
    // Load links on startup
    console.log('📂 Loading Discord links...');
    loadLinks();
    
    // Start the bot
    console.log('🔐 Checking bot token...');
    if (!CONFIG.token) {
        console.error('❌ DISCORD_BOT_TOKEN not found in .env file!');
        console.error('   Make sure you have a .env file in the discord-bot folder');
        console.error('   It should contain: DISCORD_BOT_TOKEN=your_token_here');
        console.error('   Press any key to exit...');
        process.exit(1);
    }
    
    console.log('🔑 Token found! Attempting to login to Discord...');
    console.log('   (This may take a few seconds...)');
    
    client.login(CONFIG.token).catch(error => {
        console.error('❌ Failed to login to Discord!');
        console.error('   Error:', error.message);
        console.error('   Full error:', error);
        console.error('');
        console.error('Common issues:');
        console.error('   1. Invalid bot token - check your .env file');
        console.error('   2. Bot token expired - regenerate it in Discord Developer Portal');
        console.error('   3. Bot not invited to server - check OAuth2 URL');
        process.exit(1);
    });
    
    console.log('⏳ Login request sent, waiting for Discord response...');
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        if (gameWebSocket) {
            gameWebSocket.close();
        }
        client.destroy();
        process.exit(0);
    });
    
})(); // End of async IIFE - all code above runs after encryption is ready
