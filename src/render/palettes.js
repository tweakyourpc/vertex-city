/**
 * Colour schemes for the wireframe view.
 *
 * Each entry names the four edge colours the shader selects between using the
 * mesh's `kind` material id, plus the void the city hangs in. Keeping them as
 * plain data means a new scheme is one object here and one option in the View
 * panel, with no shader change: the fragment shader reads whichever four
 * colours are uploaded rather than hard-coding any of them.
 *
 * Values are linear 0..1 RGB, matching the rest of the mesh colour pipeline.
 */
export const WIRE_PALETTES = {
  tron: {
    label: 'Tron · cyan & amber',
    building: [0.30, 0.95, 1.00],
    water:    [0.22, 0.58, 1.00],
    canopy:   [0.45, 1.00, 0.62],
    ground:   [1.00, 0.71, 0.24],
    void:     [0.012, 0.027, 0.047],
  },
  matrix: {
    label: 'Matrix · green rain',
    building: [0.35, 1.00, 0.45],
    water:    [0.15, 0.78, 0.48],
    canopy:   [0.68, 1.00, 0.35],
    ground:   [0.18, 0.82, 0.34],
    void:     [0.004, 0.024, 0.012],
  },
  blueprint: {
    label: 'Blueprint · drafting table',
    building: [0.90, 0.95, 1.00],
    water:    [0.58, 0.80, 1.00],
    canopy:   [0.74, 0.90, 1.00],
    ground:   [0.68, 0.84, 1.00],
    void:     [0.031, 0.078, 0.184],
  },
  amber: {
    label: 'Amber · phosphor terminal',
    building: [1.00, 0.74, 0.30],
    water:    [1.00, 0.54, 0.16],
    canopy:   [1.00, 0.86, 0.47],
    ground:   [0.96, 0.61, 0.21],
    void:     [0.035, 0.016, 0.004],
  },
  synth: {
    label: 'Synthwave · magenta & ice',
    building: [1.00, 0.30, 0.76],
    water:    [0.35, 0.86, 1.00],
    canopy:   [0.66, 0.40, 1.00],
    ground:   [1.00, 0.56, 0.36],
    void:     [0.055, 0.008, 0.055],
  },
};

export const DEFAULT_WIRE_PALETTE = 'tron';

/** Resolve a name to a scheme, falling back rather than rendering undefined. */
export function wirePalette(name) {
  return WIRE_PALETTES[name] || WIRE_PALETTES[DEFAULT_WIRE_PALETTE];
}
