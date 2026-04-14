import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;

  private container: HTMLElement;
  private animationCallbacks: Array<(dt: number) => void> = [];
  private clock = new THREE.Clock();
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsDisplay: HTMLElement | null;

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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
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

    // Main directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);

    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-5, -3, -5);
    this.scene.add(fillLight);

    // Rim light from behind
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(0, 0, -10);
    this.scene.add(rimLight);
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

  public dispose(): void {
    this.renderer.dispose();
    this.controls.dispose();
  }
}
