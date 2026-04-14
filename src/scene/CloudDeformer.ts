import { MoleculeRenderer } from './MoleculeRenderer';
import { DEFORMATION_SCALE, ANGSTROM_TO_SCENE } from '../utils/constants';
import type { SimulationSystem } from '../wasm-pkg/chemsim_physics';

/**
 * Manages cloud deformation for molecules in the scene.
 * Bridges the WASM physics engine's deformation calculation
 * with Three.js mesh updates.
 */
export class CloudDeformer {
  private physics: SimulationSystem;

  constructor(physics: SimulationSystem) {
    this.physics = physics;
  }

  /**
   * Compute and apply deformation to a molecule's cloud due to another molecule.
   * Includes distance-based modulation so deformation is visible at medium range
   * but doesn't create artifacts at very close range.
   */
  public deformCloud(
    renderer: MoleculeRenderer,
    targetMolIdx: number,
    sourceMolIdx: number,
  ): void {
    const data = renderer.getData();
    if (!data.cloud_mesh || !data.cloud_mesh.vertices.length) return;

    // Get distance between molecule centers to modulate deformation.
    // Use the physics engine's interaction result for accurate distance.
    const targetPos = this.physics.get_molecule_position(targetMolIdx);
    const sourcePos = this.physics.get_molecule_position(sourceMolIdx);
    const dx = sourcePos[0] - targetPos[0];
    const dy = sourcePos[1] - targetPos[1];
    const dz = sourcePos[2] - targetPos[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Distance-based modulation:
    // - Beyond 10 Angstroms: no deformation (too far to matter visually)
    // - 4-10 Angstroms: ramp up (pedagogically useful range)
    // - 2.5-4 Angstroms: full deformation
    // - Below 2.5 Angstroms: reduce to prevent spiky artifacts
    let distanceFactor: number;
    if (distance > 10) {
      renderer.resetCloudDeformation();
      return;
    } else if (distance > 4) {
      distanceFactor = (10 - distance) / 6;
    } else if (distance > 2.5) {
      distanceFactor = 1.0;
    } else {
      distanceFactor = distance / 2.5;
    }

    const effectiveScale = DEFORMATION_SCALE * distanceFactor;
    if (effectiveScale < 0.01) {
      renderer.resetCloudDeformation();
      return;
    }

    // Compute the world-space offset for the cloud vertices.
    // The cloud vertices in the JSON share the same local coordinate frame as the atoms.
    // The physics engine stores atoms at (local + offset), where offset was passed to
    // addMoleculeToPhysics. The physics center = mean(atom_local) + offset.
    // So: offset = physics_center - mean(atom_local).
    // The cloud vertices in world space = cloud_local + offset.
    const localCenter = data.atoms.reduce(
      (acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y, z: acc.z + a.z }),
      { x: 0, y: 0, z: 0 },
    );
    const n = data.atoms.length;
    localCenter.x /= n;
    localCenter.y /= n;
    localCenter.z /= n;

    const offsetX = targetPos[0] - localCenter.x;
    const offsetY = targetPos[1] - localCenter.y;
    const offsetZ = targetPos[2] - localCenter.z;

    // Transform cloud vertices to world space
    const flatVerts: number[] = [];
    for (const v of data.cloud_mesh.vertices) {
      flatVerts.push(v[0] + offsetX, v[1] + offsetY, v[2] + offsetZ);
    }

    // Compute deformation via WASM physics engine
    const deformations = this.physics.compute_deformation(
      targetMolIdx,
      sourceMolIdx,
      flatVerts,
      data.cloud_mesh.potentials,
      effectiveScale,
    );

    renderer.applyCloudDeformation(deformations);
  }

  /**
   * Reset cloud deformation
   */
  public resetDeformation(renderer: MoleculeRenderer): void {
    renderer.resetCloudDeformation();
  }
}
