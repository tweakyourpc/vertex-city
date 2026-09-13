/**
 * Capture the four visual styles to docs/media, for the README and for looking
 * at a change that only exists on screen.
 *
 * Uses the same headless Chrome and SwiftShader path as tools/shader-check.mjs,
 * so it needs no GPU and no extra dependency.
 *
 *   ASCII_CITY_URL=http://127.0.0.1:8792 node tools/capture-media.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.ASCII_CITY_URL;
if (!BASE) throw new Error('Set ASCII_CITY_URL to the running preview URL.');
const OUT = process.env.MEDIA_OUT || 'docs/media';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PORT = Number(process.env.CAPTURE_PORT || 9352);
const SHOTS = [['readable', 'day'], ['readable', 'night'],
               ['wireframe', 'night'], ['wireframe', 'day']];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('headless Chrome did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cmd = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (e) =>
    (await cmd('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value;

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: `${BASE}/#city=procedural` });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await evaluate('!!(window.state && window.state.phase === "ready")')) break;
  }
  await sleep(3000);
  // Stand in the street at eye height rather than wherever the spawn left us.
  await evaluate('(() => { window.cam.pitch = 0; window.cam.movement = "walk"; })()');

  for (const [mode, lighting] of SHOTS) {
    await evaluate(`(() => {
      const a = document.getElementById('appearance');
      a.value = ${JSON.stringify(mode)}; a.dispatchEvent(new Event('change'));
      const l = document.getElementById('lighting');
      l.value = ${JSON.stringify(lighting)}; l.dispatchEvent(new Event('change'));
    })()`);
    await sleep(4000);
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT}/${mode}-${lighting}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('captured', file);
  }
  ws.close();
} finally {
  chrome.kill();
}
