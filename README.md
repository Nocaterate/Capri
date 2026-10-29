# Capri — Electrical AI Desktop Companion

Capri is a pixel-art electrical AI girl who lives on your desktop. You can talk to her by voice or by typing, and she can open apps and websites, control your music, and set reminders. Pink electricity crackles off her in everything she does.

Windows 10/11 (64-bit). Free to use: she only needs a free AI key to talk.

## Quick start (5 minutes)

### 1. Download
Pick one:

**A. Portable app (easiest, nothing to install)**
1. Go to the [Releases page](https://github.com/Nocaterate/Capri/releases/latest) and download `Capri-win64.zip`.
2. Right-click the zip → **Extract All…** and extract it anywhere (for example your Desktop or Documents). Don't run it from inside the zip.
3. Open the extracted `Capri` folder and double-click `Capri.exe`.
4. If Windows SmartScreen says "Windows protected your PC", click **More info → Run anyway**. The app isn't digitally signed, so that warning is normal.

**B. From the source code (needs Node.js)**
1. Install [Node.js](https://nodejs.org) (the LTS version).
2. On this page click the green **Code** button → **Download ZIP**, and extract it. (Or `git clone https://github.com/Nocaterate/Capri.git`.)
3. Double-click `start.bat`. The first time, it installs dependencies (about 1–2 minutes) and then starts the app.

Capri appears in the bottom-right corner of your screen with a lightning strike, and a ⚡ icon shows up in the system tray (bottom-right, near the clock; click **^** if you don't see it).

### 2. Give her a brain (free Groq key)
1. Sign up at <https://console.groq.com> (free, no credit card).
2. Open **API Keys**, click **Create API Key** and copy it.
3. Right-click Capri (or the tray icon), choose **Settings…**, paste the key into **API key** and click **Save**.
4. Click **Test connection**. When it says OK, she's ready.

### 3. Talk to her
- Press `Ctrl + Alt + Space` and speak, or `Ctrl + Alt + T` (or double-click her) to type.
- Try: "Open YouTube and search for lofi music", "Remind me in 10 minutes to stretch", "Pause the music".

Everything else (her own cloned voice, Spotify, Discord bot, Hermes Agent, other AI providers) is optional and explained below.

## What she can do on your PC
Capri is an agent: the AI decides when to use these tools, so just ask in normal words.

| Tool | Example |
|---|---|
| Open / close apps, list what's open | "Open Discord", "Close Chrome", "What apps are open?" |
| Open websites, search the web | "Open YouTube and search for lofi music" |
| Media keys and volume | "Pause", "Next song", "Turn the volume down" |
| Spotify (exact songs, queue, shuffle) | "Play Espresso by Sabrina Carpenter", "Queue Blinding Lights" |
| Reminders | "Remind me in 10 minutes to take the laundry out" |
| Notes & to-do list (with timed reminders) | "Remind me at 8 pm to call mom", "Write a note called Ideas: pixel hoodie" |

She can also do all of this from **Discord** (only for you, the owner) and from **Hermes Agent**, which adds long-term memory, web research and chat apps like Telegram ("play Espresso on my PC" from your phone). Setup for both is below.

### Privacy
Your keys, tokens, settings, chat memory, notes, to-dos and logs are stored only on your PC in `%APPDATA%\Capri` (`config.json`, `history.json`, `notes.json`, `capri.log`). Nothing is sent anywhere except to the AI/voice/music services you set up yourself. Never share your `config.json` or post your keys in issues.

### Updating / uninstalling
- **Update:** download the new release and extract it over the old folder (or into a new one). Your settings stay in `%APPDATA%\Capri`.
- **Uninstall:** quit Capri from the tray icon, delete the `Capri` folder, and (to remove your settings too) delete `%APPDATA%\Capri`.

## Changing the AI later
Right-click Capri → **Settings…**. The presets at the top (Groq, Gemini, Claude, OpenRouter, Ollama…) fill in the address and model for you; paste that service's key and click **Test connection**. Any OpenAI-compatible API works. See the provider sections below.

## Controls

| Action | How |
|---|---|
| Talk by voice | `Ctrl + Alt + Space`, then speak. Recording stops when you go quiet. |
| Type a message | `Ctrl + Alt + T`, or double-click her |
| Hide / summon (teleport) | `Ctrl + Alt + H`, or click the tray icon |
| Move her | Drag her: she turns into her red electric form and snaps back with a strike where you drop her |
| Poke | Click once. Poke her too much and she gets annoyed. |
| Resize | Hover over her and scroll |
| Notes & To-do list | Right-click her (or the tray icon) → **Notes & To-do list** |
| Menu (Power up, Teleport, Dash, Notes, Settings) | Right-click her |

Things you can say:
- "Open YouTube and search for lofi music"
- "Open Discord" / "Open the calculator" (any app in your Start menu)
- "Close Chrome" / "What apps are open?"
- "Pause the music" / "Turn the volume down"
- "Remind me in 10 minutes to take the laundry out"
- "Remind me at 8 pm to call mom" / "What's on my to-do list?"

## Notes & To-do list
Capri keeps a notes pad and a to-do list for you in a hologram panel she projects next to herself.

**Open it:** right-click Capri (or the tray icon) → **Notes & To-do list**. She zaps to the side of the screen with more room and the panel scans in beside her. Close it with **✕**, **Esc**, or the same menu item.

**Notes tab**
- Click **+ New note**, give it a title and write anything. It saves by itself (the green **● Saved** light).
- Click a note on the left to open it; **Delete note** removes it (it asks first).

**To-do list tab**
- Type the to-do (max 50 letters), optionally pick a **time**, and click **Add**.
- **Remind me** (the bell): when it glows, Capri reminds you at that time. She says it out loud and Windows shows a notification. If the time has already passed today, she reminds you tomorrow. If Capri was closed at that time, she reminds you as soon as she starts.
- After a reminder fires, its bell turns off by itself, so a glowing bell always means "a reminder is still coming".
- In the table you can change a time, switch a row's bell on or off, or delete a row (it asks first).

**Or just ask her** (by voice, text, Discord as the owner, or through Hermes):

| Say | What happens |
|---|---|
| "Add buy milk to my to-do list" | Adds a to-do with no time |
| "Remind me at 8 pm to call mom" | Adds "call mom" at 20:00 with the reminder on |
| "What's on my to-do list?" | She reads the list |
| "I finished call mom" / "Delete buy milk" | Removes it |
| "Write a note called Ideas: pixel hoodie" | Makes a new note, or adds a line if "Ideas" already exists |
| "Read my Ideas note" / "What notes do I have?" | She reads it out, or lists the titles |

"Remind me **in** 10 minutes" is a quick one-off reminder; "remind me **at** 8 pm" goes on the to-do list. Everything is saved only on your PC in `%APPDATA%\Capri\notes.json`.

## Her voice
Out of the box she uses a free Microsoft Edge voice, no setup needed.

Optionally she can speak in a cloned voice with [Fish Audio](https://fish.audio). Voice clips are **not** included in this repo, so bring your own:

1. Sign up at <https://fish.audio> and create an API key under **API keys**.
2. Open **Settings → Voice & sound**, set **Her voice** to "Capri's own voice", and paste the key.
3. Click **Open the voice samples folder** (`%APPDATA%\Capri\voice-samples`) and drop in clean clips of the voice you want (mp3/wav/ogg/m4a, 10–60 seconds in total, no music or background noise).
4. Click **Create Capri's voice from her clips**. The app uploads the clips and fills in the voice model ID for you.
5. Click **Save & test voice**.

The **S2.1 Pro, free tier** model (`s2.1-pro-free`) is Fish Audio's free developer tier; if it stops being free, switch the model to the paid one or use the Edge voice. Only clone a voice that is yours or that you have permission to use.

Without a Fish Audio key, or if the service is down, she falls back to a free Microsoft Edge voice (Ana with a raised pitch by default, the closest built-in match). You can pick another Edge voice, pitch and speed in Settings. The optional **Digital voice effect** adds a robotic, electric edge on top of either voice.

## Custom sound effects
Every sound effect is synthesized by default. To use your own audio:
1. Open **Settings → Voice & sound → Open sounds folder** (it's `%APPDATA%\Capri\sounds`).
2. Drop in mp3, wav, ogg or m4a files with these names, then click **Save**:

| File | Plays when |
|---|---|
| `zap.mp3` | small electric zaps (pokes, dashes, bolts) |
| `thunder.mp3` | the big lightning strike when she appears |
| `crackle.mp3` | her pixels gathering before she appears |
| `glitch.mp3` | a glitch |
| `powerup.mp3` | Power up |
| `blip_up.mp3` / `blip_down.mp3` | she starts / stops listening |

Add variations as `zap_2.mp3`, `zap_3.mp3`, … and she picks one at random.

## Animations & effects
- **Intro:** her pixels gather, then a lightning bolt strikes from the sky.
- **Teleport:** she shatters into pink pixels that fly upward, then reappears elsewhere with a strike.
- **Levitating:** she floats above the ground and bobs gently, toes pointed, over a pulsing pink glow with sparkles rising from it and little bolts flicking from her toes.
- **Red electric form:** whenever she moves she flashes into solid red energy in her own shape (eyes, mask and grin drawn as darker red lines), trailing white and dark speed streaks, red afterimages and jagged red lightning, then snaps back when she stops. Dashes are the most intense.
- **Lightning:** soft bloom glow, a split-second strobe when bolts strike, violet and cyan fringes, white-hot cores, forks that split again, impact flares, streaking sparks, and curved arcs jumping between her hands and hair. Mostly pink, sometimes violet, rarely green.
- **Power up:** pink aura, rising particles, glowing pink eyes, finished with a shockwave.
- **Always electric:** bolts jump off her hair tips and hands, and tiny sparks crawl along her outline, more when she moves or talks.
- **Expressions:** concentric ring eyes (green, black, blue, white) in slanted sockets on her green rectangle mask, following your cursor and blinking, a thin zigzag mouth, and faces for happy, sad, angry, surprised and relaxed, plus pixel emotes (! ? ♪ anger).
- **Many eyes:** her green mask fills up with extra eyes while she listens to you, when she's angry, during Power up, and now and then on her own.
- **While talking:** her mouth opens with the voice, with a digital voice effect.
- **While dragged:** she turns into her red electric form and crackles while you hold her; let go and she snaps back with a strike.

## Using Claude as her brain (optional)
1. Create an API key in the [Claude Console](https://platform.claude.com/).
2. In Settings, click the **Claude** preset, paste the Claude key into **API key**, and click **Test connection**.
   The preset uses `claude-haiku-5-5` (fast, good for spoken replies); type `claude-sonnet-5-5` into **Chat model** for a smarter but slower Capri.
3. Claude has no speech-to-text, so open "Use a different service for speech-to-text" and paste a free Groq key there (the address is filled in for you).

## Hermes Agent (optional)
Capri can team up with [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) from Nous Research, an open-source AI agent with long-term memory, self-written skills, web research and chat apps like Telegram.
- **Capri talks through Hermes:** her replies come from Hermes, with its memory of you.
- **Hermes uses Capri's powers:** Spotify, opening/closing apps, media keys, reminders, your notes and to-do list, and making Capri speak or react (`mcp_capri_*` tools). This works from anywhere Hermes listens, e.g. message it on Telegram "play Espresso on my PC".

### 1. Install WSL (once)
Open **PowerShell as administrator** and run `wsl --install`. Restart Windows when asked, then finish the Ubuntu window that opens (pick a Linux username and password).

### 2. Install Hermes inside Ubuntu
In the Ubuntu window:
```
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc
```

### 3. Give Hermes an AI model (Capri can do it)
Easiest: in Capri's **Settings → Hermes Agent**, keep "Set up Hermes's AI model for me" ticked and paste a free Gemini key (or leave it empty to reuse Capri's AI key). Or run `hermes setup` yourself. Hermes needs a model with at least 64K context.

### 4. Connect
In Capri, open **Settings → Hermes Agent** and click **Connect Capri and Hermes**. It:
- turns on WSL mirrored networking (Windows 11 22H2+), so Hermes and Capri can reach each other on this PC,
- repairs the `hermes` command if the installer didn't finish making it,
- gives Hermes its AI model (if ticked), turns on Hermes's API server and adds Capri's tools to `~/.hermes/config.yaml` (your old file is saved as `config.yaml.bak-capri`),
- switches Capri's brain to Hermes (your old brain settings are kept; untick "Capri talks through Hermes" to go back),
- starts Hermes, and from then on starts it together with Capri.

Voice chat still uses your speech-to-text key (Groq) for her ears. Capri's tool server only listens on this PC and needs a secret token; browsers can't use it. To connect Telegram or Discord to Hermes, run `hermes gateway setup` in Ubuntu.

## Discord bot
Capri can also live on your Discord server. The bot runs inside the Capri app, so she's online while Capri is open on your PC.
- **Chat:** anyone can talk to her by mentioning **@Capri**, replying to one of her messages, or DMing her. She remembers the last few messages in each channel.
- **Only you control the PC:** when you (the bot's owner) ask, she can play music, open apps and so on, just like on the desktop. Everyone else can only chat; if they ask her to do things on your PC, she says only her owner can.
- **Slash commands:** `/ask`, `/owner` (who her owner is), `/zap` (desktop Capri powers up), `/join` and `/leave` (voice channel), and owner-only `/play`, `/music`, `/nowplaying` and `/say`.
- **Voice channels:** after `/join` she speaks her replies in the voice channel in her own voice, and leaves when everyone else has gone.
- **Desktop reacts:** your desktop Capri shows Discord chats in a small "DISCORD //" bubble (without talking over you), powers up on `/zap`, and says `/say` lines out loud.

Setup:
1. Open the [Discord Developer Portal](https://discord.com/developers/applications), click **New Application** and name it **Capri**.
2. Go to **Bot**, click **Reset Token** and copy the token.
3. On the same page, under **Privileged Gateway Intents**, turn on **Message Content Intent** and click **Save Changes**.
4. In Capri, open **Settings → Discord bot**, paste the token and click **Save & start the bot**. She sets her own profile picture the first time.
5. Click **Invite Capri to a server**, pick your server and click **Authorize**.

Slash commands can take a few minutes to appear the first time. Her owner is the account that created the bot app. To pick the owner yourself, type your Discord **username** (the unique one, not your display name) under **Commands & owner**; add more accounts with commas. Type `/owner` in Discord to check who she thinks her owner is. Keep the bot token secret: anyone who has it can run your bot. If it leaks, click **Reset Token** again.

Run the bot on **one** PC only. If two Capris use the same bot token (say your desktop and your laptop), Discord sends every message to both and she answers twice. Untick **Run Capri's Discord bot** on the other one.

If Capri talks through Hermes, only your Discord messages go to Hermes; other people get her previous brain, so they can never reach Hermes's tools.

## Spotify
She can always open Spotify, pause, skip, change the volume, open a song search in the Spotify app, and tell you what's playing (read from the Spotify window on Windows).

To let her **open the exact song, artist, album or playlist you ask for** straight in the Spotify app (one click from playing), add songs to the queue, shuffle and set Spotify's volume, connect Spotify. Spotify only allows this with **Spotify Premium** (since February 2026, apps like this need the app owner to have Premium).
1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard), log in, and click **Create app**.
2. Any name and description is fine. Under **Redirect URIs** add exactly `http://127.0.0.1:43821/callback`, tick **Web API**, and save.
3. Copy the app's **Client ID** into Capri's **Settings → Spotify** and click **Connect Spotify**. Log in and agree in the browser tab that opens.

Things you can say: "Play Espresso by Sabrina Carpenter", "Play some Lana Del Rey", "Play my lofi playlist", "What song is this?", "Skip", "Shuffle on", "Queue Blinding Lights", "Set Spotify volume to 40".

## Using Gemini as her brain (free)
1. Get a free API key at [Google AI Studio](https://aistudio.google.com/apikey). No billing needed.
2. In Settings, click the **Gemini (free)** preset, paste the key into **API key**, and click **Test connection**.
3. Gemini has no speech-to-text here either, so put a free Groq key under "Use a different service for speech-to-text".

## Using a local AI (optional)
A GTX 1650 (4 GB) is enough for a small model:
1. Install [Ollama](https://ollama.com), then run `ollama pull qwen2.5:3b`.
2. In Settings, click the **Ollama (local)** preset.
3. Speech-to-text still needs Groq. Put a Groq key under "Use a different service for speech-to-text".

## Troubleshooting
- **Mic doesn't work:** open Windows Settings → Privacy & security → Microphone and allow desktop apps to use the microphone.
- **She doesn't sound like herself:** open Settings → Voice & sound and click **Save & test voice**; the message says what's wrong (for example a rejected key or no credits). Until it's fixed she uses the Edge voice.
- **No voice at all:** both voices are online services. If they both fail, Capri falls back to the built-in Windows voice.
- **"Free usage limit":** Groq's free limit was reached. Wait a moment and try again.
- **Discord bot says "Message Content Intent":** turn that switch on in Developer Portal → Bot, save, then click **Save & start the bot** again.
- **Discord bot doesn't answer:** she only answers when mentioned, replied to, or DMed, and only while the Capri app is running.
- **Hotkey doesn't react:** another app may already use that combination. Change it in Settings → Shortcuts.

## Structure
- `main.js`: transparent overlay window, tray, hotkeys, desktop actions, sounds folder, Hermes connection
- `src/discord.js`: the Discord bot (chat, slash commands, voice)
- `src/mcp-server.js`: Capri's tool server for Hermes (MCP over HTTP, this PC only)
- `src/hermes.js`, `src/hermes-setup.sh`: setting up and starting Hermes in WSL
- `src/brain.js`: speech-to-text and AI chat (any OpenAI-compatible API)
- `src/tts.js`: her cloned voice (Fish Audio) and the Edge fallback voice
- `renderer/app.js`: the character, animations, interaction and voice flow
- `renderer/notes.js`: the Notes & To-do hologram panel (reminders are fired by `main.js`)
- `renderer/fx.js`: lightning, sparks, particles, rings, afterimages and emotes
- `renderer/sfx.js`: synthesized sound effects, your custom sounds, and the digital voice chain

Capri is an original character design.
