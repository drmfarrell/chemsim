use crate::Molecule;

/// Velocity Verlet integration step for a set of molecules
///
/// Algorithm:
/// 1. x(t+dt) = x(t) + v(t)*dt + 0.5*a(t)*dt^2
/// 2. Compute forces at new positions -> a(t+dt)
/// 3. v(t+dt) = v(t) + 0.5*(a(t) + a(t+dt))*dt
///
/// For rigid molecules, we treat each molecule as a point particle
/// at its center of mass. Internal atomic coordinates move rigidly.

/// Update positions using current velocities and forces (step 1 of Velocity Verlet)
/// forces: Vec of (fx, fy, fz) per molecule in kJ/(mol*Angstrom)
/// dt: timestep in picoseconds
/// Returns: previous accelerations for velocity update
pub fn verlet_position_step(
    molecules: &mut [Molecule],
    forces: &[(f64, f64, f64)],
    dt: f64,
) -> Vec<(f64, f64, f64)> {
    let mut old_accel = Vec::with_capacity(molecules.len());

    for (i, mol) in molecules.iter_mut().enumerate() {
        let mass = mol.total_mass();
        if mass < 0.01 {
            old_accel.push((0.0, 0.0, 0.0));
            continue;
        }

        // Convert force to acceleration: a = F/m
        // Units: kJ/(mol*Angstrom*amu) -> need conversion factor
        // 1 kJ/mol = 1e-3 * 6.022e23 J = 6.022e20 J/mol...
        // In MD natural units: force in kJ/(mol*Angstrom), mass in amu, time in ps
        // a = F/m has units kJ/(mol*Angstrom*amu)
        // Conversion: 1 kJ/(mol*Angstrom*amu) = 100 Angstrom/ps^2
        // (from: 1 kJ/mol = 1.6605e-24 kg * Angstrom^2/ps^2 * 6.022e23)
        // Actually: 1 amu * 1 Angstrom/ps^2 = 1.6605e-27 kg * 1e-10 m / (1e-12 s)^2
        //   = 1.6605e-27 * 1e-10 / 1e-24 = 1.6605e-27 * 1e14 = 1.6605e-13 N
        // 1 kJ/mol/Angstrom = 1000 J / (6.022e23 * 1e-10 m) = 1.661e-10 / 1e-10 = 1.661e-14 N
        // Wait, let me be more careful:
        // 1 kJ/mol/Angstrom = 1000 / (6.022e23 * 1e-10) N = 1.661e-14 N
        // a = F/m = 1.661e-14 / (1.661e-27 * mass_amu) = 1e13 / mass_amu m/s^2
        // In Angstrom/ps^2: 1e13 m/s^2 * 1e10 Angstrom/m * 1e-24 ps^2/s^2 = 0.01/mass Angstrom/ps^2
        // So conversion factor: a [Angstrom/ps^2] = F [kJ/(mol*Angstrom)] * 0.01 / mass [amu]
        // More precisely: the factor is 1/(mass * 100) with mass in amu

        let conv = 0.01 / mass; // kJ/(mol*Angstrom) -> Angstrom/ps^2
        let (fx, fy, fz) = forces[i];
        let ax = fx * conv;
        let ay = fy * conv;
        let az = fz * conv;

        old_accel.push((ax, ay, az));

        // Position update: x += v*dt + 0.5*a*dt^2
        let dx = mol.vx * dt + 0.5 * ax * dt * dt;
        let dy = mol.vy * dt + 0.5 * ay * dt * dt;
        let dz = mol.vz * dt + 0.5 * az * dt * dt;

        mol.translate(dx, dy, dz);
    }

    old_accel
}

/// Update velocities using old and new accelerations (step 3 of Velocity Verlet)
/// old_accel and new_forces from before and after the position update
pub fn verlet_velocity_step(
    molecules: &mut [Molecule],
    old_accel: &[(f64, f64, f64)],
    new_forces: &[(f64, f64, f64)],
    dt: f64,
) {
    for (i, mol) in molecules.iter_mut().enumerate() {
        let mass = mol.total_mass();
        if mass < 0.01 { continue; }

        let conv = 0.01 / mass;
        let (nfx, nfy, nfz) = new_forces[i];
        let new_ax = nfx * conv;
        let new_ay = nfy * conv;
        let new_az = nfz * conv;

        let (old_ax, old_ay, old_az) = old_accel[i];

        mol.vx += 0.5 * (old_ax + new_ax) * dt;
        mol.vy += 0.5 * (old_ay + new_ay) * dt;
        mol.vz += 0.5 * (old_az + new_az) * dt;
    }
}

/// Compute kinetic energy of all molecules
/// KE = 0.5 * m * v^2 for each molecule
/// Returns energy in kJ/mol (using conversion factor)
pub fn kinetic_energy(molecules: &[Molecule]) -> f64 {
    let mut ke = 0.0;
    for mol in molecules {
        let mass = mol.total_mass();
        let v2 = mol.vx * mol.vx + mol.vy * mol.vy + mol.vz * mol.vz;
        // KE = 0.5 * m * v^2, with m in amu, v in Angstrom/ps
        // Convert to kJ/mol: multiply by 100 (since 1 amu*(Angstrom/ps)^2 = 0.01 kJ/mol)
        ke += 0.5 * mass * v2 * 100.0;
    }
    ke
}

/// Compute temperature from kinetic energy
/// T = 2*KE / (3*N*k_B) where k_B = 0.00831446 kJ/(mol*K)
pub fn compute_temperature(molecules: &[Molecule]) -> f64 {
    let n = molecules.len() as f64;
    if n < 1.0 { return 0.0; }
    let ke = kinetic_energy(molecules);
    let k_b = 0.00831446; // kJ/(mol*K)
    // 3 translational degrees of freedom per molecule
    2.0 * ke / (3.0 * n * k_b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Atom;

    fn make_test_molecule(mass: f64, vx: f64, vy: f64, vz: f64) -> Molecule {
        Molecule {
            atoms: vec![Atom {
                x: 0.0, y: 0.0, z: 0.0,
                charge: 0.0, epsilon: 0.0, sigma: 0.0,
                mass,
                element: "X".into(),
            }],
            center_x: 0.0, center_y: 0.0, center_z: 0.0,
            vx, vy, vz,
            polarizability: 0.0,
        }
    }

    #[test]
    fn test_kinetic_energy() {
        // KE = 0.5 * m * v^2 * 100
        let mol = make_test_molecule(1.0, 1.0, 0.0, 0.0);
        let ke = kinetic_energy(&[mol]);
        // 0.5 * 1.0 * 1.0 * 100 = 50
        assert!((ke - 50.0).abs() < 0.01, "KE should be 50: got {}", ke);
    }

    #[test]
    fn test_free_particle_moves_linearly() {
        let mut mol = make_test_molecule(1.0, 1.0, 0.0, 0.0);
        mol.center_x = 0.0;
        let dt = 0.01; // ps
        let zero_forces = vec![(0.0, 0.0, 0.0)];

        let old_accel = verlet_position_step(&mut [mol.clone()], &zero_forces, dt);
        // Should have moved by v*dt = 0.01 Angstrom
        // Actually we need to use the mutable reference properly
        let mut mols = vec![mol];
        let old_a = verlet_position_step(&mut mols, &zero_forces, dt);
        verlet_velocity_step(&mut mols, &old_a, &zero_forces, dt);

        assert!((mols[0].center_x - 0.01).abs() < 1e-6,
            "Free particle should move v*dt: got {}", mols[0].center_x);
        assert!((mols[0].vx - 1.0).abs() < 1e-6,
            "Velocity should be unchanged: got {}", mols[0].vx);
    }
}
