use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::{Atom, Molecule, InteractionResult};
use crate::coulomb::{coulomb_energy, coulomb_force, electric_field_at};
use crate::lennard_jones::{lj_energy, lj_force};
use crate::integrator::{verlet_position_step, verlet_velocity_step, kinetic_energy, compute_temperature};
use crate::thermostat::{berendsen_thermostat, initialize_velocities};
use crate::deformation::compute_cloud_deformation_flat;

/// Input format for loading a molecule from JS
#[derive(Deserialize)]
struct MoleculeInput {
    atoms: Vec<AtomInput>,
    polarizability: f64,
}

#[derive(Deserialize)]
struct AtomInput {
    element: String,
    x: f64,
    y: f64,
    z: f64,
    charge: f64,
    epsilon: f64,
    sigma: f64,
    mass: f64,
}

/// The main simulation system exposed to JavaScript
#[wasm_bindgen]
pub struct SimulationSystem {
    molecules: Vec<Molecule>,
    box_size: f64,         // for periodic boundaries (0 = no box)
    timestep: f64,         // ps
    target_temperature: f64, // K
    thermostat_tau: f64,   // ps
    use_thermostat: bool,
    use_periodic: bool,
    cutoff: f64,           // interaction cutoff in Angstroms
    forces: Vec<(f64, f64, f64)>,
    step_count: u64,
}

#[wasm_bindgen]
impl SimulationSystem {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SimulationSystem {
        SimulationSystem {
            molecules: Vec::new(),
            box_size: 30.0,
            timestep: 0.002,
            target_temperature: 300.0,
            thermostat_tau: 0.5,
            use_thermostat: false,
            use_periodic: false,
            cutoff: 12.0,
            forces: Vec::new(),
            step_count: 0,
        }
    }

    /// Add a molecule to the system from JSON
    pub fn add_molecule(&mut self, json: &str) -> Result<usize, JsValue> {
        let input: MoleculeInput = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse molecule: {}", e)))?;

        let atoms: Vec<Atom> = input.atoms.into_iter().map(|a| Atom {
            x: a.x,
            y: a.y,
            z: a.z,
            charge: a.charge,
            epsilon: a.epsilon,
            sigma: a.sigma,
            mass: a.mass,
            element: a.element,
        }).collect();

        let mut mol = Molecule {
            atoms,
            center_x: 0.0,
            center_y: 0.0,
            center_z: 0.0,
            vx: 0.0,
            vy: 0.0,
            vz: 0.0,
            polarizability: input.polarizability,
        };
        mol.compute_center();

        let idx = self.molecules.len();
        self.molecules.push(mol);
        self.forces.push((0.0, 0.0, 0.0));
        Ok(idx)
    }

    /// Clear all molecules
    pub fn clear(&mut self) {
        self.molecules.clear();
        self.forces.clear();
        self.step_count = 0;
    }

    /// Set the position of a specific molecule (for drag interaction)
    pub fn set_molecule_position(&mut self, idx: usize, x: f64, y: f64, z: f64) {
        if idx >= self.molecules.len() { return; }
        let mol = &mut self.molecules[idx];
        let dx = x - mol.center_x;
        let dy = y - mol.center_y;
        let dz = z - mol.center_z;
        mol.translate(dx, dy, dz);
    }

    /// Get molecule center position
    pub fn get_molecule_position(&self, idx: usize) -> Vec<f64> {
        if idx >= self.molecules.len() { return vec![0.0, 0.0, 0.0]; }
        let mol = &self.molecules[idx];
        vec![mol.center_x, mol.center_y, mol.center_z]
    }

    /// Get all atom positions for a molecule (flat array: [x0,y0,z0, x1,y1,z1, ...])
    pub fn get_atom_positions(&self, mol_idx: usize) -> Vec<f64> {
        if mol_idx >= self.molecules.len() { return Vec::new(); }
        let mol = &self.molecules[mol_idx];
        let mut result = Vec::with_capacity(mol.atoms.len() * 3);
        for atom in &mol.atoms {
            result.push(atom.x);
            result.push(atom.y);
            result.push(atom.z);
        }
        result
    }

    /// Get all molecule positions as flat array: [cx0,cy0,cz0, cx1,cy1,cz1, ...]
    pub fn get_all_positions(&self) -> Vec<f64> {
        let mut result = Vec::with_capacity(self.molecules.len() * 3);
        for mol in &self.molecules {
            result.push(mol.center_x);
            result.push(mol.center_y);
            result.push(mol.center_z);
        }
        result
    }

    /// Compute interaction energy between two specific molecules
    pub fn compute_pair_interaction(&self, idx_a: usize, idx_b: usize) -> InteractionResult {
        if idx_a >= self.molecules.len() || idx_b >= self.molecules.len() {
            return InteractionResult {
                total_energy: 0.0, coulomb_energy: 0.0, lj_energy: 0.0,
                distance: 0.0, force_x: 0.0, force_y: 0.0, force_z: 0.0,
            };
        }

        let mol_a = &self.molecules[idx_a];
        let mol_b = &self.molecules[idx_b];

        let mut e_coulomb = 0.0;
        let mut e_lj = 0.0;
        let mut fx = 0.0;
        let mut fy = 0.0;
        let mut fz = 0.0;

        // Sum pairwise interactions between all atoms of A and B
        for a_atom in &mol_a.atoms {
            for b_atom in &mol_b.atoms {
                e_coulomb += coulomb_energy(a_atom, b_atom);
                e_lj += lj_energy(a_atom, b_atom);

                let (cfx, cfy, cfz) = coulomb_force(a_atom, b_atom);
                let (lfx, lfy, lfz) = lj_force(a_atom, b_atom);
                fx += cfx + lfx;
                fy += cfy + lfy;
                fz += cfz + lfz;
            }
        }

        let dx = mol_b.center_x - mol_a.center_x;
        let dy = mol_b.center_y - mol_a.center_y;
        let dz = mol_b.center_z - mol_a.center_z;
        let distance = (dx * dx + dy * dy + dz * dz).sqrt();

        InteractionResult {
            total_energy: e_coulomb + e_lj,
            coulomb_energy: e_coulomb,
            lj_energy: e_lj,
            distance,
            force_x: fx,
            force_y: fy,
            force_z: fz,
        }
    }

    /// Compute cloud deformation for a molecule due to another molecule
    /// Returns flat array of displacements: [dx0,dy0,dz0, ...]
    pub fn compute_deformation(
        &self,
        target_mol_idx: usize,
        source_mol_idx: usize,
        cloud_vertices_flat: Vec<f64>,
        cloud_potentials: Vec<f64>,
        deformation_scale: f64,
    ) -> Vec<f64> {
        if target_mol_idx >= self.molecules.len() || source_mol_idx >= self.molecules.len() {
            return vec![0.0; cloud_vertices_flat.len()];
        }

        let target = &self.molecules[target_mol_idx];
        let source = &self.molecules[source_mol_idx];

        compute_cloud_deformation_flat(
            &cloud_vertices_flat,
            &cloud_potentials,
            &source.atoms,
            target.polarizability,
            deformation_scale,
        )
    }

    /// Configure simulation parameters
    pub fn set_box_size(&mut self, size: f64) { self.box_size = size; }
    pub fn set_timestep(&mut self, dt: f64) { self.timestep = dt; }
    pub fn set_temperature(&mut self, temp: f64) { self.target_temperature = temp; }
    pub fn set_thermostat(&mut self, enabled: bool) { self.use_thermostat = enabled; }
    pub fn set_periodic(&mut self, enabled: bool) { self.use_periodic = enabled; }
    pub fn set_cutoff(&mut self, cutoff: f64) { self.cutoff = cutoff; }

    pub fn get_temperature(&self) -> f64 { compute_temperature(&self.molecules) }
    pub fn get_kinetic_energy(&self) -> f64 { kinetic_energy(&self.molecules) }
    pub fn get_molecule_count(&self) -> usize { self.molecules.len() }
    pub fn get_step_count(&self) -> u64 { self.step_count }

    /// Get the total potential energy of the system (sum of all pairwise interactions)
    pub fn get_potential_energy(&self) -> f64 {
        let n = self.molecules.len();
        let mut energy = 0.0;
        let cutoff2 = self.cutoff * self.cutoff;

        for i in 0..n {
            for j in (i + 1)..n {
                let mol_a = &self.molecules[i];
                let mol_b = &self.molecules[j];

                let mut dx = mol_b.center_x - mol_a.center_x;
                let mut dy = mol_b.center_y - mol_a.center_y;
                let mut dz = mol_b.center_z - mol_a.center_z;

                if self.use_periodic {
                    dx -= (dx / self.box_size).round() * self.box_size;
                    dy -= (dy / self.box_size).round() * self.box_size;
                    dz -= (dz / self.box_size).round() * self.box_size;
                }

                let r2 = dx * dx + dy * dy + dz * dz;
                if r2 > cutoff2 { continue; }

                for a_atom in &mol_a.atoms {
                    for b_atom in &mol_b.atoms {
                        energy += coulomb_energy(a_atom, b_atom);
                        energy += lj_energy(a_atom, b_atom);
                    }
                }
            }
        }
        energy
    }

    /// Get average nearest-neighbor distance (useful for detecting phase transitions)
    pub fn get_avg_nearest_neighbor_distance(&self) -> f64 {
        let n = self.molecules.len();
        if n < 2 { return 0.0; }

        let mut total_nn = 0.0;
        for i in 0..n {
            let mut min_dist2 = f64::MAX;
            for j in 0..n {
                if i == j { continue; }
                let mut dx = self.molecules[j].center_x - self.molecules[i].center_x;
                let mut dy = self.molecules[j].center_y - self.molecules[i].center_y;
                let mut dz = self.molecules[j].center_z - self.molecules[i].center_z;
                if self.use_periodic {
                    dx -= (dx / self.box_size).round() * self.box_size;
                    dy -= (dy / self.box_size).round() * self.box_size;
                    dz -= (dz / self.box_size).round() * self.box_size;
                }
                let d2 = dx * dx + dy * dy + dz * dz;
                if d2 < min_dist2 { min_dist2 = d2; }
            }
            total_nn += min_dist2.sqrt();
        }
        total_nn / n as f64
    }

    /// Get pairs of molecules that are currently interacting (within cutoff)
    /// Returns flat array: [i0, j0, strength0, i1, j1, strength1, ...]
    /// where strength is the magnitude of the interaction energy
    pub fn get_interaction_pairs(&self) -> Vec<f64> {
        let n = self.molecules.len();
        let mut pairs = Vec::new();
        let cutoff2 = self.cutoff * self.cutoff;

        for i in 0..n {
            for j in (i + 1)..n {
                let mol_a = &self.molecules[i];
                let mol_b = &self.molecules[j];

                let mut dx = mol_b.center_x - mol_a.center_x;
                let mut dy = mol_b.center_y - mol_a.center_y;
                let mut dz = mol_b.center_z - mol_a.center_z;

                if self.use_periodic {
                    dx -= (dx / self.box_size).round() * self.box_size;
                    dy -= (dy / self.box_size).round() * self.box_size;
                    dz -= (dz / self.box_size).round() * self.box_size;
                }

                let r2 = dx * dx + dy * dy + dz * dz;
                if r2 > cutoff2 { continue; }

                // Compute quick interaction energy
                let mut energy = 0.0;
                for a_atom in &mol_a.atoms {
                    for b_atom in &mol_b.atoms {
                        energy += coulomb_energy(a_atom, b_atom);
                        energy += lj_energy(a_atom, b_atom);
                    }
                }

                // Only include attractive pairs (negative energy)
                if energy < -0.5 {
                    pairs.push(i as f64);
                    pairs.push(j as f64);
                    pairs.push(-energy); // magnitude (positive)
                }
            }
        }
        pairs
    }

    /// Initialize velocities for box mode
    pub fn init_velocities(&mut self) {
        initialize_velocities(&mut self.molecules, self.target_temperature);
    }

    /// Run one simulation step (for box mode / many-molecule simulation)
    pub fn step(&mut self) {
        let n = self.molecules.len();
        if n == 0 { return; }

        // Compute forces on each molecule
        let forces = self.compute_all_forces();

        // Velocity Verlet position step
        let old_accel = verlet_position_step(&mut self.molecules, &forces, self.timestep);

        // Apply periodic boundary conditions
        if self.use_periodic {
            self.apply_periodic_boundaries();
        }

        // Compute new forces at updated positions
        let new_forces = self.compute_all_forces();

        // Velocity Verlet velocity step
        verlet_velocity_step(&mut self.molecules, &old_accel, &new_forces, self.timestep);

        // Apply thermostat
        if self.use_thermostat {
            berendsen_thermostat(
                &mut self.molecules,
                self.target_temperature,
                self.thermostat_tau,
                self.timestep,
            );
        }

        self.forces = new_forces;
        self.step_count += 1;
    }

    /// Run multiple steps at once (for performance)
    pub fn step_n(&mut self, n: u32) {
        for _ in 0..n {
            self.step();
        }
    }

    /// Find the optimal position/orientation for molecule B relative to A
    /// Uses simple gradient descent on the potential energy surface
    /// Returns [x, y, z] of the optimal position for molecule B's center
    pub fn find_optimal_position(&mut self, idx_a: usize, idx_b: usize) -> Vec<f64> {
        if idx_a >= self.molecules.len() || idx_b >= self.molecules.len() {
            return vec![0.0, 0.0, 0.0];
        }

        // Save original position
        let orig_x = self.molecules[idx_b].center_x;
        let orig_y = self.molecules[idx_b].center_y;
        let orig_z = self.molecules[idx_b].center_z;

        let mut best_energy = f64::MAX;
        let mut best_pos = (orig_x, orig_y, orig_z);

        // Sample positions on a sphere around molecule A at various distances
        let center_a = (
            self.molecules[idx_a].center_x,
            self.molecules[idx_a].center_y,
            self.molecules[idx_a].center_z,
        );

        for dist_idx in 0..20 {
            let r = 2.5 + dist_idx as f64 * 0.3; // 2.5 to 8.5 Angstroms

            // Sample orientations on the sphere
            let n_theta = 12;
            let n_phi = 24;
            for i in 0..n_theta {
                let theta = std::f64::consts::PI * (i as f64 + 0.5) / n_theta as f64;
                for j in 0..n_phi {
                    let phi = 2.0 * std::f64::consts::PI * j as f64 / n_phi as f64;

                    let x = center_a.0 + r * theta.sin() * phi.cos();
                    let y = center_a.1 + r * theta.sin() * phi.sin();
                    let z = center_a.2 + r * theta.cos();

                    self.set_molecule_position(idx_b, x, y, z);
                    let result = self.compute_pair_interaction(idx_a, idx_b);

                    if result.total_energy < best_energy {
                        best_energy = result.total_energy;
                        best_pos = (x, y, z);
                    }
                }
            }
        }

        // Restore to best position found
        self.set_molecule_position(idx_b, best_pos.0, best_pos.1, best_pos.2);

        vec![best_pos.0, best_pos.1, best_pos.2]
    }
}

// Private methods
impl SimulationSystem {
    fn compute_all_forces(&self) -> Vec<(f64, f64, f64)> {
        let n = self.molecules.len();
        let mut forces = vec![(0.0, 0.0, 0.0); n];
        let cutoff2 = self.cutoff * self.cutoff;

        // Use cell list for large systems (> 30 molecules with periodic boundaries)
        if n > 30 && self.use_periodic {
            self.compute_forces_cell_list(&mut forces, cutoff2);
        } else {
            self.compute_forces_brute(&mut forces, cutoff2);
        }

        forces
    }

    fn compute_forces_brute(&self, forces: &mut [(f64, f64, f64)], cutoff2: f64) {
        let n = self.molecules.len();
        for i in 0..n {
            for j in (i + 1)..n {
                self.compute_pair_force(i, j, forces, cutoff2);
            }
        }
    }

    fn compute_forces_cell_list(&self, forces: &mut [(f64, f64, f64)], cutoff2: f64) {
        let n = self.molecules.len();
        let cell_size = self.cutoff;
        let n_cells = (self.box_size / cell_size).ceil() as usize;
        let n_cells = n_cells.max(1);
        let total_cells = n_cells * n_cells * n_cells;

        // Build cell list
        let mut cells: Vec<Vec<usize>> = vec![Vec::new(); total_cells];
        let half = self.box_size / 2.0;

        for i in 0..n {
            let mol = &self.molecules[i];
            // Map position to cell index (shift to [0, box_size])
            let cx = (((mol.center_x + half) / cell_size) as usize).min(n_cells - 1);
            let cy = (((mol.center_y + half) / cell_size) as usize).min(n_cells - 1);
            let cz = (((mol.center_z + half) / cell_size) as usize).min(n_cells - 1);
            let idx = cx * n_cells * n_cells + cy * n_cells + cz;
            if idx < total_cells {
                cells[idx].push(i);
            }
        }

        // Iterate over cell pairs (including neighboring cells)
        for cx in 0..n_cells {
            for cy in 0..n_cells {
                for cz in 0..n_cells {
                    let cell_idx = cx * n_cells * n_cells + cy * n_cells + cz;

                    // Check this cell with itself and 13 forward neighbors (half-shell)
                    for dcx in 0..=1_i32 {
                        let start_cy = if dcx == 0 { 0 } else { -1_i32 };
                        for dcy in start_cy..=1_i32 {
                            let start_cz = if dcx == 0 && dcy == 0 { 0 } else { -1_i32 };
                            for dcz in start_cz..=1_i32 {
                                if dcx == 0 && dcy == 0 && dcz == 0 { continue; } // skip self-self (handled below)

                                let nx = (cx as i32 + dcx).rem_euclid(n_cells as i32) as usize;
                                let ny = (cy as i32 + dcy).rem_euclid(n_cells as i32) as usize;
                                let nz = (cz as i32 + dcz).rem_euclid(n_cells as i32) as usize;
                                let neighbor_idx = nx * n_cells * n_cells + ny * n_cells + nz;

                                // Compute forces between all pairs in cell_idx and neighbor_idx
                                for &i in &cells[cell_idx] {
                                    for &j in &cells[neighbor_idx] {
                                        if i < j {
                                            self.compute_pair_force(i, j, forces, cutoff2);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Intra-cell pairs
                    let cell = &cells[cell_idx];
                    for a in 0..cell.len() {
                        for b in (a + 1)..cell.len() {
                            self.compute_pair_force(cell[a], cell[b], forces, cutoff2);
                        }
                    }
                }
            }
        }
    }

    fn compute_pair_force(&self, i: usize, j: usize, forces: &mut [(f64, f64, f64)], cutoff2: f64) {
        let mol_a = &self.molecules[i];
        let mol_b = &self.molecules[j];

        let mut dx = mol_b.center_x - mol_a.center_x;
        let mut dy = mol_b.center_y - mol_a.center_y;
        let mut dz = mol_b.center_z - mol_a.center_z;

        if self.use_periodic {
            dx -= (dx / self.box_size).round() * self.box_size;
            dy -= (dy / self.box_size).round() * self.box_size;
            dz -= (dz / self.box_size).round() * self.box_size;
        }

        let r2 = dx * dx + dy * dy + dz * dz;
        if r2 > cutoff2 { return; }

        for a_atom in &mol_a.atoms {
            for b_atom in &mol_b.atoms {
                let (cfx, cfy, cfz) = coulomb_force(a_atom, b_atom);
                let (lfx, lfy, lfz) = lj_force(a_atom, b_atom);

                let fx = cfx + lfx;
                let fy = cfy + lfy;
                let fz = cfz + lfz;

                forces[i].0 += fx;
                forces[i].1 += fy;
                forces[i].2 += fz;
                forces[j].0 -= fx;
                forces[j].1 -= fy;
                forces[j].2 -= fz;
            }
        }
    }

    fn apply_periodic_boundaries(&mut self) {
        let half = self.box_size / 2.0;
        for mol in &mut self.molecules {
            if mol.center_x > half {
                mol.translate(-self.box_size, 0.0, 0.0);
            } else if mol.center_x < -half {
                mol.translate(self.box_size, 0.0, 0.0);
            }
            if mol.center_y > half {
                mol.translate(0.0, -self.box_size, 0.0);
            } else if mol.center_y < -half {
                mol.translate(0.0, self.box_size, 0.0);
            }
            if mol.center_z > half {
                mol.translate(0.0, 0.0, -self.box_size);
            } else if mol.center_z < -half {
                mol.translate(0.0, 0.0, self.box_size);
            }
        }
    }
}
