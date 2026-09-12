import { buildDistrict, buildMovers, STRIDE } from './district.js';
import { FOV, FLOOR_H } from '../config.js';

const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec2 uv;
attribute float kind;
attribute float seed;
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
float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233)) + mod(vSeed, 997.0)) * 437.5453); }
void main() {
  vec3 colour = vColour;
  float sun = max(0.0, dot(normalize(vNormal), normalize(vec3(-0.45,-0.62,0.85))));
  float shade = mix(0.30,0.69,daylight) + sun * mix(0.12,0.34,daylight);
  float emissive = 0.0;
  if (vKind > 0.5 && vKind < 1.5) {
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
  if (vKind > 2.5 && vKind < 3.5) emissive = 0.8 * (1.0-daylight);
  if (vKind > 3.5) {
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
    this.attributes = ['position','normal','colour','uv','kind','seed'].map(name => gl.getAttribLocation(this.program,name));
    this.uniforms = Object.fromEntries(['camera','forward','tangent','aspect','horizon','daylight','time','haze'].map(name => [name,gl.getUniformLocation(this.program,name)]));
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
    [3,3,3,2,1,1].forEach((size,i) => {
      const attr = this.attributes[i];
      if (attr >= 0) {
        gl.enableVertexAttribArray(attr);
        gl.vertexAttribPointer(attr,size,gl.FLOAT,false,STRIDE*4,offset*4);
      }
      offset += size;
    });
    gl.drawArrays(gl.TRIANGLES,0,count);
  }

  draw(world, cam, screen, light, traffic, time) {
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
    this.canvas.style.background = `linear-gradient(rgb(${light.skyTop.join(',')}),rgb(${light.skyBottom.join(',')}))`;
    this.geometry(this.staticBuffer,this.district.vertices.length/STRIDE);
    const movers = buildMovers(traffic,this.district,time);
    this.upload(this.movingBuffer,movers,gl.DYNAMIC_DRAW);
    this.geometry(this.movingBuffer,movers.length/STRIDE);
  }
}
