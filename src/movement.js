import {
  BODY_R, EYE_HEIGHT, WALK_SPEED, RUN_MULT, FLY_SPEED, FLY_BOOST,
  MOVE_RESPONSE, GRAVITY, Z_ACCEL, Z_DAMP, SPEED_PER_CELL_UP, MAX_SPEED_MULT,
} from './config.js';
import { canMoveTo, floorAt, settle } from './collision.js';

/** Advance locomotion independently of rendering and live data. Units are cells. */
export function moveCamera(world, cam, input, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.05);
  if (input.takeTaps('v') % 2) {
    cam.movement = cam.movement === 'fly' ? 'walk' : 'fly';
    cam.vz = 0;
    cam.vx = 0;
    cam.vy = 0;
  }
  const thrust = Number(input.down('e')) - Number(input.down('q'));
  if (thrust > 0 || (thrust < 0 && cam.z > floorAt(world, cam.x, cam.y) + EYE_HEIGHT + 0.05)) {
    cam.movement = 'fly';
  }
  const flying = cam.movement === 'fly';
  const boost = input.down('shift');
  const altitude = Math.max(0, cam.z - EYE_HEIGHT);
  const speed = flying
    ? FLY_SPEED * Math.min(MAX_SPEED_MULT, 1 + altitude * SPEED_PER_CELL_UP) * (boost ? FLY_BOOST : 1)
    : WALK_SPEED * (boost ? RUN_MULT : 1);
  const forward = Number(input.down('w') || input.down('arrowup'))
    - Number(input.down('s') || input.down('arrowdown'));
  const strafe = Number(input.down('d')) - Number(input.down('a'));
  const length = Math.hypot(forward, strafe) || 1;
  const fx = Math.cos(cam.angle), fy = Math.sin(cam.angle);
  const tx = (fx * forward + fy * strafe) / length * speed;
  const ty = (fy * forward - fx * strafe) / length * speed;
  // Integrate exponential velocity response analytically: identical travel at
  // 30/60/120 Hz, including a short, controlled coast on release.
  const decay = Math.exp(-MOVE_RESPONSE * dt);
  const dx = tx * dt + (cam.vx - tx) * (1 - decay) / MOVE_RESPONSE;
  const dy = ty * dt + (cam.vy - ty) * (1 - decay) / MOVE_RESPONSE;
  cam.vx = tx + (cam.vx - tx) * decay;
  cam.vy = ty + (cam.vy - ty) * decay;

  if (flying) {
    cam.vz += thrust * Z_ACCEL * dt * (boost ? 2.5 : 1);
    cam.vz *= Math.pow(Z_DAMP, dt);
  } else {
    cam.vz = Math.min(0, cam.vz) - GRAVITY * dt;
  }
  const dz = cam.vz * dt;
  // Sweep all axes in small steps, including boosted flight, so a frame cannot
  // jump across a thin wall. Per-axis rejection still permits wall sliding.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / BODY_R));
  for (let i = 0; i < steps; i++) {
    cam.z += dz / steps;
    cam.clampZ();
    settle(world, cam);
    let nx = cam.x + dx / steps, ny = cam.y + dy / steps;
    if (world.size > 0) {
      nx = Math.max(0.5, Math.min(world.width - 0.5, nx));
      ny = Math.max(0.5, Math.min(world.height - 0.5, ny));
    }
    if (canMoveTo(world, nx, cam.y, cam.z)) cam.x = nx;
    else cam.vx = 0;
    if (canMoveTo(world, cam.x, ny, cam.z)) cam.y = ny;
    else cam.vy = 0;
    settle(world, cam);
  }
  if (flying && thrust < 0 && cam.z <= floorAt(world, cam.x, cam.y) + EYE_HEIGHT + 1e-5) {
    cam.movement = 'walk';
    cam.vx = 0;
    cam.vy = 0;
  }
}
