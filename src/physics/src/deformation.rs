use crate::Atom;
use crate::coulomb::electric_field_at;

/// Compute cloud vertex deformations due to the presence of another molecule's atoms.
///
/// For each vertex on molecule A's cloud:
/// 1. Compute the electric field E at the vertex position due to molecule B's atoms
/// 2. Displace the vertex proportionally to E, scaled by polarizability
/// 3. Electron-rich vertices (negative potential) are displaced toward positive field regions
/// 4. Electron-poor vertices (positive potential) are displaced away from positive field regions
///
/// Returns: Vec of (dx, dy, dz) displacement for each vertex
pub fn compute_cloud_deformation(
    cloud_vertices: &[(f64, f64, f64)],
    cloud_potentials: &[f64],
    other_atoms: &[Atom],
    polarizability: f64,
    deformation_scale: f64,
) -> Vec<(f64, f64, f64)> {
    let mut displacements = Vec::with_capacity(cloud_vertices.len());

    for (i, &(vx, vy, vz)) in cloud_vertices.iter().enumerate() {
        let (ex, ey, ez) = electric_field_at(vx, vy, vz, other_atoms);

        // The local potential at this vertex determines how it responds to the field.
        // Negative potential (electron-rich) vertices: displaced in the field direction
        //   (electrons are attracted toward positive regions)
        // Positive potential (electron-poor) vertices: displaced against the field direction
        //   (positive regions are repelled from positive fields)
        let potential = if i < cloud_potentials.len() {
            cloud_potentials[i]
        } else {
            0.0
        };

        // Normalize potential to [-1, 1] range for scaling
        // Typical ESP values range from about -50 to +50 kJ/mol
        let norm_potential = (potential / 50.0).clamp(-1.0, 1.0);

        // Electrons move opposite to E field. Electron-rich vertices (negative potential)
        // should move opposite to E (toward positive charges). Electron-poor vertices
        // (positive potential) should move with E (away from positive charges).
        // So response_factor = norm_potential: negative for electron-rich, positive for electron-poor.
        let response_factor = norm_potential;

        let scale = polarizability * deformation_scale * response_factor;

        // Clamp displacement magnitude to prevent extreme deformation
        let mag = (ex * ex + ey * ey + ez * ez).sqrt();
        let max_displacement = 1.5; // Angstroms (generous for visual clarity)
        let effective_scale = if mag * scale.abs() > max_displacement && mag > 1e-10 {
            max_displacement / mag * scale.signum()
        } else {
            scale
        };

        displacements.push((
            ex * effective_scale,
            ey * effective_scale,
            ez * effective_scale,
        ));
    }

    displacements
}

/// Batch version: compute deformations for all cloud vertices at once,
/// returning a flat f64 array for efficient transfer to JS
/// Layout: [dx0, dy0, dz0, dx1, dy1, dz1, ...]
pub fn compute_cloud_deformation_flat(
    cloud_vertices_flat: &[f64],   // [x0,y0,z0, x1,y1,z1, ...]
    cloud_potentials: &[f64],
    other_atoms: &[Atom],
    polarizability: f64,
    deformation_scale: f64,
) -> Vec<f64> {
    let n_verts = cloud_vertices_flat.len() / 3;
    let mut result = vec![0.0; n_verts * 3];

    for i in 0..n_verts {
        let vx = cloud_vertices_flat[i * 3];
        let vy = cloud_vertices_flat[i * 3 + 1];
        let vz = cloud_vertices_flat[i * 3 + 2];

        let (ex, ey, ez) = electric_field_at(vx, vy, vz, other_atoms);

        let potential = if i < cloud_potentials.len() {
            cloud_potentials[i]
        } else {
            0.0
        };

        let norm_potential = (potential / 50.0).clamp(-1.0, 1.0);
        let response_factor = norm_potential;
        let scale = polarizability * deformation_scale * response_factor;

        let mag = (ex * ex + ey * ey + ez * ez).sqrt();
        let max_displacement = 0.4;  // Balance between smoothness and visibility
        let effective_scale = if mag * scale.abs() > max_displacement && mag > 1e-10 {
            max_displacement / mag * scale.signum()
        } else {
            scale
        };

        result[i * 3] = ex * effective_scale;
        result[i * 3 + 1] = ey * effective_scale;
        result[i * 3 + 2] = ez * effective_scale;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deformation_toward_positive_charge() {
        // A positive charge to the right (+x) of a cloud vertex
        // Electron-rich vertex (negative potential) should be displaced toward it
        let other_atoms = vec![Atom {
            x: 5.0, y: 0.0, z: 0.0,
            charge: 1.0,
            epsilon: 0.0, sigma: 0.0, mass: 1.0,
            element: "X".into(),
        }];

        let vertices = vec![(0.0, 0.0, 0.0)];
        let potentials = vec![-30.0]; // electron-rich

        let displacements = compute_cloud_deformation(
            &vertices, &potentials, &other_atoms, 1.0, 0.15,
        );

        // Electron-rich vertex should move toward positive charge (positive x)
        assert!(displacements[0].0 > 0.0,
            "Electron-rich vertex should move toward positive charge: dx={}", displacements[0].0);
    }

    #[test]
    fn test_deformation_away_from_positive_charge() {
        // Electron-poor vertex (positive potential) should move away from positive charge
        let other_atoms = vec![Atom {
            x: 5.0, y: 0.0, z: 0.0,
            charge: 1.0,
            epsilon: 0.0, sigma: 0.0, mass: 1.0,
            element: "X".into(),
        }];

        let vertices = vec![(0.0, 0.0, 0.0)];
        let potentials = vec![30.0]; // electron-poor

        let displacements = compute_cloud_deformation(
            &vertices, &potentials, &other_atoms, 1.0, 0.15,
        );

        // Electron-poor vertex should move away from positive charge (negative x)
        assert!(displacements[0].0 < 0.0,
            "Electron-poor vertex should move away from positive charge: dx={}", displacements[0].0);
    }

    #[test]
    fn test_deformation_magnitude_clamped() {
        // Very close charge should not produce extreme deformation
        let other_atoms = vec![Atom {
            x: 0.5, y: 0.0, z: 0.0,
            charge: 1.0,
            epsilon: 0.0, sigma: 0.0, mass: 1.0,
            element: "X".into(),
        }];

        let vertices = vec![(0.0, 0.0, 0.0)];
        let potentials = vec![-50.0];

        let displacements = compute_cloud_deformation(
            &vertices, &potentials, &other_atoms, 1.0, 0.15,
        );

        let mag = (displacements[0].0.powi(2) + displacements[0].1.powi(2) + displacements[0].2.powi(2)).sqrt();
        assert!(mag <= 1.51, "Deformation should be clamped: mag={}", mag);
    }
}
