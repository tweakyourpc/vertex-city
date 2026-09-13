/**
 * Frame-time quality controller for the cinematic compositor.
 *
 * It changes one quality step at a time and waits for a settle window before
 * changing direction. This prevents an integrated-GPU laptop from oscillating
 * between resolutions while the user moves the camera.
 */
export class QualityController {
  constructor({ targetMs = 33.3, clock = () => performance.now() } = {}) {
    this.targetMs = targetMs;
    this.clock = clock;
    this.mode = 'auto';
    this.samples = [];
    this.lastChange = -Infinity;
    this.cooldownMs = 1800;
    this.maxSamples = 30;
    // The floor was 0.64, which is coarse enough to read as broken rather than
    // as an adaptation. A gentler ladder degrades in smaller steps and never
    // goes as far down.
    // The top of the ladder used to be native resolution, so a machine with
    // headroom had nowhere to spend it and the view stayed as coarse as it
    // started. The first rung is finer than native; auto only climbs to it
    // when frames are comfortably inside the target, so it costs nothing on
    // hardware that cannot afford it.
    this.scales = [1.22, 1, 0.92, 0.84, 0.76];
    /** Native resolution: where auto starts, and what it falls back toward. */
    this.baseLevel = 1;
    this.level = this.baseLevel;
    // Asymmetric thresholds, but only slightly. These were +4 to degrade and
    // -8 to recover: a band from 25 ms to 37 ms in which nothing could improve.
    // A machine sitting anywhere inside it stepped down at every excursion
    // above and never climbed back, so quality only ever ratcheted one way and
    // the view visibly got worse the longer you looked at it.
    this.slowMs = 6;
    this.fastMs = 3;
  }

  setMode(mode) {
    this.mode = mode === 'manual' ? 'manual' : 'auto';
    return this.mode;
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(this.scales.length - 1, level | 0));
    return this.level;
  }

  cycle() {
    this.samples.length = 0;
    if (this.mode === 'auto') {
      this.mode = 'manual';
      this.level = 0;
    } else if (this.level < this.scales.length - 1) {
      this.level++;
    } else {
      this.mode = 'auto';
      this.level = this.baseLevel;
    }
    return this.snapshot();
  }

  snapshot() {
    return { mode: this.mode, level: this.level, scale: this.scale };
  }

  sample(frameMs, now = this.clock()) {
    if (!Number.isFinite(frameMs) || this.mode !== 'auto') return false;
    this.samples.push(frameMs);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    if (this.samples.length < this.maxSamples || now - this.lastChange < this.cooldownMs) return false;
    const avg = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples.length = 0;
    if (avg > this.targetMs + this.slowMs && this.level < this.scales.length - 1) {
      this.level++;
      this.lastChange = now;
      return true;
    }
    if (avg < this.targetMs - this.fastMs && this.level > 0) {
      this.level--;
      this.lastChange = now;
      return true;
    }
    return false;
  }

  get scale() { return this.scales[this.level]; }
}
