use crate::Atom;

/// Lennard-Jones potential between two atoms
/// V(r) = 4 * epsilon * [(sigma/r)^12 - (sigma/r)^6]
/// Uses Lorentz-Berthelot combining rules for mixed pairs:
///   sigma_ij = (sigma_i + sigma_j) / 2
///   epsilon_ij = sqrt(epsilon_i * epsilon_j)
pub fn lj_energy(a1: &Atom, a2: &Atom) -> f64 {
    let dx = a2.x - a1.x;
    let dy = a2.y - a1.y;
    let dz = a2.z - a1.z;
    let r2 = dx * dx + dy * dy + dz * dz;
    if r2 < 0.01 { return 0.0; }

    let sigma = (a1.sigma + a2.sigma) / 2.0;
    let epsilon = (a1.epsilon * a2.epsilon).sqrt();
    if epsilon < 1e-10 { return 0.0; }

    let s2 = sigma * sigma / r2;
    let s6 = s2 * s2 * s2;
    let s12 = s6 * s6;

    4.0 * epsilon * (s12 - s6)
}

/// Lennard-Jones force on atom 1 due to atom 2
/// F = -dV/dr * r_hat
/// dV/dr = 4 * epsilon * [-12 * sigma^12 / r^13 + 6 * sigma^6 / r^7]
/// F = 4 * epsilon * [12 * sigma^12 / r^14 - 6 * sigma^6 / r^8] * (dx, dy, dz)
/// Returns (fx, fy, fz) on a1 due to a2
pub fn lj_force(a1: &Atom, a2: &Atom) -> (f64, f64, f64) {
    lj_force_raw(a1.x, a1.y, a1.z, a1.epsilon, a1.sigma,
                 a2.x, a2.y, a2.z, a2.epsilon, a2.sigma)
}

/// Raw-coordinate LJ force. Same math as `lj_force` but takes f64 args so the
/// parallel force loop doesn't have to synthesise image-shifted `Atom`
/// structs (which allocates a `String` for the element and serialises rayon
/// workers on the wasm allocator).
#[inline(always)]
pub fn lj_force_raw(
    ax: f64, ay: f64, az: f64, aeps: f64, asig: f64,
    bx: f64, by: f64, bz: f64, beps: f64, bsig: f64,
) -> (f64, f64, f64) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    let r2 = dx * dx + dy * dy + dz * dz;
    if r2 < 0.01 { return (0.0, 0.0, 0.0); }

    let sigma = (asig + bsig) / 2.0;
    let epsilon = (aeps * beps).sqrt();
    if epsilon < 1e-10 { return (0.0, 0.0, 0.0); }

    let s2 = sigma * sigma / r2;
    let s6 = s2 * s2 * s2;
    let s12 = s6 * s6;

    let f_scale = -4.0 * epsilon * (12.0 * s12 - 6.0 * s6) / r2;
    (f_scale * dx, f_scale * dy, f_scale * dz)
}

/// Fused Coulomb + LJ force on atom A from atom B. Computes distance once
/// and applies both potentials, saving ~30% of the atom-atom inner loop
/// cost (which was duplicating the sqrt + r2 computation across the two
/// separate functions). Hot path for water-water pairs.
#[inline(always)]
pub fn coulomb_lj_force_raw(
    ax: f64, ay: f64, az: f64, aq: f64, aeps: f64, asig: f64,
    bx: f64, by: f64, bz: f64, bq: f64, beps: f64, bsig: f64,
) -> (f64, f64, f64) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    let r2 = dx * dx + dy * dy + dz * dz;
    if r2 < 0.01 { return (0.0, 0.0, 0.0); }
    let r = r2.sqrt();

    // Coulomb: F = -K q_a q_b / r^3 * (dx, dy, dz)
    let f_c = -crate::COULOMB_K * aq * bq / (r * r2);

    // LJ: F = -4 eps (12 s12 - 6 s6) / r^2 * (dx, dy, dz)
    let sigma = (asig + bsig) * 0.5;
    let epsilon_sq = aeps * beps;
    let f_lj = if epsilon_sq < 1e-20 {
        0.0
    } else {
        let epsilon = epsilon_sq.sqrt();
        let s2 = sigma * sigma / r2;
        let s6 = s2 * s2 * s2;
        let s12 = s6 * s6;
        -4.0 * epsilon * (12.0 * s12 - 6.0 * s6) / r2
    };

    let f_scale = f_c + f_lj;
    (f_scale * dx, f_scale * dy, f_scale * dz)
}

/// Compute the LJ potential minimum distance for a pair
/// r_min = sigma * 2^(1/6)
pub fn lj_min_distance(sigma1: f64, sigma2: f64) -> f64 {
    let sigma = (sigma1 + sigma2) / 2.0;
    sigma * 2.0_f64.powf(1.0 / 6.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lj_minimum_at_expected_distance() {
        let sigma = 3.0;
        let epsilon = 1.0;
        let r_min = sigma * 2.0_f64.powf(1.0 / 6.0);

        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };

        // Test energy at r_min: should be -epsilon
        let a2_min = Atom { x: r_min, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let e_min = lj_energy(&a1, &a2_min);
        assert!((e_min - (-epsilon)).abs() < 0.001, "LJ minimum should be -epsilon: got {}", e_min);

        // Test that energy is higher at r_min - 0.5 and r_min + 0.5
        let a2_close = Atom { x: r_min - 0.5, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let e_close = lj_energy(&a1, &a2_close);
        assert!(e_close > e_min, "Energy should be higher closer than r_min");

        let a2_far = Atom { x: r_min + 0.5, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let e_far = lj_energy(&a1, &a2_far);
        assert!(e_far > e_min, "Energy should be higher farther than r_min");
    }

    #[test]
    fn test_lj_force_zero_at_minimum() {
        let sigma = 3.0;
        let epsilon = 1.0;
        let r_min = sigma * 2.0_f64.powf(1.0 / 6.0);

        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let a2 = Atom { x: r_min, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let (fx, fy, fz) = lj_force(&a1, &a2);
        assert!(fx.abs() < 0.01, "Force should be ~zero at LJ minimum: got fx={}", fx);
        assert!(fy.abs() < 0.001, "fy should be zero");
        assert!(fz.abs() < 0.001, "fz should be zero");
    }

    #[test]
    fn test_lj_repulsive_at_short_range() {
        let sigma = 3.0;
        let epsilon = 1.0;
        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let a2 = Atom { x: 2.5, y: 0.0, z: 0.0, charge: 0.0, epsilon, sigma, mass: 1.0, element: "X".into() };
        let (fx, _, _) = lj_force(&a1, &a2);
        // At r < r_min, force on a1 should push away from a2 (negative x)
        assert!(fx < 0.0, "Force should be repulsive (negative fx) at short range: got fx={}", fx);
    }

    #[test]
    fn test_lj_min_distance() {
        let r = lj_min_distance(3.0, 3.0);
        let expected = 3.0 * 2.0_f64.powf(1.0 / 6.0);
        assert!((r - expected).abs() < 0.001);
    }
}
