import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

/**
 * Manages WebXR session, hand/controller input, and VR UI.
 */
export class VRManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private vrButton: HTMLElement | null;
  private isVRSupported = false;
  private controllers: THREE.XRTargetRaySpace[] = [];
  private controllerGrips: THREE.XRGripSpace[] = [];
  private grabbedObject: THREE.Object3D | null = null;
  private onGrab: ((obj: THREE.Object3D) => void) | null = null;
  private onRelease: (() => void) | null = null;
  private onMove: ((pos: THREE.Vector3) => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.vrButton = document.getElementById('vr-button');

    this.checkVRSupport();
  }

  private async checkVRSupport(): Promise<void> {
    if (!('xr' in navigator)) return;

    try {
      this.isVRSupported = await navigator.xr!.isSessionSupported('immersive-vr');
    } catch {
      this.isVRSupported = false;
    }

    if (this.isVRSupported && this.vrButton) {
      this.vrButton.style.display = 'block';
      this.vrButton.addEventListener('click', () => this.toggleVR());
      this.setupControllers();
    }
  }

  private setupControllers(): void {
    const controllerModelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('selectstart', () => this.onSelectStart(controller));
      controller.addEventListener('selectend', () => this.onSelectEnd());
      this.scene.add(controller);
      this.controllers.push(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(controllerModelFactory.createControllerModel(grip));
      this.scene.add(grip);
      this.controllerGrips.push(grip);

      // Visual ray from controller
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x508cff }));
      line.scale.z = 5;
      controller.add(line);
    }
  }

  private onSelectStart(controller: THREE.XRTargetRaySpace): void {
    // Raycast from controller to find grabbable objects
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(this.scene.children, true);
    for (const intersect of intersects) {
      let obj = intersect.object;
      // Walk up to find molecule group
      while (obj.parent && !obj.name.startsWith('molecule-')) {
        obj = obj.parent;
      }
      if (obj.name.startsWith('molecule-')) {
        this.grabbedObject = obj;
        if (this.onGrab) this.onGrab(obj);
        break;
      }
    }
  }

  private onSelectEnd(): void {
    this.grabbedObject = null;
    if (this.onRelease) this.onRelease();
  }

  public update(): void {
    if (!this.grabbedObject) return;

    // Move grabbed object with controller
    for (const controller of this.controllers) {
      if (controller.userData.isSelecting) {
        const pos = new THREE.Vector3();
        controller.getWorldPosition(pos);
        this.grabbedObject.position.copy(pos);
        if (this.onMove) this.onMove(pos);
      }
    }
  }

  private async toggleVR(): Promise<void> {
    if (!this.vrButton) return;

    const session = this.renderer.xr.getSession();
    if (session) {
      session.end();
      this.vrButton.textContent = 'Enter VR';
    } else {
      try {
        const newSession = await navigator.xr!.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
        this.renderer.xr.enabled = true;
        await this.renderer.xr.setSession(newSession);
        this.vrButton.textContent = 'Exit VR';

        newSession.addEventListener('end', () => {
          this.renderer.xr.enabled = false;
          this.vrButton!.textContent = 'Enter VR';
        });
      } catch (e) {
        console.error('Failed to start VR session:', e);
      }
    }
  }

  public setCallbacks(
    onGrab: (obj: THREE.Object3D) => void,
    onRelease: () => void,
    onMove: (pos: THREE.Vector3) => void,
  ): void {
    this.onGrab = onGrab;
    this.onRelease = onRelease;
    this.onMove = onMove;
  }

  public isSupported(): boolean {
    return this.isVRSupported;
  }

  public dispose(): void {
    // Cleanup controllers
    for (const controller of this.controllers) {
      this.scene.remove(controller);
    }
    for (const grip of this.controllerGrips) {
      this.scene.remove(grip);
    }
  }
}
