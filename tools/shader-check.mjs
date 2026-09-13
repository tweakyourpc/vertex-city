/**
 * Compile the surface renderer's shaders in a real browser and report failures.
 *
 * The GPU views are the only part of this project that cannot be checked from
 * Node: the shaders are strings until a driver builds them. Twice now a change
 * that passed lint and the whole test suite took both surface views down, and
 * the reason was only ever visible to the driver. Once it was a reserved word
 * (`packed`), once an out-of-range literal under mediump precision.
 *
 * This drives headless Chrome over the DevTools protocol with SwiftShader, so
 * it needs no GPU and no extra dependency: Node 22 has a WebSocket client and
 * Chrome ships the rest. It loads the page, switches through every appearance,
 * and fails if any of them errors or leaves the surface renderer unbuilt.
 *
 *   ASCII_CITY_URL=http://127.0.0.1:8792 node tools/shader-check.mjs
 */
import { spawn } from 'node:child_process';

const BASE = process.env.ASCII_CITY_URL;
if (!BASE) throw new Error('Set ASCII_CITY_URL to the running preview URL.');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PORT = Number(process.env.SHADER_CHECK_PORT || 9345);
const MODES = ['readable', 'wireframe', 'ascii', 'cinematic'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-dev-shm-usage',
  // SwiftShader so this runs on a machine with no usable GPU, such as CI.
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

let failed = false;
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
  const errors = [];
  let id = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cmd = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) =>
    (await cmd('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.navigate', { url: `${BASE}/#city=procedural` });

  // Wait for the world rather than a fixed delay: generation dominates startup.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(1000);
    ready = await evaluate('!!(window.state && window.state.phase === "ready")');
  }
  if (!ready) throw new Error('the page never reached a ready state');

  for (const mode of MODES) {
    await evaluate(`(() => { const s = document.getElementById('appearance');
      s.value = ${JSON.stringify(mode)}; s.dispatchEvent(new Event('change')); })()`);
    await sleep(2500);
    const state = JSON.parse(await evaluate(`JSON.stringify({
      mode: window.presentation.appearance,
      hasReadable: !!window.readable,
      notice: document.getElementById('notice').textContent,
    })`));
    const gpu = mode === 'readable' || mode === 'wireframe';
    const bad = state.mode !== mode || (gpu && !state.hasReadable) || state.notice;
    if (bad) failed = true;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${mode.padEnd(10)} `
      + `renderer=${state.hasReadable ? 'built' : 'absent'}`
      + (state.notice ? `  notice=${state.notice}` : ''));
  }

  if (errors.length) {
    failed = true;
    console.log('\npage errors:');
    for (const e of errors) console.log('  ' + e);
  }
  ws.close();
} finally {
  chrome.kill();
}

console.log(failed ? '\nshader check FAILED' : '\nall appearances built cleanly');
process.exit(failed ? 1 : 0);
