/**
 * Build a compact directed road graph from the polylines worlds already keep.
 * OSM connectivity is determined by shared node ids, not geometric crossings:
 * two ways crossing at different nodes may be a bridge and must not create a
 * junction. Synthetic worlds fall back to exact, quantized vertex positions.
 */

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
    // |cross| is 1 for a street square to this axis and 0 for one along it.
    reach = Math.max(reach, arm.half * Math.abs(dx * arm.uy - dy * arm.ux));
  }
  // A node where everything is parallel is a kink in one street, not a box.
  return reach > 0 ? reach : (junction?.boxHalf ?? 0);
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
      boxHalf = Math.max(boxHalf, w / 2);
      const away = e.from === node.id ? 1 : -1;
      boxArms.push({ ux: e.dx * away, uy: e.dy * away, half: w / 2 });
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

  return { nodes, edges, junctions, signalJunctions };
}

export function positionOnEdge(graph, edge, distance, laneOffset = 0) {
  const a = graph.nodes[edge.from];
  const d = Math.max(0, Math.min(edge.length, distance));
  return {
    x: a.x + edge.dx * d + edge.dy * laneOffset,
    y: a.y + edge.dy * d - edge.dx * laneOffset,
  };
}
