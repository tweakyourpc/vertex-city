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
import { CompositeWorld } from '../src/world/composite.js';
import { DEMO_BBOX, DEMO_ELEMENTS } from '../src/world/demo-city.js';
import { T, F } from '../src/world/source.js';

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
