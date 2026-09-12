import { buildDistrict, buildMovers, STRIDE } from './district.js';
import { FOV, FLOOR_H } from '../config.js';
import { wirePalette } from './palettes.js';

const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec2 uv;
attribute float kind;
attribute float seed;
attribute vec4 quad;   // xy: corner within the quad, zw: quad size in metres
uniform vec3 camera;
uniform vec2 forward;
uniform float tangent;
uniform float aspect;
uniform float horizon;
varying vec3 vColour;
varying vec3 vNormal;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vDistance;
varying vec4 vQuad;
void main() {
  vec3 relative = position - camera;
  float along = dot(relative.xy, forward);
  float side = dot(relative.xy, vec2(forward.y, -forward.x));
  float near = 0.025;
  float far = 480.0;
  gl_Position = vec4(side / tangent,
    relative.z * aspect / tangent + horizon * along,
    (far + near) / (far - near) * along - 2.0 * far * near / (far - near), along);
  vColour = colour;
  vNormal = normal;
  vUv = uv;
  vKind = kind;
  vSeed = seed;
  vQuad = quad;
  vDistance = length(relative);
}`;
const fragmentSource = `
precision mediump float;
uniform float daylight;
uniform float time;
uniform vec3 haze;
varying vec3 vColour;
varying vec3 vNormal;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vDistance;
varying vec4 vQuad;
uniform float wire;
uniform float wireUnit;    // world metres per screen pixel, at unit distance
uniform vec3 wireBuilding;
uniform vec3 wireWater;
uniform vec3 wireCanopy;
uniform vec3 wireGround;
uniform vec3 wireVoid;
uniform vec3 sunDir;   // unit vector toward the sun, world axes
uniform vec3 wireFrontier;
uniform float lightPass;
float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233)) + mod(vSeed, 997.0)) * 437.5453); }
void main() {
  vec3 colour = vColour;
  // Provenance rides in kind's 8s place. Take it off before switching on the
  // material, so every material test below reads the same as it always did.
  float sim = step(8.0, vKind);
  float kind = vKind - sim * 8.0;

  // Lights are drawn additively in their own pass, so a pool brightens the
  // ground it lands on instead of covering it. uv.x runs 0 at a disc's centre
  // to 1 at its rim, which gives the falloff without a texture.
  if (lightPass > 0.5) {
    // Kind 6 is an aircraft warning light: on for part of its cycle, off for
    // the rest, phase set by the seed so a skyline does not blink in unison.
    // It burns day and night, which is the point of it.
    // Kind 7 is a signal lamp. Its seed packs which lamp it is, its phase
    // group and the junction's offset, and the cycle below is the same one
    // traffic-signals.js runs: 12 s green, 3 s amber, the rest red, with the
    // crossing group shifted half a cycle. The two must agree, or cars will
    // stop for a light that looks green.
    if (kind > 6.5) {
      float off = floor(vSeed / 8.0);
      float rem = vSeed - off * 8.0;
      float grp = floor(rem / 4.0);
      float lamp = rem - grp * 4.0;
      float phase = mod(time + off + grp * 16.0, 32.0);
      float state = phase < 12.0 ? 2.0 : (phase < 15.0 ? 1.0 : 0.0);
      float on = 1.0 - step(0.5, abs(state - lamp));
      float far = 1.0 - smoothstep(110.0, 300.0, vDistance);
      gl_FragColor = vec4(colour * (0.05 + 0.95 * on) * far, 1.0);
      return;
    }
    if (kind > 5.5) {
      float blink = step(0.4, sin(time * 2.2 + vSeed * 0.0063 * 6.2831));
      float far = 1.0 - smoothstep(200.0, 460.0, vDistance);
      gl_FragColor = vec4(colour * blink * far, 1.0);
      return;
    }
    float fall = 1.0 - vUv.x;
    fall *= fall;
    float far = 1.0 - smoothstep(90.0, 240.0, vDistance);
    gl_FragColor = vec4(colour * fall * far * (1.0 - daylight), 1.0);
    return;
  }

  // Wireframe view. The city's real geometry, drawn as light on its own edges:
  // the layout stays surveyed while the surfaces stop pretending to be matter.
  if (wire > 0.5) {
    // Triangle fans (discs) collapse one axis to zero length. Such an axis has
    // no border to measure, and taking it literally puts every fragment on the
    // edge, lighting the whole disc. Measure only axes that have extent.
    vec2 metres = vQuad.xy * vQuad.zw;
    vec2 toEdge = min(metres, vQuad.zw - metres);
    float border = min(vQuad.z > 0.01 ? toEdge.x : 1e9,
                       vQuad.w > 0.01 ? toEdge.y : 1e9);

    // One screen pixel, expressed in world metres at this fragment's range.
    // A width fixed in metres is thick underfoot and gone at distance; scaling
    // it with range is what keeps a line one pixel wide everywhere. The
    // projection scales x and y by the same factor, so this is isotropic.
    // Each quad draws inward from its own border, so a shared edge is lit from
    // both sides and reads at twice this. Sized for about two pixels there and
    // one on a silhouette. vDistance is euclidean where the projection divides
    // by depth, so lines run up to a fifth wider at the frame's edge than at
    // its centre; smooth across the frame, and cheaper than another varying.
    float unit = wireUnit * vDistance;
    float core = unit * 0.30;
    float edge = 1.0 - smoothstep(core, core + unit * 0.65, border);

    // Facades carry their own floor and window grid, so a tower reads as a
    // tower at a distance no outline alone would survive. Measured in metres
    // off the mullion, so these stay as crisp as the outline.
    float inner = 0.0;
    if (kind > 0.5 && kind < 1.5) {
      vec2 g = vec2(vUv.x / 0.92, vUv.y / ${FLOOR_H.toFixed(4)});
      vec2 f = abs(fract(g) - 0.5);
      float mullion = min((0.5 - f.x) * 0.92, (0.5 - f.y) * ${FLOOR_H.toFixed(4)});
      inner = (1.0 - smoothstep(core, core + unit * 0.65, mullion))
            * (1.0 - smoothstep(55.0, 120.0, vDistance)) * 0.42;
    }

    vec3 neon = kind > 0.5 && kind < 1.5 ? wireBuilding
              : kind > 3.5                ? wireWater
              : kind > 1.5 && kind < 2.5 ? wireCanopy
              : wireGround;
    // The sun rakes the wire city. Planes turned toward it burn brighter, so
    // the real solar azimuth is legible in which faces of a block are lit, and
    // the whole grid dims through dusk rather than glowing at a fixed value
    // that makes noon and midnight identical.
    float facing = max(0.0, dot(normalize(vNormal), sunDir));
    neon *= 0.50 + 0.50 * daylight + 0.55 * facing * daylight;

    // After dark the windows come on: the same panes the surface view lights,
    // in the scheme's own colour, so a night skyline reads as occupied rather
    // than merely unlit.
    float panes = 0.0;
    if (kind > 0.5 && kind < 1.5) {
      vec2 g = vec2(vUv.x / 0.92, vUv.y / ${FLOOR_H.toFixed(4)});
      vec2 p = fract(g);
      panes = step(0.62, noise(floor(g))) * (1.0 - daylight)
            * (1.0 - smoothstep(55.0, 140.0, vDistance))
            * step(0.20, p.x) * step(p.x, 0.80)
            * step(0.24, p.y) * step(p.y, 0.78);
    }

    // Invented ground takes the scheme's frontier colour, so the edge of the
    // survey is a thing you can see from a rooftop rather than a thing the
    // renderer quietly papers over.
    neon = mix(neon, wireFrontier, sim);

    float glow = max(edge, inner);
    vec3 body = colour * 0.045 * (0.35 + 0.65 * daylight);
    vec3 lit = mix(body, neon, glow) + neon * edge * 0.22 + wireBuilding * panes * 0.50;
    float haul = smoothstep(70.0, 300.0, vDistance) * 0.80;
    gl_FragColor = vec4(mix(lit, wireVoid * 1.6, haul), 1.0);
    return;
  }

  float sun = max(0.0, dot(normalize(vNormal), sunDir));
  float shade = mix(0.30,0.69,daylight) + sun * mix(0.12,0.34,daylight);
  float emissive = 0.0;
  if (kind > 0.5 && kind < 1.5) {
    vec2 grid = vec2(vUv.x / 0.92, vUv.y / ${FLOOR_H.toFixed(4)});
    vec2 pane = fract(grid);
    float floorIndex = floor(grid.y);
    // Solid masonry first, then deliberate window openings. Distant panes
    // dissolve into their material instead of becoming flickering pixels.
    float detail = 1.0 - smoothstep(65.0,130.0,vDistance);
    bool inPane = pane.x > 0.19 && pane.x < 0.81 && pane.y > 0.22 && pane.y < 0.77;
    if (inPane) {
      vec3 glass = mix(vec3(0.10,0.17,0.21),vec3(0.38,0.52,0.57),daylight);
      glass *= 0.83 + pane.y * 0.22;
      float lit = step(0.55,noise(floor(grid))) * (1.0-daylight);
      glass = mix(glass,vec3(1.0,0.75,0.39),lit);
      colour = mix(colour * 0.82,glass,detail);
      emissive = lit * detail * 0.70;
    }
    if (pane.y < 0.035) colour *= 0.87;
    // Ground-floor glazing and door frames establish human-scale frontage.
    if (floorIndex < 1.0 && vUv.y < 0.91) {
      float bay = fract(vUv.x / 2.5);
      colour = bay > 0.10 && bay < 0.90 ? vec3(0.16,0.24,0.25) : vColour * 0.80;
      if (bay > 0.48 && bay < 0.51) colour = vColour * 0.67;
    }
    colour *= 0.89 + 0.11 * smoothstep(0.0,0.7,vUv.y);
  }
  if (kind > 2.5 && kind < 3.5) emissive = 0.8 * (1.0-daylight);
  if (kind > 3.5) {
    float ripple = sin(vUv.x*10.0+time*0.35)*sin(vUv.y*8.0-time*0.22);
    colour += ripple * 0.025;
  }
  vec3 surface = colour * shade + colour * emissive;
  float fog = smoothstep(35.0,170.0,vDistance) * 0.86;
  gl_FragColor = vec4(mix(surface,haze,fog),1.0);
}`;

/** A readable surface view of the canonical world; no second simulation. */
export class ReadableRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL is unavailable');
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.staticBuffer = gl.createBuffer();
    this.movingBuffer = gl.createBuffer();
    this.lightBuffer = gl.createBuffer();
    this.beaconBuffer = gl.createBuffer();
    this.attributes = ['position','normal','colour','uv','kind','seed','quad'].map(name => gl.getAttribLocation(this.program,name));
    this.uniforms = Object.fromEntries(['camera','forward','tangent','aspect','horizon','daylight','time','haze',
      'wire','wireUnit','wireBuilding','wireWater','wireCanopy','wireGround','wireVoid','sunDir','wireFrontier','lightPass'].map(name => [name,gl.getUniformLocation(this.program,name)]));
    this.world = null;
    this.district = null;
    this.generation = 0;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
  }

  upload(buffer, vertices, usage) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,vertices,usage);
  }

  geometry(buffer, count) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    let offset = 0;
    [3,3,3,2,1,1,4].forEach((size,i) => {
      const attr = this.attributes[i];
      if (attr >= 0) {
        gl.enableVertexAttribArray(attr);
        gl.vertexAttribPointer(attr,size,gl.FLOAT,false,STRIDE*4,offset*4);
      }
      offset += size;
    });
    gl.drawArrays(gl.TRIANGLES,0,count);
  }

  draw(world, cam, screen, light, traffic, time, { wireframe = false, palette, sunDir = [0,0,1] } = {}) {
    if (this.lost) throw new Error('Graphics context lost');
    const gl = this.gl;
    const w = screen.width, h = screen.height;
    const ratio = Math.min(window.devicePixelRatio || 1,1.5);
    if (this.canvas.width !== Math.round(w*ratio) || this.canvas.height !== Math.round(h*ratio)) {
      this.canvas.width = Math.round(w*ratio); this.canvas.height = Math.round(h*ratio);
    }
    if (this.world !== world || !this.district || Math.abs(cam.x-this.district.cx)>40 || Math.abs(cam.y-this.district.cy)>40) {
      this.district = buildDistrict(world,cam,125);
      this.world = world;
      this.generation++;
      this.upload(this.staticBuffer,this.district.vertices,gl.STATIC_DRAW);
      this.upload(this.lightBuffer,this.district.lights,gl.STATIC_DRAW);
      this.upload(this.beaconBuffer,this.district.beacons,gl.STATIC_DRAW);
    }
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    const u = this.uniforms;
    gl.uniform3f(u.camera,cam.x,cam.y,cam.z);
    gl.uniform2f(u.forward,Math.cos(cam.angle),Math.sin(cam.angle));
    gl.uniform1f(u.tangent,Math.tan(FOV/2));
    gl.uniform1f(u.aspect,w/h);
    gl.uniform1f(u.horizon,1-2*cam.hz/screen.rows);
    gl.uniform1f(u.daylight,light.dayAmt);
    gl.uniform1f(u.time,time%10000);
    gl.uniform3f(u.haze,light.skyBottom[0]/255,light.skyBottom[1]/255,light.skyBottom[2]/255);
    gl.uniform1f(u.wire,wireframe?1:0);
    gl.uniform1f(u.lightPass,0);
    gl.uniform3fv(u.sunDir,sunDir);
    const scheme = wirePalette(palette);
    if (wireframe) {
      // One device pixel in world metres at unit distance. canvas.width is the
      // backing store, so the line is a real pixel rather than a CSS one.
      gl.uniform1f(u.wireUnit,2*Math.tan(FOV/2)/Math.max(1,this.canvas.width));
      gl.uniform3fv(u.wireBuilding,scheme.building);
      gl.uniform3fv(u.wireWater,scheme.water);
      gl.uniform3fv(u.wireCanopy,scheme.canopy);
      gl.uniform3fv(u.wireGround,scheme.ground);
      // The void keeps the hour. A wash of the real sky, scaled by daylight,
      // so distant geometry fades into a dawn that is actually dawn-coloured
      // while a night frontier stays the scheme's own black.
      gl.uniform3fv(u.wireFrontier,scheme.frontier);
      gl.uniform3fv(u.wireVoid,scheme.void.map((c,i) =>
        c + light.skyBottom[i] / 255 * 0.22 * light.dayAmt));
    }
    // The wire city hangs in its own void: a daylight gradient behind glowing
    // edges reads as a bug, not a style.
    const v = scheme.void;
    const k = light.dayAmt;
    const band = (scale,sky,wash) => v
      .map((c,i) => Math.round(Math.min(255, c * scale * 255 + sky[i] * wash * k)))
      .join(',');
    this.canvas.style.background = wireframe
      ? `linear-gradient(rgb(${band(0.45,light.skyTop,0.30)}),rgb(${band(1.6,light.skyBottom,0.42)}))`
      : `linear-gradient(rgb(${light.skyTop.join(',')}),rgb(${light.skyBottom.join(',')}))`;
    this.geometry(this.staticBuffer,this.district.vertices.length/STRIDE);
    const movers = buildMovers(traffic,this.district,time);
    this.upload(this.movingBuffer,movers,gl.DYNAMIC_DRAW);
    this.geometry(this.movingBuffer,movers.length/STRIDE);

    // Lights last, added onto the finished scene. Depth still tests, so a pool
    // does not shine through a wall, but nothing writes depth: overlapping
    // pools should sum rather than occlude one another.
    const lights = this.district.lights;
    const beacons = this.district.beacons;
    const pools = lights.length && light.dayAmt < 0.999;
    if (pools || beacons.length) {
      gl.uniform1f(u.lightPass,1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE,gl.ONE);
      gl.depthMask(false);
      if (pools) this.geometry(this.lightBuffer,lights.length/STRIDE);
      if (beacons.length) this.geometry(this.beaconBuffer,beacons.length/STRIDE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniform1f(u.lightPass,0);
    }
  }
}
