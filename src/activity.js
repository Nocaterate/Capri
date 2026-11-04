// "Make her more alive": Capri notices what you're doing on your main screen and reacts to it now and then
// ("How's the movie?", "Good song!"). Only the window in front on the primary monitor counts: a Spotify window
// there means music, a Netflix tab means a movie, a Steam game means gaming. Off unless you turn it on in Settings.
// Nothing is stored except the line she says (it goes into her chat memory so she understands your answer).
// Private things are never looked at: incognito/InPrivate windows, password managers, banking, adult sites.

// ---------------------------------------------------------------- recognising what's on screen
const BROWSERS = /^(chrome|msedge|firefox|brave|opera|opera_gx|vivaldi|arc|zen|librewolf|waterfox|floorp|thorium|yandex)$/i;
const BROWSER_SUFFIX = /\s+[-—–]\s+(google chrome|microsoft​?\s*edge|mozilla firefox|firefox|brave|opera|vivaldi|arc|zen browser|librewolf|waterfox|floorp|thorium|yandex)(\s+(beta|dev|canary|nightly))?\s*$/i;
const PRIVATE = /\b(incognito|inprivate|private browsing|privat(e|es) fenster)\b/i;
const SENSITIVE_APPS = /^(1password|bitwarden|keepass(xc)?|lastpass|dashlane|nordpass|enpass|keeper|credentialuibroker|consent|lockapp|logonui)$/i;
const SENSITIVE_TITLE = /\b(bank|banking|bca|bri|mandiri|bni|jenius|paypal|wise\.com|venmo|crypto wallet|metamask|password|passwords|login|log in|sign in|masuk|otp|2fa|verification code|porn|xxx|onlyfans|hentai|nsfw)\b/i;
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|wmv|m4v|webm|flv|ts)\b/i;
const AUDIO_EXT = /\.(mp3|flac|wav|m4a|aac|ogg|opus|wma)\b/i;

// desktop apps (process name, lower case, without .exe)
const APPS = [
  [/^spotify$/, 'music', 'Spotify'], [/^(applemusic|itunes|amazonmusic|tidal|deezer|foobar2000|aimp|musicbee|winamp|youtube music)$/, 'music', null],
  [/^(vlc|mpc-hc64|mpc-hc|mpc-be64|potplayermini64|potplayermini|potplayer|mpv|kmplayer|gom|wmplayer|stremio|plex|kodi|jellyfin media player)$/, 'player', null],
  [/^(netflix|disneyplus|primevideo)$/, 'movie', null],
  [/^(code|code - insiders|cursor|windsurf|devenv|idea64|pycharm64|webstorm64|rider64|clion64|goland64|phpstorm64|studio64|sublime_text|notepad\+\+|zed|eclipse|androidstudio)$/, 'coding', null],
  [/^(discord|discordptb|discordcanary|whatsapp|whatsapp\.root|telegram|signal|slack|teams|ms-teams|zoom|line|messenger|skype)$/, 'chat', null],
  [/^(claude|chatgpt|perplexity|copilot|microsoft\.copilot|gemini|lm studio|ollama app|jan)$/, 'ai', null],
  [/^(winword|excel|powerpnt|onenote|notion|obsidian|wps|et|wpp|soffice|swriter|scalc|libreoffice|acrobat|acrord32|sumatrapdf|foxitpdfreader)$/, 'work', null],
  [/^(photoshop|illustrator|aseprite|krita|clipstudiopaint|clip studio paint|paintdotnet|gimp-2\.10|gimp|blender|figma|affinity.*|procreate|medibangpaintpro|sai2|sai|inkscape|afterfx|adobe premiere pro|premiere|resolve|capcut|vegas.*|obs64|obs)$/, 'art', null],
  [/^(steam|epicgameslauncher|riotclientux|battle\.net|galaxyclient|ubisoftconnect|eadesktop|xboxpcapp)$/, 'launcher', null],
];
// known games that aren't under a Steam/Epic folder (process names)
const GAMES = /^(valorant|valorant-win64-shipping|leagueclient|league of legends|minecraft|javaw|robloxplayerbeta|genshinimpact|zenlesszonezero|starrail|fortniteclient-win64-shipping|cs2|dota2|r5apex|overwatch|gta5|eldenring|cod|mlbb|pubg|tslgame|wutheringwaves|client-win64-shipping|osu!|terraria|stardew valley|hollow_knight)$/i;

// web pages (the browser tab's title)
const SITES = [
  [/\b(netflix)\b/i, 'movie', 'Netflix'], [/\b(disney\+|disneyplus|hotstar)\b/i, 'movie', 'Disney+'], [/\bprime video\b/i, 'movie', 'Prime Video'],
  [/\b(hbo max|max\b.*hbo|apple tv\+?|vidio|wetv|iqiyi|viu|catchplay|mubi|hulu|paramount\+|peacock)\b/i, 'movie', null],
  [/\b(crunchyroll|bilibili|anime|9anime|zoro|hianime|aniwatch)\b/i, 'anime', null],
  [/\btwitch\b/i, 'stream', 'Twitch'], [/\bkick\.com\b|- kick$/i, 'stream', 'Kick'],
  [/youtube music|soundcloud|spotify|apple music|deezer|tidal|joox|bandcamp|resso/i, 'music', null],
  [/\byoutube\b/i, 'video', 'YouTube'],
  [/\b(tiktok|instagram|facebook|twitter|threads|reddit|pinterest|tumblr)\b|\/ x$| on x$/i, 'social', null],
  [/\b(tokopedia|shopee|lazada|blibli|amazon|ebay|aliexpress|temu|bukalapak|zalora)\b/i, 'shopping', null],
  [/\b(github|stack overflow|stackoverflow|gitlab|codepen|replit|leetcode|mdn web docs)\b/i, 'coding', null],
  [/\b(google docs|google sheets|google slides|notion|canva|figma|trello|jira|gmail|outlook)\b/i, 'work', null],
  [/\b(whatsapp|discord|telegram|messenger)\b/i, 'chat', null],
  [/\b(wikipedia|medium|webtoon|mangadex|manga|wattpad|ao3|archive of our own)\b/i, 'reading', null],
  [/\b(chatgpt|claude|gemini|copilot|perplexity)\b/i, 'ai', null],
];

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// "Dune.Part.Two.2024.1080p.WEBRip.x264.mkv" -> "Dune Part Two"
function mediaName(file) {
  let s = String(file).replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
  s = s.replace(/[._]+/g, ' ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  s = s.replace(/\b(19|20)\d{2}\b.*$/, '').replace(/\b(480|720|1080|2160)p\b.*$/i, '').replace(/\b(web-?rip|web-?dl|bluray|brrip|hdrip|x26[45]|h\.?26[45]|hevc|aac|dts)\b.*$/i, '');
  return tidy(s).slice(0, 60);
}

// what is this window? -> { category, detail, private } or null (nothing worth noticing)
function classify(fg) {
  if (!fg || fg.none || fg.self) return null;
  const proc = String(fg.process || '').toLowerCase();
  let title = tidy(fg.title);
  const exe = String(fg.path || '');
  if (!title && !proc) return null;
  if (/^(explorer|shellexperiencehost|searchhost|searchapp|startmenuexperiencehost|textinputhost|lockapp|applicationframehost)$/.test(proc) && !title) return null;
  if (proc === 'explorer' && (!title || /^program manager$/i.test(title))) return null;          // the desktop itself
  if (SENSITIVE_APPS.test(proc) || PRIVATE.test(title) || SENSITIVE_TITLE.test(title)) return { private: true };

  // browsers: decide by the tab title
  if (BROWSERS.test(proc)) {
    title = title.replace(BROWSER_SUFFIX, '').replace(/\s+[-—–]\s+(personal|work|profile \d+|person \d+)$/i, '').replace(/\s+and \d+ more pages?$/i, '');
    title = title.replace(/^\(\d+\+?\)\s*/, '');                                                   // "(3) Video - YouTube"
    for (const [re, cat, site] of SITES) {
      if (!re.test(title)) continue;
      let detail = tidy(title.replace(/\s+[-—–|•·]\s+(youtube|netflix|twitch|crunchyroll|youtube music|soundcloud|spotify|disney\+|prime video)\s*$/i, ''));
      if (site && detail.toLowerCase() === site.toLowerCase()) detail = '';
      detail = detail.replace(/^watch\s+/i, '');
      if (cat === 'video' && (!detail || /^youtube$/i.test(detail))) return { category: 'browsing', detail: '', site: 'YouTube' };   // YouTube's home page
      if (cat === 'music' && /^(spotify|spotify\s*[-–]\s*web player.*|youtube music|soundcloud)$/i.test(detail)) detail = '';
      return { category: cat, detail: detail.slice(0, 80), site: site || '' };
    }
    return { category: 'browsing', detail: title.slice(0, 80), site: '' };
  }

  // a game? anything run from a Steam / Epic / other games folder, or a known game
  const gameDir = exe.match(/[\\/](?:steamapps[\\/]common|epic games|riot games|gog galaxy[\\/]games|xboxgames|games)[\\/]([^\\/]+)/i);
  if (gameDir && !/launcher|crashreport|setup|unins/i.test(proc)) return { category: 'game', detail: tidy(gameDir[1]).slice(0, 60) };
  if (GAMES.test(proc)) return { category: 'game', detail: title.slice(0, 60) };

  for (const [re, cat, name] of APPS) {
    if (!re.test(proc)) continue;
    if (cat === 'music' && proc === 'spotify') {
      // Spotify's title is "Artist - Song" while something plays, "Spotify Premium"/"Spotify Free" when paused
      if (!title || /^spotify( premium| free)?$/i.test(title)) return { category: 'music_idle', detail: '' };
      return { category: 'music', detail: title.slice(0, 80), site: name };
    }
    if (cat === 'player') {
      const t = title.replace(/\s+[-—–]\s+(vlc media player|mpc-hc|mpc-be|potplayer|mpv|media player)$/i, '');
      if (AUDIO_EXT.test(t)) return { category: 'music', detail: mediaName(t) };
      return { category: 'movie', detail: VIDEO_EXT.test(t) || t !== title ? mediaName(t) : '' };
    }
    if (cat === 'coding') {
      const parts = title.split(/\s+[-—–]\s+/);
      return { category: 'coding', detail: tidy(parts.length > 2 ? parts[parts.length - 2] : parts[0]).slice(0, 50) };
    }
    if (cat === 'launcher') return { category: 'launcher', detail: '' };
    return { category: cat, detail: cat === 'work' || cat === 'chat' ? '' : title.slice(0, 60) };
  }
  // the Windows Media Player / Films & TV / Netflix apps run inside ApplicationFrameHost
  if (proc === 'applicationframehost' || /^(microsoft\.media\.player|video\.ui|music\.ui)$/.test(proc)) {
    if (/netflix|disney|prime video/i.test(title)) return { category: 'movie', detail: '' };
    if (/media player|films|movies|groove/i.test(title)) return { category: AUDIO_EXT.test(title) ? 'music' : 'movie', detail: '' };
  }
  // something unknown covering the whole main screen is most likely a game
  if (fg.fullscreen && !/^(explorer|electron)$/i.test(proc)) return { category: 'game', detail: title.slice(0, 60) };
  return { category: 'other', detail: '' };
}

// ---------------------------------------------------------------- when she says something
// seconds an activity must last before she mentions it (the owner wants 1 minute for everything)
const AFTER_ALL = 60;
const AFTER = {};
// minutes between remarks (any activity): the "at most every … minutes" setting, 1-60; the same kind of thing waits 3x longer
const OLD_GAP = { rare: 40, normal: 18, often: 8 };
function gapMinutes(cfg) {
  const n = Number(cfg.activityMinutes);
  if (Number.isFinite(n) && n > 0) return Math.min(60, Math.max(1, n));
  return OLD_GAP[cfg.activityFrequency] || 18;
}

const WHAT = {
  movie: (d) => (d ? `watching "${d}"` : 'watching a movie or a show'), anime: (d) => (d ? `watching the anime "${d}"` : 'watching anime'),
  video: (d) => (d ? `watching the YouTube video "${d}"` : 'watching YouTube'), stream: (d, s) => `watching a live stream${s ? ` on ${s}` : ''}${d ? ` ("${d}")` : ''}`,
  music: (d) => (d ? `listening to "${d}"` : 'listening to music'), game: (d) => (d ? `playing ${d}` : 'playing a game'),
  coding: (d) => (d ? `coding (project "${d}")` : 'coding'), chat: () => 'chatting with someone', work: () => 'working on documents',
  art: (d) => (d ? `drawing or editing in ${d}` : 'making art'), reading: (d) => (d ? `reading "${d}"` : 'reading something'),
  shopping: () => 'shopping online', social: (d, s) => `scrolling social media${s ? ` (${s})` : ''}`, ai: () => 'chatting with another AI',
};
const LINES = {
  movie: [['happy', "How's the movie? Is it good?"], ['happy', 'Ooh, movie time! Is it a good one?'], ['surprised', "Wait, what are we watching? Is it scary? Tell me it's not scary."]],
  anime: [['happy', 'Anime time! Which episode are you on?'], ['happy', "Is it good? I bet the fights are electric."]],
  video: [['happy', 'What are you watching? Looks interesting!'], ['happy', 'Is the video good? Tell me the best part later!']],
  stream: [['happy', "Who's streaming? Are they any good?"], ['happy', 'Live stream? I hope chat is behaving.']],
  music: [['happy', "How's the music? Is it a good one?"], ['happy', 'Ooh, I like this vibe. Good song?'], ['relaxed', 'Music on... my circuits are humming along.']],
  game: [['happy', 'Gaming! Are you winning?'], ['surprised', "Don't lose! I'm cheering for you!"], ['happy', 'How is the game going? Need some electric luck?']],
  coding: [['happy', "Coding again? Don't forget to save!"], ['relaxed', 'Any bugs yet? I could zap them for you.']],
  chat: [['happy', 'Who are you chatting with? Tell them Capri says hi!'], ['surprised', 'Ooh, gossip? Tell me everything later!'], ['happy', 'Chatting away! Is it someone fun?']],
  work: [['happy', "Working hard? I'm cheering for you!"], ['relaxed', "Don't forget to take a break, okay?"]],
  art: [['happy', 'Making something cool? Show me later!'], ['happy', 'Ooh, are you drawing? I want to see!']],
  reading: [['relaxed', 'What are you reading? Is it good?']],
  shopping: [['happy', 'Shopping? Buy me something electric!'], ['surprised', 'Ooh, what are you buying?']],
  social: [['happy', 'Scrolling again? Find anything funny?']],
  ai: [['angry', 'Hey! Are you talking to another AI? I can do that too, you know!'], ['surprised', 'Another AI? Should I be jealous right now?'], ['happy', "Asking another AI for help? Fine... but I'm cuter."]],
};
// her own words for what she's reacting to (for the renderer's little reactions without talking)
const MOODS = { movie: 'watch', anime: 'watch', video: 'watch', stream: 'watch', music: 'music', game: 'game', coding: 'focus', work: 'focus', reading: 'focus', art: 'focus' };

function createActivity({ pc, getConfig, log = () => {}, isBusy = () => false, makeLine, onSay, onMood }) {
  let timer = null, failUntil = 0, failures = 0;
  let cur = null;               // { key, category, detail, site, since }
  let lastSaidAt = 0;
  const lastByCat = {}, lastByKey = {};
  let lastMood = null, lastKind = null;

  async function poll() {
    const cfg = getConfig();
    if (!cfg.activityAware) return;
    if (Date.now() < failUntil) return;
    let fg;
    try {
      fg = await pc.call('foreground', {}, 8000);
      failures = 0;
    } catch (e) {
      failures++;
      failUntil = Date.now() + Math.min(10 * 60e3, 30e3 * failures);   // back off: don't spam a broken helper
      return;
    }
    if (fg.self) return;                                 // you're looking at Capri herself (or her Settings)
    const a = fg.primary === false ? null : classify(fg);   // only what's on the main screen
    if (a && a.private) { cur = null; mood(null); if (lastKind !== 'private') { lastKind = 'private'; log('activity now: private (looking away)'); } return; }   // she looks away
    const key = a ? `${a.category}|${a.detail}` : 'none';
    const kind = a ? a.category : 'nothing';
    if (kind !== lastKind) { lastKind = kind; log('activity now:', kind); }   // only the kind of thing, never titles
    if (!cur || cur.key !== key) {
      // a new song on the same player is still "listening to music" for the timing, but a fresh thing to mention
      const sameCat = cur && a && cur.category === a.category;
      cur = a ? { key, category: a.category, detail: a.detail, site: a.site || '', since: sameCat ? cur.since : Date.now() } : null;
    }
    mood(cur ? MOODS[cur.category] || null : null);
    if (!cur || !LINES[cur.category]) return;
    const now = Date.now();
    const lasted = (now - cur.since) / 1000;
    if (lasted < (AFTER[cur.category] || AFTER_ALL)) return;
    // she talks whether or not you're at the keyboard (the owner's choice); the gaps below keep it from piling up
    const gap = gapMinutes(cfg) * 60e3;
    if (now - lastSaidAt < gap) return;
    if (now - (lastByCat[cur.category] || 0) < gap * 3) return;
    if (now - (lastByKey[cur.key] || 0) < 3 * 3600e3) return;   // never twice about the same movie / song / game
    if (isBusy()) return;
    lastSaidAt = now; lastByCat[cur.category] = now; lastByKey[cur.key] = now;
    const what = (WHAT[cur.category] || (() => cur.category))(cur.detail, cur.site);
    const minutes = Math.max(1, Math.round(lasted / 60));
    let line = null;
    if (cfg.activityAi !== false && makeLine) {
      try { line = await makeLine({ category: cur.category, what, minutes }); } catch (e) { log('activity line failed:', e.message); }
    }
    if (!line) {
      const [emotion, text] = LINES[cur.category][Math.floor(Math.random() * LINES[cur.category].length)];
      line = { emotion, text };
    }
    log('activity:', cur.category, `(${minutes} min)`, '->', line.text);
    onSay({ ...line, category: cur.category, note: cfg.activityAi !== false ? what : WHAT[cur.category] ? WHAT[cur.category]('', '') : cur.category });
  }
  function mood(m) { if (m !== lastMood) { lastMood = m; onMood && onMood(m); } }

  function start() {
    if (timer) return;
    timer = setInterval(() => { poll().catch((e) => log('activity poll', e.message)); }, 8000);
    log('activity sense on');
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer); timer = null; cur = null; mood(null);
    log('activity sense off');
  }
  function sync() { if (getConfig().activityAware && process.platform === 'win32') start(); else stop(); }
  return { start, stop, sync, poll, _state: () => ({ cur, lastSaidAt }) };
}

module.exports = { createActivity, classify, mediaName, gapMinutes, LINES, WHAT };
