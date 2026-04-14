import * as THREE from 'three';

export interface InteractionData {
  totalEnergy: number;
  coulombEnergy: number;
  ljEnergy: number;
  distance: number;
  forceX: number;
  forceY: number;
  forceZ: number;
}

/**
 * Displays interaction energy readouts and optional force arrows.
 */
export class InteractionVisualizer {
  private energyDisplay: HTMLElement | null;
  private energyTotal: HTMLElement | null;
  private distanceValue: HTMLElement | null;
  private coulombValue: HTMLElement | null;
  private ljValue: HTMLElement | null;
  private forceArrow: THREE.ArrowHelper | null = null;
  private scene: THREE.Scene;
  private showForces = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.energyDisplay = document.getElementById('energy-display');
    this.energyTotal = document.getElementById('energy-total');
    this.distanceValue = document.getElementById('distance-value');
    this.coulombValue = document.getElementById('coulomb-value');
    this.ljValue = document.getElementById('lj-value');
  }

  public update(data: InteractionData, moleculeAPos?: THREE.Vector3): void {
    // Update text displays
    if (this.energyTotal) {
      const val = data.totalEnergy;
      this.energyTotal.textContent = `${val.toFixed(2)} kJ/mol`;
      this.energyTotal.className = 'energy-value ' + (
        val < -1 ? 'attractive' : val > 1 ? 'repulsive' : 'neutral'
      );
    }

    if (this.distanceValue) {
      this.distanceValue.textContent = `${data.distance.toFixed(2)} \u00C5`;
    }

    if (this.coulombValue) {
      this.coulombValue.textContent = `${data.coulombEnergy.toFixed(2)} kJ/mol`;
    }

    if (this.ljValue) {
      this.ljValue.textContent = `${data.ljEnergy.toFixed(2)} kJ/mol`;
    }

    // Update force arrow
    if (this.showForces && moleculeAPos) {
      this.updateForceArrow(moleculeAPos, data);
    }
  }

  public setShowForces(show: boolean): void {
    this.showForces = show;
    if (!show && this.forceArrow) {
      this.scene.remove(this.forceArrow);
      this.forceArrow.dispose();
      this.forceArrow = null;
    }
  }

  private updateForceArrow(origin: THREE.Vector3, data: InteractionData): void {
    // Remove old arrow
    if (this.forceArrow) {
      this.scene.remove(this.forceArrow);
      this.forceArrow.dispose();
    }

    const dir = new THREE.Vector3(data.forceX, data.forceY, data.forceZ);
    const magnitude = dir.length();
    if (magnitude < 0.01) return;

    dir.normalize();

    // Scale arrow length: log scale so small forces are still visible
    const arrowLength = Math.min(5, Math.log(1 + magnitude * 0.1) * 2);

    const color = data.totalEnergy < 0 ? 0x44ff44 : 0xff4444;
    this.forceArrow = new THREE.ArrowHelper(dir, origin, arrowLength, color, 0.3, 0.15);
    this.scene.add(this.forceArrow);
  }

  public clear(): void {
    if (this.energyTotal) {
      this.energyTotal.textContent = '0.00 kJ/mol';
      this.energyTotal.className = 'energy-value neutral';
    }
    if (this.distanceValue) this.distanceValue.textContent = '--';
    if (this.coulombValue) this.coulombValue.textContent = '--';
    if (this.ljValue) this.ljValue.textContent = '--';

    if (this.forceArrow) {
      this.scene.remove(this.forceArrow);
      this.forceArrow.dispose();
      this.forceArrow = null;
    }
  }

  public dispose(): void {
    this.clear();
  }
}
