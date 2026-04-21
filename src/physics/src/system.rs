use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::{Atom, Molecule, InteractionResult, VirtualSite};
use crate::coulomb::{coulomb_energy, coulomb_force, coulomb_force_raw, electric_field_at};
use crate::lennard_jones::{lj_energy, lj_force, lj_force_raw, coulomb_lj_force_raw};
#[cfg(target_feature = "simd128")]
use crate::lennard_jones::{coulomb_lj_force_raw_x2_v, load_f64x2};
use crate::integrator::{verlet_position_step, verlet_velocity_step, kinetic_energy, compute_temperature};
use crate::thermostat::{berendsen_thermostat, initialize_velocities};
use crate::deformation::compute_cloud_deformation_flat;
use crate::rotation::integrate_rotation;

/// Input format for loading a molecule from JS
#[derive(Deserialize)]
struct MoleculeInput {
    atoms: Vec<AtomInput>,
    polarizability: f64,
    #[serde(default)]
    virtual_sites: Vec<VirtualSiteInput>,
}

#[derive(Deserialize)]
struct VirtualSiteInput {
    charge: f64,
    ref_atoms: Vec<usize>,
    site_type: String,
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

/// Conversion: 1 bar = 1e5 Pa, 1 kJ/(mol*A^3) = 1.66054e9 Pa -> 16605.4 bar.
/// Hence pressure in bar = pressure in kJ/(mol*A^3) * BAR_PER_KJ_MOL_A3.
const BAR_PER_KJ_MOL_A3: f64 = 16605.39;

/// Forces and torques a single pair interaction contributes to both molecules,
/// plus its virial contribution. Returned from the pure `compute_pair_force` so
/// parallel callers can accumulate into thread-local buffers without locks.
#[derive(Clone, Copy, Default)]
struct PairDelta {
    f_i: (f64, f64, f64),
    f_j: (f64, f64, f64),
    t_i: (f64, f64, f64),
    t_j: (f64, f64, f64),
    virial: f64,
}

#[inline(always)]
fn apply_pair(
    delta: &PairDelta,
    i: usize,
    j: usize,
    forces: &mut [(f64, f64, f64)],
    torques: &mut [(f64, f64, f64)],
    virial: &mut f64,
) {
    forces[i].0 += delta.f_i.0; forces[i].1 += delta.f_i.1; forces[i].2 += delta.f_i.2;
    forces[j].0 += delta.f_j.0; forces[j].1 += delta.f_j.1; forces[j].2 += delta.f_j.2;
    torques[i].0 += delta.t_i.0; torques[i].1 += delta.t_i.1; torques[i].2 += delta.t_i.2;
    torques[j].0 += delta.t_j.0; torques[j].1 += delta.t_j.1; torques[j].2 += delta.t_j.2;
    *virial += delta.virial;
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
    // Torques from the end-of-step force evaluation, cached alongside
    // `forces` so `step()` can reuse them as the start-of-next-step values
    // instead of recomputing. See `forces_valid`.
    torques_cache: Vec<(f64, f64, f64)>,
    // True when `forces` and `torques_cache` are still consistent with the
    // current atom positions (i.e. nothing has moved an atom since the last
    // compute_all_forces call). Invalidated by: barostat scaling, add/remove
    // molecule, direct position setters, cutoff change.
    forces_valid: bool,
    step_count: u64,

    // Barostat state (Berendsen-style isotropic pressure coupling).
    use_barostat: bool,
    target_pressure_bar: f64,
    /// Pressure-coupling time τ_P, in ps. Feeds into the Berendsen
    /// update `mu^3 = 1 - (dt/τ_P) · κ · (P - P_target)`. Default 1 ps
    /// — classroom-friendly response without over-damping; the Advanced
    /// slider exposes it for tuning.
    barostat_coupling: f64,
    last_virial: f64,          // last scalar virial (sum over pairs of r . F)
    last_pressure_bar: f64,    // cached for UI readout
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
            torques_cache: Vec::new(),
            forces_valid: false,
            step_count: 0,

            use_barostat: false,
            target_pressure_bar: 1.0,
            barostat_coupling: 1.0,  // τ_P in picoseconds
            last_virial: 0.0,
            last_pressure_bar: 0.0,
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

        let virtual_sites: Vec<VirtualSite> = input.virtual_sites.into_iter().map(|vs| VirtualSite {
            charge: vs.charge,
            ref_atoms: vs.ref_atoms,
            site_type: vs.site_type,
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
            body_coords: Vec::new(),
            q: (1.0, 0.0, 0.0, 0.0),
            omega_body: (0.0, 0.0, 0.0),
            inertia: (1.0, 1.0, 1.0),
            virtual_sites,
            atom_pos_x: Vec::new(),
            atom_pos_y: Vec::new(),
            atom_pos_z: Vec::new(),
            atom_charges: Vec::new(),
            atom_epsilons: Vec::new(),
            atom_sigmas: Vec::new(),
            is_frozen: false,
        };
        mol.compute_center();
        mol.init_rigid_body();
        mol.sync_soa(); // populate the SoA caches used by the SIMD kernel

        let idx = self.molecules.len();
        self.molecules.push(mol);
        self.forces.push((0.0, 0.0, 0.0));
        self.forces_valid = false;
        Ok(idx)
    }

    /// Clear all molecules
    pub fn clear(&mut self) {
        self.molecules.clear();
        self.forces.clear();
        self.torques_cache.clear();
        self.forces_valid = false;
        self.step_count = 0;
    }

    /// Remove the last molecule from the system (for adding salt)
    pub fn remove_last_molecule(&mut self) {
        if !self.molecules.is_empty() {
            self.molecules.pop();
            self.forces.pop();
            self.forces_valid = false;
        }
    }

    /// Set the position of a specific molecule (for drag interaction)
    pub fn set_molecule_position(&mut self, idx: usize, x: f64, y: f64, z: f64) {
        if idx >= self.molecules.len() { return; }
        let mol = &mut self.molecules[idx];
        let dx = x - mol.center_x;
        let dy = y - mol.center_y;
        let dz = z - mol.center_z;
        mol.translate(dx, dy, dz);
        self.forces_valid = false;
    }

    /// Whether the molecule at `idx` is currently frozen (skipped by
    /// integrators). See `set_molecule_frozen`.
    pub fn is_molecule_frozen(&self, idx: usize) -> bool {
        self.molecules.get(idx).map(|m| m.is_frozen).unwrap_or(false)
    }

    /// Promote liquid water molecules that have settled into the
    /// crystal's H-bond network to frozen status — makes the ice front
    /// visibly advance into the surrounding liquid. Criteria per water:
    /// (1) O within 3.5 Å of any frozen O, (2) at least one H-bond to a
    /// frozen neighbor (this water's H within 2.2 Å of a frozen O, or
    /// its O within 2.2 Å of a frozen H). Candidates are ranked by
    /// angular speed and the quietest `max_per_call` are promoted.
    ///
    /// This is a pedagogical aid rather than rigorous physics. Real
    /// liquid-to-solid transitions are continuous; snapping individual
    /// molecules to frozen lets the student *see* the growth front
    /// without waiting nanoseconds for the angular-velocity readout to
    /// descend.
    ///
    /// Returns the number of molecules newly frozen this call.
    pub fn auto_freeze_near_frozen(&mut self, max_per_call: u32, max_omega: f64) -> u32 {
        // Collect frozen atom positions by element.
        let mut frozen_o: Vec<(f64, f64, f64)> = Vec::new();
        let mut frozen_h: Vec<(f64, f64, f64)> = Vec::new();
        for mol in &self.molecules {
            if !mol.is_frozen { continue; }
            for a in &mol.atoms {
                if a.element == "O" {
                    frozen_o.push((a.x, a.y, a.z));
                } else if a.element == "H" {
                    frozen_h.push((a.x, a.y, a.z));
                }
            }
        }
        if frozen_o.is_empty() { return 0; }

        const OO_CUTOFF2: f64 = 3.5 * 3.5;
        const HB_CUTOFF2: f64 = 2.2 * 2.2;

        // Collect (idx, |ω|²) tuples for candidates.
        let mut candidates: Vec<(usize, f64)> = Vec::new();
        for (i, mol) in self.molecules.iter().enumerate() {
            if mol.is_frozen { continue; }
            if mol.atoms.len() != 3 { continue; }  // water only (3 atoms)

            let o = match mol.atoms.iter().find(|a| a.element == "O") {
                Some(a) => a,
                None => continue,
            };

            // 1. Proximity: water's O near some frozen O.
            let mut near = false;
            for &(fx, fy, fz) in &frozen_o {
                let dx = o.x - fx; let dy = o.y - fy; let dz = o.z - fz;
                if dx * dx + dy * dy + dz * dz < OO_CUTOFF2 {
                    near = true;
                    break;
                }
            }
            if !near { continue; }

            // 2. H-bond: this water's H within 2.2 Å of a frozen O ...
            let mut h_bonded = false;
            for h in mol.atoms.iter().filter(|a| a.element == "H") {
                for &(fx, fy, fz) in &frozen_o {
                    let dx = h.x - fx; let dy = h.y - fy; let dz = h.z - fz;
                    if dx * dx + dy * dy + dz * dz < HB_CUTOFF2 {
                        h_bonded = true;
                        break;
                    }
                }
                if h_bonded { break; }
            }
            // ... or a frozen H within 2.2 Å of this water's O.
            if !h_bonded {
                for &(fx, fy, fz) in &frozen_h {
                    let dx = o.x - fx; let dy = o.y - fy; let dz = o.z - fz;
                    if dx * dx + dy * dy + dz * dz < HB_CUTOFF2 {
                        h_bonded = true;
                        break;
                    }
                }
            }
            if !h_bonded { continue; }

            // 3. Quietness gate: water must be tumbling slowly enough
            //    that we believe it's settled into the H-bond network
            //    rather than just glancing past the crystal. Keeps hot,
            //    transient close-passes from getting snap-frozen.
            let (wx, wy, wz) = mol.omega_body;
            let omega2 = wx * wx + wy * wy + wz * wz;
            if omega2 > max_omega * max_omega { continue; }

            candidates.push((i, omega2));
        }

        // Quietest first — these are the waters most "settled into" the
        // crystal's network.
        candidates.sort_by(|a, b| a.1.partial_cmp(&b.1)
            .unwrap_or(std::cmp::Ordering::Equal));

        let n = (candidates.len() as u32).min(max_per_call);
        for &(idx, _) in candidates.iter().take(n as usize) {
            let mol = &mut self.molecules[idx];
            mol.is_frozen = true;
            mol.vx = 0.0; mol.vy = 0.0; mol.vz = 0.0;
            mol.omega_body = (0.0, 0.0, 0.0);
        }
        self.forces_valid = false;
        n
    }

    /// Unfreeze every currently-frozen molecule. Used when the target
    /// temperature rises above the water model's melting point —
    /// frozen waters are otherwise invisible to the thermostat, so
    /// they'd stay rigid forever even at 400 K without this escape
    /// hatch. Returns the number of molecules that went back into
    /// normal dynamics.
    pub fn unfreeze_all_frozen(&mut self) -> u32 {
        let mut n = 0;
        for mol in self.molecules.iter_mut() {
            if mol.is_frozen {
                mol.is_frozen = false;
                n += 1;
            }
        }
        n
    }

    /// Scan for ions (single-atom molecules with |charge| > 0.5) and
    /// unfreeze any frozen water whose atoms sit within `threshold`
    /// Angstroms of an ion. This simulates local melting at the
    /// dissolution front: as Na+ and Cl- approach the ice seed, the
    /// surface layer of seed waters goes back into normal dynamics and
    /// can be pulled away by the ions' Coulomb field.
    ///
    /// Call from the JS animation loop before each `step_n`. Returns
    /// the number of newly-unfrozen molecules this call so the
    /// renderer knows how many tints to clear.
    pub fn unfreeze_near_ions(&mut self, threshold: f64) -> u32 {
        // Gather ion positions (single-atom, |q| > 0.5). Cheap — usually
        // a few dozen at most.
        let mut ion_positions: Vec<(f64, f64, f64)> = Vec::new();
        for mol in &self.molecules {
            if mol.atoms.len() == 1 && mol.atoms[0].charge.abs() > 0.5 {
                ion_positions.push((mol.atoms[0].x, mol.atoms[0].y, mol.atoms[0].z));
            }
        }
        if ion_positions.is_empty() { return 0; }

        let thr2 = threshold * threshold;
        let mut to_thaw: Vec<usize> = Vec::new();
        for (i, mol) in self.molecules.iter().enumerate() {
            if !mol.is_frozen { continue; }
            let mut close = false;
            'outer: for a in &mol.atoms {
                for &(ix, iy, iz) in &ion_positions {
                    let dx = a.x - ix;
                    let dy = a.y - iy;
                    let dz = a.z - iz;
                    if dx * dx + dy * dy + dz * dz < thr2 {
                        close = true;
                        break 'outer;
                    }
                }
            }
            if close { to_thaw.push(i); }
        }

        let n = to_thaw.len() as u32;
        // Leave velocities at zero — thermostat + neighbor forces
        // accelerate them within a few steps. Flipping is_frozen off
        // is enough to put them back in the integrator's hands.
        for i in to_thaw { self.molecules[i].is_frozen = false; }
        n
    }

    /// Freeze or unfreeze a single molecule. Frozen molecules keep their
    /// velocities at zero and are skipped by the position, velocity, and
    /// rotation integrators plus the thermostat. Pair forces are still
    /// computed, so liquid neighbors interact with the frozen molecule
    /// normally — this is how a pre-built ice seed acts as a stable
    /// substrate for the surrounding supercooled water to nucleate onto.
    pub fn set_molecule_frozen(&mut self, idx: usize, frozen: bool) {
        if idx >= self.molecules.len() { return; }
        let mol = &mut self.molecules[idx];
        mol.is_frozen = frozen;
        if frozen {
            mol.vx = 0.0; mol.vy = 0.0; mol.vz = 0.0;
            mol.omega_body = (0.0, 0.0, 0.0);
        }
    }

    /// Set the orientation of a specific molecule (for the Mode 1 rotation
    /// handler). The world-frame atom positions are rebuilt from the stored
    /// body_coords so downstream energy calculations see the new orientation.
    pub fn set_molecule_orientation(
        &mut self,
        idx: usize,
        qw: f64,
        qx: f64,
        qy: f64,
        qz: f64,
    ) {
        if idx >= self.molecules.len() { return; }
        let mol = &mut self.molecules[idx];
        if mol.body_coords.is_empty() { return; }
        let mut q = (qw, qx, qy, qz);
        crate::rotation::quat_normalize(&mut q);
        mol.q = q;
        crate::rotation::update_atom_positions(mol);
        self.forces_valid = false;
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

    /// Get all molecule orientation quaternions as a flat array
    /// [qw0, qx0, qy0, qz0, qw1, qx1, qy1, qz1, ...]. Three.js uses the
    /// (x, y, z, w) order internally, so callers should convert.
    pub fn get_all_orientations(&self) -> Vec<f64> {
        let mut result = Vec::with_capacity(self.molecules.len() * 4);
        for mol in &self.molecules {
            result.push(mol.q.0);
            result.push(mol.q.1);
            result.push(mol.q.2);
            result.push(mol.q.3);
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

        // Compute virtual site positions for both molecules
        let mut a_virt_sites: Vec<(f64, f64, f64, f64)> = Vec::new(); // (x, y, z, charge)
        let mut b_virt_sites: Vec<(f64, f64, f64, f64)> = Vec::new();

        for vs in &mol_a.virtual_sites {
            if vs.site_type == "tip4p" {
                let (x, y, z) = crate::compute_tip4p_m_site(&mol_a.atoms, &vs.ref_atoms);
                a_virt_sites.push((x, y, z, vs.charge));
            }
        }

        for vs in &mol_b.virtual_sites {
            if vs.site_type == "tip4p" {
                let (x, y, z) = crate::compute_tip4p_m_site(&mol_b.atoms, &vs.ref_atoms);
                b_virt_sites.push((x, y, z, vs.charge));
            }
        }

        // Helper for Coulomb energy between charge sites
        let coulomb_energy_site = |ax: f64, ay: f64, az: f64, qa: f64,
                                     bx: f64, by: f64, bz: f64, qb: f64| -> f64 {
            let dx = bx - ax;
            let dy = by - ay;
            let dz = bz - az;
            let r2 = dx * dx + dy * dy + dz * dz;
            if r2 < 0.01 { return 0.0; }
            let r = r2.sqrt();
            crate::COULOMB_K * qa * qb / r
        };

        // Helper for Coulomb force between charge sites
        let coulomb_force_site = |ax: f64, ay: f64, az: f64, qa: f64,
                                     bx: f64, by: f64, bz: f64, qb: f64| -> (f64, f64, f64) {
            let dx = bx - ax;
            let dy = by - ay;
            let dz = bz - az;
            let r2 = dx * dx + dy * dy + dz * dz;
            if r2 < 0.01 { return (0.0, 0.0, 0.0); }
            let r = r2.sqrt();
            let f_scale = -crate::COULOMB_K * qa * qb / (r * r2);
            (f_scale * dx, f_scale * dy, f_scale * dz)
        };

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

            // A atoms with B virtual sites (Coulomb only)
            for &(vx, vy, vz, vq) in &b_virt_sites {
                e_coulomb += coulomb_energy_site(a_atom.x, a_atom.y, a_atom.z, a_atom.charge, vx, vy, vz, vq);
                let (cfx, cfy, cfz) = coulomb_force_site(a_atom.x, a_atom.y, a_atom.z, a_atom.charge, vx, vy, vz, vq);
                fx += cfx;
                fy += cfy;
                fz += cfz;
            }
        }

        // A virtual sites with B atoms (Coulomb only)
        for &(vx, vy, vz, vq) in &a_virt_sites {
            for b_atom in &mol_b.atoms {
                e_coulomb += coulomb_energy_site(vx, vy, vz, vq, b_atom.x, b_atom.y, b_atom.z, b_atom.charge);
                let (cfx, cfy, cfz) = coulomb_force_site(vx, vy, vz, vq, b_atom.x, b_atom.y, b_atom.z, b_atom.charge);
                fx += cfx;
                fy += cfy;
                fz += cfz;
            }

            // Virtual site - virtual site interactions
            for &(bx, by, bz, bq) in &b_virt_sites {
                e_coulomb += coulomb_energy_site(vx, vy, vz, vq, bx, by, bz, bq);
                let (cfx, cfy, cfz) = coulomb_force_site(vx, vy, vz, vq, bx, by, bz, bq);
                fx += cfx;
                fy += cfy;
                fz += cfz;
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
    pub fn set_box_size(&mut self, size: f64) { self.box_size = size; self.forces_valid = false; }
    pub fn set_timestep(&mut self, dt: f64) { self.timestep = dt; }
    pub fn set_temperature(&mut self, temp: f64) { self.target_temperature = temp; }
    pub fn set_thermostat(&mut self, enabled: bool) { self.use_thermostat = enabled; }
    pub fn set_periodic(&mut self, enabled: bool) { self.use_periodic = enabled; self.forces_valid = false; }
    pub fn set_cutoff(&mut self, cutoff: f64) { self.cutoff = cutoff; self.forces_valid = false; }

    pub fn get_temperature(&self) -> f64 { compute_temperature(&self.molecules) }
    pub fn get_kinetic_energy(&self) -> f64 { kinetic_energy(&self.molecules) }

    /// Mean body-frame angular speed |ω| (rad/ps) over non-frozen molecules.
    /// Useful as a freezing order parameter: liquid waters tumble fast
    /// (~5–15 rad/ps at 300 K); rotationally ordered waters locked into
    /// an ice H-bond network settle to much lower values as the crystal
    /// front advances into them.
    pub fn get_mean_angular_speed_liquid(&self) -> f64 {
        let mut total = 0.0;
        let mut n = 0;
        for mol in &self.molecules {
            if mol.is_frozen { continue; }
            let (wx, wy, wz) = mol.omega_body;
            total += (wx * wx + wy * wy + wz * wz).sqrt();
            n += 1;
        }
        if n == 0 { 0.0 } else { total / n as f64 }
    }
    pub fn get_molecule_count(&self) -> usize { self.molecules.len() }
    pub fn get_step_count(&self) -> u64 { self.step_count }

    /// Barostat controls and readouts. The barostat only runs when periodic
    /// boundaries are enabled (it rescales the periodic cell).
    pub fn set_barostat(&mut self, enabled: bool) { self.use_barostat = enabled; }
    pub fn set_target_pressure(&mut self, p_bar: f64) { self.target_pressure_bar = p_bar; }
    /// Set the Berendsen coupling time τ_P (ps). Smaller = snappier
    /// pressure regulation, larger = gentler. Classroom sweet spot ~1 ps.
    pub fn set_barostat_coupling(&mut self, tau_p_ps: f64) { self.barostat_coupling = tau_p_ps; }
    pub fn get_pressure(&self) -> f64 { self.last_pressure_bar }
    pub fn get_virial(&self) -> f64 { self.last_virial }
    pub fn get_box_size(&self) -> f64 { self.box_size }

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

        // The forces and torques at the current (start-of-step) positions
        // are identical to the ones computed at the *end* of the previous
        // step's second evaluation — positions don't change between step
        // boundaries unless the barostat rescales them. Reuse that cached
        // work when we can; otherwise recompute. This cuts ~half the pair-
        // force calls in a typical run.
        let (forces, torques) = if self.forces_valid
            && self.forces.len() == n
            && self.torques_cache.len() == n
        {
            (self.forces.clone(), self.torques_cache.clone())
        } else {
            let (f, t, _v) = self.compute_all_forces();
            (f, t)
        };

        // Velocity Verlet position step for translation.
        let old_accel = verlet_position_step(&mut self.molecules, &forces, self.timestep);

        // Apply boundary conditions to translational state.
        if self.use_periodic {
            self.apply_periodic_boundaries();
        } else {
            self.apply_wall_boundaries();
        }

        // Semi-implicit Euler step for rotation (rebuilds world atom positions
        // from the updated orientation).
        integrate_rotation(&mut self.molecules, &torques, self.timestep);

        // Compute new forces + torques + virial at updated positions.
        let (new_forces, new_torques, new_virial) = self.compute_all_forces();

        // Velocity Verlet velocity step.
        verlet_velocity_step(&mut self.molecules, &old_accel, &new_forces, self.timestep);

        // Apply thermostat (rescales both translational and angular velocities).
        if self.use_thermostat {
            berendsen_thermostat(
                &mut self.molecules,
                self.target_temperature,
                self.thermostat_tau,
                self.timestep,
            );
        }

        // Record virial + pressure for UI + barostat consumption. Pressure is
        // computed from post-thermostat translational KE so it reflects the
        // rescaled velocities.
        self.last_virial = new_virial;
        self.last_pressure_bar = self.compute_pressure_bar();

        // Apply barostat (rescale box + molecule COMs). This moves atom
        // positions, so the cached end-of-step forces/torques no longer
        // match the current positions — invalidate so the next step
        // recomputes them.
        let barostat_ran = self.use_barostat && self.use_periodic;
        if barostat_ran {
            self.apply_barostat();
        }

        self.forces = new_forces;
        self.torques_cache = new_torques;
        self.forces_valid = !barostat_ran;
        self.step_count += 1;
    }

    /// Current pressure in bar, computed from the translational KE and the
    /// last pair virial using the virial equation of state:
    ///   P = (2 * KE_trans + W) / (3 * V).
    fn compute_pressure_bar(&self) -> f64 {
        if self.box_size <= 0.0 { return 0.0; }
        let volume = self.box_size.powi(3);
        let ke_trans = kinetic_energy(&self.molecules); // kJ/mol, translational only
        let p_kj = (2.0 * ke_trans + self.last_virial) / (3.0 * volume);
        p_kj * BAR_PER_KJ_MOL_A3
    }

    /// Berendsen isotropic barostat: each step, isotropically rescale the
    /// box and every molecule's center of mass by
    ///
    ///     mu^3 = 1 - (dt / tau_P) * kappa_T * (P - P_target)
    ///     lambda = mu^3^(1/3)
    ///
    /// where `tau_P` is the pressure-coupling time (ps, stored in
    /// `self.barostat_coupling`) and `kappa_T` is the isothermal
    /// compressibility of water (4.5e-5 /bar — close enough for any
    /// liquid we simulate; barostat is only well-defined in the
    /// periodic NPT ensemble anyway).
    ///
    /// Pre-rewrite this function had a tiered-by-N ad-hoc coupling, an
    /// asymmetric contract-vs-expand gain, a dead `barostat_coupling`
    /// field, and a 100 Å box-size cap that silently broke the boiling
    /// demo. See commit 56635dd + the deep-dive report in docs/ for the
    /// pathology. Default `barostat_coupling = 1.0 ps`; ±0.1 %/step
    /// clamp is enough to tame initial-transient overshoot without
    /// washing out dynamics.
    fn apply_barostat(&mut self) {
        if self.molecules.is_empty() { return; }

        let tau_p = self.barostat_coupling.max(0.01);  // ps
        const KAPPA_T: f64 = 4.5e-5;                   // /bar, water compressibility
        let delta_p = self.last_pressure_bar - self.target_pressure_bar;

        let mu3 = 1.0 - (self.timestep / tau_p) * KAPPA_T * delta_p;
        let mu3_clamped = mu3.clamp(0.999, 1.001);
        let lambda = mu3_clamped.cbrt();
        if (lambda - 1.0).abs() < 1e-12 { return; }

        // Keep the box within sane geometric bounds; MIN protects the
        // neighbor-cell math from dividing by nothing when pressure spikes
        // send lambda toward zero, MAX is a safety net against runaway.
        const MIN_BOX_SIZE: f64 = 10.0;
        const MAX_BOX_SIZE: f64 = 500.0;
        let mut new_box_size = self.box_size * lambda;
        let mut effective_lambda = lambda;
        if new_box_size < MIN_BOX_SIZE {
            new_box_size = MIN_BOX_SIZE;
            effective_lambda = new_box_size / self.box_size;
        } else if new_box_size > MAX_BOX_SIZE {
            new_box_size = MAX_BOX_SIZE;
            effective_lambda = new_box_size / self.box_size;
        }

        self.box_size = new_box_size;
        let shift = effective_lambda - 1.0;
        for mol in &mut self.molecules {
            let dx = mol.center_x * shift;
            let dy = mol.center_y * shift;
            let dz = mol.center_z * shift;
            mol.translate(dx, dy, dz);
        }
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

// Benchmark hooks — gated behind the `benchmarks` cargo feature so they
// don't ship to students' browsers in a release build. Enable via
// `wasm-pack build ... -- --features parallel,benchmarks` when a maintainer
// wants to exercise `__chemsim.benchSteps` / `bench_forces_parallel` etc.
#[cfg(feature = "benchmarks")]
#[wasm_bindgen]
impl SimulationSystem {
    /// Time one serial cell-list force computation, return ms.
    pub fn bench_forces_serial(&self) -> f64 {
        let n = self.molecules.len();
        let mut forces = vec![(0.0, 0.0, 0.0); n];
        let mut torques = vec![(0.0, 0.0, 0.0); n];
        let mut virial = 0.0;
        let cutoff2 = self.cutoff * self.cutoff;
        let t0 = js_sys::Date::now();
        self.compute_forces_cell_list(&mut forces, &mut torques, &mut virial, cutoff2);
        js_sys::Date::now() - t0
    }

    /// Time one parallel cell-list force computation, return ms.
    #[cfg(feature = "parallel")]
    pub fn bench_forces_parallel(&self) -> f64 {
        let n = self.molecules.len();
        let mut forces = vec![(0.0, 0.0, 0.0); n];
        let mut torques = vec![(0.0, 0.0, 0.0); n];
        let mut virial = 0.0;
        let cutoff2 = self.cutoff * self.cutoff;
        let t0 = js_sys::Date::now();
        self.compute_forces_cell_list_parallel(&mut forces, &mut torques, &mut virial, cutoff2);
        js_sys::Date::now() - t0
    }

    /// Time a single full `step()` (forces + integration + thermostat +
    /// barostat), return ms.
    pub fn bench_step_one(&mut self) -> f64 {
        let t0 = js_sys::Date::now();
        self.step();
        js_sys::Date::now() - t0
    }

    /// Time just `compute_all_forces()`, return ms.
    pub fn bench_compute_all_forces(&self) -> f64 {
        let t0 = js_sys::Date::now();
        let _r = self.compute_all_forces();
        js_sys::Date::now() - t0
    }

    /// Returns [alloc_ms, parallel_force_ms, cap_loops_ms] averaged over 30 iters.
    #[cfg(feature = "parallel")]
    pub fn bench_overhead(&self) -> Vec<f64> {
        let n = self.molecules.len();
        let cutoff2 = self.cutoff * self.cutoff;
        let mut alloc_total = 0.0;
        let mut parallel_total = 0.0;
        let mut cap_total = 0.0;
        for _ in 0..30 {
            let a0 = js_sys::Date::now();
            let mut forces = vec![(0.0, 0.0, 0.0); n];
            let mut torques = vec![(0.0, 0.0, 0.0); n];
            let mut virial = 0.0;
            alloc_total += js_sys::Date::now() - a0;

            let p0 = js_sys::Date::now();
            self.compute_forces_cell_list_parallel(&mut forces, &mut torques, &mut virial, cutoff2);
            parallel_total += js_sys::Date::now() - p0;

            let c0 = js_sys::Date::now();
            const MAX_FORCE: f64 = 1.0e4;
            const MAX_FORCE_SQ: f64 = MAX_FORCE * MAX_FORCE;
            for f in forces.iter_mut() {
                let mag2 = f.0*f.0 + f.1*f.1 + f.2*f.2;
                if mag2 > MAX_FORCE_SQ { let s = MAX_FORCE / mag2.sqrt(); f.0*=s; f.1*=s; f.2*=s; }
            }
            for t in torques.iter_mut() {
                let mag2 = t.0*t.0 + t.1*t.1 + t.2*t.2;
                if mag2 > MAX_FORCE_SQ { let s = MAX_FORCE / mag2.sqrt(); t.0*=s; t.1*=s; t.2*=s; }
            }
            cap_total += js_sys::Date::now() - c0;
        }
        vec![alloc_total / 30.0, parallel_total / 30.0, cap_total / 30.0]
    }

    /// Returns [force_call_1, integrator, force_call_2, rest] in ms. Lets us
    /// see if the two in-step force calls are actually each as fast as the
    /// standalone benchmark suggests.
    pub fn bench_step_split(&mut self) -> Vec<f64> {
        let n = self.molecules.len();
        if n == 0 { return vec![0.0, 0.0, 0.0, 0.0]; }

        let t0 = js_sys::Date::now();
        let (forces, torques, _v0) = self.compute_all_forces();
        let t1 = js_sys::Date::now();

        let old_accel = verlet_position_step(&mut self.molecules, &forces, self.timestep);
        if self.use_periodic { self.apply_periodic_boundaries(); }
        else { self.apply_wall_boundaries(); }
        integrate_rotation(&mut self.molecules, &torques, self.timestep);
        let t2 = js_sys::Date::now();

        let (new_forces, _new_torques, new_virial) = self.compute_all_forces();
        let t3 = js_sys::Date::now();

        verlet_velocity_step(&mut self.molecules, &old_accel, &new_forces, self.timestep);
        if self.use_thermostat {
            berendsen_thermostat(&mut self.molecules, self.target_temperature, self.thermostat_tau, self.timestep);
        }
        self.last_virial = new_virial;
        self.last_pressure_bar = self.compute_pressure_bar();
        if self.use_barostat && self.use_periodic { self.apply_barostat(); }
        self.forces = new_forces;
        self.step_count += 1;
        let t4 = js_sys::Date::now();

        vec![t1 - t0, t2 - t1, t3 - t2, t4 - t3]
    }

    /// Returns [verlet_pos_ms, periodic_ms, rotation_ms, verlet_vel_ms,
    /// thermostat_ms, pressure_ms, barostat_ms] for one pass over the
    /// molecules. Lets us spot which O(N) loop is hot.
    pub fn bench_step_components(&mut self) -> Vec<f64> {
        let n = self.molecules.len();
        let cutoff2 = self.cutoff * self.cutoff;
        let mut forces = vec![(0.0, 0.0, 0.0); n];
        let mut torques = vec![(0.0, 0.0, 0.0); n];
        let mut virial = 0.0;
        // Populate forces/torques so the integration paths do real work.
        #[cfg(feature = "parallel")]
        self.compute_forces_cell_list_parallel(&mut forces, &mut torques, &mut virial, cutoff2);
        #[cfg(not(feature = "parallel"))]
        self.compute_forces_cell_list(&mut forces, &mut torques, &mut virial, cutoff2);

        let t0 = js_sys::Date::now();
        let _old_accel = verlet_position_step(&mut self.molecules, &forces, self.timestep);
        let t1 = js_sys::Date::now();
        if self.use_periodic { self.apply_periodic_boundaries(); }
        let t2 = js_sys::Date::now();
        integrate_rotation(&mut self.molecules, &torques, self.timestep);
        let t3 = js_sys::Date::now();
        verlet_velocity_step(&mut self.molecules, &_old_accel, &forces, self.timestep);
        let t4 = js_sys::Date::now();
        if self.use_thermostat {
            berendsen_thermostat(
                &mut self.molecules,
                self.target_temperature,
                self.thermostat_tau,
                self.timestep,
            );
        }
        let t5 = js_sys::Date::now();
        self.last_virial = virial;
        self.last_pressure_bar = self.compute_pressure_bar();
        let t6 = js_sys::Date::now();
        if self.use_barostat && self.use_periodic { self.apply_barostat(); }
        let t7 = js_sys::Date::now();

        vec![t1-t0, t2-t1, t3-t2, t4-t3, t5-t4, t6-t5, t7-t6]
    }
}

// Private methods
impl SimulationSystem {
    fn compute_all_forces(&self) -> (Vec<(f64, f64, f64)>, Vec<(f64, f64, f64)>, f64) {
        let n = self.molecules.len();
        let mut forces = vec![(0.0, 0.0, 0.0); n];
        let mut torques = vec![(0.0, 0.0, 0.0); n];
        let mut virial = 0.0;
        let cutoff2 = self.cutoff * self.cutoff;

        // Dispatch: always use the parallel path when the persistent pool
        // is up (dispatch latency is ~10us, so parallel wins at N well
        // below the old rayon-era threshold of 200). Fall back to serial
        // cell list if the pool isn't initialized yet, or to brute force
        // for tiny systems where a cell list isn't worth building.
        if n > 30 {
            #[cfg(feature = "parallel")]
            {
                self.compute_forces_cell_list_parallel(
                    &mut forces, &mut torques, &mut virial, cutoff2,
                );
            }
            #[cfg(not(feature = "parallel"))]
            {
                self.compute_forces_cell_list(&mut forces, &mut torques, &mut virial, cutoff2);
            }
        } else {
            self.compute_forces_brute(&mut forces, &mut torques, &mut virial, cutoff2);
        }

        // Cap per-molecule force magnitude to prevent the integrator from
        // exploding when two atoms briefly approach the LJ r^-12 singularity.
        // This is far above any normal physical force (~1e3) so it only
        // clamps genuine blow-ups, leaving the equilibrium dynamics untouched.
        const MAX_FORCE: f64 = 1.0e4;
        const MAX_FORCE_SQ: f64 = MAX_FORCE * MAX_FORCE;
        for f in forces.iter_mut() {
            let mag2 = f.0 * f.0 + f.1 * f.1 + f.2 * f.2;
            if mag2 > MAX_FORCE_SQ {
                let scale = MAX_FORCE / mag2.sqrt();
                f.0 *= scale;
                f.1 *= scale;
                f.2 *= scale;
            }
        }

        // Cap torque magnitude on the same principle. Torque units are
        // kJ/mol; a typical molecular-scale torque is well under 1e4.
        const MAX_TORQUE_SQ: f64 = MAX_FORCE_SQ;
        for t in torques.iter_mut() {
            let mag2 = t.0 * t.0 + t.1 * t.1 + t.2 * t.2;
            if mag2 > MAX_TORQUE_SQ {
                let scale = MAX_FORCE / mag2.sqrt();
                t.0 *= scale;
                t.1 *= scale;
                t.2 *= scale;
            }
        }

        (forces, torques, virial)
    }

    fn compute_forces_brute(
        &self,
        forces: &mut [(f64, f64, f64)],
        torques: &mut [(f64, f64, f64)],
        virial: &mut f64,
        cutoff2: f64,
    ) {
        let n = self.molecules.len();
        for i in 0..n {
            for j in (i + 1)..n {
                if let Some(d) = self.compute_pair_force(i, j, cutoff2) {
                    apply_pair(&d, i, j, forces, torques, virial);
                }
            }
        }
    }

    fn compute_forces_cell_list(
        &self,
        forces: &mut [(f64, f64, f64)],
        torques: &mut [(f64, f64, f64)],
        virial: &mut f64,
        cutoff2: f64,
    ) {
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

                    // Intra-cell pairs (molecules within the same cell)
                    let cell = &cells[cell_idx];
                    for a in 0..cell.len() {
                        for b in (a + 1)..cell.len() {
                            if let Some(d) = self.compute_pair_force(cell[a], cell[b], cutoff2) {
                                apply_pair(&d, cell[a], cell[b], forces, torques, virial);
                            }
                        }
                    }

                    // Inter-cell pairs with forward neighbors (half-shell for periodic).
                    // The forward walk alone would visit each pair once, but with small
                    // n_cells the periodic wrap (rem_euclid) can make the forward shell
                    // revisit `cell_idx` itself — so we also need an `i < j` guard to
                    // stop the same molecule pair from being counted twice when the
                    // neighbor cell wraps back onto the home cell.
                    for dcx in 0..=1_i32 {
                        let start_cy = if dcx == 0 { 0 } else { -1_i32 };
                        for dcy in start_cy..=1_i32 {
                            let start_cz = if dcx == 0 && dcy == 0 { 1 } else { -1_i32 };
                            for dcz in start_cz..=1_i32 {
                                let nx = (cx as i32 + dcx).rem_euclid(n_cells as i32) as usize;
                                let ny = (cy as i32 + dcy).rem_euclid(n_cells as i32) as usize;
                                let nz = (cz as i32 + dcz).rem_euclid(n_cells as i32) as usize;
                                let neighbor_idx = nx * n_cells * n_cells + ny * n_cells + nz;

                                for &i in &cells[cell_idx] {
                                    for &j in &cells[neighbor_idx] {
                                        if i >= j { continue; }
                                        if let Some(d) = self.compute_pair_force(i, j, cutoff2) {
                                            apply_pair(&d, i, j, forces, torques, virial);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// Parallel force computation using the persistent spin-wait worker
    /// pool (see `persistent_pool.rs`). Each worker gets a contiguous
    /// range of molecule indices and computes the full (not half-shell)
    /// force on each of its molecules by walking the 27-cell neighborhood.
    /// Output is a per-molecule `(fx, fy, fz, tx, ty, tz, virial_half)`
    /// tuple — adjacent writes land in adjacent `accum` slots, so no two
    /// workers alias.
    ///
    /// Versus the earlier rayon `par_iter_mut` version: no Atomics.wait /
    /// notify cycle on dispatch. The pool workers spin on a shared
    /// sequence counter, so per-dispatch latency drops from ~1-2 ms to
    /// ~10 us. Trade-off: workers burn 100% CPU whenever the sim is
    /// running.
    #[cfg(feature = "parallel")]
    fn compute_forces_cell_list_parallel(
        &self,
        forces: &mut [(f64, f64, f64)],
        torques: &mut [(f64, f64, f64)],
        virial: &mut f64,
        cutoff2: f64,
    ) {
        let n = self.molecules.len();
        let cell_size = self.cutoff;
        let n_cells = ((self.box_size / cell_size).ceil() as usize).max(1);
        let total_cells = n_cells * n_cells * n_cells;

        // Build cell list serially. O(N) and fast; this dominates nothing.
        let mut cells: Vec<Vec<usize>> = vec![Vec::new(); total_cells];
        let half = self.box_size / 2.0;
        for i in 0..n {
            let mol = &self.molecules[i];
            let cx = (((mol.center_x + half) / cell_size) as usize).min(n_cells - 1);
            let cy = (((mol.center_y + half) / cell_size) as usize).min(n_cells - 1);
            let cz = (((mol.center_z + half) / cell_size) as usize).min(n_cells - 1);
            let idx = cx * n_cells * n_cells + cy * n_cells + cz;
            if idx < total_cells {
                cells[idx].push(i);
            }
        }

        // Per-molecule cell index, for neighbor enumeration.
        let mol_cell: Vec<usize> = (0..n).map(|i| {
            let mol = &self.molecules[i];
            let cx = (((mol.center_x + half) / cell_size) as usize).min(n_cells - 1);
            let cy = (((mol.center_y + half) / cell_size) as usize).min(n_cells - 1);
            let cz = (((mol.center_z + half) / cell_size) as usize).min(n_cells - 1);
            cx * n_cells * n_cells + cy * n_cells + cz
        }).collect();

        // Per-molecule output. (fx, fy, fz, tx, ty, tz, virial_half). Each
        // worker writes to its assigned [start, end) slice, so no aliasing.
        let mut accum: Vec<(f64, f64, f64, f64, f64, f64, f64)> =
            vec![(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0); n];

        // Fall back to serial cell-list if the pool isn't up yet (e.g.,
        // during early init before `init_persistent_pool` has run).
        let n_workers = crate::persistent_pool::pool_worker_count();
        if n_workers == 0 {
            self.compute_forces_cell_list(forces, torques, virial, cutoff2);
            return;
        }

        // Pack everything the workers need into a single struct and pass
        // its address through the pool's opaque work pointer. All fields
        // are read-only except `accum_ptr`, which workers slice by id.
        #[repr(C)]
        struct ForceWorkDesc {
            sim: *const SimulationSystem,
            cells: *const Vec<Vec<usize>>,
            mol_cell: *const Vec<usize>,
            accum_ptr: *mut (f64, f64, f64, f64, f64, f64, f64),
            n_molecules: usize,
            n_cells: usize,
            cutoff2: f64,
            n_workers: usize,
        }

        let desc = ForceWorkDesc {
            sim: self,
            cells: &cells,
            mol_cell: &mol_cell,
            accum_ptr: accum.as_mut_ptr(),
            n_molecules: n,
            n_cells,
            cutoff2,
            n_workers,
        };

        unsafe extern "Rust" fn force_worker(data: *const u8, id: usize) {
            let desc = &*(data as *const ForceWorkDesc);
            let sim = &*desc.sim;
            let cells = &*desc.cells;
            let mol_cell = &*desc.mol_cell;
            let n = desc.n_molecules;
            let n_cells = desc.n_cells;
            let ncells_i = n_cells as i32;
            let use_periodic = sim.use_periodic;

            // Split [0, n) evenly across workers; last worker mops up the
            // remainder from the ceil division.
            let chunk = n.div_ceil(desc.n_workers);
            let start = id * chunk;
            let end = ((id + 1) * chunk).min(n);

            for i in start..end {
                let my_cell = mol_cell[i];
                let cx = my_cell / (n_cells * n_cells);
                let cy = (my_cell / n_cells) % n_cells;
                let cz = my_cell % n_cells;

                let mut out = (0.0f64, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);

                // Collect the 27-cell neighborhood's cell indices, then
                // dedupe. Under periodic BCs with small `n_cells` (box ~=
                // cutoff) several (dcx, dcy, dcz) triples wrap onto the
                // same physical cell; without dedup the same neighbor
                // molecule would be counted multiple times, since
                // compute_pair_force applies minimum-image internally.
                let mut neighbor_cells = [0usize; 27];
                let mut n_neighbor = 0usize;
                for dcx in -1_i32..=1 {
                    for dcy in -1_i32..=1 {
                        for dcz in -1_i32..=1 {
                            let rx = cx as i32 + dcx;
                            let ry = cy as i32 + dcy;
                            let rz = cz as i32 + dcz;
                            let (nx, ny, nz) = if use_periodic {
                                (
                                    rx.rem_euclid(ncells_i) as usize,
                                    ry.rem_euclid(ncells_i) as usize,
                                    rz.rem_euclid(ncells_i) as usize,
                                )
                            } else {
                                if rx < 0 || rx >= ncells_i || ry < 0 || ry >= ncells_i
                                    || rz < 0 || rz >= ncells_i
                                {
                                    continue;
                                }
                                (rx as usize, ry as usize, rz as usize)
                            };
                            let nc = nx * n_cells * n_cells + ny * n_cells + nz;
                            let mut seen = false;
                            for k in 0..n_neighbor {
                                if neighbor_cells[k] == nc { seen = true; break; }
                            }
                            if !seen {
                                neighbor_cells[n_neighbor] = nc;
                                n_neighbor += 1;
                            }
                        }
                    }
                }
                for k in 0..n_neighbor {
                    let nc = neighbor_cells[k];
                    for &j in &cells[nc] {
                        if i == j {
                            continue;
                        }
                        let (lo, hi) = if i < j { (i, j) } else { (j, i) };
                        if let Some(d) = sim.compute_pair_force(lo, hi, desc.cutoff2) {
                            let (fx, fy, fz, tx, ty, tz) = if i < j {
                                (d.f_i.0, d.f_i.1, d.f_i.2, d.t_i.0, d.t_i.1, d.t_i.2)
                            } else {
                                (d.f_j.0, d.f_j.1, d.f_j.2, d.t_j.0, d.t_j.1, d.t_j.2)
                            };
                            out.0 += fx; out.1 += fy; out.2 += fz;
                            out.3 += tx; out.4 += ty; out.5 += tz;
                            out.6 += d.virial * 0.5;
                        }
                    }
                }
                // Workers only ever write to their own disjoint indices.
                unsafe { *desc.accum_ptr.add(i) = out };
            }
        }

        // SAFETY: `desc` lives on this stack frame; `dispatch_global`
        // blocks until all workers are done, so `desc` and everything it
        // points to (self, cells, mol_cell, accum) are guaranteed alive
        // throughout. Workers only call &self methods (no mutation) and
        // write to disjoint `accum[i]` slots.
        unsafe {
            crate::persistent_pool::dispatch_global(
                force_worker,
                &desc as *const _ as *const u8,
            );
        }

        // Serial sum into caller's buffers.
        for i in 0..n {
            let a = accum[i];
            forces[i].0 += a.0; forces[i].1 += a.1; forces[i].2 += a.2;
            torques[i].0 += a.3; torques[i].1 += a.4; torques[i].2 += a.5;
            *virial += a.6;
        }
    }

    /// Pure pair-force calculation: returns the forces, torques, and virial
    /// this interaction contributes, so callers (serial *or* parallel) can
    /// accumulate into their own buffers. Returns `None` if outside cutoff.
    fn compute_pair_force(
        &self,
        i: usize,
        j: usize,
        cutoff2: f64,
    ) -> Option<PairDelta> {
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
        if r2 > cutoff2 { return None; }

        // Local accumulators (faster than repeated indexed writes and safe
        // for parallel callers since we only return the delta).
        let mut d = PairDelta::default();

        // Periodic image offset from a to b so that pair forces use the
        // minimum-image convention but lever arms remain each atom's
        // offset from its own molecule's center.
        let img_dx = dx - (mol_b.center_x - mol_a.center_x);
        let img_dy = dy - (mol_b.center_y - mol_a.center_y);
        let img_dz = dz - (mol_b.center_z - mol_a.center_z);

        // Compute virtual site positions for both molecules. We support up to
        // two vsites per molecule on the stack so this hot path allocates
        // nothing (a previous Vec-based version heap-allocated per pair and
        // serialised rayon workers on the wasm allocator).
        let mut a_virt_sites: [(f64, f64, f64, f64); 2] = [(0.0, 0.0, 0.0, 0.0); 2];
        let mut b_virt_sites: [(f64, f64, f64, f64); 2] = [(0.0, 0.0, 0.0, 0.0); 2];
        let mut a_n_vs = 0usize;
        let mut b_n_vs = 0usize;

        for vs in &mol_a.virtual_sites {
            if vs.site_type == "tip4p" && a_n_vs < 2 {
                let (x, y, z) = crate::compute_tip4p_m_site(&mol_a.atoms, &vs.ref_atoms);
                a_virt_sites[a_n_vs] = (x, y, z, vs.charge);
                a_n_vs += 1;
            }
        }

        for vs in &mol_b.virtual_sites {
            if vs.site_type == "tip4p" && b_n_vs < 2 {
                let (x, y, z) = crate::compute_tip4p_m_site(&mol_b.atoms, &vs.ref_atoms);
                b_virt_sites[b_n_vs] = (x + img_dx, y + img_dy, z + img_dz, vs.charge);
                b_n_vs += 1;
            }
        }

        // Inline per-pair accumulator. Shared between the SIMD batch and the
        // scalar path so the body is identical.
        macro_rules! accumulate_atom_pair {
            ($a_atom:expr, $rax:expr, $ray:expr, $raz:expr,
             $bx:expr, $by:expr, $bz:expr, $b_atom:expr,
             $fx:expr, $fy:expr, $fz:expr) => {{
                let fx = $fx; let fy = $fy; let fz = $fz;
                d.f_i.0 += fx; d.f_i.1 += fy; d.f_i.2 += fz;
                d.f_j.0 -= fx; d.f_j.1 -= fy; d.f_j.2 -= fz;

                let rdx = $a_atom.x - $bx;
                let rdy = $a_atom.y - $by;
                let rdz = $a_atom.z - $bz;
                d.virial += rdx * fx + rdy * fy + rdz * fz;

                d.t_i.0 += $ray * fz - $raz * fy;
                d.t_i.1 += $raz * fx - $rax * fz;
                d.t_i.2 += $rax * fy - $ray * fx;

                let rbx = $b_atom.x - mol_b.center_x;
                let rby = $b_atom.y - mol_b.center_y;
                let rbz = $b_atom.z - mol_b.center_z;
                d.t_j.0 += rby * (-fz) - rbz * (-fy);
                d.t_j.1 += rbz * (-fx) - rbx * (-fz);
                d.t_j.2 += rbx * (-fy) - rby * (-fx);
            }};
        }

        for a_atom in &mol_a.atoms {
            let rax = a_atom.x - mol_a.center_x;
            let ray = a_atom.y - mol_a.center_y;
            let raz = a_atom.z - mol_a.center_z;

            // SIMD (wasm f64x2) path: two atom-atom pairs per kernel call.
            // Uses `load_f64x2` to pull adjacent B-atom positions and LJ
            // constants out of the contiguous SoA arrays in one 16-byte
            // load instead of two scalar loads + lane combines. A-side is
            // splatted because the same a_atom participates in both pairs.
            #[cfg(target_feature = "simd128")]
            {
                use std::arch::wasm32::*;
                let bx_arr = mol_b.atom_pos_x.as_slice();
                let by_arr = mol_b.atom_pos_y.as_slice();
                let bz_arr = mol_b.atom_pos_z.as_slice();
                let bq_arr = mol_b.atom_charges.as_slice();
                let beps_arr = mol_b.atom_epsilons.as_slice();
                let bsig_arr = mol_b.atom_sigmas.as_slice();
                let n_b = bx_arr.len();

                // a-side broadcast: same a_atom for both pair lanes.
                let vax = f64x2_splat(a_atom.x);
                let vay = f64x2_splat(a_atom.y);
                let vaz = f64x2_splat(a_atom.z);
                let vaq = f64x2_splat(a_atom.charge);
                let vaeps = f64x2_splat(a_atom.epsilon);
                let vasig = f64x2_splat(a_atom.sigma);
                let vimg_dx = f64x2_splat(img_dx);
                let vimg_dy = f64x2_splat(img_dy);
                let vimg_dz = f64x2_splat(img_dz);

                let mut bi = 0;
                while bi + 1 < n_b {
                    // Wide unaligned loads — two adjacent f64s per instruction.
                    let vbx = f64x2_add(load_f64x2(bx_arr, bi), vimg_dx);
                    let vby = f64x2_add(load_f64x2(by_arr, bi), vimg_dy);
                    let vbz = f64x2_add(load_f64x2(bz_arr, bi), vimg_dz);
                    let vbq = load_f64x2(bq_arr, bi);
                    let vbeps = load_f64x2(beps_arr, bi);
                    let vbsig = load_f64x2(bsig_arr, bi);

                    let ((fx0, fy0, fz0), (fx1, fy1, fz1)) = coulomb_lj_force_raw_x2_v(
                        vax, vay, vaz, vaq, vaeps, vasig,
                        vbx, vby, vbz, vbq, vbeps, vbsig,
                    );
                    // Shifted b positions for the virial + torque apply step.
                    let bx0 = bx_arr[bi] + img_dx;
                    let by0 = by_arr[bi] + img_dy;
                    let bz0 = bz_arr[bi] + img_dz;
                    let bx1 = bx_arr[bi + 1] + img_dx;
                    let by1 = by_arr[bi + 1] + img_dy;
                    let bz1 = bz_arr[bi + 1] + img_dz;
                    let b0 = &mol_b.atoms[bi];
                    let b1 = &mol_b.atoms[bi + 1];
                    accumulate_atom_pair!(a_atom, rax, ray, raz, bx0, by0, bz0, b0, fx0, fy0, fz0);
                    accumulate_atom_pair!(a_atom, rax, ray, raz, bx1, by1, bz1, b1, fx1, fy1, fz1);
                    bi += 2;
                }
                if bi < n_b {
                    let bx = bx_arr[bi] + img_dx;
                    let by = by_arr[bi] + img_dy;
                    let bz = bz_arr[bi] + img_dz;
                    let (fx, fy, fz) = coulomb_lj_force_raw(
                        a_atom.x, a_atom.y, a_atom.z, a_atom.charge, a_atom.epsilon, a_atom.sigma,
                        bx, by, bz, bq_arr[bi], beps_arr[bi], bsig_arr[bi],
                    );
                    let b_atom = &mol_b.atoms[bi];
                    accumulate_atom_pair!(a_atom, rax, ray, raz, bx, by, bz, b_atom, fx, fy, fz);
                }
            }

            #[cfg(not(target_feature = "simd128"))]
            for b_atom in &mol_b.atoms {
                let bx = b_atom.x + img_dx;
                let by = b_atom.y + img_dy;
                let bz = b_atom.z + img_dz;
                let (fx, fy, fz) = coulomb_lj_force_raw(
                    a_atom.x, a_atom.y, a_atom.z, a_atom.charge, a_atom.epsilon, a_atom.sigma,
                    bx, by, bz, b_atom.charge, b_atom.epsilon, b_atom.sigma,
                );
                accumulate_atom_pair!(a_atom, rax, ray, raz, bx, by, bz, b_atom, fx, fy, fz);
            }

            // A atom interacting with B's virtual sites (Coulomb only)
            for k in 0..b_n_vs {
                let (vx, vy, vz, vq) = b_virt_sites[k];
                let (fx, fy, fz) = coulomb_force_raw(
                    a_atom.x, a_atom.y, a_atom.z, a_atom.charge,
                    vx, vy, vz, vq,
                );

                d.f_i.0 += fx; d.f_i.1 += fy; d.f_i.2 += fz;
                d.f_j.0 -= fx; d.f_j.1 -= fy; d.f_j.2 -= fz;

                let rdx = a_atom.x - vx;
                let rdy = a_atom.y - vy;
                let rdz = a_atom.z - vz;
                d.virial += rdx * fx + rdy * fy + rdz * fz;

                d.t_i.0 += ray * fz - raz * fy;
                d.t_i.1 += raz * fx - rax * fz;
                d.t_i.2 += rax * fy - ray * fx;
                // Torque on B from virtual site: virtual site has no lever arm (at molecular center)
                // so no torque contribution
            }
        }

        // A's virtual sites interacting with B's atoms
        for k in 0..a_n_vs {
            let (vx, vy, vz, vq) = a_virt_sites[k];
            for b_atom in &mol_b.atoms {
                // Lever arm for virtual site (assumed at molecular center):
                // no torque contribution for molecule A from this interaction.

                let b_img_x = b_atom.x + img_dx;
                let b_img_y = b_atom.y + img_dy;
                let b_img_z = b_atom.z + img_dz;

                let dx = b_img_x - vx;
                let dy = b_img_y - vy;
                let dz = b_img_z - vz;
                let r2 = dx * dx + dy * dy + dz * dz;
                if r2 < 0.01 { continue; }
                let r = r2.sqrt();
                let f_scale = -crate::COULOMB_K * vq * b_atom.charge / (r * r2);
                let fx = f_scale * dx;
                let fy = f_scale * dy;
                let fz = f_scale * dz;

                d.f_i.0 += fx; d.f_i.1 += fy; d.f_i.2 += fz;
                d.f_j.0 -= fx; d.f_j.1 -= fy; d.f_j.2 -= fz;

                d.virial += (vx - b_img_x) * fx + (vy - b_img_y) * fy + (vz - b_img_z) * fz;
                // No torque on A (virtual site at center)
                // Torque on B
                let rbx = b_atom.x - mol_b.center_x;
                let rby = b_atom.y - mol_b.center_y;
                let rbz = b_atom.z - mol_b.center_z;
                d.t_j.0 += rby * (-fz) - rbz * (-fy);
                d.t_j.1 += rbz * (-fx) - rbx * (-fz);
                d.t_j.2 += rbx * (-fy) - rby * (-fx);
            }

            // Virtual site - virtual site interactions
            for m in 0..b_n_vs {
                let (bx, by, bz, bq) = b_virt_sites[m];
                let (fx, fy, fz) = coulomb_force_raw(vx, vy, vz, vq, bx, by, bz, bq);

                d.f_i.0 += fx; d.f_i.1 += fy; d.f_i.2 += fz;
                d.f_j.0 -= fx; d.f_j.1 -= fy; d.f_j.2 -= fz;

                d.virial += (vx - bx) * fx + (vy - by) * fy + (vz - bz) * fz;
                // No torque contribution (virtual sites at molecular centers)
            }
        }

        Some(d)
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

    fn apply_wall_boundaries(&mut self) {
        let half = self.box_size / 2.0;
        // Account for molecular radius when bouncing (approximate as 2 Å)
        let mol_radius = 2.0;
        let effective_half = half - mol_radius;

        for mol in &mut self.molecules {
            // Bounce off walls and reflect velocity
            if mol.center_x > effective_half {
                mol.center_x = effective_half;
                mol.vx = -mol.vx * 0.9; // Lose some energy on bounce
            } else if mol.center_x < -effective_half {
                mol.center_x = -effective_half;
                mol.vx = -mol.vx * 0.9;
            }

            if mol.center_y > effective_half {
                mol.center_y = effective_half;
                mol.vy = -mol.vy * 0.9;
            } else if mol.center_y < -effective_half {
                mol.center_y = -effective_half;
                mol.vy = -mol.vy * 0.9;
            }

            if mol.center_z > effective_half {
                mol.center_z = effective_half;
                mol.vz = -mol.vz * 0.9;
            } else if mol.center_z < -effective_half {
                mol.center_z = -effective_half;
                mol.vz = -mol.vz * 0.9;
            }
        }
    }
}
