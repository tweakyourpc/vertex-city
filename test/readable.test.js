import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, buildDistrict, buildMovers, triangulate, laneMarkings, STRIDE } from '../src/render/district.js';
import { Lighting } from '../src/render/materials.js';
import { T } from '../src/world/source.js';
import { ProceduralWorld } from '../src/world/procedural.js';
import { buildRoadGraph } from '../src/world/roadgraph.js';

function fixture() {
  // Explicit test geometry: one rectangular mapped footprint on empty ground.
  const building={osm:'way/100',cx:3,cy:3,r:3,h:5,rings:[[[1,1],[5,1],[5,5],[1,5],[1,1]]]};
  // flags carries provenance, so a world without it is not a world the
  // renderer should have to guess about. Surveyed: no SIMULATED bit set.
  return {buildings:[null,building],roads:[],junctions:[],h:[0,5],type:[T.VOID,T.HOUSE],pal:[0,0],bid:[0,1],
    flags:[0,0],
    sample(x,y){return x>=1&&x<5&&y>=1&&y<5?1:0;}};
}
// buildDistrict snaps its centre to a 32-cell sector grid, so a camera at
// (3,3) centres the district at (16,16). The fixture's building sits 18.4
// cells from there and an 8-cell radius culled it before a single wall was
// built, which is why this asserted walls.length>0 against an empty mesh.
// Place the camera in the same sector as the building and give the radius
// room to reach it.
test('mesh attributes remain finite and triangles retain exact footprint wall planes',()=>{
  const data=buildDistrict(fixture(),{x:16,y:16},40).vertices;
  assert.equal(data.length%(STRIDE*3),0);
  assert.ok(data.every(Number.isFinite));
  const walls=[];
  for(let i=0;i<data.length;i+=STRIDE)if(data[i+11]===1)walls.push([data[i],data[i+1],data[i+2]]);
  assert.ok(walls.length>0);
  for(const [x,y,z] of walls){assert.ok(x===1||x===5||y===1||y===5);assert.ok(z===0||z===5);}
});
test('every quad carries its own corners and metric extent for the wireframe view',()=>{
  const m=new Mesh();
  m.quad([[0,0,0],[6,0,0],[6,0,4],[0,0,4]],[0,-1,0],[.5,.5,.5],1,7);
  const d=m.array();
  assert.equal(d.length,STRIDE*6);
  // Both triangles must agree on the extent, or the two halves of one wall
  // would outline at different widths and the diagonal would show.
  for(let i=0;i<d.length;i+=STRIDE){
    assert.deepEqual([d[i+15],d[i+16]],[6,4]);
    assert.ok((d[i+13]===0||d[i+13]===1)&&(d[i+14]===0||d[i+14]===1));
  }
  // The corner must track the vertex, so distance-to-border is real.
  const corners=[];
  for(let i=0;i<d.length;i+=STRIDE) corners.push([d[i],d[i+2],d[i+13],d[i+14]].join(','));
  assert.ok(corners.includes('0,0,0,0'));
  assert.ok(corners.includes('6,0,1,0'));
  assert.ok(corners.includes('6,4,1,1'));
  assert.ok(corners.includes('0,4,0,1'));
});
test('a building still emits walls when the camera shares its sector',()=>{
  const data=buildDistrict(fixture(),{x:16,y:16},40).vertices;
  let walls=0;
  for(let i=0;i<data.length;i+=STRIDE) if(data[i+11]===1) walls++;
  assert.ok(walls>0,'no wall geometry was built');
});
test('mesh box roof and sides keep their height bounds',()=>{
  const m=new Mesh();m.box(0,0,0,2,3,5,0,[.5,.6,.7],1,3);
  const data=m.array();for(let i=0;i<data.length;i+=STRIDE)assert.ok(data[i+2]>=0&&data[i+2]<=5);
});
test('night skies remain dark and noon is blue rather than magenta',()=>{
  const light=new Lighting();light.update(45);
  assert.ok(light.skyTop[2]>light.skyTop[0]);
  assert.ok(Math.abs(light.skyBottom[0]-light.skyBottom[1])<25);
  light.update(-20);assert.ok(light.skyTop.every(c=>c<45));
  assert.ok(light.litProb>.5);
});
test('rendered movers use actual simulation positions and quiet mode emits none',()=>{
  const car={kind:'car',x:4,y:6,renderX:5,renderY:7,hx:1,hy:0};
  // buildMovers returns solid geometry and the light it throws, separately:
  // headlights have to be added onto the scene, not painted into it.
  const data=buildMovers({mode:1,agents:[car]}, {},0).vertices;
  assert.ok(data.length>0);
  for(let i=0;i<data.length;i+=STRIDE){assert.ok(Math.abs(data[i]-5)<2);assert.ok(Math.abs(data[i+1]-7)<1);}
  assert.equal(buildMovers({mode:0,agents:[car]}, {},0).vertices.length,0);
});

/**
 * Road paint has to sit on the asphalt, not inside it.
 *
 * The crossing bars and stop line were at 0.066 and 0.067 while the road slab
 * spans 0.056 to 0.070, so the paint was four millimetres underneath the
 * surface it was painted on. Two coplanar-ish surfaces leave the depth test
 * with nothing to separate them, and a crossing tore into shimmering fans that
 * swam as the camera moved. This is an invariant about geometry, not a
 * judgement about how it looks, so it is worth pinning.
 */
test('road markings sit above the road surface, never inside it', () => {
  const world = new ProceduralWorld();
  const data = buildDistrict(world, { x: 829, y: 1192 }, 90).vertices;

  // Vertex layout: position 0-2, normal 3-5, colour 6-8, uv 9-10, kind 11,
  // seed 12, corner 13-14, extent 15-16. Getting this wrong is how the first
  // version of this test passed against the very bug it was written for: it
  // read index 5 as the seed when index 5 is normal.z, so it selected only
  // vertical faces and never saw a single piece of road paint.
  const COLOUR = { z: 2, r: 6, g: 7, b: 8, nz: 5 };
  const near = (v, t) => Math.abs(v - t) < 0.005;
  const isColour = (i, c) =>
    near(data[i+COLOUR.r], c[0]) && near(data[i+COLOUR.g], c[1]) && near(data[i+COLOUR.b], c[2]);

  // The asphalt's own top, taken from the mesh rather than assumed.
  let roadTop = 0;
  for (let i = 0; i < data.length; i += STRIDE) {
    if (isColour(i, [0.32, 0.37, 0.40])) roadTop = Math.max(roadTop, data[i+COLOUR.z]);
  }
  assert.ok(roadTop > 0, 'no road surface found to test against');

  // Every painted marking, by its own colour, and only the faces that lie flat
  // on the ground: a marking's vertical edges are not what z-fights.
  const paints = {
    'crossing bars': [0.88, 0.88, 0.84],
    'stop line': [0.93, 0.93, 0.90],
    'lane dashes': [0.92, 0.86, 0.61],
  };
  let checked = 0;
  for (const [name, colour] of Object.entries(paints)) {
    let lowest = Infinity;
    for (let i = 0; i < data.length; i += STRIDE) {
      if (!isColour(i, colour)) continue;
      if (data[i+COLOUR.nz] < 0.9) continue;        // flat, facing up
      if (data[i+COLOUR.z] > 0.5) continue;         // on the ground, not a roof
      lowest = Math.min(lowest, data[i+COLOUR.z]);
    }
    if (lowest === Infinity) continue;              // none in this district
    checked++;
    assert.ok(lowest > roadTop,
      `${name} at z=${lowest.toFixed(4)} is at or below the road surface at ` +
      `z=${roadTop.toFixed(4)}, which is what makes paint z-fight with tarmac`);
  }
  assert.ok(checked >= 2, `only ${checked} kinds of marking found; the sweep is not covering them`);
});

/**
 * A roof may not invent geometry the footprint does not have.
 *
 * Ear clipping a ring that crosses itself produces triangles outside the
 * building altogether, which renders as a slab of roof lying across the street
 * beside it. OSM ways also carry consecutive duplicate nodes, which stalled the
 * clipper partway and left half a roof missing. Neither is a judgement about
 * appearance: a roof either covers its own footprint or it is wrong.
 */
test('a roof covers its footprint exactly, or is not built at all', () => {
  const area = (a,b,c) => Math.abs((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]))/2;
  const shoelace = (r) => {
    let s = 0;
    for (let i = 0; i < r.length-1; i++) s += r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1];
    return Math.abs(s)/2;
  };
  const covered = (ring) => triangulate(ring).reduce((s,[a,b,c]) => s + area(a,b,c), 0);

  // Rings with a real interior must be covered completely.
  for (const [name, ring] of Object.entries({
    rectangle: [[0,0],[8,0],[8,4],[0,4],[0,0]],
    'L-shaped': [[0,0],[6,0],[6,2],[2,2],[2,6],[0,6],[0,0]],
    'duplicate nodes': [[0,0],[4,0],[4,0],[4,4],[0,4],[0,0]],
    'collinear nodes': [[0,0],[2,0],[4,0],[6,0],[6,4],[0,4],[0,0]],
  })) {
    const want = shoelace(ring);
    const got = covered(ring);
    assert.ok(Math.abs(got - want) < want * 0.02,
      `${name}: covered ${got.toFixed(2)} of ${want.toFixed(2)}`);
  }

  // A ring that crosses itself has no interior to cover, so nothing is built.
  const bowtie = [[0,0],[6,0],[0,4],[6,4],[0,0]];
  assert.equal(triangulate(bowtie).length, 0,
    'a self-intersecting ring must produce no roof rather than one beside the building');

  // And nothing produced may lie outside the ring that asked for it.
  const inside = (p, ring) => {
    let c = false;
    for (let i = 0, j = ring.length-2; i < ring.length-1; j = i++) {
      const a = ring[i], b = ring[j];
      if (((a[1] > p[1]) !== (b[1] > p[1])) &&
          (p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]) + a[0])) c = !c;
    }
    return c;
  };
  const concave = [[0,0],[6,0],[6,2],[2,2],[2,6],[0,6],[0,0]];
  for (const [a,b,c] of triangulate(concave)) {
    if (area(a,b,c) < 1e-9) continue;
    const centre = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3];
    assert.ok(inside(centre, concave),
      `a roof triangle centred at ${centre.map(v=>v.toFixed(2))} lies outside its footprint`);
  }
});

/**
 * A roof is not a facade. The material guard tested `kind === 1` exactly, but a
 * generated building carries its provenance bit as well, so its top kept the
 * facade material and the shader painted window bands flat across the roof.
 */
test('generated roofs are not given the facade material', () => {
  const SIM = 8;
  for (const wallKind of [1, 1 + SIM]) {
    const m = new Mesh();
    m.box(0, 0, 0, 2, 2, 5, 0, [0.5,0.5,0.5], wallKind, 0);
    const d = m.array();
    const roofKind = d[d.length - STRIDE + 11];
    const material = roofKind >= SIM ? roofKind - SIM : roofKind;
    assert.notEqual(material, 1,
      `a wall of kind ${wallKind} produced a roof reading as facade material`);
    if (wallKind >= SIM) {
      assert.ok(roofKind >= SIM, 'the roof must keep its provenance bit');
    }
  }
});

/**
 * Lane markings follow what the map says about the road.
 *
 * Yellow separates opposing directions, so it must never appear on a one-way
 * street; white separates lanes running the same way. Previously every road got
 * the same single dashed line down the middle whatever OSM said about it.
 */
test('lane markings read oneway and lanes from the map', () => {
  const YELLOW = [0.93, 0.78, 0.24];
  const near = (v, t) => Math.abs(v - t) < 0.02;
  const paint = (tags, cls = 'residential') => {
    const mesh = new Mesh();
    const road = { cls, tags, pts: [[0,0],[40,0]] };
    // laneMarkings is exercised through buildDistrict's own call shape.
    const ux = 1, uy = 0;
    const seen = { yellow: 0, white: 0 };
    // Re-implement the colour census over what the mesh received.
    laneMarkings(mesh, [0,0], ux, uy, 0, 40, 3.8, road, () => false);
    const d = mesh.array();
    for (let i = 0; i < d.length; i += STRIDE) {
      if (near(d[i+6], YELLOW[0]) && near(d[i+7], YELLOW[1]) && near(d[i+8], YELLOW[2])) {
        seen.yellow++;
      } else if (d[i+6] > 0.88 && d[i+7] > 0.88 && d[i+8] > 0.85) {
        seen.white++;
      }
    }
    return seen;
  };

  const twoWay = paint({});
  assert.ok(twoWay.yellow > 0, 'a two-way street needs a yellow centre line');

  const oneWay = paint({ oneway: 'yes', lanes: '3' });
  assert.equal(oneWay.yellow, 0,
    'a one-way street has nothing coming the other way, so no yellow line');
  assert.ok(oneWay.white > 0, 'three one-way lanes need white dividers between them');

  // A single-lane one-way street has no interior boundary to mark at all.
  const single = paint({ oneway: 'yes', lanes: '1' });
  assert.equal(single.yellow, 0);
  assert.equal(single.white, 0, 'one lane has no divider');

  // Overtaking is not permitted on a primary road, so its centre is solid.
  const primary = paint({}, 'primary');
  assert.ok(primary.yellow > twoWay.yellow,
    'a solid double centre line uses more paint than a dashed single one');
});

/* ------------------------ crossings at junctions ------------------------- */

// Park Avenue, structurally: a wide avenue with cross streets every 30 cells,
// a vertex every 3 cells the way surveyed geometry actually comes, and the
// separately named tunnel and service ways that lie along the same nodes.
function avenueGrid({ vertexStep = 3, redundantWays = true } = {}) {
  const AV_W = 13.5, ST_W = 4.2;
  let next = 1;
  const ids = new Map();
  const nid = (x, y) => {
    const k = `${x},${y}`;
    if (!ids.has(k)) ids.set(k, next++);
    return ids.get(k);
  };
  const dense = (keep) => {
    const out = [];
    for (let v = 0; v <= 180; v += vertexStep) out.push(v);
    for (const v of keep) if (!out.includes(v)) out.push(v);
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const XS = [0, 90, 180], YS = [0, 30, 60, 90, 120, 150, 180];
  const roads = [];
  for (const [i, x] of XS.entries()) {
    const ys = dense(YS);
    const pts = ys.map((y) => [x, y]);
    const nodeIds = ys.map((y) => nid(x, y));
    roads.push({ cls: 'primary', width: AV_W, nameId: 100 + i, tags: {}, pts, nodeIds });
    if (redundantWays && i === 1) {
      roads.push({ cls: 'secondary', width: AV_W * 0.6, nameId: 300, tags: {},
        pts: pts.map((p) => [...p]), nodeIds: [...nodeIds] });
      roads.push({ cls: 'service', width: 3, nameId: 301, tags: {},
        pts: pts.map((p) => [...p]), nodeIds: [...nodeIds] });
    }
  }
  for (const [i, y] of YS.entries()) {
    const xs = dense(XS);
    roads.push({ cls: 'residential', width: ST_W, nameId: 200 + i, tags: {},
      pts: xs.map((x) => [x, y]), nodeIds: xs.map((x) => nid(x, y)) });
  }
  const graph = buildRoadGraph(roads, {});
  return {
    world: {
      buildings: [], roads, junctions: graph.junctions,
      h: [0], type: [T.VOID], pal: [0], bid: [0], flags: [0], sample() { return 0; },
    },
    junctions: graph.junctions, AV_W,
  };
}

// Crossings and stop lines are the only geometry on this plane; see CROSSING_Z.
const CROSSING_PLANE = 0.078;
function crossingQuads(vertices) {
  const out = [];
  for (let i = 0; i < vertices.length; i += STRIDE * 3) {
    const tri = [0, 1, 2].map((t) => [
      vertices[i + t * STRIDE], vertices[i + t * STRIDE + 1], vertices[i + t * STRIDE + 2],
    ]);
    if (tri.every((p) => Math.abs(p[2] - CROSSING_PLANE) < 1e-4)) out.push(tri);
  }
  return out;
}

test('crossings stay at the junctions and do not repeat down the street', () => {
  const { world, junctions, AV_W } = avenueGrid();
  const quads = crossingQuads(buildDistrict(world, { x: 90, y: 90 }, 145).vertices);
  assert.ok(quads.length > 0, 'no crossings were drawn at all');

  // Nothing is painted twice: a junction is shared by the segment arriving and
  // the one leaving, and by every way through it.
  const keys = new Set(quads.map((t) => t.map((p) => p.map((n) => n.toFixed(3)).join()).join('|')));
  assert.equal(keys.size, quads.length, 'the same crossing was painted more than once');

  // A box, a crossing and a stop line reach ~11 cells from the widest corner
  // here. Beyond 14 is paint out in the middle of a block.
  for (const tri of quads) {
    const [x, y] = [0, 1].map((k) => (tri[0][k] + tri[1][k] + tri[2][k]) / 3);
    const near = Math.min(...junctions.map((j) => Math.hypot(j.x - x, j.y - y)));
    assert.ok(near <= 14, `crossing paint ${near.toFixed(1)} cells from any junction`);
  }

  // Park Avenue runs 180 cells through 7 junctions. Each junction marks two
  // approaches, ~6 cells of paint apiece, so well under a third of its length
  // is painted. At the regression it was 179 of 180.
  const onAvenue = new Set();
  for (const tri of quads) {
    const x = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const y = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    if (Math.abs(x - 90) < AV_W / 2) onAvenue.add(Math.round(y));
  }
  assert.ok(onAvenue.size < 60, `${onAvenue.size} of 180 cells of the avenue are painted`);
});

test('crossings do not depend on how finely a street is drawn or renamed', () => {
  // The same city described three ways: a vertex every 3 cells, a vertex only
  // at each junction, and with the tunnel and service ways removed. The paint
  // is a property of the junctions, so all three must agree exactly.
  const shape = (opts) => crossingQuads(buildDistrict(avenueGrid(opts).world, { x: 90, y: 90 }, 145).vertices)
    .map((t) => t.map((p) => p.map((n) => n.toFixed(3)).join()).join('|')).sort().join('\n');
  const dense = shape({});
  assert.equal(shape({ vertexStep: 30 }), dense, 'vertex spacing changed the crossings');
  assert.equal(shape({ redundantWays: false }), dense, 'a co-located named way changed the crossings');
});

// Park Avenue near the tunnel, structurally as OSM describes it: a DIVIDED
// avenue whose two carriageways are separate ways, cross streets SPLIT at the
// median so each carriageway gets its own node, a separately named tunnel way
// that dives away below grade, a service road on the same nodes, and a vertex
// every 3 cells. Four or five graph nodes make up one physical intersection.
function dividedAvenue() {
  const CARRIAGE = 7.0, MEDIAN = 5.0, ST_W = 4.2;
  const WEST = 90 - MEDIAN / 2 - CARRIAGE / 2, EAST = 90 + MEDIAN / 2 + CARRIAGE / 2;
  let next = 1;
  const ids = new Map();
  const nid = (x, y) => {
    const k = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (!ids.has(k)) ids.set(k, next++);
    return ids.get(k);
  };
  const dense = (keep) => {
    const out = [];
    for (let v = 0; v <= 180; v += 3) out.push(v);
    for (const v of keep) if (!out.includes(v)) out.push(v);
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const YS = [30, 60, 90, 120, 150];
  const ys = dense(YS);
  const roads = [];
  for (const x of [WEST, EAST]) {
    const pts = ys.map((y) => [x, y]);
    const nodeIds = ys.map((y) => nid(x, y));
    roads.push({ cls: 'primary', width: CARRIAGE, nameId: 101,
      tags: { oneway: 'yes' }, pts, nodeIds });
    roads.push({ cls: 'service', width: 3, nameId: 301, tags: {},
      pts: pts.map((p) => [...p]), nodeIds: [...nodeIds] });
  }
  const deep = ys.filter((y) => y >= 100);
  roads.push({ cls: 'secondary', width: 6, nameId: 300,
    tags: { tunnel: 'yes', layer: '-1' },
    pts: deep.map((y) => [90, y]), nodeIds: deep.map((y) => nid(90, y)) });
  for (const [i, y] of YS.entries()) {
    for (const xs of [dense([WEST]).filter((x) => x <= 90), dense([EAST]).filter((x) => x >= 90)]) {
      roads.push({ cls: 'residential', width: ST_W, nameId: 200 + i, tags: {},
        pts: xs.map((x) => [x, y]), nodeIds: xs.map((x) => nid(x, y)) });
    }
  }
  const graph = buildRoadGraph(roads, {});
  return {
    world: {
      buildings: [], roads, junctions: graph.junctions,
      h: [0], type: [T.VOID], pal: [0], bid: [0], flags: [0], sample() { return 0; },
    },
    graph, WEST, EAST, CARRIAGE, YS,
  };
}

test('the several nodes of one intersection are marked once, not once each', () => {
  const { world, graph, YS } = dividedAvenue();
  // Four or five graph nodes per intersection, five intersections.
  assert.equal(graph.junctions.length, YS.length,
    `${graph.junctions.length} intersections for ${YS.length} cross streets`);

  const quads = crossingQuads(buildDistrict(world, { x: 90, y: 90 }, 145).vertices);
  const centres = quads.map((t) => [
    (t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3]);
  assert.ok(centres.length > 0, 'no crossings were drawn at all');

  // Two crossing quads at the same spot are the same marking painted twice.
  // Being coplanar they fight in the depth buffer, and that is what tore the
  // bands into smears that swam as the camera moved.
  for (let i = 0; i < centres.length; i++) {
    for (let k = i + 1; k < centres.length; k++) {
      const d = Math.hypot(centres[i][0] - centres[k][0], centres[i][1] - centres[k][1]);
      assert.ok(d > 0.3,
        `two crossing quads ${d.toFixed(3)} cells apart at (${centres[i][0].toFixed(1)}, ${centres[i][1].toFixed(1)})`);
    }
  }
});

test('a divided avenue is marked on each carriageway, not once across both', () => {
  const { world, WEST, EAST, CARRIAGE } = dividedAvenue();
  const quads = crossingQuads(buildDistrict(world, { x: 90, y: 90 }, 145).vertices);
  // The crossings of the avenue at the middle intersection: bars lying across
  // a carriageway, north and south of it.
  const onCarriageway = (cx) => quads.some((t) => {
    const x = (t[0][0] + t[1][0] + t[2][0]) / 3;
    const y = (t[0][1] + t[1][1] + t[2][1]) / 3;
    return Math.abs(x - cx) < CARRIAGE / 2 && y > 90 && y < 90 + 12;
  });
  // Deduplicating by bearing alone collapsed these two into one, because the
  // two carriageways of an avenue run the same way a median apart.
  assert.ok(onCarriageway(WEST), 'the west carriageway is unmarked');
  assert.ok(onCarriageway(EAST), 'the east carriageway is unmarked');
});

test('a tunnel portal is not an intersection to paint a crossing at', () => {
  // Park Avenue Tunnel parts company with the road above it mid-block. Counted
  // as an arm, that divergence made a junction there on open road.
  const { graph } = dividedAvenue();
  for (const j of graph.junctions) {
    const nearest = Math.min(...[30, 60, 90, 120, 150].map((y) => Math.abs(j.y - y)));
    assert.ok(nearest < 3, `an intersection at y=${j.y.toFixed(1)}, ${nearest.toFixed(1)} cells from any cross street`);
  }
});

/* ------------------- stop lines and signals face traffic ----------------- */

// One avenue crossed by one street, so each approach is unambiguous.
function crossroads(avenueTags = {}) {
  let n = 1;
  const ids = new Map();
  const nid = (x, y) => { const k = `${x},${y}`; if (!ids.has(k)) ids.set(k, n++); return ids.get(k); };
  const along = []; for (let v = 0; v <= 180; v += 3) along.push(v);
  const roads = [
    { cls: 'primary', width: 13.5, nameId: 0, tags: avenueTags,
      pts: along.map((y) => [90, y]), nodeIds: along.map((y) => nid(90, y)) },
    { cls: 'residential', width: 4.2, nameId: 1, tags: {},
      pts: along.map((x) => [x, 90]), nodeIds: along.map((x) => nid(x, 90)) },
  ];
  const graph = buildRoadGraph(roads, { signalPoints: [{ x: 90, y: 90 }] });
  return {
    graph,
    world: {
      buildings: [], roads, junctions: graph.junctions, roadGraph: graph,
      streetNames: ['Park Avenue', 'E 33rd St'],
      h: [0], type: [T.VOID], pal: [0], bid: [0], flags: [0], sample() { return 0; },
    },
  };
}

// On the avenue: narrow quads are crossing bars, one wide quad is the stop line.
function avenueMarkings(vertices) {
  const out = [];
  for (let i = 0; i < vertices.length; i += STRIDE * 3) {
    const t = [0, 1, 2].map((k) => [
      vertices[i + k * STRIDE], vertices[i + k * STRIDE + 1], vertices[i + k * STRIDE + 2]]);
    if (!t.every((p) => Math.abs(p[2] - CROSSING_PLANE) < 1e-4)) continue;
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
    if (Math.min(...xs) < 82 || Math.max(...xs) > 98) continue;
    out.push({ stopLine: Math.max(...xs) - Math.min(...xs) > 6,
      y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  }
  return out;
}

test('a stop line is behind its crossing, on the side traffic arrives from', () => {
  const { world } = crossroads();
  const marks = avenueMarkings(buildDistrict(world, { x: 90, y: 90 }, 145).vertices);
  const bars = marks.filter((m) => !m.stopLine).map((m) => m.y);
  const lines = [...new Set(marks.filter((m) => m.stopLine).map((m) => m.y))];
  assert.equal(lines.length, 2, `${lines.length} stop lines on a two-way avenue`);

  // A stop line between the crossing and the junction is a line telling a
  // driver to stop once they are already standing on the crosswalk. It came
  // from taking the polyline's own direction as the approach bearing, which
  // points the same way on both sides of a junction.
  for (const ly of lines) {
    const side = bars.filter((y) => (ly < 90 ? y < 90 : y > 90));
    assert.ok(side.length, `a stop line at ${ly} with no crossing on that side`);
    const cy = (Math.min(...side) + Math.max(...side)) / 2;
    assert.ok(Math.abs(ly - 90) > Math.abs(cy - 90),
      `stop line at ${ly.toFixed(2)} is in front of its crossing at ${cy.toFixed(2)}`);
  }
});

test('a one-way street is not told to stop at the crossing it drives away from', () => {
  // Northbound only: the crossing beyond the junction is behind every driver
  // who uses this street. A stop line there faces traffic that cannot legally
  // exist, and so does a signal head.
  const { world } = crossroads({ oneway: 'yes' });
  const marks = avenueMarkings(buildDistrict(world, { x: 90, y: 90 }, 145).vertices);
  const bars = marks.filter((m) => !m.stopLine).map((m) => m.y);
  const lines = [...new Set(marks.filter((m) => m.stopLine).map((m) => m.y))];

  // Both crossings stay: pedestrians cross on both sides of an intersection.
  assert.ok(bars.some((y) => y < 90) && bars.some((y) => y > 90),
    'a one-way street still gets a crossing on each side of the junction');
  assert.equal(lines.length, 1, `${lines.length} stop lines on a one-way avenue`);
  assert.ok(lines[0] < 90, 'the stop line is on the approach side');
});

test('every signalled approach gets its own mast, not one shared between two', () => {
  const { world } = crossroads();
  const { vertices } = buildDistrict(world, { x: 90, y: 90 }, 145);
  // A mast pole rises from the ground to 3.15 cells; nothing else does.
  const poles = new Set();
  for (let i = 0; i < vertices.length; i += STRIDE) {
    if (Math.abs(vertices[i + 2] - 3.15) < 1e-4) {
      poles.add(`${vertices[i].toFixed(2)},${vertices[i + 1].toFixed(2)}`);
    }
  }
  // Four corners to a pole, four approaches to a crossroads. Taking the
  // polyline's direction as the bearing put each street's two masts at one
  // point, so a four-way junction came out with two lights instead of four.
  assert.equal(poles.size, 16, `${poles.size / 4} signal masts at a four-way junction`);
});
