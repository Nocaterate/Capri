// Capri's tool server for Hermes Agent (or any MCP client).
// A small MCP server (Streamable HTTP transport, JSON responses) on this computer only.
// Every request needs `Authorization: Bearer <token>`; browsers are refused (Origin header),
// so web pages can't drive Capri. Hermes registers the tools as mcp_capri_<name>.
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const EXTRA_TOOLS = [
  {
    name: 'say',
    description: 'Make Capri (the pixel-art girl on the user\'s Windows desktop) say something out loud in her voice, with a speech bubble. Use it to talk to the user on their PC, e.g. to announce something or reply when they are at the computer.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What she says. Keep it short and natural, no markdown.' },
        emotion: { type: 'string', enum: ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'react',
    description: 'Make Capri do an animation on the desktop: power_up (electric charge-up), teleport, dash, many_eyes (her mask fills with eyes), glitch, or back_to_corner.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['power_up', 'teleport', 'dash', 'many_eyes', 'glitch', 'back_to_corner'] } },
      required: ['action'],
    },
  },
];

function start({ port, token, tools, actions, onSay, onReact, onToolUsed, log }) {
  const toolList = [
    ...EXTRA_TOOLS,
    ...tools.map((t) => ({
      name: t.function.name,
      description: `${t.function.description} (Runs on the user's Windows PC through Capri.)`,
      inputSchema: t.function.parameters || { type: 'object', properties: {} },
    })),
  ];
  const tokenBuf = Buffer.from(String(token));
  const authed = (req) => {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return false;
    const got = Buffer.from(m[1].trim());
    return got.length === tokenBuf.length && crypto.timingSafeEqual(got, tokenBuf);
  };

  async function callTool(name, args) {
    if (name === 'say') {
      const text = String(args.text || '').trim();
      if (!text) return 'Nothing to say.';
      onSay(text, args.emotion || 'neutral');
      return `Capri said: "${text}"`;
    }
    if (name === 'react') {
      const map = { power_up: 'charge', teleport: 'teleport', dash: 'dash', many_eyes: 'many_eyes', glitch: 'glitch', back_to_corner: 'recenter' };
      if (!map[args.action]) return `Unknown action "${args.action}".`;
      onReact(map[args.action]);
      return `Capri did: ${args.action.replace(/_/g, ' ')}.`;
    }
    const fn = actions[name];
    if (!fn) throw new Error(`Unknown tool "${name}".`);
    onToolUsed(name);
    return String((await fn(args || {})) ?? 'Done.');
  }

  async function handle(msg) {
    const { id, method, params } = msg || {};
    const isNote = id === undefined || id === null;
    const ok = (result) => (isNote ? null : { jsonrpc: '2.0', id, result });
    const fail = (code, message) => (isNote ? null : { jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (method) {
        case 'initialize': {
          const want = params && params.protocolVersion;
          return ok({
            protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'capri', title: 'Capri desktop companion', version: '1.0.0' },
            instructions: 'These tools act on the user\'s Windows PC through Capri, their pixel-art desktop companion. ' +
              'Use spotify_play to play music (it opens the exact song in the Spotify app), open_app / close_app for apps, ' +
              'set_reminder for reminders on the PC, and say / react to talk or animate on their desktop.',
          });
        }
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: toolList });
        case 'tools/call': {
          const name = params && params.name;
          const args = (params && params.arguments) || {};
          log('hermes ->', name, args);
          try {
            const text = await callTool(name, args);
            log('hermes <-', name, text);
            return ok({ content: [{ type: 'text', text }], isError: false });
          } catch (e) {
            log('hermes <- error', name, e.message);
            return ok({ content: [{ type: 'text', text: `Failed: ${e.message}` }], isError: true });
          }
        }
        default:
          if (String(method || '').startsWith('notifications/')) return null;
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (e) {
      return fail(-32603, e.message);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.headers.origin) { res.writeHead(403); res.end(); return; } // no browsers
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'capri' }));
      return;
    }
    if (url.pathname !== '/mcp') { res.writeHead(404); res.end(); return; }
    if (!authed(req)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST, DELETE' }); res.end(); return; } // no server-sent stream
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      const batch = Array.isArray(msg);
      const out = (await Promise.all((batch ? msg : [msg]).map(handle))).filter(Boolean);
      const headers = { 'Content-Type': 'application/json' };
      if (!batch && msg && msg.method === 'initialize') headers['Mcp-Session-Id'] = crypto.randomUUID();
      if (!out.length) { res.writeHead(202, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(JSON.stringify(batch ? out : out[0]));
    });
  });

  // Loopback always (works with WSL mirrored networking). Also the WSL virtual adapter if there is one,
  // so Hermes in WSL's default NAT mode can reach Capri at the Windows host address.
  const hosts = ['127.0.0.1'];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!/wsl/i.test(name)) continue;
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) hosts.push(a.address);
  }
  const servers = hosts.map((host) => {
    const s = host === '127.0.0.1' ? server : http.createServer((req, res) => server.emit('request', req, res));
    s.on('error', (e) => log('mcp server', host, e.code || e.message));
    s.listen(port, host, () => log('mcp server listening on', `http://${host}:${port}/mcp`));
    return s;
  });
  return {
    hosts,
    toolCount: toolList.length,
    close: () => servers.forEach((s) => { try { s.close(); } catch { /* already closed */ } }),
  };
}

module.exports = { start };
