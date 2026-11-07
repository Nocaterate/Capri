// "Sit on my window" (Window walker, version 7A "lounging on the title bar"): she flies up in her red electric form to
// the top edge of the window you're using, lands on it and lounges there in her chill pose, floating just above the
// edge (she always levitates). D stands next to her on the edge. Move the window and she drops (red) to the taskbar,
// then floats back up once it's still again. Minimise, maximise or close it (nothing left to sit on) and she just gets
// up and keeps floating where she is. The mouse coming close makes her hop aside.
// Main tells us where the window is (src/walker.js, 'walker-rect': {hwnd, x, y, w, h} in overlay px, or null).
// st.ledge = { y, dSide } while she's on a window (app.js puts D on the edge beside her).
export function initWalker(env) {
  const { st, fx, sfx, tween, cancelTweens, easeIn, easeInOut } = env;
  let rect = null, rectAt = 0, mode = 'off', perch = null, gen = 0, cooldownUntil = 0, lastHop = 0, chillOffAt = 0, hadChill = false;
  let wasDragged = false;
  const fracs = new Map();                       // where along each window's edge she likes to sit

  env.api.onWalkerRect && env.api.onWalkerRect((r) => {
    rect = r && Number.isFinite(r.y) ? r : null;
    rectAt = performance.now();
  });

  const S = () => env.S();
  const H = () => env.dims().H;
  const feetToPosY = (feetY) => H() - feetY - env.HOVER * S();
  // the stretch of the edge she may use: away from the window's ends and its – □ × buttons
  function span(r) {
    const lo = r.x + Math.max(40, 40 * S()), hi = r.x + r.w - Math.max(170, 44 * S());
    return hi > lo ? [lo, hi] : null;
  }
  function spotFor(r) {
    const sp = span(r);
    if (!sp) return null;
    if (!fracs.has(r.hwnd)) fracs.set(r.hwnd, 0.15 + Math.random() * 0.55);
    if (fracs.size > 40) fracs.delete(fracs.keys().next().value);
    return sp[0] + (sp[1] - sp[0]) * fracs.get(r.hwnd);
  }
  // D stands on the roomier side of her
  const dSideFor = (r, x) => (x - r.x > r.x + r.w - x ? -1 : 1);
  const roomAbove = (r) => r.y > 60 * S();      // her lounge pose must fit above the edge
  const blocked = () => !st.visible || st.hideSprite || st.party || st.tv || st.notesOpen || st.drag
    || st.mode === 'dragging' || st.mode === 'teleport' || st.orb;
  const sameRect = (a, b) => a && b && a.hwnd === b.hwnd && Math.abs(a.x - b.x) <= 3 && Math.abs(a.y - b.y) <= 3 && Math.abs(a.w - b.w) <= 6;
  const lounge = () => { if (env.startChill(1e6)) hadChill = true; };   // chill until something wakes her
  const stopLounge = () => { if (st.chill) env.endChill(); hadChill = false; };

  function release(cooldown = 0) {
    gen++;
    cancelTweens(st.pos);
    if (mode === 'perched') stopLounge();
    st.ledge = null; st.peek = null; st.walkerRed = false; st.walkerBusy = false;
    perch = null; mode = 'off';
    cooldownUntil = performance.now() + cooldown;
  }

  async function flyUp(r) {
    const g = ++gen;
    const x = spotFor(r);
    if (x == null || !roomAbove(r)) return;
    mode = 'flying'; st.walkerBusy = true; perch = { ...r };
    st.walk = null;
    st.flip = x >= st.pos.x ? 1 : -1;
    st.walkerRed = true;
    const ty = feetToPosY(r.y - 2 * S());
    const dist = Math.hypot(x - st.pos.x, ty - st.pos.y);
    await tween(st.pos, { x, y: ty }, Math.min(0.9, 0.35 + dist / 2200), easeInOut);
    if (g !== gen) return;
    if (!sameRect(rect, perch)) {                // the window moved (or went) while she flew: go after it, or down
      st.walkerRed = false; mode = 'off'; st.walkerBusy = false;
      if (rect) cooldownUntil = 0;              // no window any more: she just stays up, floating
      return;
    }
    st.walkerRed = false;
    st.ledge = { y: r.y, dSide: dSideFor(r, x) };
    env.squash(1.1, 0.9);
    sfx.zap(0.35);
    fx.burst(x, r.y, 10, { speed: 160, life: 0.3, gravity: 0, color: '#FF70A2' });
    await env.sleep(450);
    if (g !== gen) return;
    mode = 'perched'; st.walkerBusy = false;
    lounge();
  }

  async function fall() {
    const g = ++gen;
    cancelTweens(st.pos);
    stopLounge();
    st.ledge = null; st.peek = null; perch = null;
    mode = 'falling'; st.walkerBusy = true;
    st.walkerRed = true;
    sfx.zap(0.6);
    const x = Math.min(Math.max(st.pos.x, 30 * S()), env.dims().W - 30 * S());
    await tween(st.pos, { x, y: 0 }, Math.min(0.6, 0.25 + st.pos.y / 2400), easeIn);
    if (g !== gen) return;
    st.walkerRed = false;
    env.landed();
    mode = 'off'; st.walkerBusy = false;
    cooldownUntil = performance.now() + 500;
  }

  // the window went away (closed, minimised, maximised): she sits up and floats where she is
  function getUp() {
    gen++;
    cancelTweens(st.pos);
    stopLounge();
    st.ledge = null; st.peek = null; perch = null; st.walkerRed = false; st.walkerBusy = false;
    mode = 'off';
    sfx.zap(0.3);
    fx.burst(st.pos.x, env.dims().H - st.pos.y, 8, { speed: 140, life: 0.3, gravity: 0, color: '#FF70A2' });
    cooldownUntil = performance.now() + 500;
  }

  async function hopAside(r) {
    const sp = span(r);
    if (!sp) return;
    const g = gen;
    lastHop = performance.now();
    const cx = st.cursor ? st.cursor.x : st.pos.x;
    // the side of the edge farther from the mouse
    const gap = 50 * S();
    const opts = [[sp[0], cx - gap], [cx + gap, sp[1]]].filter(([a, b]) => b - a > 4).map(([a, b]) => (a + b) / 2);
    if (!opts.length) return;
    const x = opts.sort((a, b) => Math.abs(b - cx) - Math.abs(a - cx))[0];
    fracs.set(r.hwnd, (x - sp[0]) / Math.max(1, sp[1] - sp[0]));
    stopLounge();
    mode = 'flying'; st.walkerBusy = true;
    st.flip = x >= st.pos.x ? 1 : -1;
    st.walkerRed = true;
    await tween(st.pos, { x }, 0.3, easeInOut);
    if (g !== gen) return;
    st.walkerRed = false;
    st.ledge = { y: r.y, dSide: dSideFor(r, x) };
    mode = 'perched'; st.walkerBusy = false;
    chillOffAt = performance.now() - 12e3;       // lie back down soon
  }

  function tick() {
    const now = performance.now();
    const on = !!env.cfg().windowWalker;
    if (!on) { if (mode === 'perched' || mode === 'flying') fall(); return; }
    // you picked her up: let go of the window; once you drop her she goes back to it (or down to the taskbar)
    if (st.drag || st.mode === 'dragging') { if (mode !== 'off') release(); wasDragged = true; return; }
    if (wasDragged) { wasDragged = false; cooldownUntil = now + 1200; }
    if (blocked()) { if (mode !== 'off') release(st.party || st.tv ? 5e3 : 1500); return; }
    if (mode === 'perched') {
      if (!rect) { getUp(); return; }            // window gone / maximised: she gets up and keeps floating there
      if (!sameRect(rect, perch)) { fall(); return; }
      st.ledge.y = rect.y;
      // woken up (talking, a poke, the chill menu item): she sits up, then lies back down after a while
      if (hadChill && !st.chill) { hadChill = false; chillOffAt = now; }
      if (!st.chill && now - chillOffAt > 15e3 && st.mode === 'idle' && !st.action && env.typeboxClosed()) lounge();
      const c = st.cursor;
      if (c && now - lastHop > 1200 && Math.abs(c.x - st.pos.x) < 40 * S() && c.y > rect.y - 70 * S() && c.y < rect.y + 30) hopAside(rect);
      return;
    }
    if (mode !== 'off' || now < cooldownUntil) return;
    const free = st.mode === 'idle' && !st.action && !st.walk && env.typeboxClosed();
    if (!rect) return;                           // nothing to sit on: she stays wherever she's floating
    if (now - rectAt < 700) return;                                    // wait until the window stays put
    if (!free || st.chill) return;
    flyUp(rect);
  }

  return { tick, release, fall, mode: () => mode, rect: () => rect, perching: () => mode === 'perched',
    _set: (r) => { rect = r; rectAt = performance.now() - 1000; } };
}
