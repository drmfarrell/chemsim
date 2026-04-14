// Physical constants
export const COULOMB_CONSTANT = 332.0637; // kJ/mol * Angstrom / e^2 (for charges in electron units, distances in Angstroms)
export const BOLTZMANN_KJ = 0.00831446; // kJ/(mol*K)
export const AVOGADRO = 6.02214076e23;

// Lennard-Jones default parameters (in Angstroms and kJ/mol)
// These are approximate, per-element defaults; real simulations use pair-specific values
export const LJ_PARAMS: Record<string, { epsilon: number; sigma: number }> = {
  H:  { epsilon: 0.01, sigma: 2.50 },
  C:  { epsilon: 0.4577, sigma: 3.40 },
  N:  { epsilon: 0.7113, sigma: 3.25 },
  O:  { epsilon: 0.6502, sigma: 3.12 },
  F:  { epsilon: 0.2552, sigma: 2.95 },
  S:  { epsilon: 1.0460, sigma: 3.55 },
  Cl: { epsilon: 1.1088, sigma: 3.47 },
};

// Van der Waals radii (Angstroms) for rendering
export const VDW_RADII: Record<string, number> = {
  H:  1.20,
  C:  1.70,
  N:  1.55,
  O:  1.52,
  F:  1.47,
  S:  1.80,
  Cl: 1.75,
};

// Covalent radii (Angstroms) for ball-and-stick rendering
export const COVALENT_RADII: Record<string, number> = {
  H:  0.31,
  C:  0.76,
  N:  0.71,
  O:  0.66,
  F:  0.57,
  S:  1.05,
  Cl: 1.02,
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
export const CLOUD_MESH_DETAIL = 3;   // Icosphere subdivision level for cloud generation

// Simulation
export const DEFAULT_TIMESTEP = 0.002;   // picoseconds
export const DEFAULT_TEMPERATURE = 300;  // Kelvin
export const MAX_MOLECULES_DESKTOP = 200;
export const MAX_MOLECULES_MOBILE = 50;
export const MAX_MOLECULES_VR = 100;
export const INTERACTION_CUTOFF = 12.0;  // Angstroms, beyond this forces are neglected
export const DEFORMATION_SCALE = 0.5;    // Scale factor for cloud vertex displacement

// Box mode defaults
export const DEFAULT_BOX_SIZE = 30.0;    // Angstroms per side
export const DEFAULT_MOLECULE_COUNT = 50;
