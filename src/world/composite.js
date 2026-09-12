/**
 * A mapped extract standing on a generated substrate.
 *
 * `OsmWorld` is a fixed rectangle: outside its bounds `sample` returns the void
 * slot, so the city ends at a cliff. For a 1.3 km extract against a 415 m draw
 * distance that edge is inside view from about 87% of the extract's own area,
 * which makes the boundary the normal condition rather than an edge case.
 *
 * This world keeps the surveyed geometry exactly as rasterized and fills every
 * other cell with the procedural city, in one chunk store, generated lazily and
 * evicted by the same budget as any other chunked world. Nothing is fetched to
 * make this work: the substrate is local and deterministic, so a tile that has
 * not loaded, or cannot load, is plausible ground rather than a hole. That is
 * the point. It turns network availability from a correctness problem into a
 * question of how much detail is present.
 *
 * Every generated cell carries `F.SIMULATED`. The renderer can then draw the
 * frontier honestly instead of letting invention pass as survey.
 */
import { ProceduralWorld } from './procedural.js';
import { CHUNK, F } from './source.js';
import { WORLD, MAXD } from '../config.js';

/** Where the substrate's own profile stops placing buildings, in cells. */
const BUILT_RADIUS = 480;

/** Metadata the extract owns outright; the substrate has no opinion on it. */
const OSM_METADATA = [
  'bbox', 'lat', 'lon', 'label', 'name', 'proj', 'enriched',
  'buildings', 'roads', 'junctions', 'landmarks', 'pois',
  'roadGraph', 'roadCells', 'segs', 'anchor',
  'streetNames', 'streetRank', 'streetTags',
  'signalNodeIds', 'signalPoints', 'simulatedBuildings', 'stats',
];

export class CompositeWorld extends ProceduralWorld {
  /**
   * @param {object} osm a rasterized OsmWorld to stand on the substrate
   * @param {{seed?: number}} [options]
   */
  constructor(osm, { seed } = {}) {
    super(seed === undefined ? undefined : { seed });
    this.osm = osm;

    // Unbounded rather than the substrate's 2048-cell wrap. Flying far should
    // thin out into countryside, not bring the same downtown back around.
    this.size = 0;

    // The substrate's density decays from its own centre, so put that centre on
    // the extract: real city in the middle, generated density falling away from
    // the same point instead of from an unrelated origin.
    this.originX = Math.round(WORLD / 2 - osm.width / 2);
    this.originY = Math.round(WORLD / 2 - osm.height / 2);

    // The standalone profile ends all built form 480 cells out, which for a
    // typical extract is inside the extract's own corner: the generated
    // surroundings would be farmland the moment the real city stopped. Stretch
    // it so buildings still reach three draw distances beyond the far corner,
    // and the eye finds city wherever the survey happens to end.
    const corner = Math.hypot(osm.width, osm.height) / 2;
    this.densityScale = Math.max(1, (corner + MAXD * 3) / BUILT_RADIUS);

    for (const key of OSM_METADATA) this[key] = osm[key];
    this.width = osm.width;
    this.height = osm.height;
    // Both layers can raise the skyline, and the DDA early-out needs the taller.
    this.maxHeight = Math.max(osm.maxHeight, this.maxHeight);
    // The extract decides whether this city claims to be a real place; the
    // substrate around it is marked per cell, not by relabelling the world.
    this.synthetic = osm.synthetic;
  }

  /** True where the mapped extract has real geometry for this cell. */
  observed(ax, ay) {
    return ax >= 0 && ax < this.osm.width && ay >= 0 && ay < this.osm.height;
  }

  fillChunk(ox, oy, base) {
    // Plausible city everywhere first. Offsetting by the origin translates the
    // substrate's pattern, so its downtown lands on the extract rather than
    // wherever the generator's own centre happens to be.
    super.fillChunk(ox + this.originX, oy + this.originY, base);

    const osm = this.osm;
    const { width, height } = osm;
    for (let ly = 0; ly < CHUNK; ly++) {
      const ay = oy + ly;
      const row = base + ly * CHUNK;
      if (ay < 0 || ay >= height) {
        for (let lx = 0; lx < CHUNK; lx++) this.flags[row + lx] |= F.SIMULATED;
        continue;
      }
      const osmRow = ay * width;
      for (let lx = 0; lx < CHUNK; lx++) {
        const ax = ox + lx;
        const to = row + lx;
        if (ax < 0 || ax >= width) { this.flags[to] |= F.SIMULATED; continue; }
        // Surveyed geometry wins outright. Copied rather than referenced
        // because the two worlds do not share a slot space.
        const from = osmRow + ax;
        this.h[to] = osm.h[from];
        this.type[to] = osm.type[from];
        this.rnd[to] = osm.rnd[from];
        this.lamp[to] = osm.lamp[from];
        this.pal[to] = osm.pal[from];
        this.mat[to] = osm.mat[from];
        this.bid[to] = osm.bid[from];
        this.flags[to] = osm.flags[from] & ~F.SIMULATED;
      }
    }
  }

  /** Spawn where the extract says, not where the substrate would. */
  spawn() { return this.osm.spawn(); }

  ready() { return Promise.resolve(this); }

  maxHeightAt() { return this.maxHeight; }

  get hasStreets() { return this.osm.roadCells.length > 0; }

  randomRoadCell() { return this.osm.randomRoadCell(); }

  dispose() {
    this.reset();
    this.osm.dispose?.();
  }
}
