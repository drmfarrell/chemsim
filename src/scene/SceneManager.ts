import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: TrackballControls;

  private container: HTMLElement;
  private animationCallbacks: Array<(dt: number) => void> = [];
  private clock = new THREE.Clock();
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsDisplay: HTMLElement | null;
  private mainLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private slabThickness: number | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.fpsDisplay = document.getElementById('fps-counter');

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a14);

    // Camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 15);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.44;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    // TrackballControls instead of OrbitControls so the camera can spin
    // freely in any direction — there's no physical "up" in a molecular
    // scene, and OrbitControls' polar clamp was stopping vertical rotation
    // at ±90° from the horizon. TrackballControls tracks its own up vector
    // each frame so rotation is unbounded on both axes.
    //
    // Bindings (same as OrbitControls for user familiarity):
    //   Left-drag   = rotate
    //   Right-drag  = pan
    //   Wheel / middle-drag = zoom
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 3.0;
    this.controls.zoomSpeed = 1.5;
    this.controls.panSpeed = 0.8;
    this.controls.staticMoving = false;
    this.controls.dynamicDampingFactor = 0.15;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 100;

    // Lighting
    this.setupLighting();

    // Resize handler
    window.addEventListener('resize', () => this.onResize());

    // Start render loop
    this.animate();
  }

  private setupLighting(): void {
    // Ambient light for base illumination
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    // Main directional light - will follow camera
    this.mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.scene.add(this.mainLight);

    // Fill light from opposite side - also follows camera
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    this.scene.add(fillLight);
    this.fillLight = fillLight;
  }

  public onAnimationFrame(callback: (dt: number) => void): void {
    this.animationCallbacks.push(callback);
  }

  public removeAnimationCallback(callback: (dt: number) => void): void {
    const idx = this.animationCallbacks.indexOf(callback);
    if (idx >= 0) this.animationCallbacks.splice(idx, 1);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const dt = this.clock.getDelta();

    // FPS counter
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      if (this.fpsDisplay) this.fpsDisplay.textContent = `${fps} FPS`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    // Run animation callbacks
    for (const cb of this.animationCallbacks) {
      cb(dt);
    }

    this.controls.update();

    // Depth slab: clip to a thickness centered on the orbit target so users
    // can see through dense clusters. When disabled, use wide defaults.
    if (this.slabThickness !== null) {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const half = this.slabThickness / 2;
      const near = Math.max(0.1, dist - half);
      const far = Math.max(near + 0.5, dist + half);
      if (this.camera.near !== near || this.camera.far !== far) {
        this.camera.near = near;
        this.camera.far = far;
        this.camera.updateProjectionMatrix();
      }
    } else if (this.camera.near !== 0.1 || this.camera.far !== 1000) {
      this.camera.near = 0.1;
      this.camera.far = 1000;
      this.camera.updateProjectionMatrix();
    }

    // Update lights to follow camera for consistent illumination
    const lightOffset = new THREE.Vector3(5, 10, 7);
    lightOffset.applyQuaternion(this.camera.quaternion);
    this.mainLight.position.copy(this.camera.position).add(lightOffset);

    const fillOffset = new THREE.Vector3(-5, -3, -5);
    fillOffset.applyQuaternion(this.camera.quaternion);
    this.fillLight.position.copy(this.camera.position).add(fillOffset);

    this.renderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** Enable the depth-clipping slab with the given thickness in scene units (Å),
   *  or pass null to disable clipping. Slab is centered on the orbit target. */
  public setSlabThickness(thickness: number | null): void {
    this.slabThickness = thickness;
  }

  public dispose(): void {
    this.renderer.dispose();
    this.controls.dispose();
  }
}
