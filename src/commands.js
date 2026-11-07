// Command protocols: "/" commands typed in her typing box (or the TV command line) run straight away, with no AI
// and no tokens. Anything that doesn't start with "/" is a normal chat message. Main runs them with the same
// desktop actions the AI uses (ctx.actions); the overlay shows COMMANDS as suggestions while you type.

const COMMANDS = [
  // name, what to type after it, what it does
  ['help', '', 'list every command'],
  ['timer', '10m [text]', 'timer / reminder (10m, 90s, 1h30m)'],
  ['todo', '[7pm] text', 'add a to-do (with a time = reminder)'],
  ['todos', '', 'read the to-do list'],
  ['done', 'text', 'tick a to-do off'],
  ['note', 'text', 'save a quick note'],
  ['notes', '', 'open Notes & To-do'],
  ['play', 'song or artist', 'play it on Spotify'],
  ['pause', '', 'pause / resume'],
  ['next', '', 'next song'],
  ['prev', '', 'previous song'],
  ['vol', '0-100 | up | down', 'Spotify volume'],
  ['mute', '', 'mute / unmute the PC'],
  ['open', 'app', 'open an app'],
  ['close', 'app', 'close an app'],
  ['google', 'search', 'search Google'],
  ['yt', 'search', 'search YouTube'],
  ['web', 'site', 'open a website'],
  ['party', '', 'High Forever on/off'],
  ['ride', '', 'In Love With Myself on/off (with D)'],
  ['tv', '', 'TV mode on/off'],
  ['walker', '', 'sit on my window on/off'],
  ['chill', '', 'lounge / stop lounging'],
  ['d', '', 'call / uncall D'],
  ['zap', '', 'power up'],
  ['teleport', '', 'teleport somewhere'],
  ['voice', 'on | off', 'talk out loud or not'],
  ['clear', '', 'wipe her chat memory'],
  ['powershell', '', 'open Capri Terminal (PowerShell)'],
  ['cmd', '', 'open Capri Terminal (CMD)'],
  ['settings', '', 'open Settings'],
].map(([name, args, desc]) => ({ name, args, desc }));

const ALIASES = { h: 'help', '?': 'help', t: 'timer', remind: 'timer', reminder: 'timer', n: 'note', todolist: 'todos', list: 'todos',
  p: 'play', resume: 'pause', skip: 'next', previous: 'prev', back: 'prev', volume: 'vol', v: 'vol', o: 'open', start: 'open',
  g: 'google', search: 'google', youtube: 'yt', url: 'web', go: 'web', site: 'web', hf: 'party', dance: 'party',
  inlove: 'ride', car: 'ride', window: 'walker', walk: 'walker', lounge: 'chill', calld: 'd', power: 'zap', charge: 'zap', tp: 'teleport',
  config: 'settings', ps: 'powershell', pwsh: 'powershell', terminal: 'powershell', term: 'powershell', shell: 'powershell', prompt: 'cmd', mic: 'voice', forget: 'clear', check: 'done', finish: 'done' };

// "10m", "90s", "1h30m", "1.5h", "10" (minutes), "10 min", "2 hours" -> minutes (null if none)
function parseDuration(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs|hr|h|minutes?|mins|min|m|seconds?|secs|sec|s)(?=\d|\s|$)/g;
  let total = 0, any = false, m, used = '';
  while ((m = re.exec(t))) { any = true; used += m[0]; const n = Number(m[1]), u = m[2][0]; total += u === 'h' ? n * 60 : u === 's' ? n / 60 : n; }
  if (!any || used.replace(/\s/g, '').length !== t.replace(/\s/g, '').length) return null;
  return total;
}
// the first word(s) of the text as a duration: "10m drink water" -> [10, "drink water"]
function splitDuration(rest) {
  const words = String(rest || '').trim().split(/\s+/).filter(Boolean);
  for (let k = Math.min(3, words.length); k >= 1; k--) {
    const d = parseDuration(words.slice(0, k).join(' '));
    if (d != null) return [d, words.slice(k).join(' ')];
  }
  return [null, String(rest || '').trim()];
}
const fmtMin = (m) => (m < 2 && m % 1 ? `${Math.round(m * 60)} seconds` : m % 60 === 0 && m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : m > 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m * 10) / 10} minute${m === 1 ? '' : 's'}`);

function resolve(word) {
  const w = String(word || '').toLowerCase();
  if (COMMANDS.some((c) => c.name === w)) return w;
  if (ALIASES[w]) return ALIASES[w];
  const starts = COMMANDS.filter((c) => c.name.startsWith(w));
  return w && starts.length === 1 ? starts[0].name : null;
}

// ctx: { actions, getConfig, setConfig, send, openSettings, clearHistory, partyKind() }
async function runCommand(input, ctx) {
  const raw = String(input || '').trim().replace(/^\//, '');
  const [word = '', ...restWords] = raw.split(/\s+/);
  const rest = restWords.join(' ').trim();
  const name = resolve(word);
  const a = ctx.actions, cfg = ctx.getConfig();
  const ok = (text, emotion = 'happy') => ({ ok: true, name, text: String(text || 'Done!'), emotion });
  const bad = (text) => ({ ok: false, name, text, emotion: 'surprised' });
  const need = (what) => bad(`Tell me ${what}: /${name} ${COMMANDS.find((c) => c.name === name).args}`);
  if (!name) return bad(`I don't know "/${word}". Type /help for my commands.`);
  switch (name) {
    case 'help': return { ok: true, name, emotion: 'happy', help: true, text: COMMANDS.map((c) => `/${c.name}${c.args ? ' ' + c.args : ''}`).join('  ·  ') };
    case 'timer': {
      const [min, msg] = splitDuration(rest);
      if (min == null || min <= 0) return need('how long');
      if (min > 24 * 60) return bad('Timers go up to 24 hours. For later, use /todo with a time.');
      await a.set_reminder({ minutes: min, message: msg || 'Time is up!' });
      return ok(`Timer set: ${fmtMin(min)}${msg ? ` · "${msg}"` : ''}.`);
    }
    case 'todo': {
      if (!rest) return need('the to-do');
      const m = rest.match(/^(?:at\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s+(.+)$/i) || rest.match(/^(.+?)\s+(?:at\s+)(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)$/i);
      if (m) {
        const [time, text] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
        const r = await a.add_todo({ text, time: time.replace(/\s+/g, ''), remind: true });
        if (!/^I couldn't/.test(r)) return ok(r);
      }
      return ok(await a.add_todo({ text: rest }));
    }
    case 'todos': return ok(await a.list_todos(), 'relaxed');
    case 'done': return rest ? ok(await a.remove_todo({ text: rest })) : need('which to-do');
    case 'note': return rest ? ok(await a.add_note({ title: 'Quick notes', text: rest })) : need('the note');
    case 'notes': ctx.send('notes-toggle'); return ok('Notes & To-do~');
    case 'play': return rest ? ok(await a.spotify_play({ query: rest, type: 'track' })) : ok(await a.spotify_control({ action: 'resume' }));
    case 'pause': return ok(await a.media_control({ action: 'play_pause' }));
    case 'next': return ok(await a.spotify_control({ action: 'next' }));
    case 'prev': return ok(await a.spotify_control({ action: 'previous' }));
    case 'vol': {
      if (/^(up|\+)$/i.test(rest)) return ok(await a.media_control({ action: 'volume_up' }));
      if (/^(down|-)$/i.test(rest)) return ok(await a.media_control({ action: 'volume_down' }));
      const n = Number(String(rest).replace('%', ''));
      if (!rest || !Number.isFinite(n)) return need('a volume');
      return ok(await a.spotify_control({ action: 'volume', volume_percent: Math.max(0, Math.min(100, Math.round(n))) }));
    }
    case 'mute': return ok(await a.media_control({ action: 'mute' }));
    case 'open': return rest ? ok(await a.open_app({ name: rest })) : need('which app');
    case 'close': return rest ? ok(await a.close_app({ name: rest })) : need('which app');
    case 'google': return rest ? ok(await a.search_web({ query: rest, site: 'google' })) : need('what to search');
    case 'yt': return rest ? ok(await a.search_web({ query: rest, site: 'youtube' })) : need('what to search');
    case 'web': return rest ? ok(await a.open_website({ url: rest })) : need('which site');
    case 'party': return ok(await a.high_forever({ on: ctx.partyKind() !== 'party' }));
    case 'ride': return ok(await a.in_love_with_myself({ on: ctx.partyKind() !== 'ride' }));
    case 'tv': ctx.send('action', 'tv_toggle'); return ok(cfg.tvMode ? 'Stepping out of the TV!' : 'Jumping into the TV~');
    case 'walker': { const was = !!cfg.windowWalker; ctx.setConfig({ windowWalker: !was }); return ok(was ? "Okay, I'll stop sitting on your windows." : "I'll hang out on your window~"); }
    case 'chill': ctx.send('action', 'chill'); return ok('Chill mode~', 'relaxed');
    case 'd': if (cfg.dOut && ctx.partyKind() === 'ride') return bad("D is driving! Stop the ride first.");
      { const was = !!cfg.dOut; ctx.setConfig({ dOut: !was }); return ok(was ? 'Bye D!' : 'D, come here!'); }
    case 'zap': ctx.send('action', cfg.dOut ? 'duo_charge' : 'charge'); return ok('Power up!');
    case 'teleport': ctx.send('action', 'teleport'); return ok('Zip!');
    case 'voice': {
      const on = /^(on|1|yes)$/i.test(rest) ? true : /^(off|0|no)$/i.test(rest) ? false : !cfg.voiceEnabled;
      ctx.setConfig({ voiceEnabled: on });
      return ok(on ? "I'll talk out loud." : "Okay, I'll stay quiet (text only).");
    }
    case 'clear': ctx.clearHistory(); return ok('Chat memory wiped. Fresh start!');
    case 'powershell': ctx.openTerminal('powershell'); return ok('PowerShell, my style~ Type /capri in there if you need me.');
    case 'cmd': ctx.openTerminal('cmd'); return ok('CMD, my style~ Type /capri in there if you need me.');
    case 'settings': ctx.openSettings(); return ok('Opening Settings.');
    default: return bad(`I don't know "/${word}".`);
  }
}

module.exports = { COMMANDS, ALIASES, runCommand, parseDuration, splitDuration, resolve };
