import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../src/camera.js';
import { moveCamera } from '../src/movement.js';
import { BODY_R, EYE_HEIGHT, METERS_PER_CELL } from '../src/config.js';
import { T } from '../src/world/source.js';

function setup() {
  const width = 64;
  const world = {
    size: 0, width, height: width,
    h: new Float32Array(width * width + 1),
    type: new Uint8Array(width * width + 1),
    sample(x, y) {
      x = Math.floor(x); y = Math.floor(y);
      return x < 0 || y < 0 || x >= width || y >= width ? width * width : y * width + x;
    },
  };
  const cam = new Camera();
  cam.placeAt({ x: 10, y: 10, angle: 0 });
  return { world, cam };
}

function input(keys = [], taps = []) {
  const pressed = new Set(taps);
  return { down: k => keys.includes(k), takeTaps: k => Number(pressed.delete(k)) };
}

function advance(world, cam, keys, seconds, hz = 60) {
  const controls = input(keys);
  for (let i = 0; i < seconds * hz; i++) moveCamera(world, cam, controls, 1 / hz);
}

test('walking uses human eye height and reaches 5.4 km/h with a short start and stop', () => {
  const { world, cam } = setup();
  assert.ok(Math.abs(cam.z * METERS_PER_CELL - 1.7) < 1e-9);
  advance(world, cam, ['w'], 1);
  const start = cam.x;
  advance(world, cam, ['w'], 1);
  assert.ok(Math.abs((cam.x - start) * METERS_PER_CELL - 1.5) < 0.001);
  const stop = cam.x;
  advance(world, cam, [], 1);
  assert.ok((cam.x - stop) * METERS_PER_CELL < 0.13);
  assert.ok(Math.abs(cam.vx) < 0.00001);
});

test('diagonal walking and frame rates preserve travel distance', () => {
  const distances = [];
  for (const hz of [30, 60, 120]) {
    for (const keys of [['w'], ['w', 'd']]) {
      const { world, cam } = setup();
      advance(world, cam, keys, 2, hz);
      distances.push(Math.hypot(cam.x - 10, cam.y - 10));
    }
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 1e-9);
});

test('walking speed stays human on rooftops and shift gives a jog', () => {
  const { world, cam } = setup();
  world.h.fill(40);
  cam.z = 40 + EYE_HEIGHT;
  advance(world, cam, ['w', 'shift'], 1);
  const start = cam.x;
  advance(world, cam, ['w', 'shift'], 1);
  assert.ok(Math.abs((cam.x - start) * METERS_PER_CELL - 3.6) < 0.001);
});

test('flight can hover; V returns to walking and falls to the ground', () => {
  const { world, cam } = setup();
  advance(world, cam, ['e'], 0.5);
  assert.equal(cam.movement, 'fly');
  advance(world, cam, [], 3);
  const hover = cam.z;
  advance(world, cam, [], 1);
  assert.ok(Math.abs(cam.z - hover) < 0.001);
  moveCamera(world, cam, input([], ['v']), 1 / 60);
  advance(world, cam, [], 3);
  assert.equal(cam.movement, 'walk');
  assert.equal(cam.z, EYE_HEIGHT);
});

test('holding Q after landing does not re-enter fast flight', () => {
  const { world, cam } = setup();
  cam.movement = 'fly'; cam.z = 2;
  advance(world, cam, ['q'], 2);
  assert.equal(cam.movement, 'walk');
  assert.equal(cam.z, EYE_HEIGHT);
  const start = cam.x;
  advance(world, cam, ['q', 'w'], 1);
  assert.ok((cam.x - start) * METERS_PER_CELL < 1.5);
});

test('boosted flight cannot tunnel through a thin wall and can slide along it', () => {
  const { world, cam } = setup();
  for (let y = 0; y < world.height; y++) world.h[world.sample(12, y)] = 10;
  cam.movement = 'fly'; cam.z = 3;
  cam.vx = 100; cam.vy = 10;
  moveCamera(world, cam, input(['w', 'shift']), 0.05);
  assert.ok(cam.x < 12 - BODY_R);
  assert.ok(cam.y > 10);
  assert.equal(cam.vx, 0);
});

test('walking cannot enter water and falls after stepping off a roof', () => {
  const { world, cam } = setup();
  for (let y = 0; y < world.height; y++) world.type[world.sample(11, y)] = T.WATER;
  advance(world, cam, ['w'], 3);
  assert.ok(cam.x < 11 - BODY_R);
  cam.z = 5 + EYE_HEIGHT;
  advance(world, cam, [], 3);
  assert.equal(cam.z, EYE_HEIGHT);
});

test('placing a camera clears motion and restores walking', () => {
  const { cam } = setup();
  cam.movement = 'fly'; cam.vx = 20; cam.vy = 10; cam.vz = 5;
  cam.placeAt({ x: 5, y: 6 });
  assert.deepEqual([cam.vx, cam.vy, cam.vz, cam.movement], [0, 0, 0, 'walk']);
});
