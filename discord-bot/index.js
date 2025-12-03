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
    
    const { joinVoiceChannel } = require('@discordjs/voice');
    
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
        const connection = joinVoiceChannel({
            channelId: targetChannel.id,
            guildId: targetChannel.guild.id,
            adapterCreator: targetChannel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
        });
        
        voiceConnections.set(targetChannel.id, connection);
        
        connection.on('stateChange', (oldState, newState) => {
            console.log(`   🔌 Voice connection state: ${oldState.status} -> ${newState.status}`);
            if (newState.status === 'ready') {
                console.log(`   ✅ Bot successfully joined voice channel: ${targetChannel.name}!`);
                setupSpeakingDetection(connection, targetChannel);
            }
        });
        
        connection.on('error', (error) => {
            console.error(`   ❌ Voice connection error:`, error);
        });
        
    } catch (error) {
        console.error(`   ❌ Error joining configured voice channel:`, error);
    }
}

    // Store voice connections per channel
    const voiceConnections = new Map();
    
    // Monitor voice state changes
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    console.log(`🔊 VoiceStateUpdate event triggered`);
    console.log(`   Old: channel=${oldState.channelId}, New: channel=${newState.channelId}`);
    
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
        const channel = newState.channel;
        console.log(`   📍 User ${username} joined channel: ${channel ? channel.name : 'unknown'}`);
        
        if (!channel) {
            console.log(`   ❌ Channel is null!`);
            return;
        }
        
        if (!voiceConnections.has(channel.id)) {
            console.log(`   🤖 Bot not in channel yet, joining...`);
            try {
                const connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    selfDeaf: false, // Don't deafen - we need to receive audio
                    selfMute: true,  // Mute ourselves so we don't transmit
                });
                
                console.log(`   ✅ Voice connection created`);
                voiceConnections.set(channel.id, connection);
                
                // Wait for connection to be ready
                connection.on('stateChange', (oldState, newState) => {
                    console.log(`   🔌 Voice connection state: ${oldState.status} -> ${newState.status}`);
                    if (newState.status === 'ready') {
                        console.log(`   ✅ Bot ready in voice channel: ${channel.name}`);
                        setupSpeakingDetection(connection, channel);
                    }
                });
                
                // Handle errors
                connection.on('error', (error) => {
                    console.error(`   ❌ Voice connection error:`, error.message);
                    if (error.message.includes('encryption')) {
                        console.error('');
                        console.error('╔════════════════════════════════════════════════════════════╗');
                        console.error('║  ENCRYPTION ERROR - Voice Detection Disabled                ║');
                        console.error('╠════════════════════════════════════════════════════════════╣');
                        console.error('║  The bot cannot detect speaking without encryption.         ║');
                        console.error('║                                                              ║');
                        console.error('║  SOLUTIONS:                                                  ║');
                        console.error('║  1. Install Visual Studio Build Tools:                      ║');
                        console.error('║     https://visualstudio.microsoft.com/downloads/           ║');
                        console.error('║     Then: npm install sodium-native --force                 ║');
                        console.error('║                                                              ║');
                        console.error('║  2. OR manually highlight characters in-game                ║');
                        console.error('║     using the test command or other methods                 ║');
                        console.error('╚════════════════════════════════════════════════════════════╝');
                        console.error('');
                    }
                });
                
            } catch (error) {
                console.error(`   ❌ Error joining voice channel:`, error);
                console.error(`   Error details:`, error.stack);
            }
        } else {
            console.log(`   ✅ Bot already in channel`);
            // Bot is already in channel, but user just joined - subscribe to this user's audio
            const existingConnection = voiceConnections.get(channel.id);
            if (existingConnection && existingConnection.state.status === 'ready') {
                const userIdToSubscribe = newState.member.user.id;
                console.log(`   🔧 Subscribing to new user: ${username} (${userIdToSubscribe})...`);
                try {
                    const subscription = existingConnection.receiver.subscribe(userIdToSubscribe, {
                        end: { behavior: 'manual' }
                    });
                    if (subscription) {
                        console.log(`   ✅ Subscribed to audio from ${username}`);
                    } else {
                        console.log(`   ⚠️ Subscription returned null for ${username}`);
                    }
                } catch (error) {
                    console.error(`   ❌ Could not subscribe to ${username}:`, error.message);
                }
            }
        }
    }
    
    // If user left the channel, check if bot should leave too
    if (!newState.channelId && oldState.channelId) {
        const channel = oldState.channel;
        if (channel) {
            console.log(`   👋 User ${username} left channel: ${channel.name}`);
            // Check if anyone else is in the channel
            const membersInChannel = channel.members.filter(m => !m.user.bot);
            console.log(`   👥 Non-bot members remaining: ${membersInChannel.size}`);
            if (membersInChannel.size === 0) {
                // No one left, disconnect bot
                const connection = voiceConnections.get(channel.id);
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
    function setupSpeakingDetection(connection, channel) {
    console.log(`   🔧 Setting up speaking detection for channel: ${channel.name}`);
    console.log(`   👥 Members in channel: ${channel.members.size}`);
    
    // Map SSRC to user ID (SpeakingMap uses SSRCs, not user IDs)
    const ssrcToUserId = new Map();
    const userIdToSsrc = new Map();
    
    // Track speaking timeouts for "stopped speaking" detection
    const speakingTimeouts = new Map();
    
    // Helper to reset the "stopped speaking" timeout
    const resetSpeakingTimeout = (userId, username) => {
        // Clear existing timeout
        if (speakingTimeouts.has(userId)) {
            clearTimeout(speakingTimeouts.get(userId));
        }
        
        // Set new timeout - if no audio for 500ms, mark as stopped
        const timeout = setTimeout(() => {
            const wasSpeaking = speakingUsers.get(userId) || false;
            if (wasSpeaking) {
                console.log(`   🔇 ${username} stopped speaking (no audio for 500ms)`);
                speakingUsers.set(userId, false);
            }
            speakingTimeouts.delete(userId);
        }, 500);
        
        speakingTimeouts.set(userId, timeout);
    };
    
    // Function to subscribe to all current members
    const subscribeToMembers = () => {
        channel.members.forEach((member) => {
            if (member.user.bot) {
                console.log(`   ⏭️ Skipping bot: ${member.user.username}`);
                return;
            }
            
            const userId = member.user.id;
            const username = member.user.username;
            
            console.log(`   📡 Attempting to subscribe to: ${username} (${userId})`);
            
            try {
                const subscription = connection.receiver.subscribe(userId, {
                    end: {
                        behavior: 'manual'
                    }
                });
                
                if (subscription) {
                    console.log(`   ✅ Subscribed to audio from ${username}`);
                    
                    // Monitor the subscription for audio packets - when packets arrive, user is speaking
                    subscription.on('data', (chunk) => {
                        // Audio data received = user is speaking!
                        const wasSpeaking = speakingUsers.get(userId) || false;
                        if (!wasSpeaking) {
                            console.log(`\n   🎤🎤🎤 AUDIO DETECTED: ${username} is speaking! (userId: ${userId}) 🎤🎤🎤\n`);
                            handleUserStartedSpeaking(member, channel);
                            speakingUsers.set(userId, true);
                        }
                        // Reset timeout - user is still speaking
                        resetSpeakingTimeout(userId, username);
                    });
                    
                    // Also listen for readable events
                    subscription.on('readable', () => {
                        // Data is available to read
                        const wasSpeaking = speakingUsers.get(userId) || false;
                        if (!wasSpeaking) {
                            console.log(`\n   🎤🎤🎤 READABLE: ${username} is speaking! (userId: ${userId}) 🎤🎤🎤\n`);
                            handleUserStartedSpeaking(member, channel);
                            speakingUsers.set(userId, true);
                        }
                        // Reset timeout - user is still speaking
                        resetSpeakingTimeout(userId, username);
                        
                        // Try to read the data to trigger more events
                        try {
                            while (subscription.readable && subscription.read() !== null) {
                                // Consume data
                            }
                        } catch (e) {
                            // Ignore read errors
                        }
                    });
                    
                    // The subscription might have SSRC info
                    // Try to get SSRC if available
                    if (subscription.ssrc !== undefined) {
                        const ssrc = subscription.ssrc;
                        ssrcToUserId.set(ssrc, userId);
                        userIdToSsrc.set(userId, ssrc);
                        console.log(`   🔑 Mapped SSRC ${ssrc} to user ${username} (${userId})`);
                    }
                    
                    // Try to access SSRC from internal properties
                    if (subscription.ssrc === undefined && subscription._ssrc !== undefined) {
                        const ssrc = subscription._ssrc;
                        ssrcToUserId.set(ssrc, userId);
                        userIdToSsrc.set(userId, ssrc);
                        console.log(`   🔑 Mapped SSRC ${ssrc} (from _ssrc) to user ${username} (${userId})`);
                    }
                } else {
                    console.log(`   ⚠️ Subscription returned null for ${username}`);
                }
            } catch (error) {
                console.error(`   ❌ Could not subscribe to ${username}:`, error.message);
            }
        });
    };
    
    // Subscribe immediately to current members
    subscribeToMembers();
    
    // Also subscribe when new members join
    channel.guild.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
        if (newState.channelId === channel.id && newState.channelId !== oldState.channelId) {
            // Someone joined this channel
            const member = newState.member;
            if (member && !member.user.bot) {
                console.log(`   🆕 ${member.user.username} joined ${channel.name}, subscribing...`);
                try {
                    const subscription = connection.receiver.subscribe(member.user.id, { end: { behavior: 'manual' } });
                    if (subscription) {
                        console.log(`   ✅ Subscribed to new member: ${member.user.username}`);
                        
                        // Monitor audio packets for this new member too
                        const userId = member.user.id;
                        const username = member.user.username;
                        
                        subscription.on('data', (chunk) => {
                            const wasSpeaking = speakingUsers.get(userId) || false;
                            if (!wasSpeaking) {
                                console.log(`\n   🎤🎤🎤 AUDIO: ${username} is speaking! 🎤🎤🎤\n`);
                                handleUserStartedSpeaking(member, channel);
                                speakingUsers.set(userId, true);
                            }
                            // Reset timeout
                            if (typeof resetSpeakingTimeout === 'function') {
                                resetSpeakingTimeout(userId, username);
                            }
                        });
                        
                        subscription.on('readable', () => {
                            const wasSpeaking = speakingUsers.get(userId) || false;
                            if (!wasSpeaking) {
                                console.log(`\n   🎤🎤🎤 READABLE: ${username} is speaking! 🎤🎤🎤\n`);
                                handleUserStartedSpeaking(member, channel);
                                speakingUsers.set(userId, true);
                            }
                            // Reset timeout
                            if (typeof resetSpeakingTimeout === 'function') {
                                resetSpeakingTimeout(userId, username);
                            }
                            
                            // Consume data
                            try {
                                while (subscription.readable && subscription.read() !== null) {
                                    // Consume data to trigger more events
                                }
                            } catch (e) {
                                // Ignore read errors
                            }
                        });
                    }
                } catch (error) {
                    console.error(`   ❌ Could not subscribe to new member:`, error.message);
                }
            }
        }
    });
    
    // Monitor speaking state using periodic polling
    // The speaking map is a Map that updates when users speak
    const speakingCheckInterval = setInterval(() => {
        if (!connection.receiver || connection.state.status !== 'ready') {
            console.log(`   ⚠️ Connection not ready, clearing interval`);
            clearInterval(speakingCheckInterval);
            return;
        }
        
        // Check speaking map - it's a Map
        const speakingMap = connection.receiver.speaking;
        
        if (!speakingMap) {
            return;
        }
        
        // Log speaking map state for debugging (first time only)
        if (!speakingCheckInterval._loggedOnce) {
            console.log(`   🔍 Speaking map type: ${speakingMap.constructor.name}`);
            console.log(`   🔍 Speaking map size: ${speakingMap instanceof Map ? speakingMap.size : 'N/A'}`);
            console.log(`   🔍 Channel members to check: ${channel.members.size}`);
            
            // Try to inspect the speaking map structure
            try {
                if (speakingMap instanceof Map) {
                    const entries = Array.from(speakingMap.entries());
                    console.log(`   🔍 Speaking map has ${entries.length} entries:`, entries.slice(0, 5));
                } else if (speakingMap.forEach) {
                    const entries = [];
                    speakingMap.forEach((value, key) => {
                        entries.push([key, value]);
                    });
                    console.log(`   🔍 Speaking map forEach found ${entries.length} entries:`, entries.slice(0, 5));
                } else if (speakingMap.keys) {
                    const keys = Array.from(speakingMap.keys());
                    console.log(`   🔍 Speaking map has keys:`, keys.slice(0, 5));
                }
            } catch (e) {
                console.log(`   🔍 Could not inspect speaking map structure:`, e.message);
            }
            
            speakingCheckInterval._loggedOnce = true;
            console.log(`   ✅ Speaking detection polling started - checking every 200ms`);
        }
        
        // Check all members currently in the channel
        let checkedCount = 0;
        channel.members.forEach((member) => {
            if (member.user.bot) return;
            checkedCount++;
            
            const userId = member.user.id;
            const username = member.user.username;
            
            // Check if user is speaking
            // SpeakingMap uses SSRCs (audio source identifiers) as keys, not user IDs
            // We need to check both by user ID and by SSRC
            let isCurrentlySpeaking = false;
            try {
                // First, try checking by user ID (might work in some versions)
                if (typeof speakingMap.has === 'function') {
                    // Try with user ID as string
                    isCurrentlySpeaking = speakingMap.has(userId) || speakingMap.has(userId.toString());
                }
                
                // If that didn't work, check by SSRC
                if (!isCurrentlySpeaking && userIdToSsrc.has(userId)) {
                    const ssrc = userIdToSsrc.get(userId);
                    if (typeof speakingMap.has === 'function') {
                        isCurrentlySpeaking = speakingMap.has(ssrc) || speakingMap.has(ssrc.toString());
                    }
                }
                
                // Alternative: Iterate through speaking map and match by SSRC
                if (!isCurrentlySpeaking) {
                    try {
                        // Try iterating the speaking map
                        if (speakingMap.forEach) {
                            speakingMap.forEach((bitfield, key) => {
                                // Check if this SSRC belongs to our user
                                const ssrcKey = typeof key === 'number' ? key : parseInt(key);
                                if (ssrcToUserId.has(ssrcKey) && ssrcToUserId.get(ssrcKey) === userId) {
                                    // This SSRC belongs to our user
                                    // Bitfield: 1 = speaking, 2 = soundshare
                                    if (typeof bitfield === 'number') {
                                        isCurrentlySpeaking = (bitfield & 1) !== 0 || (bitfield & 2) !== 0;
                                    } else {
                                        isCurrentlySpeaking = Boolean(bitfield);
                                    }
                                }
                            });
                        } else if (speakingMap[Symbol.iterator]) {
                            // Try iterator protocol
                            for (const [key, bitfield] of speakingMap) {
                                const ssrcKey = typeof key === 'number' ? key : parseInt(key);
                                if (ssrcToUserId.has(ssrcKey) && ssrcToUserId.get(ssrcKey) === userId) {
                                    if (typeof bitfield === 'number') {
                                        isCurrentlySpeaking = (bitfield & 1) !== 0 || (bitfield & 2) !== 0;
                                    } else {
                                        isCurrentlySpeaking = Boolean(bitfield);
                                    }
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        // Iteration failed
                    }
                }
                
                // Final fallback: Try get method
                if (!isCurrentlySpeaking && typeof speakingMap.get === 'function') {
                    // Try user ID
                    let bitfield = speakingMap.get(userId) || speakingMap.get(userId.toString());
                    
                    // Try SSRC
                    if (!bitfield && userIdToSsrc.has(userId)) {
                        const ssrc = userIdToSsrc.get(userId);
                        bitfield = speakingMap.get(ssrc) || speakingMap.get(ssrc.toString());
                    }
                    
                    if (typeof bitfield === 'number') {
                        isCurrentlySpeaking = (bitfield & 1) !== 0 || (bitfield & 2) !== 0;
                    } else if (bitfield !== undefined && bitfield !== null) {
                        isCurrentlySpeaking = Boolean(bitfield);
                    }
                }
            } catch (error) {
                console.error(`   ⚠️ Error checking speaking status for ${username}:`, error.message);
                return;
            }
            
            const wasSpeaking = speakingUsers.get(userId) || false;
            
            // Enhanced debug logging - log periodically when not speaking, always when speaking
            // Also log what's actually in the speaking map to help debug
            const shouldLog = isCurrentlySpeaking || (checkedCount <= 10 && Date.now() % 2000 < 200);
            if (shouldLog) {
                let debugInfo = {
                    username,
                    userId,
                    isSpeaking: isCurrentlySpeaking,
                    wasSpeaking,
                    mapSize: 'unknown',
                    mapKeys: [],
                    ssrcMapped: userIdToSsrc.has(userId)
                };
                
                // Try to get info about the speaking map
                try {
                    if (speakingMap.size !== undefined) {
                        debugInfo.mapSize = speakingMap.size;
                    }
                    
                    // Try to get all keys
                    if (speakingMap.keys) {
                        const keys = Array.from(speakingMap.keys());
                        debugInfo.mapKeys = keys.slice(0, 5).map(k => `${k} (${typeof k})`);
                    }
                    
                    // Check user ID directly
                    if (typeof speakingMap.get === 'function') {
                        const userBitfield = speakingMap.get(userId) || speakingMap.get(userId.toString());
                        debugInfo.userIdBitfield = userBitfield;
                        
                        // Check SSRC if mapped
                        if (userIdToSsrc.has(userId)) {
                            const ssrc = userIdToSsrc.get(userId);
                            const ssrcBitfield = speakingMap.get(ssrc) || speakingMap.get(ssrc.toString());
                            debugInfo.ssrcBitfield = ssrcBitfield;
                        }
                    }
                } catch (e) {
                    debugInfo.error = e.message;
                }
                
                console.log(`   🔍 ${username}:`, JSON.stringify(debugInfo, null, 2));
            }
            
            if (isCurrentlySpeaking && !wasSpeaking) {
                // User just started speaking
                console.log(`\n   🎤🎤🎤 DETECTED: ${username} started speaking! (userId: ${userId}) 🎤🎤🎤\n`);
                handleUserStartedSpeaking(member, channel);
            } else if (!isCurrentlySpeaking && wasSpeaking) {
                // User just stopped speaking
                console.log(`   🔇 ${username} stopped speaking`);
                speakingUsers.set(userId, false);
            }
        });
        
        if (checkedCount > 0 && !speakingCheckInterval._debugLogged) {
            console.log(`   ✅ Checked ${checkedCount} member(s) in ${channel.name}`);
            speakingCheckInterval._debugLogged = true;
        }
    }, 200); // Check every 200ms for better responsiveness
    
    console.log(`   ✅ Speaking detection active (checking every 200ms)`);
    console.log(`   💡 Bot is now listening for voice activity in: ${channel.name}`);
}

    // Handle when user starts speaking
    function handleUserStartedSpeaking(user, channel) {
    const userId = user.user.id;
    const username = user.user.username;
    const wasSpeaking = speakingUsers.get(userId) || false;
    
    if (!wasSpeaking) {
        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║  🎤 SPEAKING DETECTED 🎤                                    ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  User: ${username.padEnd(50)} ║`);
        console.log(`║  Discord ID: ${userId.padEnd(45)} ║`);
        console.log(`║  Channel: ${channel.name.padEnd(49)} ║`);
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
    } else {
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
            if (voiceConnections.has(voiceChannel.id)) {
                await message.reply(`✅ Bot is already in that channel!`);
                return;
            }
            
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: true,
            });
            
            voiceConnections.set(voiceChannel.id, connection);
            
            connection.on('stateChange', (oldState, newState) => {
                console.log(`🔌 Manual join - Voice connection state: ${oldState.status} -> ${newState.status}`);
                if (newState.status === 'ready') {
                    message.reply(`✅ Bot successfully joined voice channel: ${voiceChannel.name}!`);
                    setupSpeakingDetection(connection, voiceChannel);
                }
            });
            
            connection.on('error', (error) => {
                console.error(`❌ Voice connection error:`, error);
                message.reply(`❌ Error joining voice channel: ${error.message}`);
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
