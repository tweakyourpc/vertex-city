import { T, F, hash } from '../world/source.js';
import { FLOOR_H } from '../config.js';

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
  const BAR=0.62, GAP=0.46, DEPTH=2.35;    // metres, in cells
  const half=width/2+0.12;
  // Step out from the centreline both ways so the pattern stays centred on the
  // road however wide it is, instead of starting at one kerb and running short.
  for(let o=-half;o<half-BAR*0.5;o+=BAR+GAP) {
    const a=Math.max(o,-half), b=Math.min(o+BAR,half);
    if(b-a<0.12) continue;
    const c=(a+b)/2, w=b-a;
    mesh.quad([
      [px+nx*(c-w/2)-ux*DEPTH/2, py+ny*(c-w/2)-uy*DEPTH/2, .066],
      [px+nx*(c+w/2)-ux*DEPTH/2, py+ny*(c+w/2)-uy*DEPTH/2, .066],
      [px+nx*(c+w/2)+ux*DEPTH/2, py+ny*(c+w/2)+uy*DEPTH/2, .066],
      [px+nx*(c-w/2)+ux*DEPTH/2, py+ny*(c-w/2)+uy*DEPTH/2, .066],
    ],[0,0,1],[.88,.88,.84]);
  }
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
function signalMast(mesh,lamps,px,py,ux,uy,width,group,offset) {
  const nx=-uy, ny=ux;
  const POLE_H=2.78, ARM_Z=2.52;           // about 6.6 m and 6.0 m
  const reach=width/2+0.9;
  const bx=px+nx*(width/2+0.75), by=py+ny*(width/2+0.75);
  const angle=Math.atan2(uy,ux);

  mesh.box(bx,by,0,.17,.17,POLE_H,0,[.21,.25,.26]);
  // Arm from the kerb out over the middle of the road.
  const ax=bx-nx*reach/2, ay=by-ny*reach/2;
  mesh.box(ax,ay,ARM_Z,reach,.12,.12,angle+Math.PI/2,[.21,.25,.26]);

  // Head at the far end, facing back down the approach.
  const hx=bx-nx*reach, hy=by-ny*reach;
  mesh.box(hx,hy,ARM_Z-1.02,.30,.30,1.00,angle,[.13,.16,.17]);
  const COL=[[1,.13,.10],[1,.70,.12],[.20,1,.32]];
  for(let i=0;i<3;i++) {
    const z=ARM_Z-0.28-i*0.30, r=0.10;
    const fx=-ux*0.17, fy=-uy*0.17;        // just proud of the housing face
    lamps.quad([
      [hx+fx+nx*-r, hy+fy+ny*-r, z-r],
      [hx+fx+nx* r, hy+fy+ny* r, z-r],
      [hx+fx+nx* r, hy+fy+ny* r, z+r],
      [hx+fx+nx*-r, hy+fy+ny*-r, z+r],
    ],[-ux,-uy,0],COL[i],7,i+group*4+offset*8);
  }
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
      if((type===T.TREE||type===T.FOREST) && Math.hypot(x-cx,y-cy)<70 && hash(x,y,27)>.85) tree(mesh,x,y,Math.round(x*19+y*7));
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
      mesh.box(mx,my,.056,hi-lo,width,.014,angle,foot?[.77,.74,.65]:[.32,.37,.40]);
      // Crossings at each end of a segment that meets a junction, set back from
      // the centre so they sit where a stop line would, not in the middle of
      // the box. Both ends are checked because a segment can arrive at one
      // junction and leave from another.
      if(!foot) for(const end of [0,1]) {
        const jx=end?b[0]:a[0], jy=end?b[1]:a[1];
        const j=nearbyJunctions.find(n2=>Math.hypot(n2.x-jx,n2.y-jy)<2.5);
        if(!j) continue;
        const back=width/2+2.4;
        const d=end?len-back:back;
        if(d<lo||d>hi) continue;
        const dirx=end?ux:-ux, diry=end?uy:-uy;
        crossing(mesh,a[0]+ux*d,a[1]+uy*d,ux,uy,width);
        // Phase group from the approach bearing, so crossing streets alternate;
        // offset from the junction's own position, so the city does not switch
        // in unison. Both are deterministic, which keeps the mesh stable.
        const group=Math.abs(dirx)>Math.abs(diry)?0:1;
        const offset=Math.abs(Math.round(j.x*7+j.y*13))%32;
        signalMast(mesh,beacons,a[0]+ux*d,a[1]+uy*d,dirx,diry,width,group,offset);
      }
      if(!foot) for(let d=Math.ceil(lo/4)*4;d<hi;d+=4) {
        if(nearbyJunctions.some(j=>Math.hypot(j.x-(a[0]+ux*d),j.y-(a[1]+uy*d))<width+1)) continue;
        mesh.box(a[0]+ux*d,a[1]+uy*d,.073,1.8,.065,.003,angle,[.92,.86,.61]);
      }
      // Step on a grid measured along the road itself, and alternate which
      // kerb each piece lands on, the way street furniture is actually spaced.
      // Both sides at every stop put two of everything at each interval.
      const STEP=14;
      const first=Math.ceil((base+lo)/STEP)*STEP;
      for(let g=first;g<base+hi;g+=STEP) {
        const d=g-base;
        const side=(Math.round(g/STEP)&1)?1:-1;
        const offset=width/2+.8,x=a[0]+ux*d-uy*offset*side,y=a[1]+uy*d+ux*offset*side;
        const slot=world.sample(x,y);
        if(world.h[slot]>.1 || ![T.SIDEWALK,T.PATH,T.YARD].includes(world.type[slot]) || Math.hypot(x-cx,y-cy)>65) continue;
        if(nearbyJunctions.some(j=>Math.hypot(j.x-x,j.y-y)<width+2)) continue;
        const seed=Math.round(hash(Math.round(x*8),Math.round(y*8),42)*10000);
        if(seed%3) tree(mesh,x,y,seed);
        else {
          mesh.box(x,y,.06,.055,.055,2.3,0,[.22,.29,.29]);
          // An opaque housing with the light on its underside. The head used to
          // be one emissive box, and nothing culls backfaces here, so its top
          // face glowed at anyone looking down on it: a lit tile on a pole
          // rather than a lamp. The housing now occludes the source from above,
          // and the source only faces the ground it is lighting.
          mesh.box(x,y,2.30,.38,.38,.07,angle,[.20,.23,.24]);
          const g=.155;
          mesh.quad([[x-g,y-g,2.295],[x+g,y-g,2.295],[x+g,y+g,2.295],[x-g,y+g,2.295]],
            [0,0,-1],[1,.87,.55],3);
          // Radial falloff rides in the disc's uv.x, which runs 0 at the
          // centre to 1 at the rim, so the pool fades out instead of ending
          // at a hard circle.
          lights.disc(x,y,.03,3.2,[1,.82,.48],5);
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

export function buildMovers(traffic, district, time) {
  const mesh=new Mesh();
  if(traffic.mode===0) return mesh.array();
  for(const car of traffic.agents) {
    if(car.kind!=='car') continue;
    const p=car.vehicle, x=car.renderX??car.x,y=car.renderY??car.y;
    const angle=Math.atan2(car.hy||0,car.hx||1),col=p?.paint.map(c=>c/255)||[.73,.24,.18];
    const len=p?.length||1.85,w=p?.width||.78;
    mesh.box(x,y,.16,len,w,.28,angle,col);
    mesh.box(x,y,.44,len*.55,w*.83,.28,angle,[.23,.38,.44]);
    mesh.box(x,y,.70,len*.42,w*.78,.06,angle,col);
    for(const side of [-1,1]) for(const end of [-1,1]) {
      const ux=Math.cos(angle),uy=Math.sin(angle);
      mesh.box(x+ux*len*.32*end-uy*w*.46*side,y+uy*len*.32*end+ux*w*.46*side,.075,.29,.12,.27,angle,[.12,.15,.16]);
    }
  }
  if(traffic.mode===2) for(const p of traffic.agents) {
    if(p.kind!=='ped') continue;
    const x=p.renderX??p.x,y=p.renderY??p.y;
    const walk=Math.sin(time*7+x)*.035;
    mesh.box(x,y,.32,.20,.15,.27,0,[.38,.46,.54]);
    mesh.box(x,y,.60,.14,.14,.14,0,[.75,.56,.40]);
    mesh.box(x-.055,y+walk,.025,.07,.09,.30,0,[.23,.28,.32]);
    mesh.box(x+.055,y-walk,.025,.07,.09,.30,0,[.23,.28,.32]);
  }
  return mesh.array();
}
