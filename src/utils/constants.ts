// Lennard-Jones default parameters (in Angstroms and kJ/mol)
// Per-element fallback consumed at molecule-load time when a JSON doesn't
// carry its own `epsilon` / `sigma`. See src/utils/waterModels.ts for the
// per-water-model overrides; ion JSONs carry explicit overrides directly.
export const LJ_PARAMS: Record<string, { epsilon: number; sigma: number }> = {
  H:  { epsilon: 0.01, sigma: 2.50 },
  C:  { epsilon: 0.4577, sigma: 3.40 },
  N:  { epsilon: 0.7113, sigma: 3.25 },
  O:  { epsilon: 0.6502, sigma: 3.12 },
  F:  { epsilon: 0.2552, sigma: 2.95 },
  S:  { epsilon: 1.0460, sigma: 3.55 },
  Cl: { epsilon: 1.1088, sigma: 3.47 },
  // Na+ (Joung-Cheatham 2008, TIP3P set). The codebase only uses sodium as
  // Na+, and sodium_ion.json carries the same values as an explicit override
  // so this fallback is mostly belt-and-suspenders.
  Na: { epsilon: 0.3659, sigma: 2.4393 },
};

// Ionic radii for charged species (Angstroms) - used for rendering ions
// Na+ contracts to ~1.02 Å, Cl- expands to ~1.81 Å
export const IONIC_RADII: Record<string, number> = {
  Na: 1.02,  // Na+ ionic radius (smaller than oxygen)
  Cl: 1.81,  // Cl- ionic radius (larger than oxygen)
};

// Van der Waals radii (Angstroms) for rendering
export const VDW_RADII: Record<string, number> = {
  H:  1.20,
  C:  1.70,
  N:  1.55,
  O:  1.52,
  F:  1.47,
  S:  1.80,
  Cl: 1.75, // Neutral chlorine (use IONIC_RADII for Cl-)
  Na: 2.27, // Neutral sodium (use IONIC_RADII for Na+)
};

// Element colors (CPK coloring scheme)
export const ELEMENT_COLORS: Record<string, number> = {
  H:  0xffffff,
  C:  0x404040,
  N:  0x3050f8,
  O:  0xff0d0d,
  F:  0x90e050,
  S:  0xffff30,
  Cl: 0x1ff01f,
  Na: 0xab5cf2, // Purple/violet for sodium
};

// Electrostatic potential color scheme (matching MolCalc)
// Maps potential value [-1, +1] to color
export const ESP_COLOR_NEGATIVE = { r: 0.8, g: 0.0, b: 0.0 }; // Deep red (electron-rich)
export const ESP_COLOR_NEUTRAL  = { r: 0.9, g: 0.9, b: 0.9 }; // White/light gray
export const ESP_COLOR_POSITIVE = { r: 0.0, g: 0.0, b: 0.8 }; // Deep blue (electron-poor)

// Rendering
export const ANGSTROM_TO_SCENE = 1.0; // 1 Angstrom = 1 scene unit
export const BALL_RADIUS_SCALE = 0.3; // Scale factor for ball-and-stick atom spheres
export const STICK_RADIUS = 0.08;     // Radius of bond sticks
export const CLOUD_OPACITY = 0.35;    // Default cloud transparency

// Cloud-deformation scale factor, consumed by CloudDeformer when morphing
// electron-cloud vertices in response to nearby charges.
export const DEFORMATION_SCALE = 0.5;
