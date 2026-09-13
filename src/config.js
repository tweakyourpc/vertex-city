/**
 * Every tunable in one place. Values that were magic numbers scattered through
 * the original single-file engine live here with a note on what they control.
 */

/* ------------------------------- display ------------------------------- */

/**
 * 0 = glyph (one character per cell), 1 = half-block (double vertical
 * resolution, solid colour). See MODE in screen.js. Toggled at runtime with B.
 */
export const RENDER_MODE = 2;

export const FONT_PX = 14;
export const FONT_STACK = 'ui-monospace, Menlo, Consolas, monospace';
export const LINE_RATIO = 1.05;        // cell height as a multiple of font size
export const FOV = 1.15;               // radians, horizontal
export const HORIZON_FRAC = 0.52;      // horizon as a fraction of screen rows

/** Ambient light floor: 0.15 night .. 1.0 day. Higher floor means nights stay
 * visible with faint colour rather than absolute black. */
export const AMBIENT_FLOOR = 0.24;

/** Sun elevation smoothstep range: full day above +12deg, full night below -8deg,
 * with golden hour visible in between. */
export const SUN_EARLY = -8;
export const SUN_LATE = 12;

/* ------------------------------- distance ------------------------------ */

export const MAXD = 175;               // DDA draw distance, cells
export const FOG_K = 0.0125;           // exp(-d * FOG_K)
export const FOG_FULL = 320;           // past here everything is pure haze;
                                       // fogOf(320) is about 0.018

/* -------------------------------- scale --------------------------------
 * FLOOR_H is primary: it is the facade texture's window-row pitch, inherited
 * from the original engine. The metric scale is derived from it, so that one
 * real storey occupies exactly one rendered floor and OSM `building:levels`
 * lines up with the window rows for free.
 *
 * Calibration constants. Check them on screen after changing either.
 */

export const FLOOR_H = 1.35;                                   // cells per storey
export const STOREY_METERS = 3.2;
export const METERS_PER_CELL = STOREY_METERS / FLOOR_H;        // about 2.37 m

/* -------------------------------- camera -------------------------------- */

export const EYE_HEIGHT = 1.7 / METERS_PER_CELL;
export const PED_HEIGHT = 1.75 / METERS_PER_CELL;
export const PED_WIDTH = 0.55 / METERS_PER_CELL;
export const MIN_CAM_Z = 0.05;         // below this the floor cast degenerates
export const MAX_CAM_Z = 400;          // soft ceiling
export const Z_ACCEL = 26;             // cells/s^2 on Q/E
export const Z_DAMP = 0.02;            // velocity retained per second
export const WALK_SPEED = 1.5 / METERS_PER_CELL; // 5.4 km/h
export const RUN_MULT = 2.4;                    // 13 km/h jog
export const FLY_SPEED = 5.6;                  // retain fast exploration
export const FLY_BOOST = 4;
export const MOVE_RESPONSE = 12;               // velocity response per second
export const GRAVITY = 9.81 / METERS_PER_CELL;
/**
 * Flight speed scales with altitude to keep large-area exploration useful.
 * Walking and jogging stay at the same metric speed, including on rooftops.
 */
export const SPEED_PER_CELL_UP = 0.035;
// Capped so the fastest case still crosses a loaded extract in a few seconds
// rather than in one. Uncapped, altitude alone reached Mach 2.
export const MAX_SPEED_MULT = 6;
export const BODY_R = 0.3 / METERS_PER_CELL;
export const MOVE_CLEAR = 0.35;        // vertical clearance needed to fly over
export const WADE_Z = 2.0;             // above this you fly over water

/* ------------------------------- aircraft ------------------------------- */

/**
 * Live ADS-B aircraft, another truthful layer of the real world (like OSM
 * geography and the astronomical sky). All of it is optional and degrades to
 * "no aircraft" on any failure.
 *
 * No keyless ADS-B provider sends browser-permissive CORS headers, so requests
 * require an explicitly configured, deployment-owned Worker.
 */
export const AIR_ENABLED = true;        // master switch (also toggled with T)
export const AIR_REFRESH_MS = 20000;    // poll cadence; ADS-B needs no faster
export const AIR_RADIUS_KM = 30;       // query radius around the camera
export const AIR_ALT_MIN_M = 30;        // ignore surface/taxiing traffic
export const AIR_GLYPH = '✈';          // aircraft mark
/* ------------------------------- weather -------------------------------- */

/**
 * Live weather, another truthful layer of the real world (like OSM geography,
 * the astronomical sky, and live aircraft). Open-Meteo is keyless and sends
 * browser-permissive CORS headers, so unlike ADS-B it needs no proxy and works
 * straight from the browser. Everything is strictly additive and degrades to
 * "no weather" on any failure, so a missing or offline source never spoils the
 * city. Weather only shows while the clock controller is explicitly LIVE.
 */
export const WX_ENABLED = true;          // master switch (also toggled with Y)
export const WX_REFRESH_MS = 600000;     // 10 min; weather is slow to change
export const WX_RADIUS_KM = 5;           // query radius around the camera
export const WX_GLYPH = '*';             // precipitation mark (overridden by kind)

/* ------------------------------ earthquakes ----------------------------- */

/**
 * Live earthquakes, another truthful layer of the real world (like OSM
 * geography, the astronomical sky, live aircraft, and live weather). USGS is
 * keyless and sends browser-permissive CORS headers, so unlike ADS-B it needs
 * no proxy and works straight from the browser. Everything is strictly additive
 * and degrades to "no quakes" on any failure. Quakes only show while the clock
 * controller is explicitly LIVE.
 */
export const QUAKE_ENABLED = true;        // master switch (also toggled with K)
export const QUAKE_REFRESH_MS = 60000;   // 1 min; the feed is updated ~every min
export const QUAKE_RADIUS_KM = 300;      // keep only quakes within this of the city
export const QUAKE_MIN_MAG = 2.5;        // ignore the constant micro-tremors

/* -------------------------------- flock -------------------------------- */

/**
 * Live ALPR/"flock" camera map, another truthful layer of the real world (like
 * OSM geography, the sky, aircraft, weather, and quakes). DeFlock publishes the
 * global license-plate-reader network as keyless 20-degree vector tiles on a
 * CDN, but the CDN sends no CORS headers, so requests require an explicitly
 * configured, deployment-owned Worker (exactly like the ADS-B aircraft feed).
 * Everything is strictly additive and degrades to "no cameras" on any failure.
 */
export const FLOCK_ENABLED = true;        // master switch (also toggled with F)
export const FLOCK_REFRESH_MS = 3600000; // 1 h; the dataset is updated daily
export const FLOCK_RADIUS_KM = 30;        // keep only cameras within this of the city
export const FLOCK_TILE_DEG = 20;         // DeFlock region tile size, degrees

/* ------------------------------ procedural ------------------------------ */

export const WORLD = 2048;             // wrap period, cells
export const BLOCK = 14;               // city block pitch, cells
export const SEED = 1337;

/* ------------------------------- palettes ------------------------------- */

export const GLYPH_RAMP = ' .:-=+*#%@';
// Warm interior glows dominate, with a few cooler tints so not every lit
// window is the same yellow. These had been flattened toward white, which at
// night is the one colour a window cannot be without looking like a hole in
// the wall. Length must match FACADE so palIdx indexes both.
export const LIT = [
  [255, 196, 118], [138, 214, 255], [255, 150, 205], [178, 246, 190],
  [255, 182, 104], [160, 222, 255], [255, 168, 188], [206, 250, 172],
];
// Building facades and roofs. A spread of warm stone tones — beige, sand,
// cream, taupe, warm grey, pale stone — so the city reads as varied masonry
// rather than one flat colour. Every entry keeps R > B so towers stay
// chromatically distinct from the cool blue-grey roads and pavement. The count
// is a power of two so world code can pick an index with a cheap bitmask.
export const FACADE = [
  [150, 124, 96],   // beige
  [134, 116, 92],   // sand
  [168, 158, 138],  // warm light grey
  [186, 176, 150],  // cream / off-white
  [120, 102, 84],   // taupe
  [142, 120, 98],   // soft tan
  [158, 150, 138],  // pale stone
  [110, 100, 88],   // warm grey
];

/* -------------------------------- traffic ------------------------------- */

// A city street should look occupied. These were tuned when agents were cheap
// raster sprites and pedestrians barely moved; both now route the road graph,
// and an empty Manhattan reads as a model rather than a place.
/**
 * Which side of the road traffic keeps to, and therefore which side the driver
 * sits on: the driver is always nearest the centreline.
 *
 * A per-country lookup is the honest version of this, since the answer is a
 * property of the place being rendered. Until there is one, this is at least a
 * single stated assumption rather than a driver silently sitting in the middle.
 */
export const DRIVE_ON_RIGHT = true;

/* ------------------------------- crossings ------------------------------ */

/**
 * Crossing and stop-line geometry, in cells, measured back from the junction
 * node along the approach.
 *
 * These live here because two places have to agree about them: the renderer
 * that paints the bars and the line, and the traffic that has to stop behind
 * them. When each kept its own numbers, cars held their red with the front
 * half of the car across the crossing.
 */
export const CROSS_GAP = 0.9;        // clear asphalt between box and crossing
export const CROSS_DEPTH = 2.35;     // depth of the bars, along the road
export const STOP_LINE_DEPTH = 0.45; // the solid transverse bar
export const STOP_LINE_GAP = 0.35;   // clear asphalt between line and crossing

/** Distance from the node to the centre of a crossing on one approach. */
export function crossingCentreFor(boxHalf) {
  return boxHalf + CROSS_GAP + CROSS_DEPTH / 2;
}

/**
 * Distance back from the node at which a stopping car's FRONT BUMPER belongs:
 * behind the crossing, which is itself outside the intersection box.
 */
export function stopLineFor(boxHalf) {
  return crossingCentreFor(boxHalf) + CROSS_DEPTH / 2
       + STOP_LINE_GAP + STOP_LINE_DEPTH;
}

export const MAX_CARS = 60;
export const MAX_PEDS = 110;
export const AGENT_CULL_D2 = 8100;     // squared cells

/* ------------------------------- defaults ------------------------------- */

export const DEFAULT_LAT = 40.71;
export const DEFAULT_LON = -74.00;
