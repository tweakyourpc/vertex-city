/**
 * Lighting: the sun must visibly light the scene, and building windows must
 * stay dark through the day and only switch on in the evening. These tests pin
 * that contract so a future tweak cannot silently re-light windows at noon or
 * flatten the day/night brightness curve.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Lighting, smoothstep, dither, quantize } from '../src/render/materials.js';
import { ProceduralWorld } from '../src/world/procedural.js';
import { Camera } from '../src/camera.js';
import { horizonVector } from '../src/astro.js';
import { renderScene } from '../src/render/raycaster.js';
import { makeScreen, asText } from './support/screen.js';

test('smoothstep ramps 0..1 across its edges', () => {
  assert.equal(smoothstep(0, 10, -5), 0);
  assert.equal(smoothstep(0, 10, 15), 1);
  assert.ok(smoothstep(0, 10, 5) > 0.4 && smoothstep(0, 10, 5) < 0.6,
    'midpoint is around 0.5');
});

test('windows are dark in daylight and lit in the evening', () => {
  const day = new Lighting();
  day.update(20);     // high sun
  const dusk = new Lighting();
  dusk.update(-4);    // after sunset

  assert.equal(day.litProb, 0, 'no windows lit at midday');
  assert.ok(dusk.litProb > 0.4, 'windows lit after dusk');
  assert.ok(dusk.litProb > day.litProb, 'evening lights more windows than day');
});

test('ambient brightness rises with the sun (day brighter than night)', () => {
  const noon = new Lighting();
  noon.update(30);
  const night = new Lighting();
  night.update(-10);

  assert.ok(noon.amb > night.amb, 'noon ambient brighter than night');
  assert.ok(noon.dayAmt > night.dayAmt, 'noon dayAmt higher than night');
  assert.ok(noon.sunWarm > night.sunWarm, 'sun tint present at noon, gone at night');
});

test('a day frame is brighter than a night frame of the same city', () => {
  const world = new ProceduralWorld();
  const cam = new Camera();
  cam.placeAt({ x: world.width / 2, y: world.height / 2 - 40, angle: Math.PI / 2 });
  cam.z = 1.65;
  cam.pitch = 0;

  function avgBrightness(sunAlt) {
    const screen = makeScreen(100, 44);
    cam.hz = screen.horizon;
    cam.buildRays(screen);
    screen.clear();
    const L = new Lighting();
    L.update(sunAlt);
    renderScene(screen, cam, world, L, 0);
    let sum = 0, n = 0;
    for (let i = 0; i < screen.colour.length; i++) {
      const c = screen.colour[i];
      if (c === undefined || c === null) continue;
      // col2str quantises to 3-bit channels; recover an approximate luminance.
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
      if (!m) continue;
      sum += (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
      n++;
    }
    return n ? sum / n : 0;
  }

  const day = avgBrightness(25);
  const night = avgBrightness(-8);
  assert.ok(day > night, `day (${day.toFixed(1)}) should be brighter than night (${night.toFixed(1)})`);
});

test('a night frame shows more lit windows than a day frame', () => {
  const world = new ProceduralWorld();
  const cam = new Camera();
  cam.placeAt({ x: world.width / 2, y: world.height / 2 - 40, angle: Math.PI / 2 });
  cam.z = 1.65;
  cam.pitch = 0;

  function litWindowCount(sunAlt) {
    const screen = makeScreen(100, 44);
    cam.hz = screen.horizon;
    cam.buildRays(screen);
    screen.clear();
    const L = new Lighting();
    L.update(sunAlt);
    renderScene(screen, cam, world, L, 0);
    const text = asText(screen);
    let n = 0;
    for (const line of text) for (const ch of line) if (ch === '*' || ch === "'") n++;
    return n;
  }

  const day = litWindowCount(25);
  const night = litWindowCount(-8);
  assert.ok(night > day, `night (${night}) should show more lit windows than day (${day})`);
});

/* ----------------------- deterministic dithering ----------------------- */

test('dither is stable for the same world point and id', () => {
  const a = dither(12.3, 45.6, 3, 1);
  const b = dither(12.3, 45.6, 3, 1);
  assert.equal(a, b, 'same inputs must give the same threshold');
  assert.ok(a >= 0 && a < 1, 'threshold is in [0,1)');
});

test('dither varies across world space and surface id', () => {
  const base = dither(12.3, 45.6, 0, 0);
  assert.notEqual(dither(12.3, 45.6, 1, 0), base, 'different id differs');
  assert.notEqual(dither(13.3, 45.6, 0, 0), base, 'different world point differs');
  assert.notEqual(dither(12.3, 45.6, 0, 1), base, 'different sub-cell differs');
});

/* --------------------------- hysteresis --------------------------- */

test('quantize snaps to the nearest band', () => {
  assert.equal(quantize(0.0, 4), 0);
  assert.equal(quantize(0.99, 4), 3);
  assert.equal(quantize(0.5, 4), 2);
});

test('quantize holds the band across tiny changes (no flicker)', () => {
  // Start in band 1 (value ~0.4). A small wobble toward band 2 must NOT flip
  // until it is clearly past the boundary plus the hysteresis margin.
  const prev = quantize(0.4, 4);
  assert.equal(prev, 1);
  assert.equal(quantize(0.46, 4, prev), 1, 'small rise stays in band 1');
  assert.equal(quantize(0.40, 4, prev), 1, 'small fall stays in band 1');
  // Past the edge by more than the margin: now it may switch.
  assert.equal(quantize(0.62, 4, prev), 2, 'clearly past the edge switches');
});

test('quantize with no previous value returns the target band', () => {
  assert.equal(quantize(0.5, 8, -1), 4);
});

/**
 * The GPU views take a sun direction rather than the fixed vector they used to
 * hard-code. That direction has to agree with the convention `render/sky.js`
 * projects the drawn sun with, or the sun in the sky and the light on the
 * buildings will come from different places.
 */
test('the sun vector matches the azimuth convention the sky is drawn with', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // Azimuth is from north, turning east; the world is x east, y north, z up.
  const [nx, ny] = horizonVector(0, 0);
  assert.ok(near(nx, 0) && near(ny, 1), 'azimuth 0 must point north (+y)');
  const [ex, ey] = horizonVector(0, 90);
  assert.ok(near(ex, 1) && near(ey, 0), 'azimuth 90 must point east (+x)');
  const [sx, sy] = horizonVector(0, 180);
  assert.ok(near(sx, 0) && near(sy, -1), 'azimuth 180 must point south (-y)');
  // Overhead is straight up, and every result is a unit vector.
  assert.ok(near(horizonVector(90, 0)[2], 1));
  for (const [alt, az] of [[0,0],[35,117],[-15,250],[89,3]]) {
    const v = horizonVector(alt, az);
    assert.ok(near(Math.hypot(...v), 1), `not unit length at alt ${alt} az ${az}`);
  }
});

test('a sun below the horizon lights no upward face', () => {
  // Night has to fall out of the geometry, so the shader needs no separate
  // day/night branch: max(0, dot(normal, sunDir)) does it.
  const up = [0, 0, 1];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  assert.ok(dot(horizonVector(-15, 180), up) < 0, 'a set sun must not light a roof');
  assert.ok(dot(horizonVector(35, 180), up) > 0, 'a risen sun must light a roof');
});
