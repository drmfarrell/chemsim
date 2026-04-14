use crate::Molecule;
use crate::integrator::compute_temperature;

/// Berendsen thermostat: rescale velocities to approach target temperature
///
/// lambda = sqrt(1 + dt/tau * (T_target/T_current - 1))
/// v_new = lambda * v_old
///
/// tau: coupling time constant (in ps). Larger = weaker coupling.
/// Typical value: 0.1 - 1.0 ps
pub fn berendsen_thermostat(
    molecules: &mut [Molecule],
    target_temp: f64,
    tau: f64,
    dt: f64,
) {
    if molecules.is_empty() { return; }

    let current_temp = compute_temperature(molecules);
    if current_temp < 1e-10 {
        // System is frozen; give random velocities
        initialize_velocities(molecules, target_temp);
        return;
    }

    let ratio = target_temp / current_temp;
    let lambda_sq = 1.0 + dt / tau * (ratio - 1.0);
    if lambda_sq <= 0.0 { return; }
    let lambda = lambda_sq.sqrt();

    for mol in molecules.iter_mut() {
        mol.vx *= lambda;
        mol.vy *= lambda;
        mol.vz *= lambda;
    }
}

/// Initialize velocities from a Maxwell-Boltzmann distribution at target temperature
/// Uses Box-Muller transform for Gaussian random numbers
pub fn initialize_velocities(molecules: &mut [Molecule], target_temp: f64) {
    let k_b = 0.00831446; // kJ/(mol*K)

    // Simple deterministic seed based on molecule count (for reproducibility in tests)
    let mut seed: u64 = 12345 + molecules.len() as u64 * 67890;

    for mol in molecules.iter_mut() {
        let mass = mol.total_mass();
        if mass < 0.01 { continue; }

        // sigma_v = sqrt(k_B * T / (m * 100))
        // The 100 factor: v is in Angstrom/ps, and 1 amu*(Angstrom/ps)^2 = 0.01 kJ/mol
        let sigma = (k_b * target_temp / (mass * 100.0)).sqrt();

        // Box-Muller with xorshift64 PRNG
        let (g1, g2) = gaussian_pair(&mut seed);
        let (g3, _) = gaussian_pair(&mut seed);

        mol.vx = sigma * g1;
        mol.vy = sigma * g2;
        mol.vz = sigma * g3;
    }

    // Remove center-of-mass velocity
    remove_com_velocity(molecules);
}

/// Remove center-of-mass velocity so the system doesn't drift
fn remove_com_velocity(molecules: &mut [Molecule]) {
    let mut total_mass = 0.0;
    let mut com_vx = 0.0;
    let mut com_vy = 0.0;
    let mut com_vz = 0.0;

    for mol in molecules.iter() {
        let m = mol.total_mass();
        com_vx += m * mol.vx;
        com_vy += m * mol.vy;
        com_vz += m * mol.vz;
        total_mass += m;
    }

    if total_mass < 0.01 { return; }
    com_vx /= total_mass;
    com_vy /= total_mass;
    com_vz /= total_mass;

    for mol in molecules.iter_mut() {
        mol.vx -= com_vx;
        mol.vy -= com_vy;
        mol.vz -= com_vz;
    }
}

/// XorShift64 PRNG
fn xorshift64(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

/// Generate a pair of Gaussian random numbers via Box-Muller
fn gaussian_pair(seed: &mut u64) -> (f64, f64) {
    loop {
        let u1 = (xorshift64(seed) as f64) / (u64::MAX as f64);
        let u2 = (xorshift64(seed) as f64) / (u64::MAX as f64);
        if u1 > 1e-10 {
            let r = (-2.0 * u1.ln()).sqrt();
            let theta = 2.0 * std::f64::consts::PI * u2;
            return (r * theta.cos(), r * theta.sin());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Atom;

    fn make_molecules(n: usize, mass: f64) -> Vec<Molecule> {
        (0..n).map(|_| Molecule {
            atoms: vec![Atom {
                x: 0.0, y: 0.0, z: 0.0,
                charge: 0.0, epsilon: 0.0, sigma: 0.0,
                mass,
                element: "X".into(),
            }],
            center_x: 0.0, center_y: 0.0, center_z: 0.0,
            vx: 0.0, vy: 0.0, vz: 0.0,
            polarizability: 0.0,
        }).collect()
    }

    #[test]
    fn test_initialize_velocities_temperature() {
        let mut mols = make_molecules(100, 18.0); // 100 water-like molecules
        initialize_velocities(&mut mols, 300.0);

        let temp = compute_temperature(&mols);
        // Should be close to 300K (statistical, so allow 50% tolerance with 100 molecules)
        assert!(temp > 150.0 && temp < 600.0,
            "Temperature should be roughly 300K: got {}", temp);
    }

    #[test]
    fn test_berendsen_approaches_target() {
        let mut mols = make_molecules(50, 18.0);
        initialize_velocities(&mut mols, 600.0); // Start hot

        let target = 300.0;
        let dt = 0.002;
        let tau = 0.1;

        // Apply thermostat many times
        for _ in 0..1000 {
            berendsen_thermostat(&mut mols, target, tau, dt);
        }

        let temp = compute_temperature(&mols);
        assert!((temp - target).abs() < 50.0,
            "After many thermostat steps, temp should approach target: got {}", temp);
    }
}
