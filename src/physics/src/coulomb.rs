use crate::Atom;

/// Coulomb constant: 1389.35 kJ*Angstrom/(mol*e^2)
/// For charges in electron units and distances in Angstroms,
/// energy comes out in kJ/mol.
/// NOTE: 332.0637 is the value in kcal*Angstrom/(mol*e^2); converting to kJ
/// gives 332.0637 * 4.184 = 1389.35.
pub const COULOMB_K: f64 = 1389.35;

/// Compute the Coulomb potential energy between two atoms
/// E = k * q1 * q2 / r
pub fn coulomb_energy(a1: &Atom, a2: &Atom) -> f64 {
    let dx = a2.x - a1.x;
    let dy = a2.y - a1.y;
    let dz = a2.z - a1.z;
    let r2 = dx * dx + dy * dy + dz * dz;
    if r2 < 0.01 { return 0.0; } // avoid singularity
    let r = r2.sqrt();
    COULOMB_K * a1.charge * a2.charge / r
}

/// Compute Coulomb force on atom 1 due to atom 2
/// F = -dE/dr * r_hat = k * q1 * q2 / r^2 * r_hat
/// Returns (fx, fy, fz) -- force on a1 due to a2
pub fn coulomb_force(a1: &Atom, a2: &Atom) -> (f64, f64, f64) {
    coulomb_force_raw(a1.x, a1.y, a1.z, a1.charge, a2.x, a2.y, a2.z, a2.charge)
}

/// Raw-coordinate Coulomb force. Same math as `coulomb_force` but avoids
/// reading through `&Atom`, which matters in the parallel inner loop where
/// constructing image-shifted `Atom` values allocates a `String` per pair and
/// contends on the wasm allocator across rayon workers.
#[inline(always)]
pub fn coulomb_force_raw(
    ax: f64, ay: f64, az: f64, aq: f64,
    bx: f64, by: f64, bz: f64, bq: f64,
) -> (f64, f64, f64) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    let r2 = dx * dx + dy * dy + dz * dz;
    if r2 < 0.01 { return (0.0, 0.0, 0.0); }
    let r = r2.sqrt();
    let f_scale = -COULOMB_K * aq * bq / (r * r2);
    (f_scale * dx, f_scale * dy, f_scale * dz)
}

/// Compute the electrostatic field at point (px, py, pz) due to a set of atoms
/// E = sum_i ( k * q_i / r_i^2 ) * r_hat_i
/// Returns (Ex, Ey, Ez)
pub fn electric_field_at(px: f64, py: f64, pz: f64, atoms: &[Atom]) -> (f64, f64, f64) {
    let mut ex = 0.0;
    let mut ey = 0.0;
    let mut ez = 0.0;
    for atom in atoms {
        let dx = px - atom.x;
        let dy = py - atom.y;
        let dz = pz - atom.z;
        let r2 = dx * dx + dy * dy + dz * dz;
        if r2 < 0.01 { continue; }
        let r = r2.sqrt();
        // E = k * q / r^2 in the direction from charge to point
        let e_scale = COULOMB_K * atom.charge / (r * r2);
        ex += e_scale * dx;
        ey += e_scale * dy;
        ez += e_scale * dz;
    }
    (ex, ey, ez)
}

/// Compute the electrostatic potential at a point due to a set of atoms
/// V = sum_i ( k * q_i / r_i )
pub fn potential_at(px: f64, py: f64, pz: f64, atoms: &[Atom]) -> f64 {
    let mut v = 0.0;
    for atom in atoms {
        let dx = px - atom.x;
        let dy = py - atom.y;
        let dz = pz - atom.z;
        let r2 = dx * dx + dy * dy + dz * dz;
        if r2 < 0.01 { continue; }
        let r = r2.sqrt();
        v += COULOMB_K * atom.charge / r;
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coulomb_energy_opposite_charges() {
        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let a2 = Atom { x: 1.0, y: 0.0, z: 0.0, charge: -1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let e = coulomb_energy(&a1, &a2);
        assert!((e - (-COULOMB_K)).abs() < 0.01, "Energy should be -k for +1/-1 charges at 1 Angstrom: got {}", e);
    }

    #[test]
    fn test_coulomb_energy_like_charges() {
        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let a2 = Atom { x: 2.0, y: 0.0, z: 0.0, charge: 1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let e = coulomb_energy(&a1, &a2);
        assert!((e - COULOMB_K / 2.0).abs() < 0.01, "Energy should be k/2 for +1/+1 at 2 Angstroms: got {}", e);
    }

    #[test]
    fn test_coulomb_force_repulsive() {
        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let a2 = Atom { x: 1.0, y: 0.0, z: 0.0, charge: 1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let (fx, _fy, _fz) = coulomb_force(&a1, &a2);
        // Like charges: a1 should be pushed away from a2, so fx < 0
        assert!(fx < 0.0, "Force on a1 should point away from a2 for like charges: got fx={}", fx);
    }

    #[test]
    fn test_coulomb_force_attractive() {
        let a1 = Atom { x: 0.0, y: 0.0, z: 0.0, charge: 1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let a2 = Atom { x: 1.0, y: 0.0, z: 0.0, charge: -1.0, epsilon: 0.0, sigma: 0.0, mass: 1.0, element: "X".into() };
        let (fx, _fy, _fz) = coulomb_force(&a1, &a2);
        // Opposite charges: a1 should be attracted to a2, so fx > 0
        assert!(fx > 0.0, "Force on a1 should point toward a2 for opposite charges: got fx={}", fx);
    }
}
