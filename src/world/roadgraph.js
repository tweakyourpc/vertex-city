/**
 * Build a compact directed road graph from the polylines worlds already keep.
 * OSM connectivity is determined by shared node ids, not geometric crossings:
 * two ways crossing at different nodes may be a bridge and must not create a
 * junction. Synthetic worlds fall back to exact, quantized vertex positions.
 */

import { CROSS_GAP, CROSS_DEPTH } from '../config.js';

const NON_DRIVABLE = new Set([
  'bridleway', 'construction', 'corridor', 'cycleway', 'elevator', 'footway',
  'path', 'pedestrian', 'platform', 'proposed', 'raceway', 'steps', 'track',
]);

const DENIED = new Set(['no', 'private']);

function nodeKey(road, i) {
  const id = road.nodeIds && road.nodeIds[i];
  if (id !== undefined && id !== null) return `n:${id}`;
  const [x, y] = road.pts[i];
  return `p:${Math.round(x * 1000)},${Math.round(y * 1000)}`;
}

function drivable(tags = {}, cls = '') {
  if (NON_DRIVABLE.has(cls)) return false;
  if (DENIED.has(tags.access) || DENIED.has(tags.vehicle) ||
      DENIED.has(tags.motor_vehicle)) return false;
  return true;
}

function oneWay(tags = {}) {
  if (tags.oneway === '-1') return -1;
  if (tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true' ||
      tags.junction === 'roundabout') return 1;
  return 0;
}

function normal(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  return { dx: dx / length, dy: dy / length, length };
}

function signalNear(node, points) {
  for (const p of points) {
    const dx = p.x - node.x;
    const dy = p.y - node.y;
    if (dx * dx + dy * dy <= 0.75 * 0.75) return true;
  }
  return false;
}

/** Assign two alternating signal groups from the approach bearings. */
function assignGroups(approaches) {
  if (approaches.length === 0) return;
  const first = approaches[0];
  for (const a of approaches) {
    a.group = Math.abs(first.dx * a.dx + first.dy * a.dy) >= Math.SQRT1_2 ? 0 : 1;
  }
}

/** A street you could walk across here, rather than a ramp leaving the surface. */
function atGrade(tags = {}) {
  if (tags.tunnel && tags.tunnel !== 'no') return false;
  if (tags.bridge && tags.bridge !== 'no') return false;
  return !Number(tags.layer);
}

/**
 * True when at least two arms leave the node on genuinely different bearings.
 *
 * Collinear arms are a kink in one street, or several named ways sharing its
 * nodes; you do not paint a crossing there. 15 degrees is well inside the
 * shallowest real fork and well outside the noise in a surveyed straight.
 */
function divergent(arms) {
  for (let i = 0; i < arms.length; i++) {
    for (let k = i + 1; k < arms.length; k++) {
      const a = arms[i], b = arms[k];
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.26) return true;
    }
  }
  return false;
}

/**
 * How far the intersection box reaches from the node ALONG a given axis.
 *
 * A crossing sits outside the box, in line with the pavement it joins, and
 * what puts it there is the width of the streets being crossed, measured in
 * the direction you are travelling. A street parallel to that direction is the
 * one you are standing on: it makes the box no longer, however wide it is.
 * Taking the widest arm regardless of bearing confused the two, which set an
 * avenue's own crossings back by half the avenue.
 *
 * @param {{arms?:Array, boxHalf?:number}} junction
 * @param {number} dx unit direction along the approach
 * @param {number} dy
 */
export function boxHalfAlong(junction, dx, dy) {
  let reach = 0;
  for (const arm of junction?.arms || []) {
    // |cross| is 1 for a street square to this axis and 0 for one along it,
    // measured out from wherever that arm's own node sits.
    const from = (arm.ox || 0) * dx + (arm.oy || 0) * dy;
    reach = Math.max(reach, from + arm.half * Math.abs(dx * arm.uy - dy * arm.ux));
  }
  // A node where everything is parallel is a kink in one street, not a box.
  return reach > 0 ? reach : (junction?.boxHalf ?? 0);
}

/**
 * Collapse the several nodes OSM uses for one physical intersection into one.
 *
 * A divided avenue meets a cross street at a node per carriageway, and the
 * cross street is usually split at the median besides, so Park Avenue and 33rd
 * is four or five nodes a few cells apart. Each of them is a real junction by
 * itself, and each painted its own crossing: the bands came out three times
 * too deep, smeared, and fighting each other in the depth buffer, because they
 * were three crossings of the same street a metre apart.
 *
 * Two nodes are one intersection when the gap between the boxes they each
 * claim could not hold a crossing anyway. That is the test, rather than a
 * distance picked by eye: if there is no room out there to mark a separate
 * crossing, there is no separate intersection to mark it for. It comes from
 * the same two constants the crossings are drawn from, so the two cannot
 * drift apart. A divided avenue's two carriageways merge; two real
 * intersections a block apart do not come close to merging.
 */
const SAME_INTERSECTION = 2 * (CROSS_GAP + CROSS_DEPTH);

function mergeJunctions(list) {
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  // On a spatial hash: a city extract has thousands of junctions and comparing
  // every pair is millions of hypots on every world load.
  const widest = list.reduce((m, j) => Math.max(m, j.boxHalf), 0);
  const cell = Math.max(8, 2 * widest + SAME_INTERSECTION);
  const buckets = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (let i = 0; i < list.length; i++) {
    const k = keyOf(list[i].x, list[i].y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  }
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const k of buckets.get(`${gx + ox},${gy + oy}`) || []) {
        if (k <= i) continue;
        const b = list[k];
        const reach = a.boxHalf + b.boxHalf + SAME_INTERSECTION;
        if (Math.hypot(a.x - b.x, a.y - b.y) > reach) continue;
        parent[find(i)] = find(k);
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < list.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(list[i]);
  }
  const out = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push({ ...group[0], members: [group[0].id], memberPts: [[group[0].x, group[0].y]] });
      continue;
    }
    const members = new Set(group.map((g) => g.id));
    const x = group.reduce((s, g) => s + g.x, 0) / group.length;
    const y = group.reduce((s, g) => s + g.y, 0) / group.length;
    // An arm that only leads to another node of this same intersection is
    // internal to it: the stub across a median is not a street to cross.
    // Each arm keeps where its own node sits relative to the merged centre, so
    // the box still clears a street on the far side of the median rather than
    // being measured from a centre none of the streets actually pass through.
    const arms = [];
    for (const g of group) for (const arm of g.arms) {
      if (!members.has(arm.to)) arms.push({ ...arm, ox: g.x - x, oy: g.y - y });
    }
    out.push({
      // The lowest member id, so the signal phase offset is stable however the
      // nodes happen to be ordered.
      // memberPts, not just ids: a renderer holds polylines, and a road knows
      // where its vertices are long before it knows what the graph called them.
      id: Math.min(...members), x, y, members: [...members],
      memberPts: group.map((g) => [g.x, g.y]),
      names: [...new Set(group.flatMap((g) => g.names))],
      approaches: group.flatMap((g) => g.approaches),
      signal: group.some((g) => g.signal),
      boxHalf: Math.max(...group.map((g) => g.boxHalf)),
      arms,
    });
  }
  return out;
}

/**
 * @param {Array} roads world road records
 * @param {{signalNodeIds?:Set, signalPoints?:Array}} options
 */
export function buildRoadGraph(roads, {
  signalNodeIds = new Set(), signalPoints = [],
} = {}) {
  const nodes = [];
  const byKey = new Map();
  const edges = [];

  const getNode = (road, i) => {
    const key = nodeKey(road, i);
    let id = byKey.get(key);
    if (id !== undefined) return id;
    const [x, y] = road.pts[i];
    const osmId = road.nodeIds && road.nodeIds[i] !== undefined
      ? road.nodeIds[i] : null;
    id = nodes.length;
    nodes.push({
      id, key, osmId, x, y, incoming: [], outgoing: [], incident: [],
      signal: osmId !== null && signalNodeIds.has(osmId),
    });
    byKey.set(key, id);
    return id;
  };

  const addEdge = (from, to, roadId, road, geom) => {
    const id = edges.length;
    const sourceKey = road.sourceId ?? `road:${roadId}`;
    const edge = {
      id, key: `${sourceKey}:${nodes[from].key}>${nodes[to].key}`,
      from, to, roadId, nameId: road.nameId ?? -1,
      cls: road.cls || 'road', tags: road.tags || {},
      width: Number.isFinite(road.width) ? road.width : undefined,
      length: geom.length, dx: geom.dx, dy: geom.dy,
      reverseId: -1,
    };
    edges.push(edge);
    nodes[from].outgoing.push(id);
    nodes[to].incoming.push(id);
    nodes[from].incident.push(id);
    nodes[to].incident.push(id);
    return id;
  };

  for (let roadId = 0; roadId < roads.length; roadId++) {
    const road = roads[roadId];
    if (!road || !Array.isArray(road.pts) || road.pts.length < 2) continue;
    const ids = road.pts.map((_, i) => getNode(road, i));
    if (!drivable(road.tags, road.cls)) continue;
    const ow = oneWay(road.tags);
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1];
      const b = road.pts[i];
      const geom = normal(a[0], a[1], b[0], b[1]);
      if (!geom) continue;
      if (ow >= 0) {
        const fwd = addEdge(ids[i - 1], ids[i], roadId, road, geom);
        if (ow === 0) {
          const rev = addEdge(ids[i], ids[i - 1], roadId, road,
            { dx: -geom.dx, dy: -geom.dy, length: geom.length });
          edges[fwd].reverseId = rev;
          edges[rev].reverseId = fwd;
        }
      } else {
        addEdge(ids[i], ids[i - 1], roadId, road,
          { dx: -geom.dx, dy: -geom.dy, length: geom.length });
      }
    }
  }

  // A geometry-only signal point is the fallback for recorded/test data whose
  // ways do not retain OSM node ids.
  for (const node of nodes) {
    if (!node.signal && signalNear(node, signalPoints)) node.signal = true;
  }

  const junctions = [];
  const signalJunctions = [];
  for (const node of nodes) {
    const arms = new Map();
    for (const edgeId of node.outgoing) {
      const e = edges[edgeId];
      const key = `${e.to}:${e.nameId}`;
      if (!arms.has(key)) arms.set(key, {
        edgeId, nodeId: e.to, nameId: e.nameId, cls: e.cls,
        dx: e.dx, dy: e.dy, group: 0,
      });
    }
    for (const edgeId of node.incoming) {
      const e = edges[edgeId];
      const key = `${e.from}:${e.nameId}`;
      if (!arms.has(key)) arms.set(key, {
        edgeId, nodeId: e.from, nameId: e.nameId, cls: e.cls,
        dx: -e.dx, dy: -e.dy, group: 0,
      });
    }
    const approaches = [...arms.values()];
    assignGroups(approaches);
    const names = [...new Set(approaches.map((a) => a.nameId).filter((n) => n >= 0))];
    // Every street meeting here, as a direction away from the node and a half
    // width. How far the box reaches depends on WHICH WAY you are leaving it,
    // so the arms are kept rather than collapsed to one number: see
    // boxHalfAlong. A single max meant an avenue's own crossings were set back
    // by half the avenue, which is a distance in the wrong axis entirely, and
    // put them a third of the way up the block.
    const boxArms = [];
    let boxHalf = 0;
    for (const edgeId of node.incident) {
      const e = edges[edgeId];
      const w = Number.isFinite(e?.width) ? e.width : 3.38;
      const away = e.from === node.id ? 1 : -1;
      // A ramp leaving the surface is not a street you can cross into, and the
      // portal where it parts company with the road above is not an
      // intersection. Park Avenue Tunnel dives away mid-block; counted as an
      // arm it made a junction there and painted a crossing on open road.
      if (!atGrade(e.tags)) continue;
      boxHalf = Math.max(boxHalf, w / 2);
      boxArms.push({
        ux: e.dx * away, uy: e.dy * away, half: w / 2,
        to: away > 0 ? e.to : e.from, nameId: e.nameId,
      });
    }
    // Two names at a node is not an intersection. Park Avenue carries the
    // separately named Park Avenue Tunnel and its service roads along the SAME
    // nodes, so every vertex of a dead-straight avenue answered to "two names
    // meet here" and became a junction: on a way with a vertex every few cells
    // that is a junction every few cells, each painting its own crossing, and
    // the carriageway disappeared under crosswalks. What makes a junction is
    // arms that diverge, so that is what is asked.
    const j = { id: node.id, x: node.x, y: node.y, names, approaches,
                signal: node.signal, boxHalf, arms: boxArms };
    if (names.length >= 2 && divergent(boxArms)) junctions.push(j);
    if (node.signal && approaches.length >= 2) signalJunctions.push(j);
  }

  const merged = mergeJunctions(junctions);
  const junctionOfNode = new Map();
  for (const j of merged) for (const id of j.members) junctionOfNode.set(id, j);

  return {
    nodes, edges, junctions: merged, signalJunctions, junctionOfNode,
    nodeJunctions: junctions,
  };
}

export function positionOnEdge(graph, edge, distance, laneOffset = 0) {
  const a = graph.nodes[edge.from];
  const d = Math.max(0, Math.min(edge.length, distance));
  return {
    x: a.x + edge.dx * d + edge.dy * laneOffset,
    y: a.y + edge.dy * d - edge.dx * laneOffset,
  };
}
