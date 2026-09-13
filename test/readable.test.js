import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, buildDistrict, buildMovers, STRIDE } from '../src/render/district.js';
import { Lighting } from '../src/render/materials.js';
import { T } from '../src/world/source.js';
import { ProceduralWorld } from '../src/world/procedural.js';

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
