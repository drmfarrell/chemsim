use crate::Molecule;

/// Rotate a vector by a unit quaternion (w, x, y, z).
/// Uses v' = q * v * q_conj formula expanded for efficiency.
pub fn rotate_by_quat(q: (f64, f64, f64, f64), v: (f64, f64, f64)) -> (f64, f64, f64) {
    let (qw, qx, qy, qz) = q;
    let (vx, vy, vz) = v;

    // t = 2 * (q_vec x v)
    let tx = 2.0 * (qy * vz - qz * vy);
    let ty = 2.0 * (qz * vx - qx * vz);
    let tz = 2.0 * (qx * vy - qy * vx);

    // v' = v + qw * t + q_vec x t
    (
        vx + qw * tx + qy * tz - qz * ty,
        vy + qw * ty + qz * tx - qx * tz,
        vz + qw * tz + qx * ty - qy * tx,
    )
}

/// Inverse rotation (rotate a world-frame vector into the body frame) by a unit quaternion.
pub fn rotate_by_quat_inv(q: (f64, f64, f64, f64), v: (f64, f64, f64)) -> (f64, f64, f64) {
    let (qw, qx, qy, qz) = q;
    rotate_by_quat((qw, -qx, -qy, -qz), v)
}

/// Quaternion multiplication (Hamilton product). Both inputs are (w, x, y, z).
pub fn quat_mul(
    a: (f64, f64, f64, f64),
    b: (f64, f64, f64, f64),
) -> (f64, f64, f64, f64) {
    let (aw, ax, ay, az) = a;
    let (bw, bx, by, bz) = b;
    (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )
}

/// Normalize a quaternion to unit length in place.
pub fn quat_normalize(q: &mut (f64, f64, f64, f64)) {
    let mag = (q.0 * q.0 + q.1 * q.1 + q.2 * q.2 + q.3 * q.3).sqrt();
    if mag > 1e-12 {
        q.0 /= mag;
        q.1 /= mag;
        q.2 /= mag;
        q.3 /= mag;
    } else {
        *q = (1.0, 0.0, 0.0, 0.0);
    }
}

/// Rebuild the world-frame atom positions of a molecule from its body_coords,
/// current center, and current orientation quaternion.
pub fn update_atom_positions(mol: &mut Molecule) {
    for (atom, &body) in mol.atoms.iter_mut().zip(mol.body_coords.iter()) {
        let (wx, wy, wz) = rotate_by_quat(mol.q, body);
        atom.x = mol.center_x + wx;
        atom.y = mol.center_y + wy;
        atom.z = mol.center_z + wz;
    }
    // Keep the SoA position cache (used by the SIMD force kernel) in sync.
    mol.sync_positions_only();
}

/// Integrate angular motion for one timestep using semi-implicit Euler on the
/// Euler equations in the body frame, then update the orientation quaternion.
///
/// Inputs: torque per molecule in the world frame, units kJ/(mol * rad) which
/// for our purposes is the same as kJ/mol (since torque = r x F with r in Å
/// and F in kJ/(mol*Å)).
/// The conversion factor from kJ/(mol*amu*Å^2) to rad/ps^2 is 0.01, matching
/// the translational conversion (1 amu * (Å/ps)^2 = 0.01 kJ/mol).
pub fn integrate_rotation(
    molecules: &mut [Molecule],
    torques_world: &[(f64, f64, f64)],
    dt: f64,
) {
    const CONV: f64 = 0.01; // kJ/(mol*amu*Å^2) -> rad/ps^2

    for (i, mol) in molecules.iter_mut().enumerate() {
        if mol.body_coords.is_empty() { continue; }

        // Transform torque from world frame into body frame.
        let tau_body = rotate_by_quat_inv(mol.q, torques_world[i]);

        // Euler's equations: I * dw/dt = tau - w x (I * w), all in body frame.
        let (ix, iy, iz) = mol.inertia;
        let (wx, wy, wz) = mol.omega_body;

        // I * w
        let iwx = ix * wx;
        let iwy = iy * wy;
        let iwz = iz * wz;

        // w x (I * w)
        let gx = wy * iwz - wz * iwy;
        let gy = wz * iwx - wx * iwz;
        let gz = wx * iwy - wy * iwx;

        // Angular acceleration in body frame (rad/ps^2).
        let ax = (tau_body.0 - gx) * CONV / ix;
        let ay = (tau_body.1 - gy) * CONV / iy;
        let az = (tau_body.2 - gz) * CONV / iz;

        // Semi-implicit Euler: update omega first, then use the new omega for q.
        let new_wx = wx + ax * dt;
        let new_wy = wy + ay * dt;
        let new_wz = wz + az * dt;

        // q_dot = 0.5 * q * (0, omega_body). Integrate one step with the new omega.
        let (qw, qx, qy, qz) = mol.q;
        let dq_w = -0.5 * (qx * new_wx + qy * new_wy + qz * new_wz);
        let dq_x =  0.5 * (qw * new_wx + qy * new_wz - qz * new_wy);
        let dq_y =  0.5 * (qw * new_wy - qx * new_wz + qz * new_wx);
        let dq_z =  0.5 * (qw * new_wz + qx * new_wy - qy * new_wx);

        let mut new_q = (
            qw + dq_w * dt,
            qx + dq_x * dt,
            qy + dq_y * dt,
            qz + dq_z * dt,
        );
        quat_normalize(&mut new_q);

        mol.q = new_q;
        mol.omega_body = (new_wx, new_wy, new_wz);
    }

    // Rebuild world-frame atom positions from the updated orientation.
    for mol in molecules.iter_mut() {
        if !mol.body_coords.is_empty() {
            update_atom_positions(mol);
        }
    }
}

/// Sum of rotational kinetic energy across all molecules, in kJ/mol.
/// KE_rot = 0.5 * sum_i (I_i * omega_i^2), converted by factor 100 the same
/// way translational KE is converted.
pub fn rotational_kinetic_energy(molecules: &[Molecule]) -> f64 {
    let mut ke = 0.0;
    for mol in molecules {
        if mol.body_coords.is_empty() { continue; }
        let (ix, iy, iz) = mol.inertia;
        let (wx, wy, wz) = mol.omega_body;
        ke += 0.5 * (ix * wx * wx + iy * wy * wy + iz * wz * wz) * 100.0;
    }
    ke
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Atom;

    fn water_mol() -> Molecule {
        let atoms = vec![
            Atom { element: "O".into(), x: 0.0, y: 0.0, z: 0.1173, charge: -0.834, epsilon: 0.6502, sigma: 3.12, mass: 15.999 },
            Atom { element: "H".into(), x: 0.7572, y: 0.0, z: -0.4692, charge: 0.417, epsilon: 0.0657, sigma: 2.50, mass: 1.008 },
            Atom { element: "H".into(), x: -0.7572, y: 0.0, z: -0.4692, charge: 0.417, epsilon: 0.0657, sigma: 2.50, mass: 1.008 },
        ];
        let mut mol = Molecule {
            atoms,
            center_x: 0.0, center_y: 0.0, center_z: 0.0,
            vx: 0.0, vy: 0.0, vz: 0.0,
            polarizability: 1.45,
            body_coords: Vec::new(),
            q: (1.0, 0.0, 0.0, 0.0),
            omega_body: (0.0, 0.0, 0.0),
            inertia: (0.0, 0.0, 0.0),
        };
        mol.compute_center();
        mol.init_rigid_body();
        mol
    }

    #[test]
    fn test_identity_rotation_is_noop() {
        let v = (1.2, -0.4, 0.7);
        let r = rotate_by_quat((1.0, 0.0, 0.0, 0.0), v);
        assert!((r.0 - v.0).abs() < 1e-12);
        assert!((r.1 - v.1).abs() < 1e-12);
        assert!((r.2 - v.2).abs() < 1e-12);
    }

    #[test]
    fn test_180_rotation_about_z_flips_xy() {
        // q = (cos(pi/2), 0, 0, sin(pi/2)) = (0, 0, 0, 1)
        let q = (0.0, 0.0, 0.0, 1.0);
        let r = rotate_by_quat(q, (1.0, 2.0, 3.0));
        assert!((r.0 + 1.0).abs() < 1e-12);
        assert!((r.1 + 2.0).abs() < 1e-12);
        assert!((r.2 - 3.0).abs() < 1e-12);
    }

    #[test]
    fn test_inverse_rotation_undoes_rotation() {
        let q = (0.8, 0.3, -0.2, 0.5);
        let mut qn = q;
        quat_normalize(&mut qn);
        let v = (1.0, 2.0, 3.0);
        let r = rotate_by_quat(qn, v);
        let back = rotate_by_quat_inv(qn, r);
        assert!((back.0 - v.0).abs() < 1e-10);
        assert!((back.1 - v.1).abs() < 1e-10);
        assert!((back.2 - v.2).abs() < 1e-10);
    }

    #[test]
    fn test_init_rigid_body_gives_positive_inertia() {
        let mol = water_mol();
        assert!(mol.inertia.0 > 0.0);
        assert!(mol.inertia.1 > 0.0);
        assert!(mol.inertia.2 > 0.0);
        assert_eq!(mol.body_coords.len(), 3);
    }

    #[test]
    fn test_free_rotation_conserves_orientation_magnitude() {
        let mut mol = water_mol();
        mol.omega_body = (0.5, 0.0, 0.0); // spin around body x
        let mut mols = vec![mol];
        let zero_torque = vec![(0.0, 0.0, 0.0)];
        for _ in 0..1000 {
            integrate_rotation(&mut mols, &zero_torque, 0.001);
        }
        let qm = {
            let q = mols[0].q;
            (q.0 * q.0 + q.1 * q.1 + q.2 * q.2 + q.3 * q.3).sqrt()
        };
        assert!((qm - 1.0).abs() < 1e-6, "quat should stay unit: mag={}", qm);
    }

    #[test]
    fn test_torque_produces_rotation() {
        let mut mol = water_mol();
        assert_eq!(mol.omega_body, (0.0, 0.0, 0.0));
        let mut mols = vec![mol];
        // Apply a world-frame torque about z.
        let torque = vec![(0.0, 0.0, 10.0)];
        integrate_rotation(&mut mols, &torque, 0.01);
        let (wx, wy, wz) = mols[0].omega_body;
        // Should pick up angular velocity about z in body frame (q == identity).
        assert!(wz.abs() > 1e-6, "wz should have grown: got {}", wz);
        assert!(wx.abs() < 1e-6);
        assert!(wy.abs() < 1e-6);
    }

    #[test]
    fn test_atom_positions_follow_rotation() {
        let mut mol = water_mol();
        let h0_before = mol.atoms[1].x;
        // 180-degree rotation about z axis (body frame, q = (0,0,0,1))
        mol.q = (0.0, 0.0, 0.0, 1.0);
        update_atom_positions(&mut mol);
        let h0_after = mol.atoms[1].x;
        assert!((h0_after + h0_before).abs() < 1e-10,
            "H x should flip sign after 180 rot: before={}, after={}", h0_before, h0_after);
    }
}
