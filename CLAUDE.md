# Capri — project notes for Claude

Capri is a pixel-art "electrical AI girl" desktop companion for Windows (Electron 45). She floats on a
transparent always-on-top overlay, chats by voice/text through any OpenAI-compatible API, opens/closes apps,
controls Spotify/media, sets reminders, runs a Discord bot, and can use Hermes Agent (in WSL) as her brain.
D is her companion character (decoration only). User-facing docs: `README.md`.

## Never commit personal data
Keys, tokens, settings, chat memory and logs live only in `%APPDATA%\Capri` (`config.json`, `history.json`,
`capri.log`) on the user's PC. Nothing personal belongs in this repo. Voice clips are not shipped
(`assets/capri/voice-samples/` holds only a README; `.gitignore` blocks audio there). Before any push or release,
scan for key-like strings (gsk_, sk-, AIza, AQ., Discord tokens, long hex, emails, `C:\Users\<name>` paths).
Commit as the repo owner with their GitHub no-reply address, never a personal email.

## Layout
- `main.js` — main process: overlay window, tray + menus (Actions submenu differs when D is out), hotkeys,
  config (`DEFAULT_CONFIG`, `SECRET_KEYS` can't be set from the renderer, `publicConfig()` strips keys before
  they reach the overlay), desktop actions the AI can call, IPC, Hermes connect, Discord bot wiring, activity
  log, and a file watcher: when run from a plain `resources/app` folder, editing renderer/assets reloads the
  window and anything else restarts the app (lets Claude update a user's install in place).
- `preload.js` — the `window.companion` bridge.
- `src/brain.js` — speech-to-text + chat with tools (OpenAI format). Handles reasoning models (gpt-oss,
  Gemini 3.x, qwen3, deepseek → `reasoning_effort: low`, `max_tokens >= 2048`), Claude (no temperature), Hermes
  (`:8642`, no tools sent, `X-Hermes-Session-Key`), request timeouts (60 s, Hermes 120 s), `noTools`/`discord`
  options. FAST_TOOLS answer straight from the tool result.
- `src/tts.js` — Fish Audio cloned voice, Microsoft Edge TTS fallback.
- `src/spotify.js` — PKCE login (redirect `http://127.0.0.1:43821/callback`); plays by opening the Spotify URI
  (restarts Spotify if needed, because the desktop app ignores switching otherwise).
- `src/apps.js` — open/close Windows apps (Get-StartApps, CloseMainWindow, protected list).
- `src/discord.js` — discord.js 14 bot: mentions/replies/DMs, per-channel memory, slash commands
  (/ask /owner /play /music /nowplaying /zap /join /leave /say), voice via @discordjs/voice (renderer decodes
  mp3 → 48 kHz PCM). Only the owner (bot-app owner, or usernames/IDs in Settings, username locked to first ID)
  gets PC tools; others never reach Hermes. Run the bot on ONE PC per token or she answers twice.
- `src/mcp-server.js` — Capri's tool server for Hermes (MCP Streamable HTTP, port 43823, bearer token,
  rejects browser Origins). `src/hermes.js` + `src/hermes-setup.sh` — WSL setup, mirrored networking,
  config.yaml edits (backed up as `.bak-capri`), starting/restarting the gateway. Hermes is often a systemd user
  service: restart it (`hermes gateway restart --yes`) instead of `gateway run`, keep a WSL session open
  (journalctl -f) so WSL doesn't idle it out, and leave the service running when Capri quits.
- `renderer/app.js` — the character: sprite composition (body + eye + mouth overlays), levitation, red electric
  form while moving, many-eyes, teleport shatter/converge, Chill (lounge) mode with zigzag slash sparks, Call D
  duo mode (orbit, loom, back-to-back, perch, chill together, red→electric coil around D), click-through hit
  testing, bubbles, voice flow, Discord desktop bubble. `renderer/fx.js` — bolts, arcs, sparks, particles
  (cap 12000: her sprite is ~5000 px). `renderer/sfx.js` — synthesized sounds + user custom sounds.
- `tools/capri_sprite.py` — generates `assets/capri/sheet.png/json/js` + icons. Shapes are drawn in a 64x80
  design space and placed into 96x100 cells at offset `OFF=(14,16)` (the shattered-glass hair is bigger than
  the body). `renderer/app.js` reads `META.offset`/`META.size`; never hard-code 64x80 or y=48 there
  (use `CORE_Y`, `TOP_Y`). `tools/capri_lounge.py` — the lounge pose (drawn through a rotation so pixels stay
  crisp, eyes baked in). `tools/capri_duo.py` — D's strip from `tools/d_src/` (his original pixels recovered
  from the concept art; extra poses are painted from them). Regenerate: `pip install pillow && python tools/capri_sprite.py`.
- `tools/build/` — `build-release.sh <runtime-folder>` builds `Capri-win64.zip` from a previous release's
  `Capri/` runtime: prod deps, Windows DAVE native module (`@snazzah/davey-win32-x64-msvc@0.1.12`), asar with
  `--unpack "*.node"`, then `integrity.cjs` rewrites the exe's asar-integrity hash (the exe refuses a changed
  asar otherwise) and `seticon.cjs` sets the icon.

## Design rules (from the owner — keep them)
- Look: "Spark" design. Shattered-glass glittering pink hair (one angular mass sweeping up-right, straight
  cracks, floating shards, glitter heavier at the top), black crown spikes, green RECTANGLE mask, blue ring
  eyes in pointed black almond sockets (short tips that don't touch in the middle), solid white mouth that is
  never round (thin zigzag / notched triangle / jagged shard), black suit with red heart gem and pink/green
  shards. Closed/blink eye = black almond with a green curve. No thin X eyes.
- Many-eyes appear only inside the green mask, never in the hair.
- She always levitates. Moving or dragging = solid red electric form (not an orb). With D out, she visibly
  turns red first, then becomes pink electricity coiling around D.
- Pink electricity in everything; Chill sparks are bold pink zigzag slashes around her outline (not rings).
- Not creepy; keep the original vibe. Bangs/"poni" redesign was tried and dropped — don't bring it back unasked.
- Always show the owner previews/illustrations before changing her design, and give a few versions.

## Testing without Windows
- Renderer: serve the repo over HTTP and load a harness page that defines a mocked `window.companion`
  (getConfig, readAsset via fetch, chat, tts, onX listeners) then imports `renderer/app.js`; drive it with
  Playwright through `window.__test` (startChill, callD, duoAction, teleportOut, startWalk, poke, st, duo, fx).
- Main process: require `main.js` with a stubbed `electron` module to check IPC handlers and config flow.
- Discord bot: `createBot()` exposes `_test` (onMessage, onCommand, ask, isOwner) for mocked messages.
- Python sprite tools: run them and check every frame's alpha bbox stays inside its cell.
