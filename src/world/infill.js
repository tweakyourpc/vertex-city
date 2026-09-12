/** Repeatable, explicitly simulated buildings for gaps beside mapped streets. */
import { hash } from './source.js';

const URBAN = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
const WIDTH = { primary: 16, secondary: 13, tertiary: 11, residential: 9, unclassified: 9, living_street: 8 };

export function generateInfill(elements, bbox) {
  const lat0 = (bbox[0] + bbox[2]) / 2, lon0 = (bbox[1] + bbox[3]) / 2;
  const sx = 111320 * Math.cos(lat0 * Math.PI / 180), sy = 110540;
  const point = p => [(p.lon - lon0) * sx, (p.lat - lat0) * sy];
  const bounds = points => [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
  const overlaps = (a, b, gap = 1) => a[0] < b[2] + gap && a[2] > b[0] - gap && a[1] < b[3] + gap && a[3] > b[1] - gap;
  const obstacles = [];
  const segments = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const geometries = el.geometry ? [el.geometry] : (el.members || []).map(m => m.geometry).filter(Boolean);
    for (const geometry of geometries) {
      const pts = geometry.map(point);
      if (tags.building || tags['building:part'] || tags.natural || tags.leisure || tags.landuse || tags.waterway) {
        if (pts.length) obstacles.push(bounds(pts));
      }
      if (tags.highway) {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len > 0) segments.push({ a, b, len, width: WIDTH[tags.highway] || 6, urban: URBAN.has(tags.highway), id: el.id, i });
        }
      }
    }
  }
  const occupied = obstacles.slice();
  const result = [];
  for (const road of segments) {
    if (!road.urban) continue;
    const dx = (road.b[0] - road.a[0]) / road.len, dy = (road.b[1] - road.a[1]) / road.len;
    for (let d = 15, slot = 0; d < road.len - 12; d += 23, slot++) {
      for (const side of [-1, 1]) {
        const seed = Math.floor(hash(road.id, road.i * 10000 + slot * 2 + (side > 0 ? 1 : 0), 1987) * 0x7fffffff);
        const width = 15 + hash(seed, 1, 4) * 5, depth = 12 + hash(seed, 2, 4) * 6;
        const offset = road.width / 2 + 4 + depth / 2;
        const cx = road.a[0] + dx * d - dy * offset * side;
        const cy = road.a[1] + dy * d + dx * offset * side;
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
          [cx + dx * u * width / 2 - dy * v * depth / 2, cy + dy * u * width / 2 + dx * v * depth / 2]);
        const box = bounds(pts);
        if (occupied.some(b => overlaps(box, b, 2))) continue;
        // Reserve every mapped street, including intersecting or diagonal roads.
        if (segments.some(s => {
          const vx = s.b[0] - s.a[0], vy = s.b[1] - s.a[1];
          const t = Math.max(0, Math.min(1, ((cx - s.a[0]) * vx + (cy - s.a[1]) * vy) / (s.len * s.len)));
          return Math.hypot(cx - s.a[0] - vx * t, cy - s.a[1] - vy * t) < Math.hypot(width, depth) / 2 + s.width / 2 + 1;
        })) continue;
        const geometry = [...pts, pts[0]].map(([x, y]) => ({ lat: lat0 + y / sy, lon: lon0 + x / sx }));
        if (geometry.some(p => p.lat < bbox[0] || p.lat > bbox[2] || p.lon < bbox[1] || p.lon > bbox[3])) continue;
        occupied.push(box);
        result.push({ type: 'way', id: -seed - 1, geometry, tags: {
          building: 'apartments', 'building:levels': String(3 + Math.floor(hash(seed, 3, 4) * 5)),
          'ascii:simulated': 'yes',
        } });
        if (result.length >= 1600) return result;
      }
    }
  }
  return result;
}
