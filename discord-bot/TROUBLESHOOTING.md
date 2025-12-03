# Discord Bot Setup Troubleshooting

## Issue: Can't Generate OAuth2 URL / Settings Not Saving

### Common Causes & Solutions

#### 1. **Settings Not Saving**
**Problem:** Checkboxes don't stay checked, or changes disappear after refresh.

**Solutions:**
- ✅ **Hard Refresh:** Press `Ctrl + F5` (Windows) or `Cmd + Shift + R` (Mac)
- ✅ **Clear Browser Cache:** Try an incognito/private window
- ✅ **Different Browser:** Switch to Chrome or Firefox if using Edge
- ✅ **Enable 2FA:** Discord requires 2FA enabled on your account for bot tokens
- ✅ **Check for Errors:** Open browser console (F12) → Look for JavaScript errors
- ✅ **Wait a Moment:** Sometimes there's a delay - wait 5 seconds after checking boxes

#### 2. **OAuth2 URL Generator is Blank/Empty**

**Problem:** No URL appears at the bottom, or the page looks incomplete.

**Solutions:**
- ✅ **Select Scopes First:** You MUST check `bot` scope before URL appears
  1. Under "SCOPES", check `bot`
  2. Check `applications.commands` 
  3. Scroll down - URL should appear below "BOT PERMISSIONS"
- ✅ **Scroll Down:** The URL is at the very bottom - scroll past all permissions
- ✅ **Try Manual URL:** Get your Client ID and build URL manually:
  1. Go to OAuth2 → General
  2. Copy "Client ID" (long number)
  3. Use this URL format:
     ```
     https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID_HERE&permissions=36703232&scope=bot%20applications.commands
     ```
  4. Replace `YOUR_CLIENT_ID_HERE` with your actual Client ID

#### 3. **"Add Bot" Button Grayed Out / Missing**

**Problem:** Can't create a bot, or bot already exists.

**Solutions:**
- ✅ **Already Created:** If you see bot settings, the bot already exists - skip "Add Bot"
- ✅ **Wrong Account:** Make sure you're logged into the correct Discord account
- ✅ **Permissions:** You need to be the owner/admin of the application

#### 4. **Intents Won't Enable**

**Problem:** Can't check the intent boxes, or they're grayed out.

**Solutions:**
- ✅ **Bot Must Exist First:** Click "Add Bot" button before enabling intents
- ✅ **Scroll Down:** Intents are below the token section
- ✅ **Click "Save Changes":** After checking boxes, scroll to bottom and click "Save Changes"
- ✅ **2FA Required:** Enable 2FA on your Discord account (Settings → My Account → Two-Factor Auth)

#### 5. **Token Won't Show / Reset Token Button Missing**

**Problem:** Can't get or see the bot token.

**Solutions:**
- ✅ **Enable 2FA:** Discord requires Two-Factor Authentication for bot tokens
  1. Discord app → User Settings (gear icon)
  2. My Account → Two-Factor Auth
  3. Enable 2FA using an authenticator app
- ✅ **Refresh Page:** Hard refresh (Ctrl+F5) after enabling 2FA
- ✅ **Browser Issue:** Try different browser

## Step-by-Step Verification Checklist

Use this to verify each step:

### ✅ Step 1 Verification:
- [ ] Application created (you see "General Information" page)
- [ ] "Bot" tab exists in left sidebar
- [ ] Bot added (you see bot username and token section)
- [ ] All 3 intents are checked (PRESENCE, SERVER MEMBERS, MESSAGE CONTENT)
- [ ] "Save Changes" button clicked (no longer visible after saving)
- [ ] Token copied and saved somewhere safe

### ✅ Step 2 Verification:
- [ ] "OAuth2" tab visible in left sidebar
- [ ] "URL Generator" sub-tab selected
- [ ] `bot` scope checked (under SCOPES)
- [ ] `applications.commands` scope checked
- [ ] "BOT PERMISSIONS" section visible (appears after selecting scopes)
- [ ] At least 5 permissions checked (View Channels, Connect, Speak, Use Voice Activity, Read Message History)
- [ ] URL visible at bottom of page (starts with `https://discord.com/api/oauth2/authorize`)
- [ ] URL opens in browser and shows "Authorize Bot" page

## Manual URL Construction

If URL Generator isn't working, build it manually:

1. **Get Client ID:**
   - Go to OAuth2 → General
   - Copy "Client ID" (numeric string like: 123456789012345678)

2. **Calculate Permissions:**
   - Use this value: `36703232` (includes all needed permissions)
   - Or calculate at: https://discordapi.com/permissions.html

3. **Build URL:**
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=36703232&scope=bot%20applications.commands
   ```
   Replace `YOUR_CLIENT_ID` with your actual Client ID

4. **Test URL:**
   - Paste in browser
   - Should show "Authorize Bot" page
   - Select your server → Authorize

## Still Not Working?

### Try This Alternative Method:

1. **Use Discord's Bot Builder:**
   - Go to: https://discord.com/developers/applications
   - Click your application
   - OAuth2 → URL Generator
   - Use the visual builder instead of manual checkboxes

2. **Check Browser Console:**
   - Press F12 → Console tab
   - Look for red error messages
   - Take screenshot and note errors

3. **Use Mobile Discord:**
   - Sometimes browser issues - try Discord mobile app settings

4. **Contact Support:**
   - Discord Developer Support: https://discord.com/developers/docs
   - Check Discord Developer Server: https://discord.gg/discord-developers

## Quick Test: Is Bot Working?

After setup, test if bot is online:

1. Start the bot: `npm start` (in discord-bot folder)
2. Check Discord - bot should appear in your server's member list
3. Bot should show status: "Watching D&D Game"
4. Check bot console for: `✅ Discord bot logged in as BotName#1234!`

If you see that message, bot is working! 🎉


