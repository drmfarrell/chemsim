import * as THREE from 'three';
import { MoleculeData, AtomData } from '../utils/loader';
import {
  ELEMENT_COLORS, BALL_RADIUS_SCALE, STICK_RADIUS,
  CLOUD_OPACITY, VDW_RADII,
  ESP_COLOR_NEGATIVE, ESP_COLOR_NEUTRAL, ESP_COLOR_POSITIVE,
  ANGSTROM_TO_SCENE,
} from '../utils/constants';

export type ViewMode = 'ball-stick' | 'space-fill' | 'cloud-only';

export class MoleculeRenderer {
  private group: THREE.Group;
  private atomMeshes: THREE.Mesh[] = [];
  private bondMeshes: THREE.Mesh[] = [];
  private cloudMesh: THREE.Mesh | null = null;
  private cloudGeometry: THREE.BufferGeometry | null = null;
  private baseCloudPositions: Float32Array | null = null; // undeformed positions
  private adjacency: Map<number, Set<number>> | null = null; // vertex adjacency for smoothing
  private data: MoleculeData;
  private viewMode: ViewMode = 'ball-stick';
  private cloudVisible = true;
  private _disposed = false;

  // Shared geometries and materials (static, created once)
  private static sphereGeo: THREE.SphereGeometry | null = null;
  private static cylinderGeo: THREE.CylinderGeometry | null = null;

  constructor(data: MoleculeData) {
    this.data = data;
    this.group = new THREE.Group();
    this.group.name = `molecule-${data.name}`;

    if (!MoleculeRenderer.sphereGeo) {
      MoleculeRenderer.sphereGeo = new THREE.SphereGeometry(1, 16, 12);
      MoleculeRenderer.cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    }

    this.buildAtoms();
    this.buildBonds();
    this.buildCloud();
  }

  private buildAtoms(): void {
    for (const atom of this.data.atoms) {
      const color = ELEMENT_COLORS[atom.element] ?? 0xff00ff;
      const material = new THREE.MeshPhongMaterial({
        color,
        shininess: 80,
        specular: 0x444444,
      });

      const mesh = new THREE.Mesh(MoleculeRenderer.sphereGeo!, material);
      const radius = BALL_RADIUS_SCALE * (VDW_RADII[atom.element] ?? 1.5) * ANGSTROM_TO_SCENE;
      mesh.scale.setScalar(radius);
      mesh.position.set(
        atom.x * ANGSTROM_TO_SCENE,
        atom.y * ANGSTROM_TO_SCENE,
        atom.z * ANGSTROM_TO_SCENE,
      );
      mesh.userData = { atom, type: 'atom' };

      this.atomMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private buildBonds(): void {
    for (const bond of this.data.bonds) {
      const a1 = this.data.atoms[bond.from];
      const a2 = this.data.atoms[bond.to];

      const start = new THREE.Vector3(
        a1.x * ANGSTROM_TO_SCENE,
        a1.y * ANGSTROM_TO_SCENE,
        a1.z * ANGSTROM_TO_SCENE,
      );
      const end = new THREE.Vector3(
        a2.x * ANGSTROM_TO_SCENE,
        a2.y * ANGSTROM_TO_SCENE,
        a2.z * ANGSTROM_TO_SCENE,
      );

      const mid = start.clone().add(end).multiplyScalar(0.5);
      const direction = end.clone().sub(start);
      const length = direction.length();

      const material = new THREE.MeshPhongMaterial({
        color: 0x888888,
        shininess: 40,
      });

      const mesh = new THREE.Mesh(MoleculeRenderer.cylinderGeo!, material);
      mesh.scale.set(
        STICK_RADIUS * ANGSTROM_TO_SCENE,
        length,
        STICK_RADIUS * ANGSTROM_TO_SCENE,
      );
      mesh.position.copy(mid);

      // Orient cylinder along the bond direction
      const axis = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(axis, direction.normalize());
      mesh.quaternion.copy(quat);

      this.bondMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private buildCloud(): void {
    const cloudData = this.data.cloud_mesh;
    if (!cloudData || !cloudData.vertices.length) return;

    const geometry = new THREE.BufferGeometry();

    // Vertices
    const positions = new Float32Array(cloudData.vertices.length * 3);
    for (let i = 0; i < cloudData.vertices.length; i++) {
      positions[i * 3] = cloudData.vertices[i][0] * ANGSTROM_TO_SCENE;
      positions[i * 3 + 1] = cloudData.vertices[i][1] * ANGSTROM_TO_SCENE;
      positions[i * 3 + 2] = cloudData.vertices[i][2] * ANGSTROM_TO_SCENE;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Save base positions for deformation
    this.baseCloudPositions = new Float32Array(positions);

    // Colors from potentials
    const colors = new Float32Array(cloudData.vertices.length * 3);
    this.updateCloudColors(colors, cloudData.potentials);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Faces + build adjacency for smoothing
    this.adjacency = new Map();
    if (cloudData.faces.length > 0) {
      const indices: number[] = [];
      for (const face of cloudData.faces) {
        indices.push(face[0], face[1], face[2]);
        // Build adjacency
        for (const v of face) {
          if (!this.adjacency.has(v)) this.adjacency.set(v, new Set());
        }
        this.adjacency.get(face[0])!.add(face[1]).add(face[2]);
        this.adjacency.get(face[1])!.add(face[0]).add(face[2]);
        this.adjacency.get(face[2])!.add(face[0]).add(face[1]);
      }
      geometry.setIndex(indices);
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      opacity: CLOUD_OPACITY,
      side: THREE.DoubleSide,
      shininess: 30,
      depthWrite: false,
    });

    this.cloudMesh = new THREE.Mesh(geometry, material);
    this.cloudGeometry = geometry;
    this.group.add(this.cloudMesh);
  }

  private updateCloudColors(colors: Float32Array, potentials: number[]): void {
    // Map potential to color: red (negative) -> white (neutral) -> blue (positive)
    // Find the range for normalization
    let maxAbs = 0;
    for (const p of potentials) {
      const abs = Math.abs(p);
      if (abs > maxAbs) maxAbs = abs;
    }
    if (maxAbs < 1) maxAbs = 1; // avoid division by zero

    for (let i = 0; i < potentials.length; i++) {
      const normalized = potentials[i] / maxAbs; // [-1, 1]
      const clamped = Math.max(-1, Math.min(1, normalized));

      let r: number, g: number, b: number;
      if (clamped < 0) {
        // Negative (electron-rich): interpolate red -> white
        const t = -clamped; // 0 to 1
        r = ESP_COLOR_NEUTRAL.r + t * (ESP_COLOR_NEGATIVE.r - ESP_COLOR_NEUTRAL.r);
        g = ESP_COLOR_NEUTRAL.g + t * (ESP_COLOR_NEGATIVE.g - ESP_COLOR_NEUTRAL.g);
        b = ESP_COLOR_NEUTRAL.b + t * (ESP_COLOR_NEGATIVE.b - ESP_COLOR_NEUTRAL.b);
      } else {
        // Positive (electron-poor): interpolate white -> blue
        const t = clamped; // 0 to 1
        r = ESP_COLOR_NEUTRAL.r + t * (ESP_COLOR_POSITIVE.r - ESP_COLOR_NEUTRAL.r);
        g = ESP_COLOR_NEUTRAL.g + t * (ESP_COLOR_POSITIVE.g - ESP_COLOR_NEUTRAL.g);
        b = ESP_COLOR_NEUTRAL.b + t * (ESP_COLOR_POSITIVE.b - ESP_COLOR_NEUTRAL.b);
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
  }

  /**
   * Apply deformation vectors to the cloud mesh vertices.
   * Includes Laplacian smoothing to prevent jagged artifacts.
   * deformations: flat array [dx0,dy0,dz0, dx1,dy1,dz1, ...] in Angstroms
   */
  public applyCloudDeformation(deformations: Float64Array | number[]): void {
    if (!this.cloudGeometry || !this.baseCloudPositions) return;

    const nVerts = this.baseCloudPositions.length / 3;

    // Copy raw deformations into a working array
    const raw = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts * 3; i++) {
      raw[i] = i < deformations.length ? deformations[i] * ANGSTROM_TO_SCENE : 0;
    }

    // Laplacian smooth the deformation field (2 passes) to eliminate spikes.
    // Each vertex's displacement is averaged with its mesh neighbors.
    const smoothed = new Float32Array(raw);
    if (this.adjacency) {
      for (let pass = 0; pass < 2; pass++) {
        const src = pass === 0 ? raw : smoothed;
        const dst = smoothed;
        for (let v = 0; v < nVerts; v++) {
          const neighbors = this.adjacency.get(v);
          if (!neighbors || neighbors.size === 0) continue;
          // Blend: 50% self + 50% average of neighbors
          let nx = 0, ny = 0, nz = 0;
          for (const nb of neighbors) {
            nx += src[nb * 3];
            ny += src[nb * 3 + 1];
            nz += src[nb * 3 + 2];
          }
          const nc = neighbors.size;
          dst[v * 3]     = src[v * 3]     * 0.5 + (nx / nc) * 0.5;
          dst[v * 3 + 1] = src[v * 3 + 1] * 0.5 + (ny / nc) * 0.5;
          dst[v * 3 + 2] = src[v * 3 + 2] * 0.5 + (nz / nc) * 0.5;
        }
      }
    }

    // Apply smoothed deformations to base positions
    const positions = this.cloudGeometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    for (let i = 0; i < nVerts * 3; i++) {
      arr[i] = this.baseCloudPositions[i] + smoothed[i];
    }

    positions.needsUpdate = true;
    this.cloudGeometry.computeVertexNormals();
  }

  /** Reset cloud to undeformed state */
  public resetCloudDeformation(): void {
    if (!this.cloudGeometry || !this.baseCloudPositions) return;

    const positions = this.cloudGeometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    arr.set(this.baseCloudPositions);
    positions.needsUpdate = true;
    this.cloudGeometry.computeVertexNormals();
  }

  public setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.updateVisibility();
  }

  public setCloudVisible(visible: boolean): void {
    this.cloudVisible = visible;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const showAtoms = this.viewMode !== 'cloud-only';
    const showBonds = this.viewMode === 'ball-stick';
    const showCloud = this.cloudVisible && this.viewMode !== 'space-fill';

    for (const mesh of this.atomMeshes) {
      mesh.visible = showAtoms;
      // Space-fill mode: use larger radius
      if (this.viewMode === 'space-fill') {
        const atom = mesh.userData.atom as AtomData;
        const radius = (VDW_RADII[atom.element] ?? 1.5) * ANGSTROM_TO_SCENE;
        mesh.scale.setScalar(radius);
      } else {
        const atom = mesh.userData.atom as AtomData;
        const radius = BALL_RADIUS_SCALE * (VDW_RADII[atom.element] ?? 1.5) * ANGSTROM_TO_SCENE;
        mesh.scale.setScalar(radius);
      }
    }

    for (const mesh of this.bondMeshes) {
      mesh.visible = showBonds;
    }

    if (this.cloudMesh) {
      this.cloudMesh.visible = showCloud;
    }
  }

  /** Set position of the entire molecule group */
  public setPosition(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
  }

  /** Get the Three.js group for this molecule */
  public getGroup(): THREE.Group {
    return this.group;
  }

  /** Get molecule data */
  public getData(): MoleculeData {
    return this.data;
  }

  /** Update atom positions from physics engine (flat array [x0,y0,z0,...]) */
  public updateAtomPositions(positions: number[]): void {
    for (let i = 0; i < this.atomMeshes.length && i * 3 + 2 < positions.length; i++) {
      this.atomMeshes[i].position.set(
        positions[i * 3] * ANGSTROM_TO_SCENE,
        positions[i * 3 + 1] * ANGSTROM_TO_SCENE,
        positions[i * 3 + 2] * ANGSTROM_TO_SCENE,
      );
    }

    // Update bond positions to match moved atoms
    this.rebuildBondPositions();
  }

  private rebuildBondPositions(): void {
    for (let bi = 0; bi < this.data.bonds.length && bi < this.bondMeshes.length; bi++) {
      const bond = this.data.bonds[bi];
      const startMesh = this.atomMeshes[bond.from];
      const endMesh = this.atomMeshes[bond.to];
      if (!startMesh || !endMesh) continue;

      const start = startMesh.position;
      const end = endMesh.position;
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const direction = end.clone().sub(start);
      const length = direction.length();

      const mesh = this.bondMeshes[bi];
      mesh.position.copy(mid);
      mesh.scale.set(
        STICK_RADIUS * ANGSTROM_TO_SCENE,
        length,
        STICK_RADIUS * ANGSTROM_TO_SCENE,
      );

      const axis = new THREE.Vector3(0, 1, 0);
      if (length > 0.001) {
        const quat = new THREE.Quaternion().setFromUnitVectors(axis, direction.normalize());
        mesh.quaternion.copy(quat);
      }
    }
  }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    for (const mesh of this.atomMeshes) {
      (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of this.bondMeshes) {
      (mesh.material as THREE.Material).dispose();
    }
    if (this.cloudMesh) {
      (this.cloudMesh.material as THREE.Material).dispose();
      this.cloudGeometry?.dispose();
    }

    this.group.removeFromParent();
  }
}
