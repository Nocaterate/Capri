// Capri as a Discord bot. Runs inside the Capri app while it's open.
//  - replies when @mentioned, when someone replies to her, and in DMs (per-channel memory)
//  - anyone can chat; only the owner (you) can make her control the PC (Spotify, apps, media, reminders)
//  - slash commands: /ask /play /music /nowplaying /zap /join /leave /say
//  - voice: /join and she speaks her replies in the voice channel, in her own voice
//  - the desktop Capri shows what's happening on Discord
const fs = require('fs');
const { Readable } = require('stream');
const {
  Client, GatewayIntentBits, Partials, Events, ActivityType, PermissionsBitField, SlashCommandBuilder, ChannelType,
} = require('discord.js');

const EMOJI = { happy: '⚡', sad: '💧', angry: '💢', surprised: '❗', relaxed: '✨' };
const OWNER_ONLY = 'Only my owner can make me do things on their PC. I can still chat, though! ⚡';
const isHermesCfg = (c) => /:8642(\/|$)/.test(c.apiBaseUrl || '') || c.chatModel === 'hermes-agent';
// turn a failed AI call into a reason a person can act on
function explainBrainError(e, c) {
  const m = `${(e && e.message) || e} ${(e && e.cause && (e.cause.code || e.cause.message)) || ''}`;
  if (isHermesCfg(c) && /ECONNREFUSED|ECONNRESET|fetch failed|socket|terminated|UND_ERR/i.test(m)) {
    return 'Hermes isn\'t running on the PC, so my brain is offline. Start Hermes, or untick "Capri talks through Hermes" in Capri → Settings → Hermes Agent.';
  }
  if (!c.apiKey && !/localhost|127\.0\.0\.1/.test(c.apiBaseUrl || '')) return 'I have no AI key yet. Add one in Capri → Settings → AI brain.';
  if (/^401|invalid.{0,20}key|unauthori[sz]ed|authentication/i.test(m)) return 'My AI key was rejected. Check it in Capri → Settings → AI brain.';
  if (/^429|rate.?limit|quota|too many/i.test(m)) return "I've hit my AI's usage limit. Give me a minute and try again!";
  if (/^404|model.{0,40}(not|does not|doesn't) exist|not found/i.test(m)) return `My AI model (${c.chatModel}) wasn't found. Pick another one in Capri → Settings → AI brain.`;
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed/i.test(m)) return "I can't reach my AI service right now. Is the PC's internet okay?";
  return `My AI service said: ${String(m).trim().slice(0, 200)}`;
}
const clip = (s, n = 1900) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

const COMMANDS = [
  new SlashCommandBuilder().setName('ask').setDescription('Ask Capri anything')
    .addStringOption((o) => o.setName('question').setDescription('What do you want to ask?').setRequired(true)),
  new SlashCommandBuilder().setName('play').setDescription("Play a song on the owner's PC (owner only)")
    .addStringOption((o) => o.setName('song').setDescription('Song, artist or playlist').setRequired(true)),
  new SlashCommandBuilder().setName('music').setDescription('Control the music on the PC (owner only)')
    .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true).addChoices(
      { name: 'pause', value: 'pause' }, { name: 'resume', value: 'resume' },
      { name: 'next', value: 'next' }, { name: 'previous', value: 'previous' })),
  new SlashCommandBuilder().setName('nowplaying').setDescription("What's playing on the PC (owner only)"),
  new SlashCommandBuilder().setName('zap').setDescription('Make desktop Capri power up ⚡'),
  new SlashCommandBuilder().setName('join').setDescription('Capri joins your voice channel and speaks her replies'),
  new SlashCommandBuilder().setName('leave').setDescription('Capri leaves the voice channel'),
  new SlashCommandBuilder().setName('owner').setDescription("Who Capri's owner is, and whether that's you"),
  new SlashCommandBuilder().setName('say').setDescription('Make Capri say something out loud (owner only)')
    .addStringOption((o) => o.setName('text').setDescription('What she says').setRequired(true)),
].map((c) => c.toJSON());

const INVITE_PERMS = new PermissionsBitField([
  'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ReadMessageHistory', 'AddReactions', 'EmbedLinks', 'Connect', 'Speak',
]).bitfield.toString();

function createBot({ getConfig, setConfig, brain, actions, tts, decodeToPcm, onDesktop, onState, log, avatarPath, readyTimeoutMs = 45000 }) {
  let client = null;
  let state = { state: 'off', message: 'Not running.' };
  let readyTimer = null;
  const setState = (next) => { state = next; log('discord state', state.state, state.message); try { if (onState) onState(state); } catch { /* ui gone */ } };
  let ownerId = null;
  const histories = new Map(); // channelId -> chat history
  const cooldown = new Map(); // userId -> time
  const voices = new Map(); // guildId -> { connection, player, queue }
  let voiceLib = null;
  const v = () => (voiceLib = voiceLib || require('@discordjs/voice'));

  let appOwnerName = '';
  // Owners from Settings: Discord usernames (@handle) and/or user IDs, separated by commas.
  // Empty = the account that owns the bot app. A username is locked to the first account seen with it,
  // so if you change your handle and someone else takes it later, they still aren't the owner.
  function ownerEntries() {
    return String(getConfig().discordOwnerId || '').split(/[,\s]+/).map((t) => t.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  }
  function isOwner(user) {
    if (!user || !user.id) return false;
    const entries = ownerEntries();
    if (!entries.length) {
      if (!ownerId) lookupAppOwner();
      return !!ownerId && user.id === ownerId;
    }
    const locks = getConfig().discordOwnerLocks || {};
    for (const e of entries) {
      if (/^\d{15,22}$/.test(e)) { if (user.id === e) return true; continue; }
      if (locks[e]) { if (user.id === locks[e]) return true; continue; }
      if (String(user.username || '').toLowerCase() === e && !user.bot) {
        setConfig({ discordOwnerLocks: { ...locks, [e]: user.id } });
        log('discord owner', `@${e}`, 'is', user.id);
        return true;
      }
    }
    return false;
  }
  let lookingUp = null;
  function lookupAppOwner() {
    if (lookingUp || !client || !client.application) return lookingUp;
    lookingUp = client.application.fetch().then((app) => {
      ownerId = app.owner && (app.owner.ownerId || app.owner.id); // a Team has ownerId
      const ou = app.owner && (app.owner.owner ? app.owner.owner.user : app.owner);
      appOwnerName = (ou && ou.username) || '';
      log('discord app owner', appOwnerName, ownerId);
    }).catch((e) => log('discord: could not look up the bot owner', e.message)).finally(() => { lookingUp = null; });
    return lookingUp;
  }
  function ownerLabel() {
    const entries = ownerEntries();
    if (!entries.length) return appOwnerName ? `@${appOwnerName} (owns the bot app)` : 'the account that owns the bot app';
    return entries.map((e) => (/^\d+$/.test(e) ? `ID ${e}` : `@${e}`)).join(', ');
  }

  // ------------------------------------------------------------ brain
  async function ask({ user, name, channelId, where, text }) {
    const cfg0 = getConfig();
    const owner = isOwner(user);
    let cfg = cfg0;
    if (!owner && cfg0.hermesBrain) {
      // never let other people reach Hermes: it can run commands on the PC
      if (!cfg0.hermesPrevBrain || !cfg0.hermesPrevBrain.apiKey) {
        log('discord: Capri talks through Hermes and has no other AI key, so only the owner can chat');
        return { text: 'My brain is busy with my owner right now. Try again later! ⚡', emotion: 'relaxed' };
      }
      cfg = { ...cfg0, ...cfg0.hermesPrevBrain };
    }
    const history = histories.get(channelId) || [];
    const context = [
      `This conversation is on Discord (${where}), in text chat. Keep replies short and natural; an emoji now and then is fine.`,
      owner
        ? `${name} (Discord @${user.username}) is your owner: the very same person you talk to on the desktop${cfg0.userName ? ` (${cfg0.userName})` : ''}, just messaging you from Discord, maybe on their phone or another device. There is no other owner; never talk about your owner as someone else.`
        : `${name} (Discord @${user && user.username}) is talking to you. They are not your owner${cfg0.userName ? ` (${cfg0.userName})` : ''}.`,
      owner ? '' : 'You cannot control the PC for this person (no music, apps, reminders). If they ask, say only your owner can.',
    ].filter(Boolean).join(' ');
    const extra = { context, noTools: !owner, discord: true, sessionKey: 'capri-discord' };
    let res;
    try {
      res = await brain.chat(cfg, history, `${name}: ${text}`, owner ? actions : {}, extra);
    } catch (e) {
      log('discord brain error', cfg.chatModel, e.message, (e.cause && (e.cause.code || e.cause.message)) || '');
      // Hermes not answering: use her normal brain instead, if she has one
      const prev = cfg0.hermesPrevBrain;
      if (isHermesCfg(cfg) && prev && prev.apiKey) {
        log('discord: Hermes failed, using the normal brain');
        try {
          res = await brain.chat({ ...cfg0, ...prev }, history, `${name}: ${text}`, owner ? actions : {}, extra);
        } catch (e2) {
          log('discord brain error (fallback)', e2.message);
          e2.capriReason = explainBrainError(e2, { ...cfg0, ...prev });
          throw e2;
        }
      } else {
        e.capriReason = explainBrainError(e, cfg);
        throw e;
      }
    }
    histories.set(channelId, res.history.slice(-16));
    return res;
  }

  // ------------------------------------------------------------ voice
  async function speak(guildId, text) {
    const vc = voices.get(guildId);
    if (!vc || !text) return;
    vc.queue = vc.queue.then(async () => {
      try {
        const spoken = String(text).replace(/<a?:\w+:\d+>/g, '').replace(/```[\s\S]*?```/g, ' (code) ').replace(/[*_`#>~|]/g, '').replace(/https?:\/\/\S+/g, 'a link').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
        if (!spoken) return;
        const mp3 = await tts.synthesize(spoken, getConfig());
        if (!mp3) return;
        const pcm = await decodeToPcm(mp3); // 48 kHz, stereo, 16-bit little-endian
        const { createAudioResource, StreamType, AudioPlayerStatus, entersState } = v();
        vc.player.play(createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw }));
        const ms = (pcm.length / (48000 * 4)) * 1000;
        await entersState(vc.player, AudioPlayerStatus.Playing, 5000).catch(() => {});
        await entersState(vc.player, AudioPlayerStatus.Idle, ms + 15000).catch(() => {});
      } catch (e) {
        log('discord voice: could not speak', e.message);
      }
    });
    return vc.queue;
  }

  async function joinVoice(member) {
    const ch = member && member.voice && member.voice.channel;
    if (!ch) return 'Join a voice channel first, then use /join.';
    const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus, NoSubscriberBehavior } = v();
    leaveVoice(ch.guild.id);
    const connection = joinVoiceChannel({ channelId: ch.id, guildId: ch.guild.id, adapterCreator: ch.guild.voiceAdapterCreator, selfDeaf: true });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    } catch (e) {
      connection.destroy();
      return "I couldn't connect to that voice channel. Check I have the Connect and Speak permissions there.";
    }
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);
    connection.on(VoiceConnectionStatus.Disconnected, () => leaveVoice(ch.guild.id));
    voices.set(ch.guild.id, { connection, player, queue: Promise.resolve(), channelId: ch.id });
    speak(ch.guild.id, 'Hi everyone! Capri is here, fully charged.');
    return `Joined **${ch.name}**! I'll speak my replies here. ⚡`;
  }
  function leaveVoice(guildId) {
    const vc = voices.get(guildId);
    if (!vc) return false;
    voices.delete(guildId);
    try { vc.player.stop(true); } catch { /* stopped */ }
    try { vc.connection.destroy(); } catch { /* gone */ }
    return true;
  }

  // ------------------------------------------------------------ handlers
  async function onMessage(m) {
    if (m.author.bot || !client || !client.user) return;
    const dm = !m.guild;
    const mentioned = m.mentions.users.has(client.user.id);
    let replyToMe = false;
    if (!dm && !mentioned && m.reference && m.reference.messageId) {
      try { replyToMe = (await m.fetchReference()).author.id === client.user.id; } catch { /* deleted */ }
    }
    if (!dm && !mentioned && !replyToMe) return;
    const now = Date.now();
    if (now - (cooldown.get(m.author.id) || 0) < 2500) return;
    cooldown.set(m.author.id, now);

    const text = m.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim() || 'hi!';
    const name = (m.member && m.member.displayName) || m.author.globalName || m.author.username;
    const where = dm ? 'a direct message' : `#${m.channel.name} on ${m.guild.name}`;
    try { await m.channel.sendTyping(); } catch { /* no permission */ }
    let res;
    try {
      res = await ask({ user: m.author, name, channelId: m.channel.id, where, text });
    } catch (e) {
      res = { text: failText(e, m.author), emotion: 'sad' };
    }
    await m.reply({ content: clip(res.text), allowedMentions: { parse: [], repliedUser: false } }).catch((e) => log('discord reply failed', e.message));
    if (EMOJI[res.emotion]) m.react(EMOJI[res.emotion]).catch(() => {});
    if (getConfig().discordDesktop !== false) onDesktop({ who: name, where, text, reply: res.text, emotion: res.emotion, actions: res.actionsDone || [] });
    if (m.guild) speak(m.guild.id, res.text);
  }

  function failText(e, user) {
    if (isOwner(user) && e && e.capriReason) return `Bzzt! ${e.capriReason}`;
    return 'Bzzt, small short circuit on my side. Try again in a moment!';
  }

  async function onCommand(i) {
    if (!i.isChatInputCommand()) return;
    const owner = isOwner(i.user);
    const name = (i.member && i.member.displayName) || i.user.globalName || i.user.username;
    const where = i.guild ? `#${i.channel ? i.channel.name : 'a channel'} on ${i.guild.name}` : 'a direct message';
    const quick = (content, ephemeral = false) => i.reply({ content: clip(content), allowedMentions: { parse: [] }, ...(ephemeral ? { flags: 64 } : {}) });
    const ownerGate = () => { if (owner) return false; quick(`${OWNER_ONLY}\n-# You're @${i.user.username}. My owner is set in Capri → Settings → Discord bot.`, true); return true; };
    try {
      switch (i.commandName) {
        case 'ask': {
          await i.deferReply();
          const q = i.options.getString('question', true);
          const res = await ask({ user: i.user, name, channelId: i.channelId, where, text: q });
          await i.editReply({ content: clip(`> ${q}\n${res.text}`), allowedMentions: { parse: [] } });
          if (getConfig().discordDesktop !== false) onDesktop({ who: name, where, text: q, reply: res.text, emotion: res.emotion, actions: res.actionsDone || [] });
          if (i.guild) speak(i.guild.id, res.text);
          break;
        }
        case 'play': {
          if (ownerGate()) return;
          await i.deferReply();
          const out = await actions.spotify_play({ query: i.options.getString('song', true), type: 'track' });
          await i.editReply(`🎵 ${out}`);
          onDesktop({ who: name, where, text: `/play ${i.options.getString('song', true)}`, reply: out, emotion: 'happy', actions: [{ name: 'spotify_play' }] });
          break;
        }
        case 'music': {
          if (ownerGate()) return;
          const out = await actions.spotify_control({ action: i.options.getString('action', true) });
          await quick(`🎵 ${out}`);
          break;
        }
        case 'nowplaying': {
          if (ownerGate()) return;
          await i.deferReply();
          await i.editReply(`🎧 ${await actions.spotify_now_playing({})}`);
          break;
        }
        case 'zap': {
          const last = cooldown.get('zap') || 0;
          if (Date.now() - last < 15000) return quick('I need a few seconds to recharge! ⚡', true);
          cooldown.set('zap', Date.now());
          onDesktop({ who: name, where, zap: true });
          await quick(`⚡ **${name}** zapped Capri! She's powering up on the desktop.`);
          break;
        }
        case 'join': {
          if (!i.guild) return quick('Voice only works in servers.', true);
          await i.deferReply();
          await i.editReply(await joinVoice(i.member));
          break;
        }
        case 'leave': {
          await quick(i.guild && leaveVoice(i.guild.id) ? 'Bye! 👋' : "I'm not in a voice channel here.");
          break;
        }
        case 'owner': {
          await quick(owner
            ? `⚡ You're my owner, @${i.user.username}! I'll do anything on your PC for you.`
            : `You're @${i.user.username}, and my owner is ${ownerLabel()}. My owner can change this in Capri → Settings → Discord bot.`, true);
          break;
        }
        case 'say': {
          if (ownerGate()) return;
          const t = i.options.getString('text', true);
          await quick(`🗣️ ${t}`);
          onDesktop({ who: name, where, sayText: t });
          if (i.guild) speak(i.guild.id, t);
          break;
        }
        default: await quick('Unknown command.', true);
      }
    } catch (e) {
      log('discord command error', i.commandName, e.message);
      const msg = e && e.capriReason ? failText(e, i.user) : 'Bzzt, something short-circuited. Try again!';
      if (i.deferred || i.replied) i.editReply(msg).catch(() => {}); else quick(msg, true).catch(() => {});
    }
  }

  // leave voice when nobody else is left in the channel
  function onVoiceState(oldS) {
    const vc = voices.get(oldS.guild.id);
    if (!vc) return;
    const ch = oldS.guild.channels.cache.get(vc.channelId);
    if (ch && ch.type === ChannelType.GuildVoice && ch.members.filter((m) => !m.user.bot).size === 0) leaveVoice(oldS.guild.id);
  }

  // ------------------------------------------------------------ lifecycle
  async function start() {
    await stop();
    const cfg = getConfig();
    if (!cfg.discordEnabled || !cfg.discordToken) { state = { state: 'off', message: 'Off.' }; return state; }
    setState({ state: 'connecting', message: 'Connecting to Discord…' });
    const me = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates],
      partials: [Partials.Channel],
      allowedMentions: { parse: [] },
    });
    client = me;
    const live = () => client === me; // ignore events from an older, stopped client
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (!live() || state.state === 'online') return;
      setState({ state: 'error', message: "Couldn't finish connecting to Discord after 45 seconds. Check your internet, and that a firewall, antivirus or VPN isn't blocking Capri, then click Save & start the bot again." });
      stop();
    }, readyTimeoutMs);
    client.on(Events.ShardDisconnect, () => { if (live() && state.state === 'online') setState({ ...state, state: 'connecting', message: 'Lost connection to Discord, reconnecting…' }); });
    client.on(Events.ShardResume, () => { if (live() && client.user) setState(onlineState(client)); });
    client.on(Events.ShardReady, () => { if (live() && client.user && client.isReady()) setState(onlineState(client)); });
    client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => log('discord message error', e.message)));
    client.on(Events.InteractionCreate, (i) => onCommand(i));
    client.on(Events.VoiceStateUpdate, (o) => onVoiceState(o));
    client.on(Events.Error, (e) => log('discord error', e.message));
    client.once(Events.ClientReady, async (c) => {
      if (!live()) return;
      clearTimeout(readyTimer);
      setState(onlineState(c)); // online right away; the extras below can take a moment
      try {
        await lookupAppOwner();
        await c.application.commands.set(COMMANDS);
      } catch (e) { log('discord setup', e.message); }
      c.user.setPresence({ activities: [{ name: 'your desktop ⚡', type: ActivityType.Watching }], status: 'online' });
      if (!getConfig().discordAvatarSet && avatarPath) {
        c.user.setAvatar(fs.readFileSync(avatarPath)).then(() => setConfig({ discordAvatarSet: true })).catch((e) => log('discord avatar', e.message));
      }
      if (live()) setState(onlineState(c));
      log('discord owner', ownerLabel());
    });
    client.on(Events.GuildCreate, () => { if (live() && client.isReady()) setState(onlineState(client)); });
    client.on(Events.GuildDelete, () => { if (live() && client.isReady()) setState(onlineState(client)); });
    try {
      await client.login(cfg.discordToken.trim());
    } catch (e) {
      const msg = /disallowed intents/i.test(e.message)
        ? 'Turn on "Message Content Intent" for your bot (Developer Portal → Bot → Privileged Gateway Intents), then Save again.'
        : /token/i.test(e.message) || e.code === 'TokenInvalid' ? 'That bot token is wrong. Copy it again from Developer Portal → Bot → Reset Token.'
          : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(e.message) ? "Couldn't reach Discord. Check your internet connection, then try again." : e.message;
      log('discord login failed', e.message);
      clearTimeout(readyTimer);
      if (live()) {
        try { client.destroy(); } catch { /* not connected */ }
        client = null;
        setState({ state: 'error', message: msg });
      }
    }
    return state;
  }

  function onlineState(c) {
    return {
      state: 'online', message: `Online as ${c.user.tag}`, tag: c.user.tag, guilds: c.guilds.cache.size,
      owner: ownerLabel(),
      invite: `https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot%20applications.commands&permissions=${INVITE_PERMS}`,
    };
  }

  async function stop() {
    clearTimeout(readyTimer);
    for (const id of [...voices.keys()]) leaveVoice(id);
    const c = client;
    client = null;
    if (c) { try { await c.destroy(); } catch { /* already gone */ } }
    if (state.state !== 'error') setState({ state: 'off', message: 'Off.' });
  }

  return { start, stop, status: () => (state.state === 'online' ? { ...state, owner: ownerLabel() } : state), ownerLabel, _test: { onMessage, onCommand, ask, isOwner, setOwner: (id) => { ownerId = id; }, setClient: (c) => { client = c; } } };
}

module.exports = { createBot, COMMANDS };
