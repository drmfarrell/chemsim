import * as THREE from 'three';
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

    // Transform cloud vertices to world coordinates for WASM field calc.
    // Cloud vertices are in Angstroms relative to the molecule's center.
    // The group's position represents the molecule's world position, and its
    // quaternion represents the molecule's orientation.
    const group = renderer.getGroup();
    const groupPos = group.position.clone();
    const groupQuat = group.quaternion.clone();

    // Transform each local vertex to world coordinates:
    // world_pos = group_pos + quat * local_vertex * quat^(-1)
    const tmp = new THREE.Vector3();
    const flatVerts: number[] = [];
    for (const v of data.cloud_mesh.vertices) {
      // Rotate local vertex by group quaternion, then add group position
      tmp.set(v[0], v[1], v[2]).applyQuaternion(groupQuat).add(groupPos);
      flatVerts.push(tmp.x, tmp.y, tmp.z);
    }

    // Compute deformation via WASM (returns world-frame displacement vectors)
    const deformations = this.physics.compute_deformation(
      targetMolIdx,
      sourceMolIdx,
      flatVerts,
      data.cloud_mesh.potentials,
      effectiveScale,
    );

    // Rotate world-frame displacements back to local frame for Three.js
    // For a displacement vector d (a direction, not a point), the inverse rotation is:
    // local_d = quat^(-1) * world_d
    const invRot = groupQuat.clone().invert();
    const n = deformations.length / 3;
    const localDeform = new Array<number>(deformations.length);
    for (let i = 0; i < n; i++) {
      tmp.set(deformations[i * 3], deformations[i * 3 + 1], deformations[i * 3 + 2])
         .applyQuaternion(invRot);
      localDeform[i * 3] = tmp.x;
      localDeform[i * 3 + 1] = tmp.y;
      localDeform[i * 3 + 2] = tmp.z;
    }

    renderer.applyCloudDeformation(localDeform);
  }

  /**
   * Reset cloud deformation
   */
  public resetDeformation(renderer: MoleculeRenderer): void {
    renderer.resetCloudDeformation();
  }
}
