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

/// Wide unaligned load of two adjacent f64s from a slice into a v128. Trusts
/// wasm's native unaligned v128 loads; the cast from `*const f64` to
/// `*const v128` bypasses Rust's 16-byte alignment requirement on v128 but
/// wasm hardware handles it directly.
#[cfg(target_feature = "simd128")]
#[inline(always)]
pub fn load_f64x2(src: &[f64], offset: usize) -> std::arch::wasm32::v128 {
    debug_assert!(offset + 1 < src.len() || offset + 2 <= src.len());
    unsafe {
        std::ptr::read_unaligned(
            src.as_ptr().add(offset) as *const std::arch::wasm32::v128,
        )
    }
}

/// SIMD (wasm f64x2) version of the fused Coulomb+LJ kernel that evaluates
/// two atom-atom pairs per instruction. Takes pre-loaded `v128` inputs so
/// the caller can use `load_f64x2` (a single wide load) instead of pair-
/// wise scalar loads plus lane combines.
///
/// `vaX` lanes hold (ax0, ax1) etc. — same for bX, aq/bq, a/b eps/sig. The
/// lanes encode two pair evaluations running in parallel. Lanes where
/// r^2 < 0.01 or epsilon == 0 are masked to zero so single-atom ions go
/// through the same kernel without a branch inside the hot loop.
#[cfg(target_feature = "simd128")]
#[inline(always)]
#[allow(clippy::too_many_arguments)]
pub fn coulomb_lj_force_raw_x2_v(
    vax: std::arch::wasm32::v128, vay: std::arch::wasm32::v128, vaz: std::arch::wasm32::v128,
    vaq: std::arch::wasm32::v128, vaeps: std::arch::wasm32::v128, vasig: std::arch::wasm32::v128,
    vbx: std::arch::wasm32::v128, vby: std::arch::wasm32::v128, vbz: std::arch::wasm32::v128,
    vbq: std::arch::wasm32::v128, vbeps: std::arch::wasm32::v128, vbsig: std::arch::wasm32::v128,
) -> ((f64, f64, f64), (f64, f64, f64)) {
    use std::arch::wasm32::*;
    {
        let dx = f64x2_sub(vbx, vax);
        let dy = f64x2_sub(vby, vay);
        let dz = f64x2_sub(vbz, vaz);
        let r2 = f64x2_add(
            f64x2_add(f64x2_mul(dx, dx), f64x2_mul(dy, dy)),
            f64x2_mul(dz, dz),
        );

        let min_r2 = f64x2_splat(0.01);
        let r2_valid = f64x2_ge(r2, min_r2);
        let r2_safe = v128_bitselect(r2, f64x2_splat(1.0), r2_valid);
        let r = f64x2_sqrt(r2_safe);
        let r3 = f64x2_mul(r, r2_safe);

        let neg_k = f64x2_splat(-crate::COULOMB_K);
        let f_c = f64x2_div(f64x2_mul(f64x2_mul(neg_k, vaq), vbq), r3);

        let sigma = f64x2_mul(f64x2_splat(0.5), f64x2_add(vasig, vbsig));
        let eps_sq = f64x2_mul(vaeps, vbeps);
        let eps_valid = f64x2_ge(eps_sq, f64x2_splat(1e-20));
        let eps_sq_safe = v128_bitselect(eps_sq, f64x2_splat(1.0), eps_valid);
        let eps = f64x2_sqrt(eps_sq_safe);
        let s2 = f64x2_div(f64x2_mul(sigma, sigma), r2_safe);
        let s6 = f64x2_mul(f64x2_mul(s2, s2), s2);
        let s12 = f64x2_mul(s6, s6);
        let twelve_s12 = f64x2_mul(f64x2_splat(12.0), s12);
        let six_s6 = f64x2_mul(f64x2_splat(6.0), s6);
        let f_lj_raw = f64x2_div(
            f64x2_mul(f64x2_mul(f64x2_splat(-4.0), eps), f64x2_sub(twelve_s12, six_s6)),
            r2_safe,
        );
        let f_lj = v128_bitselect(f_lj_raw, f64x2_splat(0.0), eps_valid);

        let f_scale_raw = f64x2_add(f_c, f_lj);
        let f_scale = v128_bitselect(f_scale_raw, f64x2_splat(0.0), r2_valid);

        let fx = f64x2_mul(f_scale, dx);
        let fy = f64x2_mul(f_scale, dy);
        let fz = f64x2_mul(f_scale, dz);
        (
            (f64x2_extract_lane::<0>(fx), f64x2_extract_lane::<0>(fy), f64x2_extract_lane::<0>(fz)),
            (f64x2_extract_lane::<1>(fx), f64x2_extract_lane::<1>(fy), f64x2_extract_lane::<1>(fz)),
        )
    }
}

/// SIMD (wasm f64x2) version of the fused Coulomb+LJ kernel that evaluates
/// two atom-atom pairs per instruction. Returns (fx, fy, fz) for both pairs
/// as ((fx0, fy0, fz0), (fx1, fy1, fz1)).
///
/// The atom-atom inner loop in `compute_pair_force` is the hottest path in
/// water-water simulations (9 calls per pair), so doing two at a time with
/// 128-bit SIMD gives the loop ~1.8x throughput. Lanes where r^2 < 0.01 or
/// epsilon == 0 are masked to zero so single-atom ions (no LJ) work through
/// the same kernel without a branch inside the hot loop.
#[cfg(target_feature = "simd128")]
#[inline(always)]
#[allow(clippy::too_many_arguments)]
pub fn coulomb_lj_force_raw_x2(
    ax: (f64, f64), ay: (f64, f64), az: (f64, f64),
    aq: (f64, f64), aeps: (f64, f64), asig: (f64, f64),
    bx: (f64, f64), by: (f64, f64), bz: (f64, f64),
    bq: (f64, f64), beps: (f64, f64), bsig: (f64, f64),
) -> ((f64, f64, f64), (f64, f64, f64)) {
    use std::arch::wasm32::*;
    {
        let vax = f64x2(ax.0, ax.1);
        let vay = f64x2(ay.0, ay.1);
        let vaz = f64x2(az.0, az.1);
        let vaq = f64x2(aq.0, aq.1);
        let vaeps = f64x2(aeps.0, aeps.1);
        let vasig = f64x2(asig.0, asig.1);
        let vbx = f64x2(bx.0, bx.1);
        let vby = f64x2(by.0, by.1);
        let vbz = f64x2(bz.0, bz.1);
        let vbq = f64x2(bq.0, bq.1);
        let vbeps = f64x2(beps.0, beps.1);
        let vbsig = f64x2(bsig.0, bsig.1);

        let dx = f64x2_sub(vbx, vax);
        let dy = f64x2_sub(vby, vay);
        let dz = f64x2_sub(vbz, vaz);
        let r2 = f64x2_add(
            f64x2_add(f64x2_mul(dx, dx), f64x2_mul(dy, dy)),
            f64x2_mul(dz, dz),
        );

        // Lanes with r^2 < 0.01 are singular; swap in a safe r^2 to keep the
        // division path well-defined, then mask results to zero at the end.
        let min_r2 = f64x2_splat(0.01);
        let r2_valid = f64x2_ge(r2, min_r2);
        let r2_safe = v128_bitselect(r2, f64x2_splat(1.0), r2_valid);
        let r = f64x2_sqrt(r2_safe);
        let r3 = f64x2_mul(r, r2_safe);

        // Coulomb: -K * qa * qb / r^3
        let neg_k = f64x2_splat(-crate::COULOMB_K);
        let f_c = f64x2_div(f64x2_mul(f64x2_mul(neg_k, vaq), vbq), r3);

        // LJ: -4 * eps * (12 * s12 - 6 * s6) / r^2, skipping zero-epsilon.
        let sigma = f64x2_mul(f64x2_splat(0.5), f64x2_add(vasig, vbsig));
        let eps_sq = f64x2_mul(vaeps, vbeps);
        let eps_valid = f64x2_ge(eps_sq, f64x2_splat(1e-20));
        let eps_sq_safe = v128_bitselect(eps_sq, f64x2_splat(1.0), eps_valid);
        let eps = f64x2_sqrt(eps_sq_safe);
        let s2 = f64x2_div(f64x2_mul(sigma, sigma), r2_safe);
        let s6 = f64x2_mul(f64x2_mul(s2, s2), s2);
        let s12 = f64x2_mul(s6, s6);
        let twelve_s12 = f64x2_mul(f64x2_splat(12.0), s12);
        let six_s6 = f64x2_mul(f64x2_splat(6.0), s6);
        let f_lj_raw = f64x2_div(
            f64x2_mul(f64x2_mul(f64x2_splat(-4.0), eps), f64x2_sub(twelve_s12, six_s6)),
            r2_safe,
        );
        let f_lj = v128_bitselect(f_lj_raw, f64x2_splat(0.0), eps_valid);

        // Sum, then zero lanes that were below the r^2 cutoff.
        let f_scale_raw = f64x2_add(f_c, f_lj);
        let f_scale = v128_bitselect(f_scale_raw, f64x2_splat(0.0), r2_valid);

        let fx = f64x2_mul(f_scale, dx);
        let fy = f64x2_mul(f_scale, dy);
        let fz = f64x2_mul(f_scale, dz);
        (
            (f64x2_extract_lane::<0>(fx), f64x2_extract_lane::<0>(fy), f64x2_extract_lane::<0>(fz)),
            (f64x2_extract_lane::<1>(fx), f64x2_extract_lane::<1>(fy), f64x2_extract_lane::<1>(fz)),
        )
    }
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
