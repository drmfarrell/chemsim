import * as THREE from 'three';
import { SceneManager } from './scene/SceneManager';
import { MoleculeRenderer, ViewMode } from './scene/MoleculeRenderer';
import { CloudDeformer } from './scene/CloudDeformer';
import { InteractionVisualizer, InteractionData } from './scene/InteractionVisualizer';
import { VRManager } from './scene/VRManager';
import { loadMolecule, MoleculeData, MOLECULE_LIST } from './utils/loader';
import { LJ_PARAMS, ANGSTROM_TO_SCENE, DEFAULT_TEMPERATURE, DEFAULT_BOX_SIZE, DEFAULT_MOLECULE_COUNT } from './utils/constants';
import { Tutorial } from './ui/Tutorial';
import { EXPERIMENTS, Experiment } from './ui/Experiments';
import init, { SimulationSystem } from './wasm-pkg/chemsim_physics';

// Application state
let sceneManager: SceneManager;
let physics: SimulationSystem;
let cloudDeformer: CloudDeformer;
let interactionViz: InteractionVisualizer;
let vrManager: VRManager;

let moleculeA: MoleculeRenderer | null = null;
let moleculeB: MoleculeRenderer | null = null;
let moleculeAData: MoleculeData | null = null;
let moleculeBData: MoleculeData | null = null;

let currentMode: 'mode1' | 'mode2' = 'mode1';
let isDragging = false;
let isRotating = false;
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let prevMouse = new THREE.Vector2();
let dragOffset = new THREE.Vector3();

// Mode 2 state
let boxMolecules: MoleculeRenderer[] = [];
let boxMoleculeData: MoleculeData | null = null;
let boxGroup: THREE.Group | null = null;
let boxHelper: THREE.LineSegments | null = null;
let isSimulationRunning = false;
let showInteractionNetwork = false;
let networkLines: THREE.LineSegments | null = null;
let statsUpdateCounter = 0;
let tutorial: Tutorial;

// Element mass lookup
const ELEMENT_MASS: Record<string, number> = {
  H: 1.008, C: 12.011, N: 14.007, O: 15.999, F: 18.998, S: 32.065, Cl: 35.453,
};

async function main() {
  // Initialize WASM
  await init();

  // Set up Three.js scene
  sceneManager = new SceneManager('canvas-container');

  // Initialize physics system
  physics = new SimulationSystem();

  // Initialize subsystems
  cloudDeformer = new CloudDeformer(physics);
  interactionViz = new InteractionVisualizer(sceneManager.scene);
  vrManager = new VRManager(sceneManager.getRenderer(), sceneManager.scene);

  // Initialize tutorial
  tutorial = new Tutorial();

  // Populate molecule dropdowns and experiments
  populateDropdowns();
  populateExperiments();

  // Set up UI event listeners
  setupUI();

  // Set up mouse/touch interaction
  setupInteraction();

  // Load initial molecules
  await loadMode1Pair('water', 'water');

  // Hide loading overlay
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');

  // Set up VR callbacks for molecule interaction
  vrManager.setCallbacks(
    (obj) => {
      // On grab: identify which molecule was grabbed
      if (currentMode === 'mode1' && moleculeB) {
        const group = moleculeB.getGroup();
        if (obj === group || group.children.includes(obj as THREE.Mesh)) {
          isDragging = true;
        }
      }
    },
    () => {
      // On release
      isDragging = false;
    },
    (pos) => {
      // On move: update dragged molecule position
      if (isDragging && moleculeB) {
        moleculeB.getGroup().position.copy(pos);
        physics.set_molecule_position(
          1,
          pos.x / ANGSTROM_TO_SCENE,
          pos.y / ANGSTROM_TO_SCENE,
          pos.z / ANGSTROM_TO_SCENE,
        );
      }
    },
  );

  // Animation callback
  sceneManager.onAnimationFrame((dt) => {
    if (currentMode === 'mode1') {
      updateMode1();
    } else {
      updateMode2(dt);
    }
    vrManager.update();
  });
}

function populateDropdowns(): void {
  const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
  const selB = document.getElementById('molecule-b-selector') as HTMLSelectElement;

  for (const mol of MOLECULE_LIST) {
    const optA = document.createElement('option');
    optA.value = mol.id;
    optA.textContent = `${mol.formula} (${mol.name})`;
    selA.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = mol.id;
    optB.textContent = `${mol.formula} (${mol.name})`;
    selB.appendChild(optB);
  }
}

function populateExperiments(): void {
  const sel = document.getElementById('experiment-selector') as HTMLSelectElement;
  for (const exp of EXPERIMENTS) {
    const opt = document.createElement('option');
    opt.value = exp.id;
    opt.textContent = exp.title;
    sel.appendChild(opt);
  }
}

function setupUI(): void {
  // Mode selector
  const modeSelector = document.getElementById('mode-selector') as HTMLSelectElement;
  modeSelector.addEventListener('change', () => {
    switchMode(modeSelector.value as 'mode1' | 'mode2');
  });

  // Molecule selectors
  const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
  const selB = document.getElementById('molecule-b-selector') as HTMLSelectElement;
  selA.addEventListener('change', () => loadMode1Pair(selA.value, selB.value));
  selB.addEventListener('change', () => loadMode1Pair(selA.value, selB.value));

  // Temperature slider
  const tempSlider = document.getElementById('temp-slider') as HTMLInputElement;
  const tempValue = document.getElementById('temp-value') as HTMLSpanElement;
  tempSlider.addEventListener('input', () => {
    tempValue.textContent = tempSlider.value;
    physics.set_temperature(parseFloat(tempSlider.value));
  });

  // Molecule count slider
  const countSlider = document.getElementById('molecule-count-slider') as HTMLInputElement;
  const countValue = document.getElementById('molecule-count-value') as HTMLSpanElement;
  countSlider.addEventListener('input', () => {
    countValue.textContent = countSlider.value;
  });
  countSlider.addEventListener('change', () => {
    if (currentMode === 'mode2') {
      loadMode2(
        (document.getElementById('molecule-a-selector') as HTMLSelectElement).value,
        parseInt(countSlider.value),
      );
    }
  });

  // View mode toggles
  const viewBtns = ['view-ball-stick', 'view-space-fill', 'view-cloud-only'] as const;
  const viewModes: ViewMode[] = ['ball-stick', 'space-fill', 'cloud-only'];
  for (let i = 0; i < viewBtns.length; i++) {
    const btn = document.getElementById(viewBtns[i])!;
    btn.addEventListener('click', () => {
      for (const b of viewBtns) document.getElementById(b)!.classList.remove('active');
      btn.classList.add('active');
      const mode = viewModes[i];
      moleculeA?.setViewMode(mode);
      moleculeB?.setViewMode(mode);
      for (const mol of boxMolecules) mol.setViewMode(mode);
    });
  }

  // Cloud toggle
  document.getElementById('toggle-cloud')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.classList.toggle('active');
    const visible = btn.classList.contains('active');
    moleculeA?.setCloudVisible(visible);
    moleculeB?.setCloudVisible(visible);
    for (const mol of boxMolecules) mol.setCloudVisible(visible);
  });

  // Forces toggle
  document.getElementById('toggle-forces')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.classList.toggle('active');
    interactionViz.setShowForces(btn.classList.contains('active'));
  });

  // Snap to optimal
  document.getElementById('snap-optimal')!.addEventListener('click', () => {
    if (currentMode !== 'mode1' || !moleculeB) return;
    animateSnapToOptimal();
  });

  // Mode 2: Play/Pause
  document.getElementById('toggle-sim-play')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLButtonElement;
    isSimulationRunning = !isSimulationRunning;
    btn.textContent = isSimulationRunning ? 'Pause' : 'Play';
    btn.classList.toggle('active', isSimulationRunning);
  });

  // Mode 2: Interaction network
  document.getElementById('toggle-network')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.classList.toggle('active');
    showInteractionNetwork = btn.classList.contains('active');
    if (!showInteractionNetwork && networkLines) {
      sceneManager.scene.remove(networkLines);
      networkLines.geometry.dispose();
      (networkLines.material as THREE.Material).dispose();
      networkLines = null;
    }
  });

  // Tutorial button
  document.getElementById('start-tutorial')!.addEventListener('click', () => {
    tutorial.start();
  });

  // Experiment selector
  document.getElementById('experiment-selector')!.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    const exp = EXPERIMENTS.find(ex => ex.id === id);
    if (exp) loadExperiment(exp);
  });

  // Close experiment prompt
  document.getElementById('close-experiment-prompt')!.addEventListener('click', () => {
    const prompt = document.getElementById('experiment-prompt');
    if (prompt) prompt.style.display = 'none';
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') {
      // Toggle cloud
      document.getElementById('toggle-cloud')!.click();
    } else if (e.key === 'f' || e.key === 'F') {
      // Toggle forces
      document.getElementById('toggle-forces')!.click();
    } else if (e.key === 'o' || e.key === 'O') {
      // Snap to optimal
      if (currentMode === 'mode1') {
        document.getElementById('snap-optimal')!.click();
      }
    } else if (e.key === ' ') {
      // Space: pause/play in Mode 2
      if (currentMode === 'mode2') {
        document.getElementById('toggle-sim-play')!.click();
        e.preventDefault();
      }
    } else if (e.key === '1') {
      document.getElementById('view-ball-stick')!.click();
    } else if (e.key === '2') {
      document.getElementById('view-space-fill')!.click();
    } else if (e.key === '3') {
      document.getElementById('view-cloud-only')!.click();
    }
  });
}

function loadExperiment(exp: Experiment): void {
  // Show experiment prompt
  const promptEl = document.getElementById('experiment-prompt');
  const promptText = document.getElementById('experiment-prompt-text');
  if (promptEl && promptText) {
    promptText.textContent = exp.prompt;
    promptEl.style.display = 'block';
  }

  // Set mode
  const modeSelector = document.getElementById('mode-selector') as HTMLSelectElement;

  if (exp.mode === 'mode1') {
    modeSelector.value = 'mode1';
    switchMode('mode1');

    // Set molecules
    const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
    const selB = document.getElementById('molecule-b-selector') as HTMLSelectElement;
    selA.value = exp.moleculeA;
    if (exp.moleculeB) selB.value = exp.moleculeB;
    loadMode1Pair(selA.value, selB.value);
  } else {
    // Set temperature and count before switching mode
    if (exp.temperature) {
      const slider = document.getElementById('temp-slider') as HTMLInputElement;
      slider.value = exp.temperature.toString();
      slider.dispatchEvent(new Event('input'));
    }
    if (exp.moleculeCount) {
      const countSlider = document.getElementById('molecule-count-slider') as HTMLInputElement;
      countSlider.value = exp.moleculeCount.toString();
      document.getElementById('molecule-count-value')!.textContent = exp.moleculeCount.toString();
    }

    const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
    selA.value = exp.moleculeA;

    modeSelector.value = 'mode2';
    switchMode('mode2');
  }
}

function setupInteraction(): void {
  const canvas = sceneManager.getRenderer().domElement;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  // Prevent context menu on right-click (we use it for rotation)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function onPointerDown(event: PointerEvent): void {
  if (currentMode !== 'mode1' || !moleculeB) return;

  const canvas = sceneManager.getRenderer().domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  prevMouse.copy(mouse);

  raycaster.setFromCamera(mouse, sceneManager.camera);

  const group = moleculeB.getGroup();
  const intersects = raycaster.intersectObjects(group.children, true);

  if (intersects.length > 0) {
    sceneManager.controls.enabled = false;

    // Shift+click or right-click = rotation mode
    if (event.shiftKey || event.button === 2) {
      isRotating = true;
      canvas.style.cursor = 'crosshair';
    } else {
      isDragging = true;
      // Set drag plane to face camera at the molecule's depth
      const camDir = sceneManager.camera.getWorldDirection(new THREE.Vector3());
      dragPlane.setFromNormalAndCoplanarPoint(camDir, group.position);

      // Compute offset between hit point and molecule center
      const hitPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlane, hitPoint);
      dragOffset.subVectors(group.position, hitPoint);

      canvas.style.cursor = 'grabbing';
    }
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!moleculeB) return;

  const canvas = sceneManager.getRenderer().domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  if (isDragging) {
    raycaster.setFromCamera(mouse, sceneManager.camera);

    const hitPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, hitPoint);
    hitPoint.add(dragOffset);

    // Enforce minimum distance: no atom on B can overlap any atom on A.
    // Iteratively push B outward until all atom pairs clear VDW contact.
    if (moleculeA && moleculeAData && moleculeBData) {
      const posA = moleculeA.getGroup().position;

      for (let iter = 0; iter < 5; iter++) {
        const centerAxis = hitPoint.clone().sub(posA);
        let centerDist = centerAxis.length();

        // If molecules are nearly coincident, push B in an arbitrary direction
        if (centerDist < 0.1 * ANGSTROM_TO_SCENE) {
          hitPoint.x = posA.x + 3 * ANGSTROM_TO_SCENE;
          continue;
        }

        // Find the worst overlapping atom pair
        let maxOverlap = 0;
        for (const atomA of moleculeAData.atoms) {
          const ax = posA.x / ANGSTROM_TO_SCENE + atomA.x;
          const ay = posA.y / ANGSTROM_TO_SCENE + atomA.y;
          const az = posA.z / ANGSTROM_TO_SCENE + atomA.z;
          for (const atomB of moleculeBData.atoms) {
            const bx = hitPoint.x / ANGSTROM_TO_SCENE + atomB.x;
            const by = hitPoint.y / ANGSTROM_TO_SCENE + atomB.y;
            const bz = hitPoint.z / ANGSTROM_TO_SCENE + atomB.z;
            const dx = bx - ax, dy = by - ay, dz = bz - az;
            const atomDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const contactDist = (atomA.vdw_radius + atomB.vdw_radius) * 0.9;
            const overlap = contactDist - atomDist;
            if (overlap > maxOverlap) maxOverlap = overlap;
          }
        }

        if (maxOverlap <= 0) break; // no overlap, done

        // Push B outward along center-center axis
        const pushDir = centerAxis.normalize();
        hitPoint.add(pushDir.multiplyScalar((maxOverlap + 0.05) * ANGSTROM_TO_SCENE));
      }
    }

    // Move the molecule group in Three.js
    moleculeB.getGroup().position.copy(hitPoint);

    // Update physics engine position (convert from scene coords to Angstroms)
    physics.set_molecule_position(
      1,
      hitPoint.x / ANGSTROM_TO_SCENE,
      hitPoint.y / ANGSTROM_TO_SCENE,
      hitPoint.z / ANGSTROM_TO_SCENE,
    );
  } else if (isRotating) {
    // Rotate molecule B around its center
    const dx = mouse.x - prevMouse.x;
    const dy = mouse.y - prevMouse.y;

    const group = moleculeB.getGroup();
    const rotSpeed = 3.0;

    // Rotate around camera's up and right axes
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(sceneManager.camera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(sceneManager.camera.quaternion);

    group.rotateOnWorldAxis(camUp, dx * rotSpeed);
    group.rotateOnWorldAxis(camRight, -dy * rotSpeed);
  }

  prevMouse.copy(mouse);
}

function onPointerUp(_event: PointerEvent): void {
  if (isDragging || isRotating) {
    isDragging = false;
    isRotating = false;
    sceneManager.controls.enabled = true;
    sceneManager.getRenderer().domElement.style.cursor = '';
  }
}

function updateMode1(): void {
  if (!moleculeA || !moleculeB) return;
  if (physics.get_molecule_count() < 2) return;

  // Compute interaction
  const result = physics.compute_pair_interaction(0, 1);

  const data: InteractionData = {
    totalEnergy: result.total_energy,
    coulombEnergy: result.coulomb_energy,
    ljEnergy: result.lj_energy,
    distance: result.distance,
    forceX: result.force_x,
    forceY: result.force_y,
    forceZ: result.force_z,
  };

  interactionViz.update(data, moleculeA.getGroup().position);

  // Compute cloud deformation
  cloudDeformer.deformCloud(moleculeA, 0, 1);
  cloudDeformer.deformCloud(moleculeB, 1, 0);
}

function updateMode2(_dt: number): void {
  if (boxMolecules.length === 0) return;

  if (isSimulationRunning) {
    // Run physics steps (multiple sub-steps per frame for stability)
    const stepsPerFrame = 5;
    physics.step_n(stepsPerFrame);

    // Update molecule positions from physics
    const positions = physics.get_all_positions();
    for (let i = 0; i < boxMolecules.length; i++) {
      const x = positions[i * 3] * ANGSTROM_TO_SCENE;
      const y = positions[i * 3 + 1] * ANGSTROM_TO_SCENE;
      const z = positions[i * 3 + 2] * ANGSTROM_TO_SCENE;
      boxMolecules[i].getGroup().position.set(x, y, z);

      // Update individual atom positions
      const atomPos = physics.get_atom_positions(i);
      boxMolecules[i].updateAtomPositions(Array.from(atomPos));
    }
  }

  // Update stats every 10 frames to avoid overhead
  statsUpdateCounter++;
  if (statsUpdateCounter % 10 === 0) {
    updateMode2Stats();
  }

  // Update interaction network
  if (showInteractionNetwork && statsUpdateCounter % 5 === 0) {
    updateInteractionNetwork();
  }
}

function updateMode2Stats(): void {
  const temp = physics.get_temperature();
  const ke = physics.get_kinetic_energy();
  const step = physics.get_step_count();

  const simTemp = document.getElementById('sim-temperature');
  const simKE = document.getElementById('sim-ke');
  const simStep = document.getElementById('sim-step');

  if (simTemp) simTemp.textContent = `${Math.round(temp)} K`;
  if (simKE) simKE.textContent = `${ke.toFixed(1)} kJ/mol`;
  if (simStep) simStep.textContent = step.toString();

  // Compute PE and NN distance less frequently (expensive)
  if (statsUpdateCounter % 30 === 0) {
    const pe = physics.get_potential_energy();
    const nnDist = physics.get_avg_nearest_neighbor_distance();
    const simPE = document.getElementById('sim-pe');
    const simNN = document.getElementById('sim-nn-dist');
    if (simPE) simPE.textContent = `${pe.toFixed(1)} kJ/mol`;
    if (simNN) simNN.textContent = `${nnDist.toFixed(2)} \u00C5`;
  }
}

function updateInteractionNetwork(): void {
  // Remove old network
  if (networkLines) {
    sceneManager.scene.remove(networkLines);
    networkLines.geometry.dispose();
    (networkLines.material as THREE.Material).dispose();
    networkLines = null;
  }

  const pairs = physics.get_interaction_pairs();
  if (pairs.length === 0) return;

  const positions = physics.get_all_positions();
  const linePositions: number[] = [];
  const lineColors: number[] = [];

  for (let p = 0; p < pairs.length; p += 3) {
    const i = pairs[p];
    const j = pairs[p + 1];
    const strength = pairs[p + 2];

    const x1 = positions[i * 3] * ANGSTROM_TO_SCENE;
    const y1 = positions[i * 3 + 1] * ANGSTROM_TO_SCENE;
    const z1 = positions[i * 3 + 2] * ANGSTROM_TO_SCENE;
    const x2 = positions[j * 3] * ANGSTROM_TO_SCENE;
    const y2 = positions[j * 3 + 1] * ANGSTROM_TO_SCENE;
    const z2 = positions[j * 3 + 2] * ANGSTROM_TO_SCENE;

    linePositions.push(x1, y1, z1, x2, y2, z2);

    // Color by strength: weak = blue, strong = green
    const t = Math.min(1, strength / 20);
    const r = 0.1;
    const g = 0.3 + t * 0.7;
    const b = 1 - t * 0.5;
    lineColors.push(r, g, b, r, g, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthTest: true,
  });

  networkLines = new THREE.LineSegments(geometry, material);
  sceneManager.scene.add(networkLines);
}

async function loadMode1Pair(nameA: string, nameB: string): Promise<void> {
  // Clean up existing
  moleculeA?.dispose();
  moleculeB?.dispose();
  moleculeA = null;
  moleculeB = null;
  physics.clear();
  interactionViz.clear();

  try {
    // Load data
    moleculeAData = await loadMolecule(nameA);
    moleculeBData = await loadMolecule(nameB);

    // Create renderers
    moleculeA = new MoleculeRenderer(moleculeAData);
    moleculeB = new MoleculeRenderer(moleculeBData);

    // Position molecule A at center, B to the right
    moleculeA.getGroup().position.set(0, 0, 0);
    moleculeB.getGroup().position.set(5 * ANGSTROM_TO_SCENE, 0, 0);

    sceneManager.scene.add(moleculeA.getGroup());
    sceneManager.scene.add(moleculeB.getGroup());

    // Add to physics engine
    addMoleculeToPhysics(moleculeAData, 0, 0, 0);
    addMoleculeToPhysics(moleculeBData, 5, 0, 0);
  } catch (e) {
    console.error('Failed to load molecules:', e);
  }
}

function addMoleculeToPhysics(data: MoleculeData, cx: number, cy: number, cz: number): void {
  const atoms = data.atoms.map(a => {
    const ljp = LJ_PARAMS[a.element] ?? { epsilon: 0.5, sigma: 3.0 };
    return {
      element: a.element,
      x: a.x + cx,
      y: a.y + cy,
      z: a.z + cz,
      charge: a.charge,
      epsilon: ljp.epsilon,
      sigma: ljp.sigma,
      mass: ELEMENT_MASS[a.element] ?? 12.0,
    };
  });

  const json = JSON.stringify({
    atoms,
    polarizability: data.polarizability,
  });

  physics.add_molecule(json);
}

async function loadMode2(moleculeName: string, count: number): Promise<void> {
  // Clean up
  clearMode2();
  physics.clear();
  isSimulationRunning = false;

  try {
    boxMoleculeData = await loadMolecule(moleculeName);

    const boxSize = DEFAULT_BOX_SIZE;
    physics.set_box_size(boxSize);
    physics.set_periodic(true);
    physics.set_thermostat(true);
    physics.set_temperature(parseFloat(
      (document.getElementById('temp-slider') as HTMLInputElement).value
    ));

    // Create box visualization
    boxGroup = new THREE.Group();
    const halfBox = (boxSize / 2) * ANGSTROM_TO_SCENE;
    const boxGeo = new THREE.BoxGeometry(
      boxSize * ANGSTROM_TO_SCENE,
      boxSize * ANGSTROM_TO_SCENE,
      boxSize * ANGSTROM_TO_SCENE,
    );
    const edges = new THREE.EdgesGeometry(boxGeo);
    boxHelper = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: 0x444466,
      transparent: true,
      opacity: 0.5,
    }));
    boxGeo.dispose();
    sceneManager.scene.add(boxHelper);

    // Place molecules randomly in the box
    const spacing = boxSize / Math.cbrt(count);
    let placed = 0;
    for (let ix = 0; placed < count; ix++) {
      for (let iy = 0; iy < Math.ceil(Math.cbrt(count)) && placed < count; iy++) {
        for (let iz = 0; iz < Math.ceil(Math.cbrt(count)) && placed < count; iz++) {
          const x = -halfBox / ANGSTROM_TO_SCENE + spacing * (ix + 0.5);
          const y = -halfBox / ANGSTROM_TO_SCENE + spacing * (iy + 0.5);
          const z = -halfBox / ANGSTROM_TO_SCENE + spacing * (iz + 0.5);

          if (Math.abs(x) > boxSize / 2 || Math.abs(y) > boxSize / 2 || Math.abs(z) > boxSize / 2) continue;

          addMoleculeToPhysics(boxMoleculeData, x, y, z);

          const renderer = new MoleculeRenderer(boxMoleculeData);
          renderer.getGroup().position.set(
            x * ANGSTROM_TO_SCENE,
            y * ANGSTROM_TO_SCENE,
            z * ANGSTROM_TO_SCENE,
          );
          // Disable cloud in box mode for performance
          renderer.setCloudVisible(false);
          sceneManager.scene.add(renderer.getGroup());
          boxMolecules.push(renderer);
          placed++;
        }
      }
    }

    // Initialize velocities and start simulation
    physics.init_velocities();
    isSimulationRunning = true;

    // Adjust camera to see the box
    sceneManager.camera.position.set(0, 0, boxSize * ANGSTROM_TO_SCENE * 1.2);
    sceneManager.controls.target.set(0, 0, 0);

  } catch (e) {
    console.error('Failed to load mode 2:', e);
  }
}

function clearMode2(): void {
  for (const mol of boxMolecules) {
    mol.dispose();
  }
  boxMolecules = [];

  if (boxHelper) {
    sceneManager.scene.remove(boxHelper);
    boxHelper.geometry.dispose();
    (boxHelper.material as THREE.Material).dispose();
    boxHelper = null;
  }

  if (boxGroup) {
    sceneManager.scene.remove(boxGroup);
    boxGroup = null;
  }
}

function switchMode(mode: 'mode1' | 'mode2'): void {
  currentMode = mode;
  isSimulationRunning = false;

  // Clean up both modes
  moleculeA?.dispose();
  moleculeB?.dispose();
  moleculeA = null;
  moleculeB = null;
  clearMode2();
  physics.clear();
  interactionViz.clear();

  // Toggle UI elements
  const mode1Elements = ['molecule-b-group', 'snap-optimal'];
  const mode2Elements = ['temp-group', 'molecule-count-group', 'mode2-controls'];

  for (const id of mode1Elements) {
    const el = document.getElementById(id);
    if (el) el.style.display = mode === 'mode1' ? '' : 'none';
  }
  for (const id of mode2Elements) {
    const el = document.getElementById(id);
    if (el) el.style.display = mode === 'mode2' ? '' : 'none';
  }

  const energyDisplay = document.getElementById('energy-display');
  if (energyDisplay) energyDisplay.style.display = mode === 'mode1' ? '' : 'none';

  const simStats = document.getElementById('sim-stats');
  if (simStats) simStats.style.display = mode === 'mode2' ? '' : 'none';

  if (mode === 'mode1') {
    const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
    const selB = document.getElementById('molecule-b-selector') as HTMLSelectElement;
    loadMode1Pair(selA.value, selB.value);
    sceneManager.camera.position.set(0, 0, 15);
  } else {
    const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
    const countSlider = document.getElementById('molecule-count-slider') as HTMLInputElement;
    loadMode2(selA.value, parseInt(countSlider.value));
  }
}

function animateSnapToOptimal(): void {
  if (!moleculeB) return;

  const optimalPos = physics.find_optimal_position(0, 1);
  const targetX = optimalPos[0] * ANGSTROM_TO_SCENE;
  const targetY = optimalPos[1] * ANGSTROM_TO_SCENE;
  const targetZ = optimalPos[2] * ANGSTROM_TO_SCENE;

  const group = moleculeB.getGroup();
  const startX = group.position.x;
  const startY = group.position.y;
  const startZ = group.position.z;

  const duration = 1.0; // seconds
  let elapsed = 0;

  const cb = (dt: number) => {
    elapsed += dt;
    const t = Math.min(1, elapsed / duration);
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);

    const x = startX + (targetX - startX) * ease;
    const y = startY + (targetY - startY) * ease;
    const z = startZ + (targetZ - startZ) * ease;

    group.position.set(x, y, z);
    physics.set_molecule_position(1, x / ANGSTROM_TO_SCENE, y / ANGSTROM_TO_SCENE, z / ANGSTROM_TO_SCENE);

    if (t >= 1) {
      sceneManager.removeAnimationCallback(cb);
    }
  };

  sceneManager.onAnimationFrame(cb);
}

// Boot
main().catch(console.error);
