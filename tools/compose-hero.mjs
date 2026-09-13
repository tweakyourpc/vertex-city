/**
 * Compose the README heroes and the GitHub social preview from captured plates.
 *
 * The branding is generated from the renderer rather than drawn, so it can be
 * remade whenever the city changes instead of going stale the way a one-off
 * artwork does. Run tools/capture-media.mjs first to refresh docs/media, then
 * this to rebuild docs/hero.png, docs/hero-cityscape.png and
 * docs/social-preview.png.
 *
 *   node tools/capture-media.mjs && node tools/compose-hero.mjs
 *
 * Two things this has to get right, both learned the hard way. Chrome will not
 * navigate to a data URL past about 2 MB, so the plates are referenced as files
 * rather than inlined. And a fixed delay is not enough for images this size, so
 * it waits for every one to report itself decoded before capturing.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const MEDIA = process.env.MEDIA_DIR || 'docs/media';
const OUT = process.env.HERO_OUT || 'docs';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PORT = Number(process.env.HERO_PORT || 9391);
const NEEDED = ['wireframe-night.png', 'readable-day.png', 'readable-night.png', 'ascii-night.png'];

for (const f of NEEDED) {
  if (!existsSync(`${MEDIA}/${f}`)) {
    throw new Error(`missing plate ${MEDIA}/${f} — run tools/capture-media.mjs first`);
  }
}
mkdirSync(OUT, { recursive: true });

const base = (w, h) => `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:#060b0e;
  font-family:"DejaVu Sans","Helvetica Neue",Arial,sans-serif;color:#eef5f6}
.stage{position:relative;width:${w}px;height:${h}px;overflow:hidden}
.shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}`;

/** Wireframe leads: dark plate, so the scrim runs in from the side. */
const wordmark = (w, h, full) => `<!doctype html><meta charset="utf-8"><style>${base(w,h)}
.shot{object-position:center 42%}
.veil{position:absolute;inset:0;background:
  linear-gradient(90deg,rgba(4,9,12,.94) 0%,rgba(4,9,12,.72) 34%,rgba(4,9,12,.06) 62%),
  linear-gradient(0deg,rgba(4,9,12,.86) 0%,rgba(4,9,12,0) 40%)}
.copy{position:absolute;left:${Math.round(w*0.055)}px;top:50%;transform:translateY(-50%);max-width:${Math.round(w*0.48)}px}
.eyebrow{font:600 ${Math.round(h*0.021)}px/1 "DejaVu Sans Mono",monospace;letter-spacing:.42em;
  color:#4fd6e8;text-transform:uppercase;margin-bottom:${Math.round(h*0.035)}px}
h1{font:800 ${Math.round(h*0.115)}px/0.95 "DejaVu Sans",sans-serif;letter-spacing:-.02em;color:#fff}
h1 span{color:#4fd6e8}
.tag{margin-top:${Math.round(h*0.038)}px;font:400 ${Math.round(h*0.038)}px/1.42 "DejaVu Sans",sans-serif;color:#9fb6bd}
.tag b{color:#e8f2f4;font-weight:600}
.rule{width:${Math.round(w*0.07)}px;height:3px;background:#e8a33c;margin-top:${Math.round(h*0.045)}px}
.modes{position:absolute;right:${Math.round(w*0.045)}px;bottom:${Math.round(h*0.10)}px;display:flex;gap:${Math.round(w*0.009)}px}
.m{width:${Math.round(w*0.115)}px;height:${Math.round(h*0.135)}px;border:1px solid rgba(232,242,244,.22);
  position:relative;border-radius:2px;overflow:hidden}
.m>img{width:100%;height:100%;object-fit:cover;display:block}
.m i{position:absolute;left:0;right:0;bottom:0;font:600 ${Math.round(h*0.017)}px/1 "DejaVu Sans Mono",monospace;
  letter-spacing:.16em;text-align:center;padding:${Math.round(h*0.011)}px 0;color:#d8e6e9;
  background:rgba(4,9,12,.82);font-style:normal;text-transform:uppercase}
</style><div class="stage">
  <img class="shot" src="wireframe-night.png">
  <div class="veil"></div>
  <div class="copy">
    <div class="eyebrow">Field Study &middot; v3</div>
    <h1>VERTEX<br>CITY<span>.</span></h1>
    <div class="tag"><b>A real city, drawn as light.</b>${full ? `<br>
      Surveyed OpenStreetMap geometry, an astronomically correct sky,
      live weather and aircraft overhead &mdash; rendered four ways,
      none of them pretending to be a photograph.` : ''}</div>
    <div class="rule"></div>
  </div>
  ${full ? `<div class="modes">
    <div class="m"><img src="wireframe-night.png"><i>Wireframe</i></div>
    <div class="m"><img src="readable-day.png"><i>Cityscape</i></div>
    <div class="m"><img src="ascii-night.png"><i>ASCII</i></div>
    <div class="m"><img src="readable-night.png"><i>Night</i></div>
  </div>` : ''}
</div>`;

/** Daylight leads: a bright plate needs its text on darkness it brought along. */
const cityscape = (w, h) => `<!doctype html><meta charset="utf-8"><style>${base(w,h)}
.shot{object-position:center 56%}
.veil{position:absolute;inset:0;background:
  linear-gradient(0deg,rgba(3,8,11,.985) 2%,rgba(3,8,11,.94) 20%,rgba(3,8,11,.62) 38%,rgba(3,8,11,0) 62%)}
.bar{position:absolute;left:0;right:0;bottom:0;
  padding:${Math.round(h*0.07)}px ${Math.round(w*0.05)}px ${Math.round(h*0.075)}px;
  display:flex;align-items:flex-end;justify-content:space-between;gap:${Math.round(w*0.04)}px}
.left{max-width:${Math.round(w*0.60)}px}
.eyebrow{font:600 ${Math.round(h*0.021)}px/1 "DejaVu Sans Mono",monospace;letter-spacing:.40em;
  color:#7fdcea;text-transform:uppercase;margin-bottom:${Math.round(h*0.028)}px}
h2{font:800 ${Math.round(h*0.072)}px/1.02 "DejaVu Sans",sans-serif;letter-spacing:-.015em;color:#fff}
h2 span{color:#7fdcea}
.tag{margin-top:${Math.round(h*0.030)}px;font:400 ${Math.round(h*0.034)}px/1.45 "DejaVu Sans",sans-serif;
  color:#c3d6dc;max-width:${Math.round(w*0.52)}px}
.facts{display:flex;gap:${Math.round(w*0.028)}px;flex-shrink:0}
.f{text-align:right}
.f b{display:block;font:700 ${Math.round(h*0.040)}px/1 "DejaVu Sans",sans-serif;color:#f0b64a}
.f i{display:block;font:600 ${Math.round(h*0.018)}px/1.5 "DejaVu Sans Mono",monospace;letter-spacing:.18em;
  color:#8ea5ac;font-style:normal;text-transform:uppercase;margin-top:${Math.round(h*0.010)}px}
</style><div class="stage">
  <img class="shot" src="readable-day.png">
  <div class="veil"></div>
  <div class="bar">
    <div class="left">
      <div class="eyebrow">Cityscape</div>
      <h2>Real streets. Real sky.<br>Nothing<span>&nbsp;pretending.</span></h2>
      <div class="tag">Mapped footprints and carriageways, the sun where it
        actually is for that place and hour, and a generated horizon that says
        so where the survey ends.</div>
    </div>
    <div class="facts">
      <div class="f"><b>4</b><i>Render modes</i></div>
      <div class="f"><b>OSM</b><i>Real geometry</i></div>
      <div class="f"><b>0</b><i>Dependencies</i></div>
    </div>
  </div>
</div>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

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
  await cmd('Page.enable');
  await cmd('Runtime.enable');

  const shots = [
    ['hero', wordmark(2400, 1000, true), 2400, 1000],
    ['hero-cityscape', cityscape(2400, 1000), 2400, 1000],
    ['social-preview', wordmark(1280, 640, false), 1280, 640],
  ];
  for (const [name, html, w, h] of shots) {
    await cmd('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const file = `${process.cwd()}/${MEDIA}/__${name}.html`;
    writeFileSync(file, html);
    await cmd('Page.navigate', { url: 'file://' + file });

    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      await sleep(250);
      const r = await cmd('Runtime.evaluate', { returnByValue: true, expression:
        '[...document.images].length>0 && [...document.images].every(i=>i.complete&&i.naturalWidth>0)' });
      ready = !!r?.result?.value;
    }
    if (!ready) throw new Error(`images never decoded for ${name}`);
    await sleep(600);
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
    console.log('composed', `${OUT}/${name}.png`, `${w}x${h}`);
  }
  ws.close();
} finally {
  chrome.kill();
}
