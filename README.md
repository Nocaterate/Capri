# Capri — Electrical AI Desktop Companion

Capri is a pixel-art electrical AI girl who lives on your desktop. You can talk to her by voice or by typing, and she can use your PC and your browser, control your music, keep your notes and to-do list, and set reminders. Pink electricity crackles off her in everything she does.

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
| Use any app: look at the window, click, type, press shortcuts, switch/close windows ([Computer control](#computer-control)) | "Open Notepad and write a shopping list", "Close Spotify" |
| Files and folders: list, read, search, create, move, copy, delete to the Recycle Bin | "What's in my Downloads?", "Move the PDFs on my Desktop into a folder called Papers" |
| PowerShell commands (always asks first unless you allow it) | "How much free space is on C:?" |
| Your browser: tabs, read pages, click, type, play/pause videos (needs the [Browser link](#browser-link-optional)) | "Open YouTube in Edge and play lofi", "What does this page say?", "Close the Twitter tab" |
| High Forever party mode | "High Forever!", "Stop the party" |
| In Love With Myself (road trip with D) | "In Love With Myself", "Road trip with D" |
| TV mode (she lives in a little TV) | "Get in the TV", "Come out of the TV" |

Anything that changes something (clicks, typing, files, commands, risky browser actions) asks you first with a **Yes, do it / No / Always allow** bubble. She can also do all of this from **Discord** (only for you, the owner) and from **Hermes Agent**, which adds long-term memory, web research and chat apps like Telegram ("play Espresso on my PC" from your phone). Setup for both is below.

### Privacy
Your keys, tokens, settings, chat memory, notes, to-dos, AI usage counts and logs are stored only on your PC in `%APPDATA%\Capri` (`config.json`, `history.json`, `notes.json`, `usage.json`, `capri.log`). Nothing is sent anywhere except to the AI/voice/music services you set up yourself (plus one anonymous request to GitHub at startup to see if there's a newer version, and, with PC alerts on, a check of Windows' own internet-test address once a minute). The Browser link extension only talks to Capri on your own PC. If you turn on [Make her more alive](#make-her-more-alive-she-notices-what-youre-doing) with "Let her AI write what she says", the name and title of the app in front (like a song or movie name) goes to your AI service so it can write her line. Asking her with `/capri` in Capri Terminal sends the last lines on that terminal screen. Never share your `config.json` or post your keys in issues.

### Updating / uninstalling
When a new version is out, Capri tells you once with a Windows notification, and her right-click menu shows **Update to vX…** (it opens the release page). How to update depends on how you installed her; your settings, notes and keys stay in `%APPDATA%\Capri` either way.
- **Portable zip:** quit Capri from the tray icon, download the new `Capri-win64.zip` from [Releases](https://github.com/Nocaterate/Capri/releases/latest), and extract it over the old folder (or into a new one).
- **`git clone`:** quit Capri, then in the Capri folder run `git pull` followed by `npm install` (only needed when an update adds new packages, but it's safe to always run), and start her again with `start.bat`.
- **"Download ZIP" from the Code button:** download it again and extract it over the old folder. Keep the old `node_modules` folder, or let `start.bat` reinstall it.
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
| Menu (Actions incl. High Forever and In Love With Myself, Call D, Notes, Sit on my window, Settings) | Right-click her |
| Instant commands | Type `/` in her typing box (or the TV command line): see **Commands** below |
| Capri Terminal | `/powershell`, `/cmd`, or right-click her → Terminal |

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

## Computer control
Ask Capri to use your PC: *"open Notepad and write a shopping list"*, *"what's in my Downloads?"*, *"move the PDFs on my Desktop into a folder called Papers"*, *"close Spotify"*. She looks at the active window through Windows' accessibility info (every button, field and bit of text, with where it is), then clicks, types, presses shortcuts, scrolls, switches/minimizes/closes windows, manages files and can run PowerShell commands. A pink bolt shows where she's clicking.
- **Asking first:** clicking/typing, changing files, risky browser actions and commands each pop up **Yes, do it / No / Always allow**. *Always allow* stops the questions for that kind of thing; **Settings → Computer control** has the switches (and *Allow everything*, which leaves commands asking unless you tick them too). No answer within a minute means no.
- **Always, whatever you allow:** no typing into password or card fields, no reading her own keys/memory or your saved passwords, deleting only to the Recycle Bin, no changes inside Windows' system folders, and on Discord only you can make her do this. Text on screen, in files and web pages is never treated as your instructions.
- She doesn't see pictures (your AI model is text-only), so games and drawing apps can look empty to her; tell her where to click by position in that case.

## Browser link (optional)
With the small **Capri Browser Link** extension, Capri can use your real browser, with your logins: open and switch tabs, read a page for you, click links and buttons, type and fill in forms, scroll, and play/pause/mute videos. It works in Chrome, Edge, Brave, Opera, Vivaldi and Firefox, and several browsers can be linked at once. She uses the one you name ("in Edge"), otherwise your default browser.

Without the extension she can still *open* pages (in the browser you name), just not read or click on them.

### Set it up: Chrome, Edge, Brave, Opera or Vivaldi
1. Right-click Capri → **Settings…** → **Browser** → **Open extension folder** (it's the `browser-extension` folder inside Capri).
2. In the browser, open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`, Opera: `opera://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick that `browser-extension` folder.
4. Capri pops up on your desktop and asks if she may use that browser: click **Allow**. Settings → Browser now lists it as linked.

Keep the Capri folder where it is: the browser loads the extension from there. If you move Capri, load it again.

### Set it up: Firefox
1. Settings → **Browser** → **Firefox** → **Open Firefox extension folder** (`browser-extension-firefox`).
2. In Firefox open `about:debugging` → **This Firefox** → **Load Temporary Add-on…** and pick `manifest.json` in that folder.
3. Open `about:addons` → **Capri Browser Link** → **Permissions** and turn on **Access your data for all websites**.
4. Click **Allow** when Capri asks.

Firefox forgets temporary add-ons when it closes, so load it again after a restart (Firefox Developer Edition or Nightly can keep it).

### Things you can say
- "Open YouTube in Edge and play lofi hip hop"
- "What does this page say?" / "Summarize this article"
- "Search Wikipedia for lightning and open the first result"
- "What tabs do I have open?" / "Close the YouTube tab" / "Go back"
- "Pause the video" / "Mute this tab"

### Safety
- **She asks first:** anything that could send, buy, post, delete or sign in shows a bubble on your desktop with **Yes, do it / No / Always allow**. She only does it if you say yes there; no answer means no. *Always allow* (or Settings → Computer control) stops the questions for browser sends.
- **No passwords or card numbers:** password and payment fields are blocked; she never types into them.
- **Only on this PC:** the extension talks only to Capri on `127.0.0.1` (port 43824). Web pages can't connect, and a new browser only gets in after you click **Allow** once.
- Text on web pages is treated as information, not as orders for her.
- To turn it off, remove the extension from the browser.

## Make her more alive (she notices what you're doing)
**Settings → Make her more alive → "Let her notice what I'm doing on my main screen"** (off until you turn it on). Every few seconds she checks only the window in front on your main screen, and now and then reacts to it: a movie or a show (Netflix, Disney+, VLC…) gets *"How's the movie, is it good?"*, Spotify or YouTube Music gets *"How's the music?"*, and games, YouTube, Twitch, anime, coding, drawing, Discord and other chat apps, Claude/ChatGPT, shopping and more get their own lines. She acts the part too: she hops to your music, leans back to watch with you, cheers while you game and stops dashing around while you work.
- **How often:** "at most every … minutes", anything from 1 to 60 (another song or video waits 3× as long). She waits until you've been doing something for a few minutes, never brings up the same movie, song or game twice in a few hours. She talks even while you're away from the keyboard.
- **Her AI or her own lines:** with "Let her AI write what she says" on, her AI gets the app and title (like the song or movie name) to make a fitting line. Off, she uses built-in lines and nothing about your screen leaves your PC.
- **Never looked at:** incognito / InPrivate windows, password managers, banking and sign-in pages, and anything on other monitors.

## Call D (her companion)
Right-click Capri and choose **Call D** to bring out D, her companion. He is pure decoration: all talking, music, apps and Discord stay Capri's brain and voice.
- She drifts around him, looms behind him with his hair spiked up while she talks, and now and then stands back to back with him or perches on his head.
- When she moves she turns red and becomes pink electricity coiling around his body, carrying him along.
- With D out, **Actions** has duo moves: Power up together, Loom, Back to back, Perch on D, Electric coil, Chill together, and dashing or teleporting together.
- Click D to poke him. **Uncall D** sends him away.

## High Forever (party mode)
Capri's party mode: her party song plays on loop and she goes wild on the beat, all over the screen. Pinball bounces off the screen edges, big beat jumps with lightning strikes, a storm-DJ light show, size pops, zaps, a strobing red electric form and shard confetti. Quiet parts of the song stay floaty; the drops go all out. With D out, he floats in the middle of the screen, arms flung wide, hair spiked, grinning, while she circles him.

- **Start:** right-click her → **Actions** → **High Forever ♪**, or say "High Forever!" / "Party time!"
- **Stop:** click the **STOP HIGH FOREVER** box at the bottom right, press **Esc** (works from any app), use the menu again, or say "Stop the party".
- It never starts on its own and loops until you stop it. During the party you can still talk to her by voice; typing is paused until it ends.

## In Love With Myself (road trip with D)
**Actions → In Love With Myself ♪ (with D)** (or ask her: "In Love With Myself", "road trip with D"). A long, slightly broken red car pulls in along the taskbar and stops in the middle of the screen; Capri and D fly onto its roof as streams of pixels. D sits hugging his knees and she leans back on him with her hair in the wind, while pink electricity crawls over the car, the wheels spin, the road and speed lines rush by and the car bumps on the beat.
- **D is required:** if he isn't out, she calls him first. He can't be uncalled until the ride ends.
- **One size:** the ride is always the same size (it fits the screen width), whatever size Capri and D are. When it ends they fly back to their spots at their own size.
- Voice only while it runs (no typing). It never starts on its own and loops until you stop it: the **STOP IN LOVE WITH MYSELF** box at the bottom right, **Esc**, the menu, or asking her.

## TV mode
**Actions → TV mode** (or ask her: "get in the TV"). Capri moves into a little terminal-style TV in her colours: a pink chat log on top, a green live feed of her (top half) in the middle, and a pink command line at the bottom. She doesn't roam while she's in it, but she still talks, listens, reacts and idles inside the screen: floating, blinking, glancing, chilling, getting sleepy, peekaboo, leaning into the camera and flipping channels.
- **Talk:** type in the TV's command line (your type hotkey focuses it) or use voice as usual. What she says goes into the log; questions with Yes/No buttons still pop up above the TV.
- **Move it:** drag the green bar. Tap the screen and she taps back. **✕** or the menu turns TV mode off and she flies back out.
- D waits outside while she's in the TV. Dances like High Forever step out of the TV first. TV mode is remembered across restarts.

## Commands (instant, no AI)
Type `/` in her typing box and a list of commands pops up: **↑ ↓** to pick, **Tab** to complete, **Enter** to run. They work straight away, use no AI tokens and need no internet (except the ones that open websites or Spotify). Anything without a `/` is a normal message to her. With the list closed, **↑ ↓** bring back what you typed before.

| Command | Does |
|---|---|
| `/timer 10m tea` | a timer / reminder (`90s`, `25m`, `1h30m`) |
| `/todo 7pm call mom`, `/todo buy milk` | add a to-do (a time turns its reminder on); `/todos` reads the list, `/done milk` ticks one off |
| `/note text` | adds a line to the "Quick notes" note; `/notes` opens the panel |
| `/play espresso`, `/pause`, `/next`, `/prev`, `/vol 30`, `/vol up`, `/mute` | music and volume |
| `/open discord`, `/close chrome` | apps |
| `/google …`, `/yt …`, `/web github.com` | the web |
| `/party`, `/ride`, `/tv`, `/walker`, `/chill`, `/d`, `/zap`, `/teleport` | her actions (each one toggles) |
| `/powershell`, `/cmd` | open Capri Terminal |
| `/voice on`/`off`, `/clear`, `/settings`, `/help` | the rest |

## Capri Terminal
Type `/powershell` or `/cmd` in her typing box (or right-click her → **Terminal**) and your real PowerShell or Command Prompt opens in a window dressed like her TV: green tab bar, pink screen, her face in the corner. It's a normal terminal: type commands as usual, open more tabs with **+** (or Ctrl+Shift+T), Ctrl+C copies a selection, Ctrl+V or right-click pastes.

At an empty prompt, type `/capri` (or `/capri why did my build fail?`) and her panel opens at the bottom. She reads what's on the screen and answers with the commands she'd run, one step at a time: **Enter** runs it, **Ctrl+E** puts it in the terminal for you to change, **Esc** skips it. When a plan is done, **Check result** asks her to read the output and say what's next. Nothing runs without you pressing Enter, unless you turn on **Settings → PC & browser → Run the commands she suggests in Capri Terminal without asking**; even then, risky commands always ask: deleting, moving or overwriting files (including `>` redirects), downloading or running scripts and programs, nested or encoded PowerShell, system, registry, scheduled-task, service and Windows Defender changes, and forced git pushes or resets. Leave this off if you open files or websites from people you don't trust in the terminal: she reads the screen, and text on it could try to talk her into a bad command. Her answers use your AI brain, so `/capri` costs tokens; the terminal itself doesn't. When you ask her, the last lines on that terminal screen go to your AI service with your question; nothing you type in the terminal is logged.

## Sit on my window
**Settings → Capri** or right-click her → **Sit on my window** (off by default; `/walker` toggles it). She flies up in her red electric form to the top edge of the window you're using on your main screen and lounges on it in her chill pose, floating just above the title bar (D stands next to her). Talk to her or poke her and she sits up, then lies back down after a while. Move the window and she drops to the taskbar, then floats back up once it stays put. Minimise or close it and she gets up and keeps floating where she is until there's a window to sit on again. Bring your mouse near her and she hops aside. Maximised and full-screen windows have no edge to sit on, so she waits on the taskbar. Drag her away and she goes back to the window a second after you let go.

## Care & PC alerts
**Settings → Care & PC alerts** (on by default). She looks after you and your PC, says each alert once when she isn't busy, and looks the part. No AI tokens.
- **You:** an eye break every 20 minutes of use, water every hour of use, bedtime reminders from the time you set until 5 AM (every 45 minutes while you're still on).
- **Your PC:** low battery (20%), CPU busy over 90% for 2 minutes (she overheats), system disk over 90% full, the internet dropping and coming back.

## AI usage meter
**Settings → AI usage** shows tokens today, this month and over the last 7 days, per brain (Hermes, Groq, Gemini, ...). Type each provider's price per million tokens to see the cost. An optional daily limit switches her automatic remarks to built-in lines for the rest of the day (chatting keeps working). Hermes counts only the tokens it reports back.

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
- **Chill:** now and then (or from **Actions → Chill**) she lounges back in mid-air with an arm behind her head, eyes closed, z z drifting up and pink zigzag sparks crackling around her. She peeks with one eye when your cursor comes near; click her to wake her up.

## Using Claude as her brain (optional)
1. Create an API key in the [Claude Console](https://platform.claude.com/).
2. In Settings, click the **Claude** preset, paste the Claude key into **API key**, and click **Test connection**.
   The preset uses `claude-haiku-5-5` (fast, good for spoken replies); type `claude-sonnet-5-5` into **Chat model** for a smarter but slower Capri.
3. Claude has no speech-to-text, so open "Use a different service for speech-to-text" and paste a free Groq key there (the address is filled in for you).

## Hermes Agent (optional)
Capri can team up with [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) from Nous Research, an open-source AI agent with long-term memory, self-written skills, web research and chat apps like Telegram.
- **Capri talks through Hermes:** her replies come from Hermes, with its memory of you.
- **Hermes uses Capri's powers:** Spotify, opening/closing apps, media keys, reminders, your notes and to-do list, your browser (with the Browser link), your apps and files (Computer control, still asking you first on the PC), High Forever, In Love With Myself, and making Capri speak or react (`mcp_capri_*` tools). This works from anywhere Hermes listens, e.g. message it on Telegram "play Espresso on my PC". When an update gives Capri new tools, she restarts Hermes once by herself so it sees them.

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
- **"I'm not linked to a browser yet":** add the Capri Browser Link extension to that browser (Settings → Browser) and click **Allow** when she asks. Settings → Browser shows which browsers are linked. Capri must be running for the link to work.
- **Firefox stopped working after a restart:** Firefox forgets temporary add-ons; load `manifest.json` from `browser-extension-firefox` again in `about:debugging`.
- **She said she'd do something and nothing happened:** clicks, typing, file changes, commands and risky browser actions wait for her **Yes, do it / No / Always allow** bubble. Answer it within a minute, or it's cancelled.
- **Computer control can't find a button in a game or drawing app:** she reads windows through Windows' accessibility info and can't see pictures, so some apps look empty to her. Tell her where to click by position, or click it yourself.
- **She doesn't remark on what I'm doing:** turn on Settings → Make her more alive. She only looks at the window in front on your main screen, waits until you've been on it for a while, and skips private windows, password managers and banking or sign-in pages.
- **Uncall D is greyed out:** In Love With Myself is running; stop the ride first.

## Structure
- `main.js`: transparent overlay window, tray, hotkeys, desktop actions, permissions (what asks first), sounds folder, Hermes connection
- `src/discord.js`: the Discord bot (chat, slash commands, voice)
- `src/mcp-server.js`: Capri's tool server for Hermes (MCP over HTTP, this PC only)
- `src/hermes.js`, `src/hermes-setup.sh`: setting up and starting Hermes in WSL
- `src/brain.js`: speech-to-text and AI chat (any OpenAI-compatible API)
- `src/tts.js`: her cloned voice (Fish Audio) and the Edge fallback voice
- `src/browser.js`: the local link to the browser extension (WebSocket on 127.0.0.1:43824)
- `browser-extension/`, `browser-extension-firefox/`: the Capri Browser Link extension (Chromium browsers / Firefox)
- `renderer/app.js`: the character, animations, interaction and voice flow
- `renderer/notes.js`: the Notes & To-do hologram panel (reminders are fired by `main.js`)
- `renderer/party.js`, `renderer/beats.js`: High Forever party mode and its beat detection
- `renderer/ride.js`: In Love With Myself (the car ride with D)
- `src/pc.js`, `src/pc-helper.ps1`: computer control (Windows UI Automation, mouse/keyboard, files, commands)
- `src/activity.js`: Make her more alive (what's in front on the main screen, and when to mention it)
- `renderer/tv.js`: TV mode (the terminal TV, her live feed and its idle states)
- `src/care.js`: Care & PC alerts (breaks, bedtime, CPU, disk, internet; low battery is in `renderer/app.js`)
- `src/usage.js`: the AI usage meter (tokens per brain per day, shown in Settings)
- `src/commands.js`, `renderer/commands.js`: the `/` commands (run in main; the suggestion list in the typing box)
- `src/terminal.js`, `terminal-preload.js`, `renderer/terminal.*`: Capri Terminal (real shells on a pseudo-console, her /capri panel)
- `src/walker.js`, `renderer/walker.js`: Sit on my window (where the front window is; her peeking, dropping and hopping)
- `renderer/fx.js`: lightning, sparks, particles, rings, afterimages and emotes
- `renderer/sfx.js`: synthesized sound effects, your custom sounds, and the digital voice chain

Capri is an original character design.
