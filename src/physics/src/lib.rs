use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

mod coulomb;
mod lennard_jones;
mod integrator;
mod thermostat;
mod deformation;
mod system;

pub use coulomb::*;
pub use lennard_jones::*;
pub use integrator::*;
pub use thermostat::*;
pub use deformation::*;
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

/// A molecule: a collection of atoms with a center of mass and orientation
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
}

impl Molecule {
    pub fn compute_center(&mut self) {
        let n = self.atoms.len() as f64;
        if n == 0.0 { return; }
        self.center_x = self.atoms.iter().map(|a| a.x).sum::<f64>() / n;
        self.center_y = self.atoms.iter().map(|a| a.y).sum::<f64>() / n;
        self.center_z = self.atoms.iter().map(|a| a.z).sum::<f64>() / n;
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
