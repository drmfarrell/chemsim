use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

mod coulomb;
mod lennard_jones;
mod integrator;
mod thermostat;
mod deformation;
mod rotation;
mod system;

pub use coulomb::*;
pub use lennard_jones::*;
pub use integrator::*;
pub use thermostat::*;
pub use deformation::*;
pub use rotation::*;
pub use system::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

/// Atom with position, charge, and LJ parameters
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Atom {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub charge: f64,      // partial charge in electron units
    pub epsilon: f64,     // LJ epsilon in kJ/mol
    pub sigma: f64,       // LJ sigma in Angstroms
    pub mass: f64,        // atomic mass in amu
    pub element: String,
}

/// A molecule: a collection of atoms with a center of mass and orientation.
///
/// World-frame atom positions in `atoms` are derived from body-frame positions
/// in `body_coords` plus the current center and orientation quaternion. The
/// rigid-body integrator updates `center_*`, `v*`, orientation, and angular
/// velocity; world-frame atom coordinates are rebuilt from those.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Molecule {
    pub atoms: Vec<Atom>,
    pub center_x: f64,
    pub center_y: f64,
    pub center_z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    pub polarizability: f64,

    /// Atom positions in the body frame (COM at origin), constant per molecule.
    #[serde(default)]
    pub body_coords: Vec<(f64, f64, f64)>,
    /// Orientation quaternion (w, x, y, z). Identity = (1, 0, 0, 0).
    #[serde(default = "identity_quat")]
    pub q: (f64, f64, f64, f64),
    /// Angular velocity in the body frame, rad/ps.
    #[serde(default)]
    pub omega_body: (f64, f64, f64),
    /// Diagonal moments of inertia in the body frame (amu * Angstrom^2).
    #[serde(default)]
    pub inertia: (f64, f64, f64),
}

fn identity_quat() -> (f64, f64, f64, f64) { (1.0, 0.0, 0.0, 0.0) }

impl Molecule {
    pub fn compute_center(&mut self) {
        let total_mass: f64 = self.atoms.iter().map(|a| a.mass).sum();
        if total_mass < 1e-10 { return; }
        self.center_x = self.atoms.iter().map(|a| a.mass * a.x).sum::<f64>() / total_mass;
        self.center_y = self.atoms.iter().map(|a| a.mass * a.y).sum::<f64>() / total_mass;
        self.center_z = self.atoms.iter().map(|a| a.mass * a.z).sum::<f64>() / total_mass;
    }

    pub fn translate(&mut self, dx: f64, dy: f64, dz: f64) {
        for atom in &mut self.atoms {
            atom.x += dx;
            atom.y += dy;
            atom.z += dz;
        }
        self.center_x += dx;
        self.center_y += dy;
        self.center_z += dz;
    }

    pub fn total_mass(&self) -> f64 {
        self.atoms.iter().map(|a| a.mass).sum()
    }

    /// Store current atom positions relative to COM as the body-frame
    /// reference, and compute diagonal moments of inertia about the COM.
    /// The off-diagonal moments are ignored (treated as zero) — this is a
    /// reasonable approximation for the small, near-symmetric molecules we
    /// support. Assumes `compute_center` has already been called.
    pub fn init_rigid_body(&mut self) {
        self.body_coords.clear();
        self.body_coords.reserve(self.atoms.len());
        let mut ixx = 0.0;
        let mut iyy = 0.0;
        let mut izz = 0.0;
        for atom in &self.atoms {
            let bx = atom.x - self.center_x;
            let by = atom.y - self.center_y;
            let bz = atom.z - self.center_z;
            self.body_coords.push((bx, by, bz));
            ixx += atom.mass * (by * by + bz * bz);
            iyy += atom.mass * (bx * bx + bz * bz);
            izz += atom.mass * (bx * bx + by * by);
        }
        // Avoid division-by-zero for 1-atom or collinear molecules: floor each
        // moment at a small value so the integrator can still run (the torque
        // on such a molecule will be ~0 so the resulting angular motion is
        // negligible regardless).
        let floor = 1e-3;
        self.inertia = (ixx.max(floor), iyy.max(floor), izz.max(floor));
        self.q = identity_quat();
        self.omega_body = (0.0, 0.0, 0.0);
    }
}

/// Result of an interaction energy calculation
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct InteractionResult {
    pub total_energy: f64,
    pub coulomb_energy: f64,
    pub lj_energy: f64,
    pub distance: f64,
    pub force_x: f64,
    pub force_y: f64,
    pub force_z: f64,
}
