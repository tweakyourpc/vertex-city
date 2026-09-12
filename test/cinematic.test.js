import assert from 'node:assert/strict';
import test from 'node:test';
import { makeScreen, MODE } from './support/screen.js';

test('cinematic mode preserves independently coloured upper and lower scene rows', () => {
  const screen = makeScreen(4, 3, MODE.CINEMATIC);
  screen.clear();
  screen.setDepth(0, 0, '#', 'red', 5);
  screen.setDepth(0, 1, '#', 'blue', 5);
  screen.blit();
  const rects = screen._calls.rects;
  assert.equal(rects.length, 2);
  assert.deepEqual(rects.map(r => [r[1], r[3], r[4]]), [
    [0, screen.ch, 'red'], [screen.ch, screen.ch, 'blue'],
  ]);
});

test('a lower-row-only feature survives against the sky', () => {
  const screen = makeScreen(4, 3, MODE.CINEMATIC);
  screen.clear();
  screen.setDepth(1, 1, '#', 'green', 5);
  screen.blit();
  assert.equal(screen._calls.rects.length, 1);
  assert.equal(screen._calls.rects[0][1], screen.ch);
  assert.equal(screen._calls.rects[0][4], 'green');
});

test('a text cell does not erase scene detail in the adjacent row', () => {
  const screen = makeScreen(4, 3, MODE.CINEMATIC);
  screen.clear();
  screen.setDepth(0, 0, '#', 'red', 5);
  screen.set(0, 1, 'A', 'white');
  screen.blit();
  assert.equal(screen._calls.rects[0][4], 'red');
  assert.equal(screen._calls.rects[0][3], screen.ch);
  assert.equal(screen._calls.texts[0][0], 'A');
});
