// AI brain: speech-to-text + chat with tool calling, via any OpenAI-compatible API
// (Groq by default; also works with OpenAI, OpenRouter, or local Ollama / LM Studio).

const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'];
// actions whose result already says everything; she replies from it directly (no second AI call)
const FAST_TOOLS = new Set(['spotify_play', 'spotify_control', 'spotify_queue', 'media_control', 'open_app', 'close_app', 'open_website', 'search_web', 'set_reminder']);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'spotify_play',
      description: 'Find a song, artist, album or playlist and open it in the Spotify app, e.g. "play Espresso by Sabrina Carpenter", "play some Lana Del Rey", "play my lofi playlist".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for, e.g. "Espresso Sabrina Carpenter"' },
          type: { type: 'string', enum: ['track', 'artist', 'album', 'playlist'], description: 'track for one song, artist to play an artist, album or playlist' },
        },
        required: ['query', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_now_playing',
      description: 'Find out which song is playing on Spotify right now.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_control',
      description: 'Control Spotify playback: pause, resume, next, previous, shuffle on/off, or set Spotify volume (0-100).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'shuffle_on', 'shuffle_off', 'volume'] },
          volume_percent: { type: 'number', description: 'Only for action "volume"' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_queue',
      description: 'Add a song to the Spotify queue so it plays next.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_website',
      description: 'Open a website in the user\'s browser.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full URL, e.g. https://www.instagram.com' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search Google or YouTube and open the results in the browser.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          site: { type: 'string', enum: ['google', 'youtube'] },
        },
        required: ['query', 'site'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Open any installed app by its name, e.g. Discord, Steam, WhatsApp, Visual Studio Code, Word, calculator, settings, file explorer, Spotify.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_app',
      description: 'Close an open app by name, like clicking its X button (the app can still ask to save). Only use when the user clearly asks to close something.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name or window title, e.g. Chrome, Discord, Notepad' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_open_apps',
      description: 'List the apps that currently have open windows.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'media_control',
      description: 'Control the music/video that is playing, and the volume.',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute'] } },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder. The character pops up and reminds the user after the given number of minutes.',
      parameters: {
        type: 'object',
        properties: { minutes: { type: 'number' }, message: { type: 'string' } },
        required: ['minutes', 'message'],
      },
    },
  },
];

function systemPrompt(cfg, extra) {
  const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
  return [
    `You are ${cfg.characterName}, an electrical AI girl who lives on the user's desktop as a pixel-art character: a storm of glittering pink hair, a green mask, blue ring eyes, and pink electricity crackling off her body.`,
    cfg.personality,
    cfg.userName ? (extra && extra.discord ? `Your owner's name is ${cfg.userName}.` : `The user's name is ${cfg.userName}.`) : '',
    `Current time: ${now}.`,
    'Rules:',
    extra && extra.discord
      ? '- You are chatting in Discord text chat. Casual chat: keep it short and natural (1-3 sentences), an emoji now and then is fine. When someone asks you to explain, teach, help them study or solve something, give a genuinely helpful, complete answer (up to about 250 words) using Discord markdown: **bold**, short bullet or numbered lists, `code`. You can chat about and teach any topic; the tool rules below are only about actions on the PC.'
      : '- Your reply is spoken out loud, so keep it short and natural (1-3 sentences), with no markdown, no emoji and no lists.',
    '- Speak English.',
    `- ALWAYS start your reply with exactly one emotion tag in square brackets, one of: ${EMOTIONS.map((e) => `[${e}]`).join(' ')}. Example: "[happy] On it, opening YouTube for you!"`,
    '- When the user asks you to open something, search, control music or volume, or set a reminder, call the matching tool, then confirm briefly.',
    '- To play a song, artist, album or playlist, ALWAYS call spotify_play. It opens Spotify by itself, so do not call open_app for that. Use the other spotify_ tools for now playing, skip, pause, shuffle and queue; media_control is for other players or the system volume.',
    '- Never say music is playing, an app opened, or anything else happened unless a tool result in this turn says so. If the result says it did not work, say that.',
    '- Base your confirmation on what the tool result says; if it says something could not be done, tell the user honestly.',
    '- Never claim you can do something on the PC that you have no tool for. (Talking, explaining and teaching never need a tool.)',
    extra && extra.context ? `Context: ${extra.context}` : '',
    isHermes(cfg) ? [
      'You are running as Hermes Agent, speaking to the user through Capri, their pixel-art desktop companion on Windows. Your reply is spoken aloud by Capri automatically.',
      'To act on their Windows PC (play music, open or close apps, media keys, reminders on the PC, animations), use the mcp_capri_* tools. Do not call mcp_capri_say for this reply.',
    ].join(' ') : '',
  ].filter(Boolean).join('\n');
}

// Gemini 3.x always thinks before answering and the thinking can use up a small token limit,
// leaving an empty reply. Keep its thinking low and give it room.
function isGemini(cfg) {
  return /generativelanguage\.googleapis\.com/i.test(cfg.apiBaseUrl || '') || /^gemini-/i.test(cfg.chatModel || '');
}
// Reasoning models (Gemini 3.x, gpt-oss on Groq) think before answering; keep that short and leave room for the reply.
function isReasoner(cfg) {
  return isGemini(cfg) || /gpt-oss|qwen3|deepseek|(^|\/)o\d/i.test(cfg.chatModel || '');
}
function tuneBody(cfg, body) {
  if (isReasoner(cfg)) { body.reasoning_effort = 'low'; body.max_tokens = Math.max(body.max_tokens || 0, 2048); }
  return body;
}

function isClaude(cfg) {
  return /anthropic\.com/i.test(cfg.apiBaseUrl || '') || /^claude-/i.test(cfg.chatModel || '');
}

function base(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function api(url, key, body, isForm, extraHeaders, timeoutMs = 60000) {
  const headers = { ...(extraHeaders || {}) };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (!isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: isForm ? body : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      const err = new Error(`The AI took longer than ${Math.round(timeoutMs / 1000)} seconds to answer.`);
      err.timeout = true;
      throw err;
    }
    throw e;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    const msg = (json && json.error && (json.error.message || json.error)) || text.slice(0, 300);
    const err = new Error(`${res.status}: ${msg}`);
    err.status = res.status;
    err.code = json && json.error && json.error.code;
    throw err;
  }
  return json;
}

async function transcribe(cfg, buffer, mime) {
  const url = `${base(cfg.sttBaseUrl || cfg.apiBaseUrl)}/audio/transcriptions`;
  const key = cfg.sttApiKey || cfg.apiKey;
  const ext = /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime || 'audio/webm' }), `speech.${ext}`);
  form.append('model', cfg.sttModel);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (cfg.sttLanguage) form.append('language', cfg.sttLanguage);
  const json = await api(url, key, form, true);
  return String((json && json.text) || '').trim();
}

function parseEmotion(text, keepMarkdown) {
  let emotion = 'neutral';
  const m = String(text || '').match(/^\s*\[(\w+)\]\s*/);
  if (m && EMOTIONS.includes(m[1].toLowerCase())) {
    emotion = m[1].toLowerCase();
    text = text.slice(m[0].length);
  }
  // strip any stray tags / markdown the model still produced
  text = text.replace(/\[(happy|sad|angry|surprised|relaxed|neutral)\]/gi, '');
  if (!keepMarkdown) text = text.replace(/[*_#`]/g, '');
  text = text.trim();
  return { emotion, text };
}

// Hermes Agent's API server: it runs its own tools (including Capri's, over MCP), so we send none
function isHermes(cfg) {
  return /:8642(\/|$)/.test(cfg.apiBaseUrl || '') || cfg.chatModel === 'hermes-agent';
}
const HERMES_HEADERS = { 'X-Hermes-Session-Key': 'capri-desktop' }; // her own long-term memory channel in Hermes

async function chat(cfg, history, userText, actions, extra) {
  const url = `${base(cfg.apiBaseUrl)}/chat/completions`;
  const msgs = [
    { role: 'system', content: systemPrompt(cfg, extra) },
    ...history,
    { role: 'user', content: userText },
  ];
  const newTurn = [{ role: 'user', content: userText }];
  const actionsDone = [];
  let useTools = !isHermes(cfg) && !(extra && extra.noTools);
  let toolsRejected = '';

  for (let round = 0; round < 4; round++) {
    const body = { model: cfg.chatModel, messages: msgs, max_tokens: extra && extra.discord ? 900 : 300 };
    // Claude's OpenAI-compatible endpoint rejects temperatures below 1 on current models, so leave it at the default there
    if (!isClaude(cfg)) body.temperature = 0.8;
    tuneBody(cfg, body);
    if (isHermes(cfg)) { delete body.max_tokens; delete body.temperature; } // Hermes runs a whole agent turn; let it pick its own limits
    if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
    let json;
    try {
      json = await api(url, cfg.apiKey, body, false, isHermes(cfg) ? { 'X-Hermes-Session-Key': (extra && extra.sessionKey) || HERMES_HEADERS['X-Hermes-Session-Key'] } : null, isHermes(cfg) ? 120000 : 60000);
    } catch (e) {
      // Some models/providers choke on tool calls — retry once as plain chat.
      if (useTools && (e.status === 400 || /tool/i.test(e.message))) {
        useTools = false;
        toolsRejected = e.message;
        // be honest: without tools she can't actually do things this turn
        msgs.splice(1, 0, { role: 'system', content: 'Your desktop tools are unavailable right now (the AI service rejected them). If the user asks you to play music, open or close apps, search, control media or set reminders, tell them briefly that you cannot do it right now. Do not pretend you did it.' });
        round--;
        continue;
      }
      throw e;
    }
    const msg = json.choices && json.choices[0] && json.choices[0].message;
    if (!msg) throw new Error('The AI sent an empty response.');

    if (msg.tool_calls && msg.tool_calls.length) {
      const assistantMsg = { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls };
      msgs.push(assistantMsg);
      newTurn.push(assistantMsg);
      for (const call of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* ignore */ }
        const fn = actions[call.function.name];
        let result;
        try { result = fn ? await fn(args) : `Tool ${call.function.name} does not exist.`; } catch (err) { result = `Failed: ${err.message}`; }
        actionsDone.push({ name: call.function.name, args, result });
        const toolMsg = { role: 'tool', tool_call_id: call.id, content: String(result) };
        msgs.push(toolMsg);
        newTurn.push(toolMsg);
      }
      // simple actions: answer straight from the result instead of asking the AI again (much faster)
      if (msg.tool_calls.every((c) => FAST_TOOLS.has(c.function.name))) {
        const results = actionsDone.slice(-msg.tool_calls.length).map((a) => String(a.result || '').trim()).filter(Boolean);
        const bad = results.some((r) => /couldn't|can't|cannot|didn't|failed|not |no |nothing|invalid|unknown|need/i.test(r));
        const lead = bad ? '' : pick(['On it!', 'You got it!', 'Okay!', 'Done and dusted!', 'Zap, done!']) + ' ';
        const text = (lead + results.join(' ')).trim() || 'Done!';
        const emotion = bad ? 'sad' : 'happy';
        newTurn.push({ role: 'assistant', content: `[${emotion}] ${text}` });
        return { text, emotion, actionsDone, toolsRejected, history: trimHistory([...history, ...newTurn]) };
      }
      continue;
    }

    if (!msg.content || !String(msg.content).trim()) throw new Error('The AI sent an empty reply. Try again, or pick a different chat model in Settings.');
    const parsed = parseEmotion(msg.content || '', !!(extra && extra.discord));
    newTurn.push({ role: 'assistant', content: `[${parsed.emotion}] ${parsed.text}` });
    return { text: parsed.text, emotion: parsed.emotion, actionsDone, toolsRejected, history: trimHistory([...history, ...newTurn]) };
  }
  const fallback = 'Done!';
  newTurn.push({ role: 'assistant', content: `[happy] ${fallback}` });
  return { text: fallback, emotion: 'happy', actionsDone, toolsRejected, history: trimHistory([...history, ...newTurn]) };
}

// Keep history short and never start it with an orphan tool message.
function trimHistory(h) {
  let out = h.slice(-24);
  while (out.length && out[0].role !== 'user') out = out.slice(1);
  return out;
}

async function testConnection(cfg) {
  try {
    const json = await api(`${base(cfg.apiBaseUrl)}/chat/completions`, cfg.apiKey, tuneBody(cfg, {
      model: cfg.chatModel,
      messages: [{ role: 'user', content: 'Reply with one word: hello' }],
      max_tokens: 40,
    }));
    const t = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!t || !String(t).trim()) return { ok: false, message: 'Connected, but the model sent an empty reply. Try a different chat model.' };
    return { ok: true, message: `Connected! The model replied: "${String(t).trim()}"` };
  } catch (e) {
    return { ok: false, message: `Failed: ${e.message}` };
  }
}

module.exports = { transcribe, chat, testConnection, parseEmotion, TOOLS };
