// "Sit on my window" (Window walker): while it's on, main asks the pc helper where the window in front is, a few
// times a second (the cheap `fgrect` command: no UI Automation), and tells the overlay its top edge in overlay
// coordinates. The overlay (renderer/walker.js) decides what she does with it: peek over it, drop when it moves.
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', 'MultitaskingViewFrame',
  'ForegroundStaging', 'TaskListThumbnailWnd', 'SysShadow', '#32768']);

// physical pixels on the main screen -> overlay (DIP, relative to the work area) coordinates; null = nothing to sit on
function why(fg, display) {
  if (!fg || fg.none || !Array.isArray(fg.rect)) return 'no window';
  if (fg.iconic) return 'minimised';
  if (fg.primary === false) return 'other screen';
  if (SKIP_CLASSES.has(fg.cls)) return 'desktop/taskbar';
  const sf = display.scaleFactor || 1, wa = display.workArea, b = display.bounds || wa;
  const [l, t, r, btm] = fg.rect.map(Number);
  const x = l / sf - wa.x, y = t / sf - wa.y, w = (r - l) / sf, h = (btm - t) / sf;
  if (w < 220 || h < 120) return 'too small';
  if (fg.zoomed || (w >= b.width - 2 && y <= 2)) return 'maximised';
  if (x + w < 120 || x > wa.width - 120 || y > wa.height - 80) return 'off screen';
  return 'ok';
}
function toOverlay(fg, display) {
  if (!fg || fg.none || !Array.isArray(fg.rect)) return null;
  if (fg.iconic || fg.primary === false || SKIP_CLASSES.has(fg.cls)) return null;
  const sf = display.scaleFactor || 1, wa = display.workArea, b = display.bounds || wa;
  const [l, t, r, btm] = fg.rect.map(Number);
  const x = l / sf - wa.x, y = t / sf - wa.y, w = (r - l) / sf, h = (btm - t) / sf;
  if (w < 220 || h < 120) return null;                                        // tiny popups, tooltips
  if (fg.zoomed || (w >= b.width - 2 && y <= 2)) return null;                 // maximised / full screen: no edge to sit on
  if (x + w < 120 || x > wa.width - 120 || y > wa.height - 80) return null;   // mostly off screen
  return { hwnd: String(fg.hwnd), x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function createWalker({ pc, getConfig, getDisplay, isVisible = () => true, send, log = () => {} }) {
  let timer = null, busy = false, last = 'init', lastWhy = '', failUntil = 0, fails = 0;
  async function poll() {
    if (busy || Date.now() < failUntil || !isVisible()) return;
    busy = true;
    try {
      const fg = await pc.call('fgrect', {}, 2500);
      fails = 0;
      if (fg && fg.self) return;                         // you clicked Capri herself: keep the window she knows
      const r = toOverlay(fg, getDisplay());
      const key = JSON.stringify(r);
      if (key !== last) {
        last = key; send('walker-rect', r);
        const w = r ? 'ok' : why(fg, getDisplay());
        if (w !== lastWhy) { lastWhy = w; log('walker: window', w); }   // only the reason, never titles
      }
    } catch (e) {
      fails++;
      if (fails === 1 || fails % 20 === 0) log('walker: window check failed:', e.message);
      failUntil = Date.now() + Math.min(60e3, 2000 * fails);
    } finally { busy = false; }
  }
  function sync() {
    const on = !!getConfig().windowWalker && process.platform === 'win32';
    if (on && !timer) { last = 'init'; timer = setInterval(poll, 300); log('window walker on'); }
    if (!on && timer) { clearInterval(timer); timer = null; send('walker-rect', null); log('window walker off'); }
  }
  return { sync, poll, stop: () => { clearInterval(timer); timer = null; } };
}

module.exports = { createWalker, toOverlay, why, SKIP_CLASSES };
