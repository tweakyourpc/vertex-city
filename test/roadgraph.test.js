import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRoadGraph, positionOnEdge, boxHalfAlong } from '../src/world/roadgraph.js';

const road = (pts, nodeIds, nameId, tags = {}) => ({
  pts, nodeIds, nameId, cls: 'residential', tags: { highway: 'residential', ...tags },
});

test('shared OSM node ids connect roads and geometric bridge crossings do not', () => {
  const connected = buildRoadGraph([
    road([[0, 1], [1, 1], [2, 1]], [1, 9, 2], 0),
    road([[1, 0], [1, 1], [1, 2]], [3, 9, 4], 1),
  ]);
  assert.equal(connected.junctions.length, 1);

  const bridge = buildRoadGraph([
    road([[0, 1], [1, 1], [2, 1]], [1, 8, 2], 0),
    road([[1, 0], [1, 1], [1, 2]], [3, 9, 4], 1),
  ]);
  assert.equal(bridge.junctions.length, 0);
});

test('one-way and access tags constrain directed edges', () => {
  const graph = buildRoadGraph([
    road([[0, 0], [2, 0]], [1, 2], 0, { oneway: 'yes' }),
    road([[0, 1], [2, 1]], [3, 4], 1, { access: 'private' }),
  ]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].from, 0);
  assert.equal(graph.edges[0].to, 1);
});

test('signal nodes and lane offsets are represented deterministically', () => {
  const graph = buildRoadGraph([
    road([[0, 0], [2, 0], [4, 0]], [1, 2, 3], 0),
    road([[2, -2], [2, 0], [2, 2]], [4, 2, 5], 1),
  ], { signalNodeIds: new Set([2]) });
  assert.equal(graph.signalJunctions.length, 1);
  const edge = graph.edges[0];
  const p = positionOnEdge(graph, edge, 1, 0.5);
  assert.equal(p.x, 1);
  assert.equal(p.y, -0.5);
});

test('directed edge keys survive reprojection and distinguish direction', () => {
  const firstRoad = {
    sourceId: 'way/42', pts: [[0, 0], [10, 0]], nodeIds: [100, 101],
    cls: 'residential', tags: { highway: 'residential' },
  };
  const movedRoad = { ...firstRoad, pts: [[20, 30], [40, 30]] };
  const first = buildRoadGraph([firstRoad]);
  const second = buildRoadGraph([movedRoad]);
  assert.deepEqual(first.edges.map((edge) => edge.key), second.edges.map((edge) => edge.key));
  assert.notEqual(first.edges[0].key, first.edges[1].key);
});

test('a second named way lying on a street is not an intersection at every vertex', () => {
  // Park Avenue carries the separately named Park Avenue Tunnel and its
  // service roads along the same nodes. Counting two names at a node as a
  // junction made every vertex of a dead-straight avenue one, and the
  // renderer painted a crossing at each: the carriageway vanished under
  // crosswalks. A junction is arms that diverge, not names that coincide.
  const ys = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30];
  const pts = ys.map((y) => [90, y]);
  const ids = ys.map((_, i) => i + 1);
  const graph = buildRoadGraph([
    { ...road(pts, ids, 101), cls: 'primary', width: 13.5 },
    { ...road(pts.map((p) => [...p]), [...ids], 300), cls: 'secondary', width: 8 },
  ]);
  assert.equal(graph.junctions.length, 0, 'a straight street has no junctions along it');

  // A street that genuinely joins it still does.
  const withCross = buildRoadGraph([
    { ...road(pts, ids, 101), cls: 'primary', width: 13.5 },
    { ...road(pts.map((p) => [...p]), [...ids], 300), cls: 'secondary', width: 8 },
    road([[80, 15], [90, 15], [100, 15]], [80, ids[5], 100], 200),
  ]);
  assert.equal(withCross.junctions.length, 1);
  assert.deepEqual([withCross.junctions[0].x, withCross.junctions[0].y], [90, 15]);
});

test('the junction box is measured along the approach, not across it', () => {
  // A wide avenue crossed by a narrow street. Coming up the avenue you cross
  // the narrow street, so the setback is the narrow street's half width; the
  // avenue's own width says nothing about how far the box reaches that way.
  // Taking the widest arm regardless of bearing set an avenue's crossings back
  // by half an avenue, which put them a third of the way up the block.
  const AV = 13.5, ST = 4.2;
  const graph = buildRoadGraph([
    { ...road([[90, 0], [90, 30], [90, 60]], [1, 2, 3], 101), cls: 'primary', width: AV },
    { ...road([[60, 30], [90, 30], [120, 30]], [4, 2, 5], 200), width: ST },
  ]);
  const j = graph.junctions[0];
  assert.equal(j.x, 90);
  // Travelling along the avenue (north): the box reaches half the cross street.
  assert.ok(Math.abs(boxHalfAlong(j, 0, 1) - ST / 2) < 1e-6,
    `along the avenue ${boxHalfAlong(j, 0, 1)}, expected ${ST / 2}`);
  // Travelling along the cross street: the box reaches half the avenue.
  assert.ok(Math.abs(boxHalfAlong(j, 1, 0) - AV / 2) < 1e-6,
    `along the street ${boxHalfAlong(j, 1, 0)}, expected ${AV / 2}`);
});
