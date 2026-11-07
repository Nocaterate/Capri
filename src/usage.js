// Usage & cost meter: every AI reply reports how many tokens it used; this adds them up per brain per day
// (in <userData>/usage.json, 62 days kept) for the Settings panel. Prices are typed by the user per brain
// (US$ per million input / output tokens). An optional daily limit stops her *automatic* AI lines (activity
// remarks) for the rest of the day; chatting with her keeps working.
const fs = require('fs');

function brainOf(url) {
  let host = '';
  try { const u = new URL(url); host = u.host; } catch { return 'Other'; }
  if (/^(127\.0\.0\.1|localhost):8642$/.test(host)) return 'Hermes';
  if (/deepseek/.test(host)) return 'DeepSeek';
  if (/groq/.test(host)) return 'Groq';
  if (/generativelanguage\.googleapis|gemini/.test(host)) return 'Gemini';
  if (/openrouter/.test(host)) return 'OpenRouter';
  if (/anthropic/.test(host)) return 'Claude';
  if (/openai\.com/.test(host)) return 'OpenAI';
  if (/(127\.0\.0\.1|localhost):11434/.test(host)) return 'Ollama';
  return host || 'Other';
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function createUsage({ file, getConfig, log = () => {}, onLimit = () => {} }) {
  let data = { days: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.days) data = j; } catch { /* first run */ }
  let saveTimer = null, limitSaidFor = '';
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keep = Object.keys(data.days).sort().slice(-62);
      data.days = Object.fromEntries(keep.map((k) => [k, data.days[k]]));
      try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { log('usage save failed:', e.message); }
    }, 3000);
  };

  function add(url, model, usage) {
    if (!usage) return;
    const inp = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
    const out = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
    if (!inp && !out) return;
    const b = brainOf(url), k = dayKey();
    const day = (data.days[k] = data.days[k] || {});
    const row = (day[b] = day[b] || { in: 0, out: 0, calls: 0 });
    row.in += inp; row.out += out; row.calls += 1;
    save();
    const cfg = getConfig();
    if (cfg.usageLimitOn && totalOf(day) >= (Number(cfg.usageLimit) || 0) && limitSaidFor !== k) { limitSaidFor = k; onLimit(totalOf(day)); }
  }
  const totalOf = (day) => Object.values(day || {}).reduce((a, r) => a + r.in + r.out, 0);
  function cost(brain, r, prices) {
    const p = prices && prices[brain];
    if (!p || (!Number(p.in) && !Number(p.out))) return null;
    return (r.in / 1e6) * (Number(p.in) || 0) + (r.out / 1e6) * (Number(p.out) || 0);
  }
  function sumRows(days) {
    const by = {};
    for (const day of days) for (const [b, r] of Object.entries(day || {})) {
      const t = (by[b] = by[b] || { in: 0, out: 0, calls: 0 });
      t.in += r.in; t.out += r.out; t.calls += r.calls;
    }
    return by;
  }
  function summary() {
    const cfg = getConfig(), prices = cfg.usagePrices || {};
    const now = new Date(), today = dayKey(now), month = today.slice(0, 7);
    const pack = (by) => {
      const brains = Object.entries(by).map(([name, r]) => ({ name, ...r, total: r.in + r.out, cost: cost(name, r, prices) }))
        .sort((a, b) => b.total - a.total);
      const total = brains.reduce((a, r) => a + r.total, 0);
      const costs = brains.map((r) => r.cost);
      return { total, brains, cost: costs.some((c) => c != null) ? costs.reduce((a, c) => a + (c || 0), 0) : null };
    };
    const last7 = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); const k = dayKey(d); last7.push({ date: k, total: totalOf(data.days[k]) }); }
    const seen = [...new Set(Object.values(data.days).flatMap((d) => Object.keys(d || {})))];
    return {
      today: pack(sumRows([data.days[today]])),
      month: pack(sumRows(Object.entries(data.days).filter(([k]) => k.startsWith(month)).map(([, v]) => v))),
      last7, brains: seen, prices, limitOn: !!cfg.usageLimitOn, limit: Number(cfg.usageLimit) || 0,
    };
  }
  const overLimit = () => { const cfg = getConfig(); return !!cfg.usageLimitOn && totalOf(data.days[dayKey()]) >= (Number(cfg.usageLimit) || 0); };
  return { add, summary, overLimit, _data: () => data };
}

module.exports = { createUsage, brainOf, dayKey };
