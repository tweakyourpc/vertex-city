import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, buildDistrict, buildMovers, STRIDE } from '../src/render/district.js';
import { Lighting } from '../src/render/materials.js';
import { T } from '../src/world/source.js';

function fixture() {
  // Explicit test geometry: one rectangular mapped footprint on empty ground.
  const building={osm:'way/100',cx:3,cy:3,r:3,h:5,rings:[[[1,1],[5,1],[5,5],[1,5],[1,1]]]};
  return {buildings:[null,building],roads:[],junctions:[],h:[0,5],type:[T.VOID,T.HOUSE],pal:[0,0],bid:[0,1],
    sample(x,y){return x>=1&&x<5&&y>=1&&y<5?1:0;}};
}
test('mesh attributes remain finite and triangles retain exact footprint wall planes',()=>{
  const data=buildDistrict(fixture(),{x:3,y:3},8).vertices;
  assert.equal(data.length%(STRIDE*3),0);
  assert.ok(data.every(Number.isFinite));
  const walls=[];
  for(let i=0;i<data.length;i+=STRIDE)if(data[i+11]===1)walls.push([data[i],data[i+1],data[i+2]]);
  assert.ok(walls.length>0);
  for(const [x,y,z] of walls){assert.ok(x===1||x===5||y===1||y===5);assert.ok(z===0||z===5);}
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
  const data=buildMovers({mode:1,agents:[car]}, {},0);
  assert.ok(data.length>0);
  for(let i=0;i<data.length;i+=STRIDE){assert.ok(Math.abs(data[i]-5)<2);assert.ok(Math.abs(data[i+1]-7)<1);}
  assert.equal(buildMovers({mode:0,agents:[car]}, {},0).length,0);
});
