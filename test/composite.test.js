/**
 * The composite world: a mapped extract standing on a generated substrate.
 *
 * The contract these pin is that surveyed geometry is never altered, that the
 * world no longer ends at the extract's edge, and that every invented cell says
 * so. The last one matters most: standing order 5 requires that generated
 * geography never present as measured fact, and a renderer can only honour that
 * if the provenance is actually on the cell.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { OsmWorld } from '../src/world/osm.js';
import { CompositeWorld, heightScaleFor } from '../src/world/composite.js';
import { DEMO_BBOX, DEMO_ELEMENTS } from '../src/world/demo-city.js';
import { T, F } from '../src/world/source.js';
import { METERS_PER_CELL } from '../src/config.js';

const extract = () => new OsmWorld(DEMO_BBOX, DEMO_ELEMENTS, 'Demo', { enrich: true });

test('surveyed cells survive the substrate unchanged', () => {
  const osm = extract();
  const world = new CompositeWorld(osm);
  let checked = 0;
  for (let y = 4; y < osm.height; y += 37) {
    for (let x = 4; x < osm.width; x += 31) {
      const a = osm.sample(x, y);
      const b = world.sample(x, y);
      assert.equal(world.type[b], osm.type[a], `type differs at ${x},${y}`);
      assert.equal(world.h[b], osm.h[a], `height differs at ${x},${y}`);
      assert.equal(world.bid[b], osm.bid[a], `building id differs at ${x},${y}`);
      assert.equal(world.flags[b] & F.SIMULATED, 0, `mapped cell marked simulated at ${x},${y}`);
      checked++;
    }
  }
  assert.ok(checked > 100, 'the sweep must actually cover the extract');
});

test('the world no longer ends at the edge of the extract', () => {
  const osm = extract();
  const world = new CompositeWorld(osm);
  const y = Math.floor(osm.height / 2);
  for (const past of [1, 40, 300, 2000, 9000]) {
    const x = osm.width + past;
    // The old world answered VOID here, which is the cliff this removes.
    assert.equal(osm.type[osm.sample(x, y)], T.VOID);
    const slot = world.sample(x, y);
    assert.notEqual(world.type[slot], T.VOID, `void ${past} cells past the edge`);
    assert.ok(world.flags[slot] & F.SIMULATED, `unflagged invention ${past} cells out`);
  }
});

test('negative coordinates are substrate too, not a wrapped extract', () => {
  const world = new CompositeWorld(extract());
  for (const [x, y] of [[-1, 10], [-500, -500], [10, -240]]) {
    const slot = world.sample(x, y);
    assert.notEqual(world.type[slot], T.VOID);
    assert.ok(world.flags[slot] & F.SIMULATED);
  }
});

test('generated surroundings still have buildings past the extract corner', () => {
  // A substrate that turns to farmland the moment the survey stops is the same
  // hard edge in softer colours, so the density profile is widened to carry
  // built form beyond the corner. Without that widening this is zero.
  const osm = extract();
  const world = new CompositeWorld(osm);
  const corner = Math.hypot(osm.width, osm.height) / 2;
  assert.ok(world.densityScale > 1, 'the profile must be stretched for an extract');

  // Sweep a band, not a line: the substrate lays streets on a block grid, and
  // a single row can sit on one for its whole length and report no buildings
  // while the blocks either side of it are full of them.
  let built = 0, sampled = 0;
  const mid = Math.floor(osm.height / 2);
  for (let y = mid - 60; y < mid + 60; y += 3) {
    for (let x = osm.width + 20; x < osm.width + 260; x += 3) {
      const t = world.type[world.sample(x, y)];
      if (t === T.HOUSE || t === T.TOWER) built++;
      sampled++;
    }
  }
  assert.ok(built / sampled > 0.05,
    `only ${built}/${sampled} built cells just beyond a ${corner.toFixed(0)}-cell corner`);
});

test('the extract keeps its identity and spawn', () => {
  const osm = extract();
  const world = new CompositeWorld(osm);
  assert.equal(world.label, osm.label);
  assert.equal(world.bbox, osm.bbox);
  assert.equal(world.roadGraph, osm.roadGraph);
  assert.equal(world.synthetic, osm.synthetic);
  assert.deepEqual(world.spawn(), osm.spawn());
  // The skyline bound has to cover both layers or the DDA early-out clips.
  assert.ok(world.maxHeight >= osm.maxHeight);
});

/**
 * The substrate's skyline has to come from the city it surrounds. Its own
 * profile is a generic downtown topping out near 65 m, and stamping that around
 * a low-rise extract invents a horizon of towers that are not there, which is
 * the thing standing order 5 exists to prevent.
 */
function extractOfHeight(metres) {
  const W = 240, H = 240, n = W * H;
  const cells = metres / METERS_PER_CELL;
  const o = {
    width: W, height: H, voidSlot: n, label: 'test', bbox: [0, 0, 1, 1],
    lat: 27, lon: -82, maxHeight: cells,
    h: new Float32Array(n + 1), type: new Uint8Array(n + 1),
    rnd: new Float32Array(n + 1), lamp: new Float32Array(n + 1),
    pal: new Uint8Array(n + 1), mat: new Uint8Array(n + 1),
    flags: new Uint8Array(n + 1), bid: new Uint16Array(n + 1),
    roadCells: [], roads: [], junctions: [], buildings: [null], streetNames: [],
    sample(x, y) {
      const a = Math.floor(x), b = Math.floor(y);
      return a < 0 || a >= W || b < 0 || b >= H ? n : b * W + a;
    },
    spawn() { return { x: 120, y: 120, angle: 0 }; },
    randomRoadCell() { return null; },
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((x * 7 + y * 13) % 23 > 4) continue;
      const s = y * W + x;
      o.type[s] = T.HOUSE;
      o.h[s] = cells * (0.7 + ((x * 31 + y * 17) % 100) / 330);
    }
  }
  return o;
}

test('generated surroundings inherit the extract own skyline', () => {
  const low = new CompositeWorld(extractOfHeight(12));
  const tall = new CompositeWorld(extractOfHeight(150));
  assert.ok(low.heightScale < 0.45,
    `a 12 m city must not be ringed by towers: scale ${low.heightScale}`);
  assert.ok(tall.heightScale > low.heightScale * 3,
    'a tall city must produce a taller substrate than a low-rise one');

  const p90 = (world) => {
    const hs = [];
    for (let y = 250; y < 380; y += 2) {
      for (let x = 90; x < 240; x += 2) {
        const s = world.sample(x, y);
        const t = world.type[s];
        if (t === T.TOWER || t === T.HOUSE) hs.push(world.h[s] * METERS_PER_CELL);
      }
    }
    hs.sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length * 0.9)] : 0;
  };
  const lowP90 = p90(low);
  assert.ok(lowP90 < 26,
    `low-rise surroundings reached ${lowP90.toFixed(0)} m, which is a skyline it does not have`);
  assert.ok(p90(tall) > lowP90 * 2, 'a tall city must build taller surroundings');
});

test('an extract with nothing built in it keeps the default skyline', () => {
  // No buildings at all is not evidence of a flat city, just of a thin
  // extract, so the substrate should not flatten itself to nothing.
  const bare = extractOfHeight(20);
  bare.type.fill(0);
  assert.equal(heightScaleFor(bare), 1);
});
