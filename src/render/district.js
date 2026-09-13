import { T, F, hash } from '../world/source.js';
import { FLOOR_H, CROSS_SETBACK, CROSS_DEPTH, STOP_LINE_DEPTH, STOP_LINE_GAP, DRIVE_ON_RIGHT } from '../config.js';

/**
 * Vertex layout: position(3) normal(3) colour(3) uv(2) kind(1) seed(1)
 * corner(2) extent(2).
 *
 * `corner` is the vertex's parametric position in its own quad and `extent`
 * that quad's size in metres, both constant across the quad's two triangles.
 * Together they let a fragment measure its distance to the quad's border, so
 * the wireframe view can outline real faces instead of the triangulation
 * diagonal every naive barycentric wireframe exposes. Appended last so the
 * older attribute offsets, and the tests that index them, are unchanged.
 */
export const STRIDE = 17;
const PALETTE = [[.83,.76,.64],[.73,.48,.35],[.91,.86,.73],[.57,.66,.67],[.77,.68,.56],[.89,.80,.66]];
const CORNER = [[0,0],[1,0],[1,1],[0,1]];

/**
 * Road surface and the paint on it, in cells.
 *
 * Paint sits ON the asphalt. The crossing bars and stop line were at 0.066 and
 * 0.067 while the road slab spans 0.056 to 0.070, which buried them four
 * millimetres inside it: two surfaces at effectively the same depth, so which
 * one won flipped per pixel and per camera position and a crossing tore itself
 * into shimmering fans that swam as you walked. The lane dashes, which were
 * already above the slab, never did this.
 *
 * Crossings sit above the dashes as well, because near a junction the two can
 * overlap and coplanar paint fights just as badly as paint in tarmac.
 */
const ROAD_Z = 0.056;
const ROAD_THICK = 0.014;
const ROAD_TOP = ROAD_Z + ROAD_THICK;
const DASH_Z = ROAD_TOP + 0.004;
const CROSSING_Z = ROAD_TOP + 0.008;
/**
 * Provenance rides in the `kind` attribute's 8s place rather than in a new
 * vertex attribute: generated geometry is its material id plus SIM, and the
 * shader takes it back off before switching on the material. One bit, no extra
 * bytes per vertex, and every existing kind keeps its meaning.
 */
const SIM = 8;
const simOf = (world, slot) => (world.flags?.[slot] & F.SIMULATED) ? SIM : 0;

/** CPU mesh assembly is independent of the GPU, and reusable in geometry tests. */
export class Mesh {
  constructor() { this.data = []; }
  quad(points, normal, colour, kind = 0, seed = 0, uv = [[0,0],[1,0],[1,1],[0,1]]) {
    const span = (a, b) => Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
    const ew = span(points[0], points[1]);
    const eh = span(points[0], points[3]);
    for (const i of [0,1,2,0,2,3]) {
      this.data.push(...points[i], ...normal, ...colour, ...uv[i], kind, seed,
        CORNER[i][0], CORNER[i][1], ew, eh);
    }
  }
  /**
   * One triangle, for geometry that is not a quad.
   *
   * Its `extent` is zero on both axes, which the wireframe reads as "this face
   * has no border to measure" and draws no line for. That is deliberate: a
   * triangulated roof outlined per triangle would show its own tessellation,
   * and the roof's real outline is already drawn by the tops of the walls.
   */
  tri(points, normal, colour, kind = 0, seed = 0) {
    for (const p of points) {
      this.data.push(...p, ...normal, ...colour, 0, 0, kind, seed, 0, 0, 0, 0);
    }
  }
  box(x, y, z, w, d, h, angle, colour, kind = 0, seed = 0) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const p = (a,b,k) => [x + c*a - s*b, y + s*a + c*b, z+k];
    const corners = [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i+1)%4];
      const ex = b[0]-a[0], ey = b[1]-a[1], length = Math.hypot(ex,ey);
      const nx = ey/length, ny = -ex/length;
      this.quad([p(...a,0),p(...b,0),p(...b,h),p(...a,h)], [c*nx-s*ny,s*nx+c*ny,0], colour, kind, seed,
        [[0,z],[length,z],[length,z+h],[0,z+h]]);
    }
    this.quad(corners.map(a => p(...a,h)), [0,0,1], colour, kind === 1 ? 0 : kind, seed);
  }
  disc(x,y,z,r,colour, kind=0) {
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
      this.quad([[x,y,z],[x+Math.cos(a)*r,y+Math.sin(a)*r,z],
        [x+Math.cos(b)*r,y+Math.sin(b)*r,z],[x,y,z]], [0,0,1], colour,kind);
    }
  }
  array() { return new Float32Array(this.data); }
}

function canopy(mesh,x,y,z,radius,colour) {
  const point=(lat,lon)=>[x+Math.cos(lat)*Math.cos(lon)*radius,
    y+Math.cos(lat)*Math.sin(lon)*radius,z+Math.sin(lat)*radius*.80];
  for(let ring=0;ring<5;ring++) for(let side=0;side<8;side++) {
    const lo=-Math.PI/2+ring*Math.PI/5,hi=lo+Math.PI/5;
    const a=side*Math.PI/4,b=a+Math.PI/4,mid=(lo+hi)/2;
    mesh.quad([point(lo,a),point(lo,b),point(hi,b),point(hi,a)],
      [Math.cos(mid)*Math.cos((a+b)/2),Math.cos(mid)*Math.sin((a+b)/2),Math.sin(mid)],colour,2);
  }
}
function tree(mesh,x,y,seed) {
  // A contact shadow directly under the canopy, not an offset one. The offset
  // was fixed at (+0.30, -0.25) regardless of where the sun was, so every tree
  // in the city threw its shadow the same way at every hour, including at
  // midnight. Centred is the one placement that is never contradicted by the
  // sun: a real cast shadow has to be recomputed as the sun moves, and this
  // mesh is only rebuilt when the camera changes sector.
  mesh.disc(x,y,.078,.80,[.29,.34,.27]);
  mesh.box(x,y,.02,.13,.13,1.6,0,[.36,.29,.21]);
  const colour=[.29+hash(seed,1,3)*.05,.43+hash(seed,2,3)*.09,.26];
  canopy(mesh,x,y,2.05,.95,colour);
  canopy(mesh,x+.35,y-.12,1.8,.67,colour);
}

/**
 * A marked crossing across one approach to a junction.
 *
 * Stripes run along the direction of traffic and repeat across the
 * carriageway, which is what makes a crossing legible from a car: you read the
 * bars side-on as you come up to them. Each bar is its own quad, so the
 * wireframe view outlines it as a closed rectangle for free, and the surface
 * view gets a flat painted marking a few millimetres above the asphalt.
 *
 * `ux,uy` is the road's direction, `px,py` the point on the centreline where
 * the crossing sits, and `width` the carriageway it has to span.
 */
function crossing(mesh,px,py,ux,uy,width) {
  const nx=-uy, ny=ux;                     // across the road
  const BAR=0.62, GAP=0.46, DEPTH=CROSS_DEPTH;
  const half=width/2+0.12;
  // The stop line: one solid transverse bar on the approach side of the
  // crossing, which is the thing a driver actually stops at. Drawn from the
  // shared constants, so what is painted and what the traffic stops behind
  // cannot drift apart.
  {
    const back=DEPTH/2+STOP_LINE_GAP+STOP_LINE_DEPTH/2;
    const bx=px-ux*back, by=py-uy*back, d=STOP_LINE_DEPTH/2;
    mesh.quad([
      [bx+nx*-half-ux*d, by+ny*-half-uy*d, CROSSING_Z],
      [bx+nx* half-ux*d, by+ny* half-uy*d, CROSSING_Z],
      [bx+nx* half+ux*d, by+ny* half+uy*d, CROSSING_Z],
      [bx+nx*-half+ux*d, by+ny*-half+uy*d, CROSSING_Z],
    ],[0,0,1],[.93,.93,.90]);
  }
  // Step out from the centreline both ways so the pattern stays centred on the
  // road however wide it is, instead of starting at one kerb and running short.
  for(let o=-half;o<half-BAR*0.5;o+=BAR+GAP) {
    const a=Math.max(o,-half), b=Math.min(o+BAR,half);
    if(b-a<0.12) continue;
    const c=(a+b)/2, w=b-a;
    mesh.quad([
      [px+nx*(c-w/2)-ux*DEPTH/2, py+ny*(c-w/2)-uy*DEPTH/2, CROSSING_Z],
      [px+nx*(c+w/2)-ux*DEPTH/2, py+ny*(c+w/2)-uy*DEPTH/2, CROSSING_Z],
      [px+nx*(c+w/2)+ux*DEPTH/2, py+ny*(c+w/2)+uy*DEPTH/2, CROSSING_Z],
      [px+nx*(c-w/2)+ux*DEPTH/2, py+ny*(c-w/2)+uy*DEPTH/2, CROSSING_Z],
    ],[0,0,1],[.88,.88,.84]);
  }
}

/**
 * A 3x5 block font, one 15-bit mask per glyph, rows top to bottom and the high
 * bit of each row on the left.
 *
 * Street names on the mast arm have to be readable as geometry, not as an
 * overlay: the blade hangs in the world and has to carry its own lettering or
 * it is a blank board. Three by five is the smallest grid that stays legible,
 * and at one quad per lit pixel a name costs only a few hundred triangles.
 */
const GLYPH = {
  A:0b010101111101101, B:0b110101110101110, C:0b011100100100011,
  D:0b110101101101110, E:0b111100110100111, F:0b111100110100100,
  G:0b011100101101011, H:0b101101111101101, I:0b111010010010111,
  J:0b001001001101010, K:0b101101110101101, L:0b100100100100111,
  M:0b101111111101101, N:0b101111111111101, O:0b010101101101010,
  P:0b110101110100100, Q:0b010101101111011, R:0b110101110101101,
  S:0b011100010001110, T:0b111010010010010, U:0b101101101101011,
  V:0b101101101101010, W:0b101101111111101, X:0b101101010101101,
  Y:0b101101010010010, Z:0b111001010100111,
  0:0b111101101101111, 1:0b010110010010111, 2:0b110001010100111,
  3:0b110001010001110, 4:0b101101111001001, 5:0b111100110001110,
  6:0b011100110101010, 7:0b111001010010010, 8:0b010101010101010,
  9:0b010101011001110, ' ':0, '-':0b000000111000000, '.':0b000000000000010,
};

/**
 * A name blade hanging under a mast arm, lettered and facing oncoming traffic.
 *
 * `ux,uy` points the way the traffic this faces is travelling, so the board is
 * turned back toward it. Stopped at the line you are looking at the name of the
 * street you are about to cross, which is the one thing a driver at a red light
 * actually wants to know.
 */
function nameBlade(mesh,cx,cy,z,ux,uy,text) {
  const label=String(text||'').toUpperCase().slice(0,18);
  if(!label) return;
  // A viewer travelling along +u reads left to right along their own right
  // hand, which is -n, not +n. Laying the glyphs out along +n mirrored every
  // name: correct geometry, backwards text.
  const nx=uy, ny=-ux;
  const PX=0.055;                          // one font pixel, in cells
  const cw=4*PX;                           // 3 wide plus a space
  const wide=label.length*cw;
  const board=wide/2+3*PX;

  // The board itself, just behind the lettering.
  const face=(a,b,zz,hh,col,kind=0)=>{
    mesh.quad([
      [cx+nx*a, cy+ny*a, zz],
      [cx+nx*b, cy+ny*b, zz],
      [cx+nx*b, cy+ny*b, zz+hh],
      [cx+nx*a, cy+ny*a, zz+hh],
    ],[-ux,-uy,0],col,kind);
  };
  face(-board,board,z-4.5*PX,9*PX,[.06,.30,.13]);

  const out=PX*0.35;                       // lettering stands proud of the board
  const lx=cx-ux*out, ly=cy-uy*out;
  for(let i=0;i<label.length;i++) {
    const mask=GLYPH[label[i]];
    if(!mask) continue;
    const x0=-wide/2+i*cw;
    for(let r=0;r<5;r++) for(let c=0;c<3;c++) {
      if(!(mask>>(14-(r*3+c))&1)) continue;
      const a=x0+c*PX, b=a+PX, zz=z+2*PX-r*PX;
      mesh.quad([
        [lx+nx*a, ly+ny*a, zz],
        [lx+nx*b, ly+ny*b, zz],
        [lx+nx*b, ly+ny*b, zz+PX],
        [lx+nx*a, ly+ny*a, zz+PX],
      ],[-ux,-uy,0],[.93,.95,.92],3);
    }
  }
}

/**
 * The name of the street crossing this junction, as seen from one approach.
 *
 * The blade on a mast arm names the road you are about to cross, not the one
 * you are already on, so the search is for a nearby segment running across the
 * approach rather than along it.
 */
function crossStreetName(world,nearRoads,j,ux,uy) {
  const names=world.streetNames||[];
  let best=null,bestD=Infinity;
  for(const r of nearRoads) {
    if(r.nameId===undefined||r.nameId<0) continue;
    const dx=r.b[0]-r.a[0],dy=r.b[1]-r.a[1],L=Math.hypot(dx,dy)||1;
    // Across, not along: a small dot product with the approach direction.
    if(Math.abs((dx/L)*ux+(dy/L)*uy)>0.5) continue;
    const mx=(r.a[0]+r.b[0])/2,my=(r.a[1]+r.b[1])/2;
    const d=Math.hypot(mx-j.x,my-j.y);
    if(d<bestD){bestD=d;best=r;}
  }
  if(!best||bestD>26) return '';
  return names[best.nameId]||'';
}

/**
 * A signal head on a mast arm over the carriageway.
 *
 * Signals existed only as glyph columns at the four corners of a junction, so
 * the surface views had no signals at all. A real head hangs over the road on
 * an arm, facing the traffic it stops, which is also the only placement you can
 * read while driving at it.
 *
 * The mesh is static and rebuilt only when the camera changes sector, so which
 * lamp is lit cannot be baked in. Each lamp carries its index, its phase group
 * and the junction's offset in `seed`, and the shader runs the same 32 second
 * cycle `traffic-signals.js` runs. Both have to agree, or the cars will stop
 * for a light that looks green.
 */
function signalMast(mesh,lamps,px,py,ux,uy,width,group,offset,crossName) {
  const nx=-uy, ny=ux;
  const POLE_H=3.15, ARM_Z=2.88;           // about 7.5 m and 6.8 m
  const reach=width/2+0.9;
  // Right-hand kerb, on the FAR side of the junction. A head mounted on the
  // near kerb sits above and behind a driver at the line, where it cannot be
  // read without leaning forward; the one you actually watch is across the
  // intersection, facing back at you.
  const bx=px-nx*(width/2+0.75), by=py-ny*(width/2+0.75);
  const angle=Math.atan2(uy,ux);

  mesh.box(bx,by,0,.17,.17,POLE_H,0,[.21,.25,.26]);
  // Arm from that kerb back out over the carriageway.
  const ax=bx+nx*reach/2, ay=by+ny*reach/2;
  mesh.box(ax,ay,ARM_Z,reach,.12,.12,angle+Math.PI/2,[.21,.25,.26]);

  // Head at the far end, facing back down the approach.
  const hx=bx+nx*reach, hy=by+ny*reach;
  mesh.box(hx,hy,ARM_Z-1.02,.30,.30,1.00,angle,[.13,.16,.17]);
  // The cross street's name, hung horizontally under the arm beside the head.
  if(crossName) nameBlade(mesh,ax,ay,ARM_Z-0.30,ux,uy,crossName);
  const COL=[[1,.13,.10],[1,.70,.12],[.20,1,.32]];
  for(let i=0;i<3;i++) {
    const z=ARM_Z-0.28-i*0.30, r=0.10;
    const fx=-ux*0.17, fy=-uy*0.17;        // just proud of the housing face
    lamps.quad([
      [hx+fx+nx*-r, hy+fy+ny*-r, z-r],
      [hx+fx+nx* r, hy+fy+ny* r, z-r],
      [hx+fx+nx* r, hy+fy+ny* r, z+r],
      [hx+fx+nx*-r, hy+fy+ny*-r, z+r],
    // Quantised to 1/8 s. `precision mediump float` only guarantees a range of
    // +/-16384, and packing at 1/64 pushed the seed past that into undefined
    // territory; 1/8 keeps the largest seed near 2000 and is still far finer
    // than a 32 second cycle needs.
    ],[-ux,-uy,0],COL[i],7,i+group*4+Math.round(offset*8)*8);
  }
}

/** A streetlight: dark pole, opaque housing, light on the underside only. */
function lamppost(mesh,lights,x,y) {
  mesh.box(x,y,.06,.055,.055,2.3,0,[.22,.29,.29]);
  // An opaque housing with the light on its underside, so nothing glows at
  // anyone looking down on it.
  mesh.box(x,y,2.30,.38,.38,.07,0,[.20,.23,.24]);
  const g=.155;
  mesh.quad([[x-g,y-g,2.295],[x+g,y-g,2.295],[x+g,y+g,2.295],[x-g,y+g,2.295]],
    [0,0,-1],[1,.87,.55],3);
  lights.disc(x,y,.03,3.2,[1,.82,.48],5);
}

function frontage(mesh,a,b,height,seed,colour) {
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
  if(len < 1) return;
  const nx=dy/len,ny=-dx/len,angle=Math.atan2(dy,dx);
  mesh.quad([[...a,0],[...b,0],[...b,height],[...a,height]],[nx,ny,0],colour,1,seed,
    [[0,0],[len,0],[len,height],[0,height]]);
  // Cornice and a recessed ground-floor canopy give the wall a human scale.
  mesh.box((a[0]+b[0])/2,(a[1]+b[1])/2,height-.10,len+.08,.16,.15,angle,[.90,.86,.76]);
  if(len>3) {
    const awning=[.20,.39,.37];
    if(seed%3===1) awning.splice(0,3,.59,.28,.22);
    mesh.box((a[0]+b[0])/2+nx*.21,(a[1]+b[1])/2+ny*.21,1.06,len*.76,.65,.12,angle,awning);
    mesh.box((a[0]+b[0])/2+nx*.13,(a[1]+b[1])/2+ny*.13,FLOOR_H-.09,len*.58,.12,.26,angle,[.17,.27,.28]);
  }
}

/**
 * Triangulate a simple polygon by ear clipping.
 *
 * Roofs used to be paved with axis-aligned cell squares, which is exact only
 * for a footprint aligned to the grid. Any other angle produced a stair-stepped
 * slab: corners jutting past the wall on one side, daylight between the steps
 * on the other. The ring is the truth about where the roof is, so cut it up
 * directly. Ear clipping rather than a centroid fan because footprints are
 * routinely concave (every L-shaped block) and a fan turns those inside out.
 *
 * Returns a flat list of triangles; a ring it cannot resolve returns none,
 * which loses a roof rather than emitting scrambled geometry.
 */
export function triangulate(ring) {
  const pts = ring.slice();
  // Rings arrive closed; the duplicate last point is not a vertex.
  if (pts.length > 1 && pts[0][0] === pts[pts.length-1][0]
                     && pts[0][1] === pts[pts.length-1][1]) pts.pop();
  const n = pts.length;
  if (n < 3) return [];

  const area2 = (a,b,c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i+1)%n];
    sum += (q[0]-p[0]) * (q[1]+p[1]);
  }
  // Work counter-clockwise so a positive cross product means a convex corner.
  const idx = [...pts.keys()];
  if (sum > 0) idx.reverse();

  const inside = (a,b,c,p) =>
    area2(a,b,p) >= 0 && area2(b,c,p) >= 0 && area2(c,a,p) >= 0;

  const out = [];
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]];
      const b = pts[idx[i]];
      const c = pts[idx[(i + 1) % idx.length]];
      if (area2(a,b,c) <= 0) continue;            // reflex, not an ear
      let clean = true;
      for (const j of idx) {
        const p = pts[j];
        if (p === a || p === b || p === c) continue;
        if (inside(a,b,c,p)) { clean = false; break; }
      }
      if (!clean) continue;
      out.push([a,b,c]);
      idx.splice(i,1);
      clipped = true;
      break;
    }
    if (!clipped) return out.length ? out : [];   // self-intersecting ring
  }
  if (idx.length === 3) out.push([pts[idx[0]],pts[idx[1]],pts[idx[2]]]);
  return out;
}

function building(mesh,world,b) {
  const seed=Number(b.osm?.split('/')[1]) || Math.round(b.cx*31+b.cy*17);
  const colour=PALETTE[Math.abs(seed)%PALETTE.length];
  for (const ring of b.rings || []) {
    // The perimeter is the truth about where this building is: walls follow it,
    // and the roof is that same outline cut into triangles, so the slab ends
    // exactly where the walls do.
    for(let i=1;i<ring.length;i++) frontage(mesh,ring[i-1],ring[i],b.h,seed,colour);
    for(const [p,q,r] of triangulate(ring)) {
      mesh.tri([[p[0],p[1],b.h],[q[0],q[1],b.h],[r[0],r[1],b.h]],[0,0,1],[.60,.61,.58]);
    }
  }
}

/** Rebuild only after a sector change; all decoration seeds are world anchored. */
export function buildDistrict(world, cam, radius = 145) {
  // Lights are built into their own mesh. They are drawn in a second, additive
  // pass, because a light has to brighten the ground it falls on rather than
  // replace it: as one opaque disc the pool hid the kerb, the markings and the
  // planting it was supposed to illuminate.
  const mesh=new Mesh(), lights=new Mesh(), beacons=new Mesh(), walkers=[];
  const cx=Math.floor(cam.x/32)*32+16,cy=Math.floor(cam.y/32)*32+16;
  const nearbyJunctions=(world.junctions||[]).filter(j=>Math.hypot(j.x-cx,j.y-cy)<radius+15);

  // Road segments in range, gathered once. Trees are placed from the raster,
  // but a road is DRAWN wider than it is rasterised, so a cell the world calls
  // TREE can sit under the carriageway that gets painted over it. Two of every
  // five trees near a street landed in the road that way. Nothing goes on the
  // ground without checking it against the geometry actually drawn there.
  const nearRoads=[];
  for(const road of world.roads||[]) {
    const width=road.width||3.8;
    for(let i=1;i<road.pts.length;i++) {
      const a=road.pts[i-1],b=road.pts[i];
      if(Math.hypot((a[0]+b[0])/2-cx,(a[1]+b[1])/2-cy)>radius+40) continue;
      nearRoads.push({a,b,width,nameId:road.nameId});
    }
  }
  const clearOfRoad=(px,py,margin)=>{
    for(const r of nearRoads) {
      const dx=r.b[0]-r.a[0],dy=r.b[1]-r.a[1],L=dx*dx+dy*dy;
      let t=L?((px-r.a[0])*dx+(py-r.a[1])*dy)/L:0;
      t=t<0?0:t>1?1:t;
      const d=Math.hypot(px-(r.a[0]+dx*t),py-(r.a[1]+dy*t));
      if(d<r.width/2+margin) return false;
    }
    return true;
  };
  mesh.box(cx,cy,-.10,radius*2.8,radius*2.8,.1,0,[.70,.71,.65]);
  // Read existing terrain into coarse, contiguous runs. Buildings themselves
  // are emitted from exact rings, not from these terrain samples.
  for(let y=cy-radius;y<cy+radius;y+=2) {
    let start=cx-radius,previous=-1,runSim=0;
    const paint=(end,type) => {
      if(![T.WATER,T.FIELD,T.YARD,T.FOREST,T.PATH].includes(type)) return;
      const col=type===T.WATER?[.28,.55,.62]:type===T.PATH?[.74,.70,.57]:[.48,.62,.37];
      mesh.box((start+end)/2,y+1,.002,end-start,2,.01,0,col,(type===T.WATER?4:0)+runSim);
    };
    for(let x=cx-radius;x<=cx+radius;x+=2) {
      const slot=world.sample(x,y),type=world.type[slot];
      if(type!==previous || x===cx+radius) { if(previous>=0) paint(x,previous); start=x; previous=type; runSim=simOf(world,slot); }
      // 1.25 clears the drawn sidewalk slab, and the canopy on top of it.
      if((type===T.TREE||type===T.FOREST) && Math.hypot(x-cx,y-cy)<70
         && hash(x,y,27)>.85 && clearOfRoad(x,y,2.3)) {
        tree(mesh,x,y,Math.round(x*19+y*7));
      }
      // Streetlights are placed from the raster too, on cells the world itself
      // calls pavement. Positioning them by an offset from a road polyline
      // could not work: the polylines and the rasterised streets are separate
      // descriptions of this city and they do not coincide, so the offset was
      // landing in the carriageway. A cell that says SIDEWALK is the one thing
      // that cannot be wrong about where the pavement is.
      if(type===T.SIDEWALK && Math.hypot(x-cx,y-cy)<62
         && hash(x,y,91)>.90 && clearOfRoad(x,y,0.35)) {
        lamppost(mesh,lights,x+.5,y+.5);
      }
    }
  }
  // Mapped footprints, drawn from their exact rings.
  const mapped = world.buildings?.length > 1;
  if(mapped) {
    for(const b of world.buildings) if(b && Math.hypot(b.cx-cx,b.cy-cy)<radius+b.r) building(mesh,world,b);
  }
  {
    // Build from the exact collision cells, never approximate procedural
    // buildings with different footprints. Merge row runs to keep the mesh small.
    //
    // This runs alongside the ring pass, not instead of it. A composite world
    // is mapped in the middle and generated around it, so both kinds of
    // building are in view at once; skipping this whenever an extract exists
    // would leave the substrate's city as bare ground. `bid` says which cells a
    // ring already owns, and those are left to the pass above rather than
    // drawn twice.
    for(let y=Math.floor(cy-radius);y<cy+radius;y++) {
      let x=Math.floor(cx-radius);
      while(x<cx+radius) {
        const slot=world.sample(x,y),type=world.type[slot],h=world.h[slot],pal=world.pal[slot];
        // Aircraft warning lights exist in the world for every building over
        // 25 cells, mapped or generated, and the character renderer has always
        // blinked them. The surface renderer never read the flag, so the red
        // lights simply went missing the moment the view changed. Each is its
        // own tiny mesh at roof height, phase-shifted by the cell so a skyline
        // does not blink in unison.
        if(world.flags?.[slot] & F.BEACON) {
          beacons.box(x+.5,y+.5,h,.5,.5,.34,0,[1,.12,.10],6,(x*73+y*31)%997);
        }
        if((type!==T.HOUSE && type!==T.TOWER) || (mapped && world.bid[slot]!==0)) { x++; continue; }
        const start=x;
        while(++x<cx+radius) {
          const next=world.sample(x,y);
          if(world.type[next]!==type || world.h[next]!==h || world.pal[next]!==pal) break;
          if(mapped && world.bid[next]!==0) break;
        }
        const colour=PALETTE[pal%PALETTE.length];
        mesh.box((start+x)/2,y+.5,0,x-start,1,h,0,colour,1+simOf(world,slot),pal);
      }
    }
  }

  for(const road of world.roads || []) {
    if(['motorway','trunk','motorway_link','trunk_link'].includes(road.cls)) continue;
    const foot=['footway','path','pedestrian','steps','cycleway'].includes(road.cls);
    const width=road.width || 3.8;
    // Distance travelled along the whole polyline, not along this segment. The
    // cadence below restarted at every vertex, so each segment placed its own
    // furniture near a shared corner and both sides of a bend got a set: the
    // clustering at junctions was two rows meeting, not one row bunching.
    let along0=0;
    for(let i=1;i<road.pts.length;i++) {
      const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      const base=along0; along0+=len;
      if(len<.1) continue;
      const t=Math.max(0,Math.min(1,((cx-a[0])*dx+(cy-a[1])*dy)/(len*len)));
      if(Math.hypot(a[0]+dx*t-cx,a[1]+dy*t-cy)>radius) continue;
      const lo=Math.max(0,t*len-radius),hi=Math.min(len,t*len+radius);
      const ux=dx/len,uy=dy/len,angle=Math.atan2(dy,dx),mx=a[0]+ux*(lo+hi)/2,my=a[1]+uy*(lo+hi)/2;
      // Sidewalk and asphalt have distinct, calm materials and real thickness.
      mesh.box(mx,my,.014,hi-lo,width+2.5,.04,angle,[.80,.79,.71]);
      mesh.box(mx,my,ROAD_Z,hi-lo,width,ROAD_THICK,angle,foot?[.77,.74,.65]:[.32,.37,.40]);
      // Crossings at each end of a segment that meets a junction, set back from
      // the centre so they sit where a stop line would, not in the middle of
      // the box. Both ends are checked because a segment can arrive at one
      // junction and leave from another.
      if(!foot) for(const end of [0,1]) {
        const jx=end?b[0]:a[0], jy=end?b[1]:a[1];
        const j=nearbyJunctions.find(n2=>Math.hypot(n2.x-jx,n2.y-jy)<2.5);
        if(!j) continue;
        const back=width/2+CROSS_SETBACK;
        const d=end?len-back:back;
        if(d<lo||d>hi) continue;
        const dirx=end?ux:-ux, diry=end?uy:-uy;
        crossing(mesh,a[0]+ux*d,a[1]+uy*d,ux,uy,width);
        // Phase group from the approach bearing, so crossing streets alternate;
        // offset from the junction's own position, so the city does not switch
        // in unison. Both are deterministic, which keeps the mesh stable.
        // Only where the simulation actually signals. A head at a junction the
        // cars treat as uncontrolled is a light nobody obeys.
        if(!j.signal) continue;
        // Signals are furniture you read from close by. Building a mast, a
        // head and a lettered blade for every signalled approach in a 125 cell
        // district put a few hundred thousand vertices of unreadable text into
        // the buffer; the name alone is up to 90 quads a character.
        const jd=Math.hypot(j.x-cx,j.y-cy);
        if(jd>72) continue;
        // The phase has to be the one the cars read, not a parallel derivation
        // of it. The simulation takes the group from the junction's own
        // approach records and the offset from the node id; computing them here
        // from bearing and position gave a different signal that merely looked
        // like one, which is why traffic ignored the colour.
        let group=0,bestDot=-2;
        for(const ap of j.approaches||[]) {
          const d=(-dirx)*ap.dx+(-diry)*ap.dy;
          if(d>bestDot){bestDot=d;group=ap.group|0;}
        }
        const offset=(((j.id*0.17)%32)+32)%32;
        // The head goes on the far kerb, past the junction, so a driver at the
        // line looks across the intersection at it rather than up at a pole
        // beside them. The blade names the street being crossed.
        const fx=j.x+dirx*(width/2+2.2), fy=j.y+diry*(width/2+2.2);
        signalMast(mesh,beacons,fx,fy,dirx,diry,width,group,offset,
          jd<46?crossStreetName(world,nearRoads,j,dirx,diry):'');
      }
      if(!foot) for(let d=Math.ceil(lo/4)*4;d<hi;d+=4) {
        if(nearbyJunctions.some(j=>Math.hypot(j.x-(a[0]+ux*d),j.y-(a[1]+uy*d))<width+1)) continue;
        mesh.box(a[0]+ux*d,a[1]+uy*d,DASH_Z,1.8,.065,.003,angle,[.92,.86,.61]);
      }
      // Step on a grid measured along the road itself, and alternate which
      // kerb each piece lands on, the way street furniture is actually spaced.
      // Both sides at every stop put two of everything at each interval.
      const STEP=14;
      const first=Math.ceil((base+lo)/STEP)*STEP;
      for(let g=first;g<base+hi;g+=STEP) {
        const d=g-base;
        const side=(Math.round(g/STEP)&1)?1:-1;
        // Step out from the kerb until the ground is genuinely pavement AND
        // clear of every nearby carriageway. A fixed offset assumed the road
        // was exactly as wide as the lane table says and that the centreline
        // sat in the middle of it; neither holds, which is how street furniture
        // ended up standing in traffic. Asking the world is the only thing that
        // knows where the kerb is.
        // Search the raster for real pavement near this point instead of
        // trusting an offset from the centreline. The polyline and the
        // rasterised streets are two independent descriptions of the same city
        // and they do not line up, so any fixed offset from one lands somewhere
        // arbitrary in the other. The world's own cells are the authority on
        // where a kerb is; the offset was only ever a guess at it.
        let x=null,y=null,bestD=Infinity;
        const ax=a[0]+ux*d, ay=a[1]+uy*d;
        for(let oy=-4;oy<=4;oy++) for(let ox=-4;ox<=4;ox++) {
          const px=Math.floor(ax)+ox+0.5, py=Math.floor(ay)+oy+0.5;
          const sl=world.sample(px,py);
          if(world.h[sl]>.1) continue;
          if(![T.SIDEWALK,T.PATH,T.YARD].includes(world.type[sl])) continue;
          if(!clearOfRoad(px,py,0.45)) continue;
          const dd=Math.hypot(px-ax,py-ay);
          if(dd<bestD){bestD=dd;x=px;y=py;}
        }
        if(x===null || Math.hypot(x-cx,y-cy)>65) continue;
        if(nearbyJunctions.some(j=>Math.hypot(j.x-x,j.y-y)<width+2)) continue;
        const seed=Math.round(hash(Math.round(x*8),Math.round(y*8),42)*10000);
        // A street tree only goes in if its canopy is provably clear of the
        // carriageway. If it is not, put the lamp there instead: a missing tree
        // costs nothing, a tree standing in the road is never acceptable.
        // Nothing is planted here unless the spot is clear of the carriageway.
        // Routing failed tree placements to a lamp instead was worse than the
        // problem it fixed: every spot too close to the road, which is exactly
        // the set a tree had just been refused, got a streetlight standing in
        // the traffic. If the ground will not take a tree it will not take a
        // pole either, and the right answer is to leave it empty.
        // Each object clears the road by what it actually occupies: a pole is
        // thin, a canopy is two metres across. Anything that cannot make its
        // own clearance is simply not placed. Sending a refused tree to a lamp
        // instead put a streetlight in the carriageway at every spot a tree had
        // just been rejected from, which was worse than what it replaced.
        // A canopy is two metres across, so a tree needs more room than a pole.
        // Whatever cannot make its own clearance is not placed at all.
        if(seed%3) { if(clearOfRoad(x,y,1.35)) tree(mesh,x,y,seed); }
        else {
          lamppost(mesh,lights,x,y);
        }
        if(seed%4===0) {
          // The bench sits 1.8 cells further along the road than the point that
          // was checked, and that new spot was never checked itself. Along a
          // curve, past a corner, or wherever the pavement simply stops, the
          // step lands in the carriageway and a bench is built in the road.
          // Anything placed on the ground has to stand somewhere real.
          const bx=x+ux*1.8,by=y+uy*1.8;
          const bs=world.sample(bx,by);
          if(world.h[bs]<=.1 && [T.SIDEWALK,T.PATH,T.YARD].includes(world.type[bs])) {
            mesh.box(bx,by,.20,.9,.32,.08,angle,[.51,.33,.20]);
            mesh.box(bx+uy*.12,by-ux*.12,.28,.9,.07,.3,angle,[.51,.33,.20]);
          }
        }
        walkers.push({x:a[0]-uy*(width/2+.5)*side,y:a[1]+ux*(width/2+.5)*side,
          ux,uy,lo:Math.max(lo,d-5),hi:Math.min(hi,d+5),seed});
      }
    }
  }
  return { vertices:mesh.array(),lights:lights.array(),beacons:beacons.array(),walkers,cx,cy };
}

/**
 * Moving geometry, and the light it throws.
 *
 * Returns both the solid mesh and a separate light mesh: headlights have to be
 * added onto the scene rather than painted into it, the same way the street
 * lamps are, or a beam is just a bright shape on the road instead of light
 * falling on it.
 */
export function buildMovers(traffic, district, time, dayAmt = 0) {
  const mesh=new Mesh(), glow=new Mesh();
  if(traffic.mode===0) return { vertices:mesh.array(), lights:glow.array() };
  for(const car of traffic.agents) {
    if(car.kind!=='car') continue;
    const p=car.vehicle, x=car.renderX??car.x,y=car.renderY??car.y;
    const angle=Math.atan2(car.hy||0,car.hx||1),col=p?.paint.map(c=>c/255)||[.73,.24,.18];
    const len=p?.length||1.85,w=p?.width||.78;
    const ux=Math.cos(angle),uy=Math.sin(angle);
    const tint=(car.vehicleSeed>>>0);
    const SKIN=[[.94,.78,.65],[.86,.67,.50],[.72,.52,.37],[.55,.38,.26],[.38,.26,.19],[.29,.19,.14]];
    const skin=SKIN[tint%SKIN.length];
    // The driver sits nearest the centreline, which is the left in right-hand
    // traffic. They used to sit dead centre, which is no country's arrangement.
    const dSide=DRIVE_ON_RIGHT?1:-1;
    const glass=[.50,.63,.69];

    if(p?.kind==='bus') {
      // A bus is a box on wheels: one tall slab the whole length, a flat roof,
      // and a band of windows down the side. Drawing it with a car's
      // proportions, a long low body under a short cabin, made a stretch limo.
      mesh.box(x,y,.14,len,w,1.06,angle,col);
      mesh.box(x,y,1.20,len*.98,w*.96,.07,angle,col.map(c=>c*.82));
      // Window band, inset a little so the body reads as bodywork around it.
      for(const side of [-1,1]) {
        mesh.box(x-uy*w*.5*side,y+ux*w*.5*side,.62,len*.90,.04,.42,angle,glass);
      }
      mesh.box(x+ux*len*.49,y+uy*len*.49,.58,.05,w*.88,.46,angle,glass);
      mesh.box(x+ux*len*.34-uy*w*.22*dSide,y+uy*len*.34+ux*w*.22*dSide,
        .74,.17,.17,.17,angle,skin);
    } else {
      mesh.box(x,y,.16,len,w,.28,angle,col);
      // Glazing, not a black box. The cabin was .23,.38,.44 in every light,
      // which at night is near enough to the body to read as a solid block and
      // by day hides that anyone is in there.
      mesh.box(x,y,.44,len*.55,w*.83,.28,angle,glass);
      mesh.box(x-ux*len*.04-uy*w*.19*dSide,y-uy*len*.04+ux*w*.19*dSide,
        .50,.16,.16,.16,angle,skin);
      mesh.box(x,y,.70,len*.42,w*.78,.06,angle,col);
    }
    for(const side of [-1,1]) for(const end of [-1,1]) {
      mesh.box(x+ux*len*.32*end-uy*w*.46*side,y+uy*len*.32*end+ux*w*.46*side,.075,.29,.12,.27,angle,[.12,.15,.16]);
    }
    // Headlights after dark: a pool of light on the road ahead, not a lamp
    // drawn on the bonnet. The disc's uv.x runs 0 at its centre to 1 at the
    // rim, which the additive pass reads as falloff.
    if(dayAmt < 0.55) {
      const reach = len*1.9;
      glow.disc(x+ux*reach, y+uy*reach, .02, len*2.4, [1,.95,.80], 5);
      for(const side of [-1,1]) {
        mesh.box(x+ux*len*.5-uy*w*.34*side, y+uy*len*.5+ux*w*.34*side,
          .26, .06, .16, .12, angle, [1,.96,.86], 3);
        // Tail lamps, so a car seen from behind is not a silhouette.
        mesh.box(x-ux*len*.5-uy*w*.34*side, y-uy*len*.5+ux*w*.34*side,
          .26, .05, .14, .10, angle, [.95,.12,.08], 3);
      }
    }

    // Indicators, on the side the car is turning, flashing about 1.5 Hz. A car
    // that changes direction without signalling first reads as teleporting into
    // the turn; the flash is what announces it.
    if(car.turn) {
      const on=Math.sin(time*9.4)>0;
      if(on) for(const end of [-1,1]) {
        mesh.box(x+ux*len*.42*end-uy*w*.48*car.turn,
                 y+uy*len*.42*end+ux*w*.48*car.turn,
                 .30,.16,.08,.10,angle,[1,.62,.10],3);
      }
    }
  }
  if(traffic.mode===2) for(const p of traffic.agents) {
    if(p.kind!=='ped') continue;
    const x=p.renderX??p.x,y=p.renderY??p.y;
    // Face the way they are going. Every limb used to be built at angle 0, so
    // a crowd all faced the same compass direction whatever street it was on.
    const angle=Math.atan2(p.hy||0,p.hx||1);
    const ux=Math.cos(angle),uy=Math.sin(angle);
    const sx=-uy,sy=ux;                       // across the body

    // One seed per person picks a skin tone and an outfit, so a pavement is a
    // crowd rather than one figure repeated.
    const t=p.tint>>>0;
    const SKIN=[[.94,.78,.65],[.86,.67,.50],[.72,.52,.37],[.55,.38,.26],[.38,.26,.19],[.29,.19,.14]];
    const SHIRT=[[.38,.46,.54],[.62,.26,.28],[.24,.40,.32],[.78,.72,.56],[.30,.32,.48],[.52,.46,.62],[.82,.56,.30],[.20,.22,.26]];
    const LEG=[[.23,.28,.32],[.30,.26,.22],[.18,.20,.26],[.42,.40,.36],[.26,.30,.28]];
    const skin=SKIN[t%SKIN.length];
    const shirt=SHIRT[(t>>>3)%SHIRT.length];
    const leg=LEG[(t>>>7)%LEG.length];

    // Opposed swing: arms counter the legs, which is what makes a walk read as
    // walking rather than sliding.
    const phase=time*7+(t%1000)*.01;
    const swing=Math.sin(phase)*.05;

    mesh.box(x,y,.32,.20,.15,.27,angle,shirt);
    mesh.box(x,y,.60,.14,.14,.14,angle,skin);
    mesh.box(x+ux*swing-sx*.055,y+uy*swing-sy*.055,.025,.07,.09,.30,angle,leg);
    mesh.box(x-ux*swing+sx*.055,y-uy*swing+sy*.055,.025,.07,.09,.30,angle,leg);
    // Arms, swinging against the legs.
    mesh.box(x-ux*swing-sx*.115,y-uy*swing-sy*.115,.33,.06,.07,.25,angle,shirt);
    mesh.box(x+ux*swing+sx*.115,y+uy*swing+sy*.115,.33,.06,.07,.25,angle,shirt);
  }
  return { vertices:mesh.array(), lights:glow.array() };
}
