import assert from 'node:assert/strict';
import test from 'node:test';

import { QualityController } from '../src/quality.js';

test('quality controller degrades one step after sustained slow frames', () => {
  // Derived from the ladder, not written out: these asserted 0.88 and 0.64,
  // which were its values at the time, so making the ladder gentler failed a
  // test about whether one slow spell costs exactly one step.
  const q = new QualityController({ clock: () => 10000 });
  const ladder = q.scales;
  const from = q.level;
  for (let i = 0; i < 30; i++) q.sample(45);
  assert.equal(q.level, from + 1, 'one slow spell costs exactly one step');
  assert.ok(ladder[q.level] < ladder[from], 'a step down must reduce scale');
});

test('quality controller waits for a settle window before recovering', () => {
  let now = 0;
  const q = new QualityController({ clock: () => now });
  q.setLevel(2);
  for (let i = 0; i < 30; i++) q.sample(45, now);
  assert.equal(q.level, 3);
  now += 2000;
  for (let i = 0; i < 30; i++) q.sample(18, now);
  assert.equal(q.level, 2);
});

test('quality control cycles through manual scales and back to auto', () => {
  const q = new QualityController();
  const ladder = q.scales;
  // Auto starts at native, not at the finest rung: the rung above native is
  // for machines that prove they can afford it.
  assert.deepEqual(q.snapshot(), { mode: 'auto', level: q.baseLevel, scale: ladder[q.baseLevel] });
  assert.equal(ladder[q.baseLevel], 1, 'native resolution is the baseline');
  assert.ok(ladder[0] > 1, 'the top rung must be finer than native');
  assert.deepEqual(q.cycle(), { mode: 'manual', level: 0, scale: ladder[0] });
  for (let i = 1; i < ladder.length; i++) {
    assert.equal(q.cycle().scale, ladder[i], `manual step ${i}`);
  }
  assert.deepEqual(q.cycle(),
    { mode: 'auto', level: q.baseLevel, scale: ladder[q.baseLevel] });
  // Every rung must be coarser than the one above it, or cycling is not a ramp.
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] < ladder[i - 1]);
});

test('quality recovers, rather than only ever degrading', () => {
  // The thresholds used to be +4 to degrade and -8 to recover, leaving a band
  // from 25 ms to 37 ms in which quality could fall but never rise. A machine
  // sitting in that band stepped down at every excursion above it and never
  // came back, so the view got worse the longer it ran. Anything comfortably
  // under the target has to be able to climb.
  const q = new QualityController({ targetMs: 33.3, clock: () => 0 });
  let now = 0;
  const run = (ms, frames = 30) => {
    for (let i = 0; i < frames; i++) { now += 20; q.sample(ms, now); }
  };
  run(45); run(45); run(45);
  assert.ok(q.level > 0, 'sustained slow frames must reduce quality');
  const worst = q.level;

  // Now the machine is comfortable: 29 ms is inside the old dead band.
  run(29); run(29); run(29);
  assert.ok(q.level < worst,
    `quality never recovered from level ${worst} at 29 ms frames`);
});

test('quality never degrades to a scale that reads as broken', () => {
  const q = new QualityController({ targetMs: 33.3, clock: () => 0 });
  let now = 0;
  for (let i = 0; i < 400; i++) { now += 20; q.sample(999, now); }
  assert.equal(q.level, q.scales.length - 1, 'the ladder should bottom out');
  assert.ok(q.scale >= 0.76, `floor is ${q.scale}, coarse enough to look broken`);
});
