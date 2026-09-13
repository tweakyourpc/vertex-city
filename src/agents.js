import { T, wrap } from './world/source.js';
import { normAngle } from './camera.js';
import { BLOCK, FOV, MAXD, MAX_CARS, MAX_PEDS, AGENT_CULL_D2, METERS_PER_CELL, PED_HEIGHT, PED_WIDTH, stopLineFor } from './config.js';
import { fogOf } from './render/materials.js';
import { positionOnEdge } from './world/roadgraph.js';
import { buildEdgeIndex } from './spatial.js';
import { signalGroupForIncoming, signalState } from './traffic-signals.js';
import {
  drawVehicle, MAX_RICH_VEHICLES, smoothVehicleHeading, vehicleProfile,
  VEHICLE_LOD,
} from './render/vehicles.js';

/** Pedestrians, with arms. Two phases so a walk cycle is possible. */
const PED_LOD = [
  [
    [' o ', '/|\\', '/ \\'],
    [' o ', '\\|/', '| |'],
  ],
  [
    ['  o  ', ' /|\\ ', '  |  ', ' / \\ ', '/   \\'],
    ['  o  ', ' \\|/ ', '  |  ', ' | | ', ' | | '],
  ],
  [
    ['   o   ', '  ___  ', ' / | \\ ', '/  |  \\', '   |   ', '  / \\  ', ' /   \\ ', '/     \\'],
    ['   o   ', '  ___  ', ' \\ | / ', '  \\|/  ', '   |   ', '  | |  ', '  | |  ', ' /   \\ '],
  ],
];

/**
 * Pick a detail level from how many TEXT LINES the sprite covers. Internal
 * rows are twice as fine in block mode, so the span is divided by rowStep or
 * every sprite jumps to the highest detail level when the mode changes.
 */
function lodFor(rows, rowStep) {
  const lines = rows / rowStep;
  return lines >= 14 ? 2 : lines >= 6 ? 1 : 0;
}

/** Cars route the directed OSM/procedural graph; pedestrians use surface cells. */
export const TRAFFIC = { OFF: 0, CARS: 1, ALL: 2 };

const ROAD_WIDTH_CELLS = {
  motorway: 8.44, trunk: 7.59, primary: 6.75, secondary: 5.48,
  tertiary: 4.64, residential: 3.80, unclassified: 3.80,
  living_street: 3.38, service: 2.11,
};

/**
 * How far off the centreline a pedestrian walks, in cells: the far side of the
 * carriageway plus a pavement's width.
 *
 * Pedestrians used to walk a raster axis, picked at random and unrelated to the
 * street they were standing on, reversing whenever they stepped off a sidewalk
 * cell. On a one-cell pavement, or on any OSM street that is not axis aligned,
 * that is a reversal almost every step: they paced instead of going anywhere,
 * covering 43 m in 30 seconds to end up 2.3 m away. Walking the same directed
 * graph the cars use, offset onto the pavement, is what makes a walk a journey.
 */
export function walkOffsetForEdge(edge) {
  const width = Number.isFinite(edge?.width)
    ? edge.width : (ROAD_WIDTH_CELLS[edge?.cls] ?? 3.38);
  return width * 0.5 + 0.85;
}

/**
 * Do two agents' footprints overlap?
 *
 * Tested in `a`'s frame: along its heading against the two half-lengths, across
 * it against the two half-widths. An approximation of two oriented boxes, and
 * close enough at this scale to keep solid things out of each other.
 *
 * Braking alone could never guarantee this. Slowing down is advice, and advice
 * loses whenever the deceleration cannot cover the closing speed; the only way
 * nothing ends up inside anything else is to refuse the move that would do it.
 */
export function footprintsOverlap(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!(Math.abs(dx) < 6) || !(Math.abs(dy) < 6)) return false;
  const hx = a.hx || 1, hy = a.hy || 0;
  const along = Math.abs(dx * hx + dy * hy);
  const across = Math.abs(dx * hy - dy * hx);
  const aL = a.vehicle ? a.vehicle.length / 2 : PED_WIDTH / 2;
  const aW = a.vehicle ? a.vehicle.width / 2 : PED_WIDTH / 2;
  const bL = b.vehicle ? b.vehicle.length / 2 : PED_WIDTH / 2;
  const bW = b.vehicle ? b.vehicle.width / 2 : PED_WIDTH / 2;
  return along < aL + bL && across < aW + bW;
}

/** Centre one lane in each directed half of the mapped carriageway. */
export function laneOffsetForEdge(edge) {
  const width = Number.isFinite(edge?.width)
    ? edge.width : (ROAD_WIDTH_CELLS[edge?.cls] ?? 3.38);
  if (edge?.reverseId < 0 && Number(edge?.tags?.lanes || 1) <= 1) return 0;
  return Math.max(0.48, Math.min(1.75, width * 0.25));
}

export class Traffic {
  constructor(world, { seed = 0x41534349 } = {}) {
    this.world = world;
    this.agents = [];
    this.seed = seed >>> 0;
    this._seedState = this.seed;
    this._routeState = this.seed ^ 0x9e3779b9;
    this._nextId = 1;
    this.maxCars = MAX_CARS;
    this.detailMode = 'auto';
    this.renderStats = { simulated: 0, visible: 0, cells: 0, near: 0, mid: 0, far: 0 };
    // Cars give a sense of scale that empty roads lack. Pedestrians at this
    // resolution mostly read as noise, so they are opt-in.
    this.mode = TRAFFIC.CARS;
  }

  _nextVehicleSeed() {
    this._seedState = (Math.imul(this._seedState, 1664525) + 1013904223) >>> 0;
    return this._seedState;
  }

  _random() {
    this._routeState = (Math.imul(this._routeState, 1664525) + 1013904223) >>> 0;
    return this._routeState / 0x100000000;
  }

  /** Developer control: repeat a traffic run without adding normal UI. */
  setSeed(seed, { respawn = true } = {}) {
    if (!Number.isFinite(Number(seed))) return this.seed;
    this.seed = Number(seed) >>> 0;
    this._seedState = this.seed;
    this._routeState = this.seed ^ 0x9e3779b9;
    if (respawn) this.agents.length = 0;
    return this.seed;
  }

  /** Developer control: 0.25..2.3 times the normal 26-car cap. */
  setDensity(scale = 1) {
    // `Number(scale) || 1` turned a requested 0 into 1, because zero is falsy:
    // asking for the emptiest streets silently gave the default ones. Only a
    // value that is not a number should fall back.
    const asked = Number(scale);
    const value = Math.max(0.25, Math.min(2.3, Number.isFinite(asked) ? asked : 1));
    // The ceiling has to stay above the default or the upper half of the range
    // does nothing: it was a flat 60 when the default was 26, and is now scaled
    // off MAX_CARS so "2.3x" still means 2.3x.
    this.maxCars = Math.max(1, Math.min(MAX_CARS * 2.5, Math.round(MAX_CARS * value)));
    let cars = 0;
    for (const agent of this.agents) if (agent.kind === 'car') cars++;
    for (let i = this.agents.length - 1; i >= 0 && cars > this.maxCars; i--) {
      if (this.agents[i].kind !== 'car') continue;
      this.agents.splice(i, 1);
      cars--;
    }
    return this.maxCars;
  }

  /** Developer control: force auto/near/mid/far to inspect LOD transitions. */
  setDetailMode(mode = 'auto') {
    if (!['auto', 'near', 'mid', 'far'].includes(mode)) return this.detailMode;
    this.detailMode = mode;
    return this.detailMode;
  }

  _prepareCar(car) {
    if (car.kind !== 'car') return car;
    if (!car.vehicleSeed) car.vehicleSeed = this._nextVehicleSeed();
    if (!car.vehicle) car.vehicle = vehicleProfile(car.vehicleSeed);
    return car;
  }

  cycle() {
    this.mode = (this.mode + 1) % 3;
    if (this.mode === TRAFFIC.OFF) this.agents.length = 0;
    if (this.mode === TRAFFIC.CARS) {
      for (let i = this.agents.length - 1; i >= 0; i--) {
        if (this.agents[i].kind === 'ped') this.agents.splice(i, 1);
      }
    }
    return this.mode;
  }

  setWorld(world) {
    this.world = world;
    this.agents.length = 0;
    this._seedState = this.seed;
    this._routeState = this.seed ^ 0x9e3779b9;
  }

  /**
   * Rebind traffic to a rebuilt geographic world without making every moving
   * car disappear. Directed edge keys are stable across OSM reprojection, so
   * progress can be restored as a fraction of the replacement edge length.
   */
  rebindWorld(world, { preserve = true } = {}) {
    const previous = this.world?.roadGraph;
    if (!preserve || !previous || !world?.roadGraph) {
      this.setWorld(world);
      return;
    }
    const saved = [];
    for (const agent of this.agents) {
      if (agent.kind !== 'car' || agent.edgeId === undefined) continue;
      const edge = previous.edges[agent.edgeId];
      if (!edge?.key) continue;
      saved.push({
        agent,
        key: edge.key,
        fraction: edge.length > 0 ? agent.distance / edge.length : 0,
      });
    }
    this.world = world;
    const byKey = new Map(world.roadGraph.edges.map((edge) => [edge.key, edge]));
    this.agents = saved.flatMap(({ agent, key, fraction }) => {
      const edge = byKey.get(key);
      if (!edge) return [];
      agent.edgeId = edge.id;
      agent.distance = Math.max(0, Math.min(edge.length, fraction * edge.length));
      const p = positionOnEdge(world.roadGraph, edge, agent.distance,
        laneOffsetForEdge(edge));
      agent.x = p.x;
      agent.y = p.y;
      agent.renderX = p.x;
      agent.renderY = p.y;
      agent.hx = edge.dx;
      agent.hy = edge.dy;
      return [agent];
    });
  }

  /**
   * OSM streets are not on a 14-cell block grid, so the lane maths below has
   * nothing to align to. Put the agent on a known road cell near the camera
   * instead, and let the off-road reversal in update() keep it on the street.
   */
  _spawnOsm(kind, cam) {
    const world = this.world;
    if (world.roadGraph?.edges.length) {
      const graph = world.roadGraph;
      // Build (once) a spatial index of edges so spawning picks a nearby edge
      // instead of scanning the whole graph. Cached on the world; rebuilt only
      // if the graph identity changes (e.g. after a streamed merge).
      if (!world._edgeIndex || world._edgeIndexGraph !== graph) {
        world._edgeIndex = buildEdgeIndex(graph);
        world._edgeIndexGraph = graph;
      }
      const envelope = {
        minX: cam.x - 90, maxX: cam.x + 90,
        minY: cam.y - 90, maxY: cam.y + 90,
      };
      const candidates = world._edgeIndex?.query(envelope);
      const pool = candidates && candidates.length ? candidates : graph.edges;
      for (let attempt = 0; attempt < 30; attempt++) {
        const edge = pool[(this._random() * pool.length) | 0];
        if (edge.length < 1) continue;
        const distance = this._random() * edge.length;
        const p = positionOnEdge(graph, edge, distance, laneOffsetForEdge(edge));
        const d2 = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2;
        if (d2 < 256 || d2 > AGENT_CULL_D2 * 0.75) continue;
        // Nothing checked whether the spot was already occupied, so a car could
        // be created inside another one and appear to peel out of it. Two car
        // lengths of clear road, or try somewhere else.
        if (kind === 'car') {
          let taken = false;
          for (const other of this.agents) {
            if (other.kind !== 'car') continue;
            const dd = (other.x - p.x) ** 2 + (other.y - p.y) ** 2;
            if (dd < 16) { taken = true; break; }
          }
          if (taken) continue;
        }
        if (kind === 'ped') {
          // Either pavement, and a walking pace rather than a driving one.
          // Spawn onto pavement, not into the road, for the same reason.
          let side = this._random() < 0.5 ? 1 : -1;
          const woff = walkOffsetForEdge(edge);
          if (world.type[world.sample(
                positionOnEdge(graph, edge, distance, woff * side).x,
                positionOnEdge(graph, edge, distance, woff * side).y)] === T.ROAD) {
            side = -side;
          }
          const w = positionOnEdge(graph, edge, distance, woff * side);
          this.agents.push({
            kind, edgeId: edge.id, distance, walkSide: side,
            x: w.x, y: w.y, renderX: w.x, renderY: w.y,
            hx: edge.dx, hy: edge.dy,
            spd: (1.25 + this._random() * 0.45) / METERS_PER_CELL,
            pal: (this._random() * 4) | 0,
            // A stable per-person seed. Everyone was drawn in one shirt, one
            // pair of trousers and one skin tone, because there was nothing to
            // vary them by.
            tint: (this._random() * 4294967296) >>> 0,
          });
          return true;
        }
        const car = this._prepareCar({
          kind, id: this._nextId++, edgeId: edge.id, distance, x: p.x, y: p.y,
          renderX: p.x, renderY: p.y,
          hx: edge.dx, hy: edge.dy, spd: 2 + this._random() * 2,
          targetSpd: 5 + this._random() * 3, pal: (this._random() * 4) | 0,
        });
        this.agents.push(car);
        return true;
      }
      return false;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const p = world.randomRoadCell();
      if (!p) return false;
      const dx = p.x - cam.x;
      const dy = p.y - cam.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 256 || d2 > AGENT_CULL_D2 * 0.75) continue;

      const t = world.type[world.sample(p.x, p.y)];
      if (kind === 'car' ? t !== T.ROAD : t !== T.SIDEWALK) continue;

      this.agents.push({
        kind,
        axis: this._random() < 0.5 ? 'x' : 'y',
        dir: this._random() < 0.5 ? 1 : -1,
        side: this._random() < 0.5,
        x: p.x, y: p.y, inX: false,
        spd: kind === 'car' ? 3 + this._random() * 5 : (1.1 + this._random() * 0.5) / METERS_PER_CELL,
        pal: (this._random() * 4) | 0,
      });
      return true;
    }
    return false;
  }

  _spawn(kind, cam) {
    const world = this.world;
    if (world.randomRoadCell) return this._spawnOsm(kind, cam);

    const ang = this._random() * Math.PI * 2;
    const rad = 16 + this._random() * 58;
    const sx = cam.x + Math.cos(ang) * rad;
    const sy = cam.y + Math.sin(ang) * rad;
    const bx = Math.floor(sx / BLOCK) * BLOCK;
    const by = Math.floor(sy / BLOCK) * BLOCK;

    const a = {
      kind,
      axis: this._random() < 0.5 ? 'x' : 'y',
      dir: this._random() < 0.5 ? 1 : -1,
      side: this._random() < 0.5,
      x: sx, y: sy, inX: false,
      spd: kind === 'car' ? 3 + this._random() * 5 : (1.1 + this._random() * 0.5) / METERS_PER_CELL,
      pal: (this._random() * 4) | 0,
    };

    if (kind === 'car') {
      if (a.axis === 'y') a.x = bx + (a.dir > 0 ? 0.6 : 2.4);
      else a.y = by + (a.dir > 0 ? 0.6 : 2.4);
      a.hx = a.axis === 'x' ? a.dir : 0;
      a.hy = a.axis === 'y' ? a.dir : 0;
      this._prepareCar(a);
    } else if (a.axis === 'y') {
      a.x = bx + (a.side ? 3.5 : 13.5);
    } else {
      a.y = by + (a.side ? 3.5 : 13.5);
    }

    const t = world.type[world.sample(a.x, a.y)];
    if (kind === 'car' ? t !== T.ROAD : t !== T.SIDEWALK) return false;
    this.agents.push(a);
    return true;
  }

  /**
   * @param {number} dt seconds
   * @param {object} cam camera, for spawning and culling
   * @param {number} [now] the scene's clock in seconds. Signals are read from
   *   this, and the surface renderer is handed the same value, so the light a
   *   driver obeys is the light you can see. It used to read Date.now()
   *   directly while the renderer was given simTime, which are different
   *   clocks: under time travel they diverge outright, and cars would hold at
   *   a red that was drawn green.
   */
  update(dt, cam, now = Date.now() / 1000) {
    const world = this.world;
    if (this.mode === TRAFFIC.OFF || world.hasStreets === false) {
      this.agents.length = 0;
      return;
    }
    const agents = this.agents;

    for (let i = agents.length - 1; i >= 0; i--) {
      const a = agents[i];
      const dx = a.x - cam.x;
      const dy = a.y - cam.y;
      if (dx * dx + dy * dy > AGENT_CULL_D2) { agents.splice(i, 1); continue; }

      if (a.kind === 'ped' && a.edgeId !== undefined && world.roadGraph) {
        this._updateGraphPed(a, dt);
        continue;
      }

      if (a.kind === 'car' && a.edgeId !== undefined && world.roadGraph) {
        this._prepareCar(a);
        this._updateGraphCar(a, dt, agents, now);
        continue;
      }

      if (a.axis === 'x') a.x += a.dir * a.spd * dt;
      else a.y += a.dir * a.spd * dt;

      const mx = wrap(a.x, BLOCK);
      const my = wrap(a.y, BLOCK);
      const atCross = mx < 3 && my < 3;

      if (atCross && !a.inX) {
        a.inX = true;
        if (this._random() < (a.kind === 'car' ? 0.35 : 0.5)) {
          a.axis = a.axis === 'x' ? 'y' : 'x';
          a.dir = this._random() < 0.5 ? 1 : -1;
          const bx = Math.floor(a.x / BLOCK) * BLOCK;
          const by = Math.floor(a.y / BLOCK) * BLOCK;
          if (a.kind === 'car') {
            if (a.axis === 'y') a.x = bx + (a.dir > 0 ? 0.6 : 2.4);
            else a.y = by + (a.dir > 0 ? 0.6 : 2.4);
          }
        }
      } else if (!atCross) {
        a.inX = false;
      }

      if (a.kind === 'car') {
        this._prepareCar(a);
        smoothVehicleHeading(a, a.axis === 'x' ? a.dir : 0,
          a.axis === 'y' ? a.dir : 0, dt);
      }

      // Keep agents on their own surface. Pedestrians always did this; cars
      // need it too on OSM streets, which have no lane grid to follow.
      const surface = world.type[world.sample(a.x, a.y)];
      const wanted = a.kind === 'car' ? T.ROAD : T.SIDEWALK;
      if (surface !== wanted) {
        a.dir = -a.dir;
        // Step back onto the road immediately, or it oscillates on the kerb.
        if (a.axis === 'x') a.x += a.dir * a.spd * dt;
        else a.y += a.dir * a.spd * dt;
      }
    }

    let cars = 0;
    let peds = 0;
    for (let i = 0; i < agents.length; i++) {
      if (agents[i].kind === 'car') cars++; else peds++;
    }
    for (let i = 0; i < 3; i++) if (cars < this.maxCars && this._spawn('car', cam)) cars++;
    if (this.mode === TRAFFIC.ALL) {
      for (let i = 0; i < 3; i++) if (peds < MAX_PEDS && this._spawn('ped', cam)) peds++;
    }
  }

  /**
   * Walk the street network, on the pavement.
   *
   * The same directed graph the cars drive, offset to one side and taken at
   * walking pace. At a node the walker picks any arm, including the one it
   * arrived on, so a route wanders the way a person's does rather than
   * repeating a loop. Crucially it keeps going: the old surface walk reversed
   * whenever it stepped off a sidewalk cell, which on a narrow or angled
   * pavement meant reversing continually and travelling nowhere.
   */
  _updateGraphPed(a, dt) {
    const graph = this.world.roadGraph;
    let edge = graph.edges[a.edgeId];
    if (!edge) return;

    a.distance += a.spd * dt;
    let hops = 0;
    while (a.distance >= edge.length && edge.length > 0 && hops++ < 4) {
      const overflow = a.distance - edge.length;
      const arms = graph.nodes[edge.to].outgoing;
      if (!arms.length) { a.distance = Math.max(0, edge.length - 0.01); break; }
      a.edgeId = arms[(this._random() * arms.length) | 0];
      edge = graph.edges[a.edgeId];
      a.distance = Math.min(overflow, Math.max(0, edge.length - 0.001));
      // Take whichever pavement leaves the walker nearest to where they already
      // are. Flipping sides at random put them on the far kerb in one frame: a
      // 16 m jump where a walking step is 2 cm, which reads as vanishing and
      // reappearing down the block. Turning a corner still moves them a little
      // sideways, and the render smoothing below absorbs that.
      // Prefer a side that is actually pavement, then the one that keeps the
      // walk continuous. A road graph's centreline is not necessarily centred
      // in the road it was rasterised from, so a symmetric offset can be clear
      // of the kerb on one side and still in the carriageway on the other.
      const off = walkOffsetForEdge(edge);
      const ez = Math.max(0.8, Math.min(1,
        a.distance / 2.5, (edge.length - a.distance) / 2.5));
      let best = a.walkSide || 1, bestScore = -Infinity;
      for (const sd of [1, -1]) {
        const c = positionOnEdge(graph, edge, a.distance, off * sd * ez);
        const paved = this.world.type[this.world.sample(c.x, c.y)] !== T.ROAD;
        const near = -((c.x - a.x) ** 2 + (c.y - a.y) ** 2);
        const score = (paved ? 1e6 : 0) + near;
        if (score > bestScore) { bestScore = score; best = sd; }
      }
      a.walkSide = best;
    }

    // Ease the walker in toward the centreline near each end of an edge, so a
    // corner is rounded rather than stepped. Two pavements meeting at a right
    // angle put their offsets in different directions, and holding the full
    // offset to the last centimetre teleports the walker across that gap the
    // instant the edge changes. Easing leaves a small, smoothable step and
    // reads as someone walking to the corner and turning.
    // The floor has to keep the walker outside the carriageway. At 0.3 of a
    // 2.7-cell offset they stood 0.8 cells from the centreline, which is in the
    // road: that is why people were strolling through traffic at every corner.
    // 0.8 rounds the corner without ever leaving the kerb.
    const ease = Math.max(0.8, Math.min(1,
      a.distance / 2.5, (edge.length - a.distance) / 2.5));
    // Step out until the ground is walkable. A nominal carriageway width is not
    // the rasterised one: near a junction the road box is wider than the lane
    // table says, so a fixed offset left about a fifth of all walkers standing
    // in the road. Asking the world costs a few samples per person per frame
    // and is the only thing that knows where the kerb actually is.
    const side = a.walkSide || 1;
    const base = walkOffsetForEdge(edge) * ease;
    // Test each candidate before accepting it. The previous loop checked the
    // one it already held and then reassigned, so the furthest step out was
    // never examined at all and could be road like the rest.
    let p = null;
    for (let extra = 0; extra <= 3.0; extra += 0.5) {
      const c = positionOnEdge(graph, edge, a.distance, (base + extra) * side);
      if (!p) p = c;
      if (this.world.type[this.world.sample(c.x, c.y)] !== T.ROAD) { p = c; break; }
    }
    // The graph position is where this walker is *heading*, not where they are.
    // Assigning it outright is what teleported people: the pavement offset can
    // change by a couple of cells in a frame when it steps out to find real
    // ground, and turning a corner swings it further still, neither of which a
    // person can do in a sixtieth of a second. Walk toward it instead, a little
    // faster than a stroll so corners are caught up within a step or two, and
    // never faster than that. Nothing else can then move them discontinuously.
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) { a.x = p.x; a.y = p.y; }
    const dx = p.x - a.x, dy = p.y - a.y;
    const want = Math.hypot(dx, dy);
    const stride = a.spd * dt * 1.8;
    const fromX = a.x, fromY = a.y;
    if (want > stride && want > 1e-6) {
      a.x += (dx / want) * stride;
      a.y += (dy / want) * stride;
    } else {
      a.x = p.x;
      a.y = p.y;
    }
    // A person does not walk through a car either. Refuse the step and wait;
    // the car will clear, and a pedestrian standing still at a kerb is a great
    // deal more believable than one passing through a bus.
    for (const other of this.agents) {
      if (other === a) continue;
      if (!footprintsOverlap(a, other)) continue;
      const was = { x: fromX, y: fromY, hx: a.hx, hy: a.hy };
      if (!footprintsOverlap(was, other)) { a.x = fromX; a.y = fromY; break; }
    }
    // Face the direction actually walked, so someone rounding a corner turns
    // through it rather than snapping to the new street's bearing.
    if (want > 1e-4) {
      const bl = 1 - Math.exp(-Math.max(0, dt) * 8);
      a.hx += ((dx / want) - a.hx) * bl;
      a.hy += ((dy / want) - a.hy) * bl;
      const hl = Math.hypot(a.hx, a.hy) || 1;
      a.hx /= hl; a.hy /= hl;
    }
    if (!Number.isFinite(a.renderX) || !Number.isFinite(a.renderY)) {
      a.renderX = a.x; a.renderY = a.y;
    } else {
      const blend = 1 - Math.exp(-Math.max(0, dt) * 13);
      a.renderX += (a.x - a.renderX) * blend;
      a.renderY += (a.y - a.renderY) * blend;
    }
  }

  _updateGraphCar(a, dt, agents, now = Date.now() / 1000) {
    this._prepareCar(a);
    const graph = this.world.roadGraph;
    let edge = graph.edges[a.edgeId];
    if (!edge) return;
    const remaining = edge.length - a.distance;
    let desired = a.targetSpd;

    const node = graph.nodes[edge.to];
    // Stop at the crossing, not in the middle of the box. The stop line was a
    // flat 1.2 cells before the node, which is the junction's centre, so a car
    // held its red light parked across the crosswalk it was supposed to keep
    // clear. district.js sets the crossing back half a carriageway plus 2.4,
    // and its bars are 2.35 deep, so the line is behind all of that.
    const lanes = Number.isFinite(edge.width)
      ? edge.width : (ROAD_WIDTH_CELLS[edge.cls] ?? 3.38);
    // `distance` is the car's CENTRE, so stopping the centre on the line put
    // half a car length of bonnet across the crossing. The bumper is what has
    // to be behind the line, and the line itself comes from the junction's own
    // box size, which is what the renderer paints against.
    const junction = graph.junctions?.find((j) => j.id === node.id);
    const boxHalf = junction?.boxHalf ?? lanes / 2;
    const stopBack = stopLineFor(boxHalf) + a.vehicle.length / 2;
    // Only brake for the light while there is still room to stop behind the
    // line. Past it the car is committed: braking there is what parked cars
    // across the crossing and left them in the box when the phase changed, and
    // it is not what a driver does either. Once over the line you go through.
    const canStillStop = remaining > stopBack;
    if (node.signal && remaining < stopBack + 9 && canStillStop) {
      const group = signalGroupForIncoming(graph, node, edge);
      const state = signalState(now, group, node.id * 0.17);
      if (state !== 'green') {
        desired = Math.min(desired, Math.max(0, (remaining - stopBack) * 1.4));
      }
    }

    // Simple same-lane headway. It removes overlaps without coupling cars to
    // raster cells, so their motion remains continuous on diagonal streets.
    let gap = Infinity;
    for (const other of agents) {
      if (other === a || other.kind !== 'car' || other.edgeId !== a.edgeId) continue;
      const ahead = other.distance - a.distance;
      if (ahead > 0 && ahead < gap) gap = ahead;
    }

    // Same-lane headway only ever sees cars that share an edge, so two cars
    // crossing at a junction, or meeting where lanes converge, were invisible
    // to each other and drove straight through. Pedestrians were never
    // considered at all. Sweep everyone in a corridor ahead in world space,
    // which catches all of those with one test and no lane bookkeeping.
    // Every comparison is written so that a NaN fails it and the agent is
    // skipped. A car without a position or heading yet would otherwise pass
    // the guards, since NaN satisfies no inequality, and set the gap to NaN,
    // which silently disables braking for everyone.
    //
    // Cross traffic needs a right of way, or two cars meeting at a junction
    // each brake for the other and neither ever moves again. Without one, cars
    // spent 87% of their time stopped and some never restarted. Whoever is
    // closer to the end of their edge is nearer the junction and goes first;
    // ties break on id so the rule is total and deadlock has nowhere to live.
    // It is also only consulted at close range: a car eleven cells away on
    // another street is not a conflict, it is scenery.
    const CROSS_REACH = 5.0;
    const myRemaining = edge.length - a.distance;
    const halfWide = a.vehicle.width * 0.5;
    for (const other of agents) {
      if (other === a) continue;
      const sameLane = other.kind === 'car' && other.edgeId === a.edgeId;
      const ahead = (other.x - a.x) * a.hx + (other.y - a.y) * a.hy;
      const reach = sameLane ? gap : Math.min(gap, CROSS_REACH);
      if (!(ahead > 0) || !(ahead < reach)) continue;
      const lateral = Math.abs((other.x - a.x) * a.hy - (other.y - a.y) * a.hx);
      const theirs = other.kind === 'car'
        ? (this._prepareCar(other).vehicle.width * 0.5) : PED_WIDTH * 0.5;
      if (!(lateral <= halfWide + theirs + 0.12)) continue;
      if (!sameLane && other.kind === 'car') {
        const theirEdge = graph.edges[other.edgeId];
        const theirRemaining = theirEdge ? theirEdge.length - other.distance : Infinity;
        const yieldToThem = theirRemaining < myRemaining
          || (theirRemaining === myRemaining && (other.id | 0) < (a.id | 0));
        if (!yieldToThem) continue;
      }
      gap = ahead;
    }
    // Braking used to engage at 6 cells. A car at full speed needs about 4.6 to
    // stop at this deceleration, so it was committing to the stop with almost
    // no margin and still slid into whatever it was braking for.
    if (gap < 11) {
      let leadLength = a.vehicle.length;
      for (const other of agents) {
        if (other === a || other.kind !== 'car' || other.edgeId !== a.edgeId) continue;
        if (other.distance > a.distance && Math.abs(other.distance - a.distance - gap) < 0.001) {
          this._prepareCar(other);
          leadLength = other.vehicle.length;
          break;
        }
      }
      const clearance = (a.vehicle.length + leadLength) * 0.5 + 0.55;
      desired = Math.min(desired, Math.max(0, (gap - clearance) * 1.5));
    }

    // Do not enter a junction you cannot clear. Crossing on green into a queue
    // that ends inside the box is what leaves a car stranded across the cross
    // street when the phase changes: it is out of everyone's way only if there
    // is somewhere for it to be on the far side first.
    if (node.signal && remaining < stopBack + 1.5 && canStillStop) {
      // Only cars going roughly my way are my queue. Using the general gap
      // counted the cross traffic stopped at its own red as though it were
      // blocking my exit, so cars refused to move on green while the junction
      // in front of them was empty.
      let queueGap = Infinity;
      for (const other of agents) {
        if (other === a || other.kind !== 'car') continue;
        if (!((other.hx * a.hx + other.hy * a.hy) > 0.6)) continue;
        const ahead = (other.x - a.x) * a.hx + (other.y - a.y) * a.hy;
        if (!(ahead > 0) || !(ahead < queueGap)) continue;
        const lateral = Math.abs((other.x - a.x) * a.hy - (other.y - a.y) * a.hx);
        if (!(lateral <= a.vehicle.width + 0.3)) continue;
        queueGap = ahead;
      }
      const needed = remaining + a.vehicle.length * 1.1;
      if (queueGap < needed) {
        desired = Math.min(desired, Math.max(0, (remaining - stopBack) * 1.4));
      }
    }

    a.braking = desired < a.targetSpd - 0.75 && desired < a.spd + 0.25;

    const rate = desired < a.spd ? 7 : 2.2;
    a.spd += Math.max(-rate * dt, Math.min(rate * dt, desired - a.spd));
    const beforeAdvance = a.distance;
    a.distance += a.spd * dt;

    while (a.distance >= edge.length && edge.length > 0) {
      const overflow = a.distance - edge.length;
      const outgoing = graph.nodes[edge.to].outgoing
        .filter((id) => id !== edge.reverseId);
      const choices = outgoing.length ? outgoing : graph.nodes[edge.to].outgoing;
      if (!choices.length) {
        a.distance = Math.max(0, edge.length - 0.1);
        a.spd = 0;
        break;
      }
      const prevDx = edge.dx, prevDy = edge.dy;
      a.edgeId = choices[(this._random() * choices.length) | 0];
      edge = graph.edges[a.edgeId];
      a.distance = Math.min(overflow, Math.max(0, edge.length - 0.001));
      // Which way this turn goes, for the indicators. The cross product's sign
      // is the side; anything near straight ahead is not a turn and shows
      // nothing, the way a driver would not signal for a bend in the road.
      const cross = prevDx * edge.dy - prevDy * edge.dx;
      const dot = prevDx * edge.dx + prevDy * edge.dy;
      a.turn = (dot > 0.82 || Math.abs(cross) < 0.22) ? 0 : (cross > 0 ? 1 : -1);
      a.turnUntil = a.distance + 2.6;
    }
    if (a.turn && a.distance > a.turnUntil) a.turn = 0;
    // Ease toward the centreline at each end of an edge. Holding a full lane
    // offset to the last centimetre and then switching edges moves the car
    // sideways in one frame and turns it on the spot; easing gives the corner
    // an arc to follow, which is what a turn looks like.
    const ease = Math.max(0.35, Math.min(1,
      a.distance / 3.2, (edge.length - a.distance) / 3.2));
    const p = positionOnEdge(graph, edge, a.distance, laneOffsetForEdge(edge) * ease);
    const movedX = p.x - a.x, movedY = p.y - a.y;
    if (!Number.isFinite(a.renderX) || !Number.isFinite(a.renderY)) {
      a.renderX = p.x;
      a.renderY = p.y;
    } else {
      const blend = 1 - Math.exp(-Math.max(0, dt) * 13);
      a.renderX += (p.x - a.renderX) * blend;
      a.renderY += (p.y - a.renderY) * blend;
    }
    // Hard constraint. Everything above is advice: a desired speed, a gap, a
    // right of way. None of it guarantees anything, and whenever the closing
    // speed beat the braking the cars simply drove through each other. A move
    // that would put this car inside another car or a pedestrian is refused
    // outright, and the car stops where it is rather than passing through.
    const wasX = a.x, wasY = a.y;
    a.x = p.x; a.y = p.y;
    // Refuse only moves that create a NEW overlap. Blocking any move while
    // overlapping at all is a trap: two agents that start inside one another,
    // from a spawn or a world rebind, can then never separate, and the whole
    // grid seizes. Something already overlapping is allowed to move apart.
    let blocked = false;
    for (const other of agents) {
      if (other === a) continue;
      if (!footprintsOverlap(a, other)) continue;
      const was = { x: wasX, y: wasY, hx: a.hx, hy: a.hy, vehicle: a.vehicle };
      if (!footprintsOverlap(was, other)) { blocked = true; break; }
    }
    if (blocked) {
      a.x = wasX; a.y = wasY;
      a.distance = beforeAdvance;
      a.spd = 0;
      return;
    }

    // Point along the path actually travelled, not along the edge. On the arc
    // through a corner those differ, and steering to the edge direction is
    // what made the turn read as an instant right angle.
    const movedLen = Math.hypot(movedX, movedY);
    if (movedLen > 1e-4) smoothVehicleHeading(a, movedX / movedLen, movedY / movedLen, dt);
    else smoothVehicleHeading(a, edge.dx, edge.dy, dt);
  }

  /**
   * Draw sprites, back to front, depth-tested per cell against the scene depth
   * buffer. The original tested one distance per column, which cannot handle a
   * rooftop seen from above partially hiding the street behind it.
   */
  draw(screen, cam, L) {
    const agents = this.agents;
    if (agents.length === 0) {
      this.renderStats = { simulated: 0, visible: 0, cells: 0, near: 0, mid: 0, far: 0 };
      return this.renderStats;
    }

    const vis = [];
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const rx = (a.renderX ?? a.x) - cam.x;
      const ry = (a.renderY ?? a.y) - cam.y;
      const d = Math.sqrt(rx * rx + ry * ry);
      if (d < 0.5 || d > MAXD) continue;
      const da = normAngle(Math.atan2(ry, rx) - cam.angle);
      if (Math.abs(da) > FOV * 0.72) continue;
      vis.push({ a, d, ang: da });
    }
    vis.sort((p, q) => q.d - p.d);

    let visibleCars = 0;
    for (const item of vis) if (item.a.kind === 'car') visibleCars++;
    let carOrdinal = 0;
    const stats = {
      simulated: 0,
      visible: visibleCars, cells: 0, near: 0, mid: 0, far: 0,
    };
    for (const agent of agents) if (agent.kind === 'car') stats.simulated++;

    const { cols, rows, depth } = screen;

    for (let i = 0; i < vis.length; i++) {
      const { a, d, ang } = vis[i];
      const dp = d * Math.cos(ang);
      if (dp < 0.3) continue;

      if (a.kind === 'car') {
        this._prepareCar(a);
        const rich = carOrdinal >= visibleCars - MAX_RICH_VEHICLES;
        carOrdinal++;
        const forcedLod = this.detailMode === 'near' ? VEHICLE_LOD.NEAR
          : this.detailMode === 'mid' ? VEHICLE_LOD.MID
          : this.detailMode === 'far' ? VEHICLE_LOD.FAR : null;
        const result = drawVehicle(screen, cam, L, a, { distance: d, rich, forcedLod });
        stats.cells += result.cells;
        if (result.lod === VEHICLE_LOD.NEAR) stats.near++;
        else if (result.lod === VEHICLE_LOD.MID) stats.mid++;
        else stats.far++;
        continue;
      }

      const wWorldSide = PED_WIDTH;
      const hWorld = PED_HEIGHT;

      const baseR = cam.rowOf(0, dp);
      const topR = cam.rowOf(hWorld, dp);
      const y0 = Math.floor(topR);
      const y1 = Math.max(y0 + 1, Math.ceil(baseR));
      const span = Math.max(0.001, baseR - topR);
      const lod = lodFor(span, screen.rowStep || 1);

      // Two-frame walk cycle, phased by distance travelled.
      const phase = ((a.axis === 'x' ? a.x : a.y) * METERS_PER_CELL * 1.6 | 0) & 1;
      const tpl = PED_LOD[lod][phase];

      const cx = cols / 2 - Math.tan(ang) * cam.proj;
      const wcols = Math.max(1, wWorldSide * cam.proj / dp);
      const x0 = cx - wcols / 2;
      const f = Math.max(0.12, fogOf(dp));

      const pedCol = L.depth(150 * L.amb + 46, 152 * L.amb + 44, 168 * L.amb + 50, f);

      const yA = Math.max(0, y0);
      const yB = Math.min(rows, y1);
      const xA = Math.max(0, Math.floor(x0));
      const xB = Math.min(cols, Math.ceil(x0 + wcols));

      for (let y = yA; y < yB; y++) {
        let tr = Math.floor((y + 0.5 - topR) / span * tpl.length);
        if (tr < 0) tr = 0;
        if (tr >= tpl.length) tr = tpl.length - 1;
        const row = tpl[tr];

        for (let x = xA; x < xB; x++) {
          if (dp >= depth[y * cols + x]) continue;
          let tc = Math.floor((x + 0.5 - x0) / wcols * row.length);
          if (tc < 0) tc = 0;
          if (tc >= row.length) tc = row.length - 1;
          const g = row[tc];
          if (g === ' ') continue;
          // setDepth, not set: labels are drawn after sprites and depth-test
          // against the buffer, so a car in front of a street name has to
          // record that it is there.
          screen.setDepth(x, y, g, pedCol, dp);
        }
      }
    }
    this.renderStats = stats;
    return stats;
  }
}
