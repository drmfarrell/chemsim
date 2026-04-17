import * as THREE from 'three';
import { SceneManager } from './scene/SceneManager';
import { MoleculeRenderer, ViewMode } from './scene/MoleculeRenderer';
import { CloudDeformer } from './scene/CloudDeformer';
import { InteractionVisualizer, InteractionData } from './scene/InteractionVisualizer';
import { VRManager } from './scene/VRManager';
import { loadMolecule, MoleculeData, MOLECULE_LIST } from './utils/loader';
import { LJ_PARAMS, ANGSTROM_TO_SCENE, DEFAULT_TEMPERATURE, DEFAULT_MOLECULE_COUNT } from './utils/constants';
import { Tutorial } from './ui/Tutorial';
import { EXPERIMENTS, Experiment } from './ui/Experiments';
import init, { SimulationSystem, initThreadPool } from './wasm-pkg/chemsim_physics';

// Molecule count presets for box mode (perfect cubes for even grid placement)
const MOLECULE_COUNT_PRESETS = [8, 27, 64, 125, 216]; // 2³, 3³, 4³, 5³, 6³ - capped for smooth animation

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
// Box side length (in Angstroms) that the boxHelper geometry was built for;
// used to scale the helper as the barostat changes the physics box.
let INITIAL_BOX_SIZE_FOR_HELPER = 1;

// Update box appearance based on walls vs periodic
function updateBoxAppearance(hasWalls: boolean): void {
  if (!boxHelper) return;
  const material = boxHelper.material as THREE.LineBasicMaterial;
  if (hasWalls) {
    material.color.setHex(0x444466);
    material.opacity = 0.5;
    material.transparent = true;
    material.dashed = false;
  } else {
    // Periodic mode: dashed lines to show "no walls"
    material.color.setHex(0x666688);
    material.opacity = 0.3;
    material.transparent = true;
    material.dashed = true;
    material.dashSize = 1;
    material.gapSize = 0.5;
  }
  material.needsUpdate = true;
}

let isSimulationRunning = false;
let simSpeedMultiplier = 1;
// Effective multiplier after the N-based auto-throttle. Equals
// simSpeedMultiplier at small N; capped for larger systems.
let effectiveSpeedMultiplier = 1;
let showInteractionNetwork = false;
let networkLines: THREE.LineSegments | null = null;
let statsUpdateCounter = 0;
let tutorial: Tutorial;

// Graph data for tracking box size and NN distance over time
const MAX_GRAPH_POINTS = 200;
let graphHistory: { boxSize: number; nnDist: number; step: number }[] = [];
let showGraph = false;

// Incremented on each load; in-flight loads whose token is stale bail out
// so overlapping load calls cannot both commit and strand meshes in the scene.
let loadToken = 0;

// Element mass lookup
const ELEMENT_MASS: Record<string, number> = {
  H: 1.008, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Na: 22.990, S: 32.065, Cl: 35.453,
};

async function main() {
  // Initialize WASM
  await init();

  // Spin up rayon's thread pool so the physics force loop can use multiple
  // cores. Requires SharedArrayBuffer (COOP/COEP headers are set in
  // vite.config.ts). Falls back to serial silently if the browser can't
  // create the pool (e.g. headers not respected, crossOriginIsolated=false).
  const coi = (globalThis as any).crossOriginIsolated;
  if (coi === true) {
    try {
      const nCores = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));
      await initThreadPool(nCores);
      console.log(`ChemSim: rayon thread pool initialized with ${nCores} threads`);
    } catch (e) {
      console.warn('ChemSim: failed to initialize rayon thread pool, running single-threaded:', e);
    }
  } else {
    console.warn(`ChemSim: crossOriginIsolated=${coi}, running single-threaded. Ensure COOP/COEP headers reach the browser (service worker cache can strip them).`);
  }

  // Debug hook: lets tests (and humans) bypass the render loop and time
  // pure physics throughput. Removed in production isn't necessary since
  // it's read-only; this is how we verify rayon is actually parallelizing.
  (globalThis as any).__chemsim = {
    get physics() { return physics; },
    get boxMolecules() { return boxMolecules; },
    benchSteps(nSteps: number): { ms: number; stepsPerSec: number; molCount: number } {
      const t0 = performance.now();
      physics.step_n(nSteps);
      const ms = performance.now() - t0;
      return { ms, stepsPerSec: (nSteps / ms) * 1000, molCount: boxMolecules.length };
    },
  };

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

  // Molecule count slider - uses preset perfect cube values for even grid placement
  const MOLECULE_COUNT_PRESETS = [8, 27, 64, 125, 216]; // 2³, 3³, 4³, 5³, 6³ - capped for smooth animation
  const countSlider = document.getElementById('molecule-count-slider') as HTMLInputElement;
  const countValue = document.getElementById('molecule-count-value') as HTMLSpanElement;
  const updateCountDisplay = () => {
    const idx = parseInt(countSlider.value);
    countValue.textContent = MOLECULE_COUNT_PRESETS[idx].toString();
  };
  countSlider.addEventListener('input', updateCountDisplay);
  countSlider.addEventListener('change', () => {
    if (currentMode === 'mode2') {
      const idx = parseInt(countSlider.value);
      loadMode2(
        (document.getElementById('molecule-a-selector') as HTMLSelectElement).value,
        MOLECULE_COUNT_PRESETS[idx],
      );
    }
  });
  // Initialize display
  updateCountDisplay();

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

  // Depth-clip slab
  const slabToggle = document.getElementById('slab-toggle') as HTMLButtonElement;
  const slabSlider = document.getElementById('slab-slider') as HTMLInputElement;
  const slabValue = document.getElementById('slab-value') as HTMLSpanElement;
  const applySlab = () => {
    const on = slabToggle.classList.contains('active');
    slabSlider.disabled = !on;
    sceneManager.setSlabThickness(on ? parseFloat(slabSlider.value) : null);
  };
  slabToggle.addEventListener('click', () => {
    slabToggle.classList.toggle('active');
    applySlab();
  });
  slabSlider.addEventListener('input', () => {
    const v = parseFloat(slabSlider.value);
    slabValue.textContent = `${v.toFixed(1)} Å`;
    if (slabToggle.classList.contains('active')) {
      sceneManager.setSlabThickness(v);
    }
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

  // Mode 2: Speed slider
  const speedSlider = document.getElementById('sim-speed-slider') as HTMLInputElement;
  const speedValue = document.getElementById('sim-speed-value') as HTMLSpanElement;
  speedSlider.addEventListener('input', () => {
    simSpeedMultiplier = parseInt(speedSlider.value);
    speedValue.textContent = speedSlider.value;
  });

  // Advanced panel: precision presets + cutoff/timestep sliders.
  // Ships with Fast defaults so students see dissolution happen in minutes
  // of wall-clock time. Toggling Precise roughly halves wall-clock speed
  // but better conserves energy for measurements.
  const cutoffSlider = document.getElementById('cutoff-slider') as HTMLInputElement;
  const cutoffValue = document.getElementById('cutoff-value') as HTMLSpanElement;
  const timestepSlider = document.getElementById('timestep-slider') as HTMLInputElement;
  const timestepValue = document.getElementById('timestep-value') as HTMLSpanElement;
  const presetFast = document.getElementById('preset-fast') as HTMLButtonElement;
  const presetBal = document.getElementById('preset-balanced') as HTMLButtonElement;
  const presetPrecise = document.getElementById('preset-precise') as HTMLButtonElement;

  const applyCutoff = (v: number) => {
    physics.set_cutoff(v);
    cutoffSlider.value = v.toString();
    cutoffValue.textContent = v.toFixed(1);
  };
  const applyTimestep = (fs: number) => {
    // Slider is in fs for legibility; the physics API takes ps.
    physics.set_timestep(fs / 1000);
    timestepSlider.value = fs.toString();
    timestepValue.textContent = fs.toFixed(1);
  };
  const setPreset = (which: 'fast' | 'balanced' | 'precise') => {
    for (const b of [presetFast, presetBal, presetPrecise]) b.classList.remove('active');
    if (which === 'fast') {
      presetFast.classList.add('active');
      applyCutoff(8.0);
      applyTimestep(3.0);
    } else if (which === 'balanced') {
      presetBal.classList.add('active');
      applyCutoff(10.0);
      applyTimestep(2.0);
    } else {
      presetPrecise.classList.add('active');
      applyCutoff(12.0);
      applyTimestep(1.5);
    }
  };
  presetFast.addEventListener('click', () => setPreset('fast'));
  presetBal.addEventListener('click', () => setPreset('balanced'));
  presetPrecise.addEventListener('click', () => setPreset('precise'));

  // Manual slider drags drop out of any preset active state.
  const clearPresetActive = () => {
    for (const b of [presetFast, presetBal, presetPrecise]) b.classList.remove('active');
  };
  cutoffSlider.addEventListener('input', () => {
    applyCutoff(parseFloat(cutoffSlider.value));
    clearPresetActive();
  });
  timestepSlider.addEventListener('input', () => {
    applyTimestep(parseFloat(timestepSlider.value));
    clearPresetActive();
  });

  // Ship with Fast as the default so classroom demos feel snappy.
  setPreset('fast');

  // Advanced popup: button toggles visibility.
  const advancedBtn = document.getElementById('advanced-btn') as HTMLButtonElement;
  const advancedPanel = document.getElementById('advanced-panel') as HTMLDivElement;
  const advancedClose = document.getElementById('advanced-close') as HTMLButtonElement;
  const setAdvancedOpen = (open: boolean) => {
    advancedPanel.style.display = open ? 'block' : 'none';
  };
  advancedBtn.addEventListener('click', () => {
    setAdvancedOpen(advancedPanel.style.display === 'none');
  });
  advancedClose.addEventListener('click', () => setAdvancedOpen(false));

  // Main-panel hide/show toggle so students can watch the sim full-screen.
  const mainPanelToggle = document.getElementById('toggle-main-panel') as HTMLButtonElement;
  mainPanelToggle.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('panel-hidden');
    mainPanelToggle.textContent = hidden ? '▶' : '◀';
    mainPanelToggle.title = hidden ? 'Show controls' : 'Hide controls';
  });

  // Speed label shows the *actual* multiplier being applied. When the
  // auto-throttle caps below the slider value we tag it "capped" and a
  // tooltip explains why — clearer than exposing an "eff" abbreviation.
  const updateEffectiveSpeed = () => {
    const eff = effectiveSpeedMultiplier;
    const req = simSpeedMultiplier;
    if (Math.abs(eff - req) > 0.1) {
      speedValue.textContent = `${eff.toFixed(1)}× (capped from ${req}×)`;
      speedValue.title =
        'Physics can only keep up with a limited number of sim steps per frame at this molecule count. Raising the slider past the cap has no effect; drop the molecule count or pick a faster preset in Advanced to push it higher.';
    } else {
      speedValue.textContent = `${req}`;
      speedValue.title = '';
    }
  };
  setInterval(updateEffectiveSpeed, 500);

  // Mode 2: Barostat toggle + target pressure slider
  document.getElementById('toggle-barostat')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.classList.toggle('active');
    physics.set_barostat(btn.classList.contains('active'));
  });

  // Mode 2: Periodic boundary toggle (Walls button)
  document.getElementById('toggle-periodic')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.classList.toggle('active');
    const hasWalls = btn.classList.contains('active');  // Active = walls on
    physics.set_periodic(!hasWalls);  // Periodic is opposite of walls
    btn.textContent = hasWalls ? 'Solid Walls' : 'No Walls';
    updateBoxAppearance(hasWalls);
  });

  // Mode 2: Box size slider
  const boxSizeSlider = document.getElementById('box-size-slider') as HTMLInputElement;
  const boxSizeValue = document.getElementById('box-size-value') as HTMLSpanElement;
  boxSizeSlider.addEventListener('input', () => {
    const newSize = parseFloat(boxSizeSlider.value);
    physics.set_box_size(newSize);
    boxSizeValue.textContent = newSize.toString();
    if (boxHelper) {
      boxHelper.scale.setScalar(newSize * ANGSTROM_TO_SCENE / INITIAL_BOX_SIZE_FOR_HELPER);
    }
  });

  // Mode 2: Add Salt Crystal button - creates a NaCl crystal that water can dissolve
  document.getElementById('add-salt-btn')!.addEventListener('click', async () => {
    if (currentMode !== 'mode2' || !boxMoleculeData || boxMoleculeData.name.toLowerCase() !== 'water') {
      alert('Please switch to Mode 2 and load a water simulation first.');
      return;
    }

    // Load ion data
    const naData = await loadMolecule('sodium_ion');
    const clData = await loadMolecule('chloride_ion');

    // NaCl lattice spacing is about 2.82 Å
    const LATTICE_SPACING = 2.82;

    // Scale crystal size with water count - use more pairs for better visibility
    const waterCount = boxMolecules.filter(m => m.getData().atoms.length === 3).length;
    let CRYSTAL_SIZE: number;
    if (waterCount <= 64) {
      CRYSTAL_SIZE = 2;  // 2x2x2 = 16 pairs (32 ions) for 64 water
    } else if (waterCount <= 125) {
      CRYSTAL_SIZE = 2;  // 2x2x2 for 125 water
    } else {
      CRYSTAL_SIZE = 2;  // 2x2x2 for 216 water (can increase if needed)
    }

    const cloudOn = document.getElementById('toggle-cloud')?.classList.contains('active') ?? true;

    // Place crystal on the side of the water drop so water can "attack" it
    // Get current box size to position crystal appropriately
    const boxSize = physics.get_box_size();
    const crystalOffset = boxSize * 0.15; // Place crystal 15% from center edge
    const centerX = crystalOffset;
    const centerY = crystalOffset;
    const centerZ = crystalOffset;

    let ionCount = 0;

    // Build NaCl crystal lattice (alternating Na+ and Cl-)
    // Each unit cell has 4 Na and 4 Cl at corners and face centers
    for (let cx = 0; cx < CRYSTAL_SIZE; cx++) {
      for (let cy = 0; cy < CRYSTAL_SIZE; cy++) {
        for (let cz = 0; cz < CRYSTAL_SIZE; cz++) {
          const offsetX = (cx - CRYSTAL_SIZE / 2 + 0.5) * LATTICE_SPACING * 2;
          const offsetY = (cy - CRYSTAL_SIZE / 2 + 0.5) * LATTICE_SPACING * 2;
          const offsetZ = (cz - CRYSTAL_SIZE / 2 + 0.5) * LATTICE_SPACING * 2;

          // Na+ at corners of this unit cell
          const naPositions = [
            [0, 0, 0],
            [LATTICE_SPACING, LATTICE_SPACING, 0],
            [LATTICE_SPACING, 0, LATTICE_SPACING],
            [0, LATTICE_SPACING, LATTICE_SPACING],
          ];

          // Cl- at face centers
          const clPositions = [
            [LATTICE_SPACING / 2, LATTICE_SPACING / 2, 0],
            [LATTICE_SPACING / 2, 0, LATTICE_SPACING / 2],
            [0, LATTICE_SPACING / 2, LATTICE_SPACING / 2],
            [LATTICE_SPACING, LATTICE_SPACING / 2, LATTICE_SPACING / 2],
          ];

          for (const [dx, dy, dz] of naPositions) {
            const x = centerX + offsetX + dx;
            const y = centerY + offsetY + dy;
            const z = centerZ + offsetZ + dz;

            addMoleculeToPhysics(naData, x, y, z);
            const naRenderer = new MoleculeRenderer(naData);
            naRenderer.getGroup().position.set(x * ANGSTROM_TO_SCENE, y * ANGSTROM_TO_SCENE, z * ANGSTROM_TO_SCENE);
            naRenderer.setCloudVisible(cloudOn);
            sceneManager.scene.add(naRenderer.getGroup());
            boxMolecules.push(naRenderer);
            ionCount++;
          }

          for (const [dx, dy, dz] of clPositions) {
            const x = centerX + offsetX + dx;
            const y = centerY + offsetY + dy;
            const z = centerZ + offsetZ + dz;

            addMoleculeToPhysics(clData, x, y, z);
            const clRenderer = new MoleculeRenderer(clData);
            clRenderer.getGroup().position.set(x * ANGSTROM_TO_SCENE, y * ANGSTROM_TO_SCENE, z * ANGSTROM_TO_SCENE);
            clRenderer.setCloudVisible(cloudOn);
            sceneManager.scene.add(clRenderer.getGroup());
            boxMolecules.push(clRenderer);
            ionCount++;
          }
        }
      }
    }

    console.log(`Added NaCl crystal with ${ionCount} ions`);
  });

  // Graph toggle
  const graphBtn = document.getElementById('toggle-graph') as HTMLButtonElement;
  const graphContainer = document.getElementById('graph-container') as HTMLDivElement;
  graphBtn.addEventListener('click', () => {
    showGraph = !showGraph;
    if (showGraph) {
      graphContainer.style.display = 'block';
      graphBtn.textContent = 'Hide Graph';
      // Clear history when showing graph
      graphHistory = [];
    } else {
      graphContainer.style.display = 'none';
      graphBtn.textContent = 'Show Graph';
    }
  });

  const pTargetSlider = document.getElementById('pressure-target-slider') as HTMLInputElement;
  const pTargetValue = document.getElementById('pressure-target-value') as HTMLSpanElement;
  pTargetSlider.addEventListener('input', () => {
    pTargetValue.textContent = pTargetSlider.value;
    physics.set_target_pressure(parseFloat(pTargetSlider.value));
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
    // Prompts may contain inline <span class="glossary" title="..."> markup
    // for hover-definitions. The text comes from static code in
    // Experiments.ts, so innerHTML is safe here.
    promptText.innerHTML = exp.prompt;
    promptEl.style.display = 'block';
  }

  // Set mode
  const modeSelector = document.getElementById('mode-selector') as HTMLSelectElement;

  if (exp.mode === 'mode1') {
    // Set molecule selectors first so switchMode/loadMode1Pair picks up the
    // experiment's molecules rather than whatever was previously loaded.
    const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
    const selB = document.getElementById('molecule-b-selector') as HTMLSelectElement;
    selA.value = exp.moleculeA;
    if (exp.moleculeB) selB.value = exp.moleculeB;

    modeSelector.value = 'mode1';
    switchMode('mode1');
  } else {
    // Set temperature and count before switching mode
    if (exp.temperature) {
      const slider = document.getElementById('temp-slider') as HTMLInputElement;
      slider.value = exp.temperature.toString();
      slider.dispatchEvent(new Event('input'));
    }
    if (exp.moleculeCount) {
      const countSlider = document.getElementById('molecule-count-slider') as HTMLInputElement;
      // Find the closest preset value
      const closestIdx = MOLECULE_COUNT_PRESETS.reduce((bestIdx, val, idx) => {
        const bestDiff = Math.abs(MOLECULE_COUNT_PRESETS[bestIdx] - exp.moleculeCount!);
        const currDiff = Math.abs(val - exp.moleculeCount!);
        return currDiff < bestDiff ? idx : bestIdx;
      }, 0);
      countSlider.value = closestIdx.toString();
      countSlider.dispatchEvent(new Event('input'));
    }

    // Set barostat state if specified by experiment
    if (exp.barostat !== undefined) {
      const barostatBtn = document.getElementById('toggle-barostat') as HTMLButtonElement;
      if (exp.barostat) {
        barostatBtn.classList.add('active');
      } else {
        barostatBtn.classList.remove('active');
      }
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

    // Propagate the new orientation to the physics engine so the next energy
    // calculation reflects the rotation. Three.js stores quaternions as
    // (x, y, z, w); the WASM API expects (w, x, y, z).
    const q = group.quaternion;
    physics.set_molecule_orientation(1, q.w, q.x, q.y, q.z);
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
    // Run physics steps (multiple sub-steps per frame for stability).
    // Speed multiplier lets the user fast-forward equilibration.
    // Scale down steps per frame for large systems to maintain performance.
    const nMol = boxMolecules.length;
    let baseSteps = 5;
    if (nMol > 200) baseSteps = 2;
    if (nMol > 400) baseSteps = 1;
    const requested = baseSteps * simSpeedMultiplier;
    // Auto-throttle: physics cost scales ~quadratically with N, so the same
    // speed multiplier that feels snappy at N=27 can crawl the browser at
    // N=64+. Cap steps-per-frame so the main thread stays under ~20ms of
    // physics per frame (keeping render ~30+ FPS). The effective multiplier
    // is then min(slider, cap). Calibration: N=27 allows 100 steps/frame
    // (20x * 5 base), N=64 caps ~42 steps/frame, N=128 caps ~21.
    const maxStepsPerFrame = nMol <= 27
      ? 100
      : Math.max(5, Math.round((100 * 27) / nMol));
    const stepsPerFrame = Math.min(requested, maxStepsPerFrame);
    physics.step_n(stepsPerFrame);
    // Expose effective multiplier for the UI readout.
    effectiveSpeedMultiplier = stepsPerFrame / baseSteps;

    // Resize the wireframe box to match the current physics box (the
    // barostat changes box_size each step). Scaling the existing
    // LineSegments object avoids reallocating edge geometry every frame.
    if (boxHelper) {
      const currentBox = physics.get_box_size();
      boxHelper.scale.setScalar(currentBox * ANGSTROM_TO_SCENE / INITIAL_BOX_SIZE_FOR_HELPER);
    }

    // Update each molecule's group transform from physics. We drive the
    // group's position and quaternion; the atom meshes live in the group's
    // body frame (set at construction) so Three.js handles the rigid-body
    // transform for us. No updateAtomPositions call is needed in box mode.
    const positions = physics.get_all_positions();
    const orientations = physics.get_all_orientations();
    for (let i = 0; i < boxMolecules.length; i++) {
      const x = positions[i * 3] * ANGSTROM_TO_SCENE;
      const y = positions[i * 3 + 1] * ANGSTROM_TO_SCENE;
      const z = positions[i * 3 + 2] * ANGSTROM_TO_SCENE;
      const group = boxMolecules[i].getGroup();
      group.position.set(x, y, z);
      // WASM returns (w, x, y, z); Three.js Quaternion.set takes (x, y, z, w).
      const qw = orientations[i * 4];
      const qx = orientations[i * 4 + 1];
      const qy = orientations[i * 4 + 2];
      const qz = orientations[i * 4 + 3];
      group.quaternion.set(qx, qy, qz, qw);
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
  const pressure = physics.get_pressure();
  const boxSize = physics.get_box_size();

  const simTemp = document.getElementById('sim-temperature');
  const simKE = document.getElementById('sim-ke');
  const simStep = document.getElementById('sim-step');
  const simPressure = document.getElementById('sim-pressure');
  const simBox = document.getElementById('sim-box-size');

  if (simTemp) simTemp.textContent = `${Math.round(temp)} K`;
  if (simKE) simKE.textContent = `${ke.toFixed(1)} kJ/mol`;
  if (simStep) simStep.textContent = step.toString();
  if (simPressure) simPressure.textContent = `${pressure.toFixed(1)} bar`;
  if (simBox) simBox.textContent = `${boxSize.toFixed(2)} \u00C5`;

  // Compute PE and NN distance less frequently (expensive O(N^2))
  // Scale interval with molecule count to maintain performance
  let nnDist = 0;
  const peInterval = Math.max(30, boxMolecules.length / 4);
  if (statsUpdateCounter % Math.floor(peInterval) === 0) {
    const pe = physics.get_potential_energy();
    nnDist = physics.get_avg_nearest_neighbor_distance();
    const simPE = document.getElementById('sim-pe');
    const simNN = document.getElementById('sim-nn-dist');
    if (simPE) simPE.textContent = `${pe.toFixed(1)} kJ/mol`;
    if (simNN) simNN.textContent = `${nnDist.toFixed(2)} \u00C5`;

    // Add to graph history
    if (showGraph) {
      graphHistory.push({ boxSize, nnDist, step });
      if (graphHistory.length > MAX_GRAPH_POINTS) {
        graphHistory.shift();
      }
      drawGraph();
    }
  }
}

function drawGraph(): void {
  const canvas = document.getElementById('stats-graph') as HTMLCanvasElement;
  if (!canvas || graphHistory.length < 2) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Clear canvas
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  // Find min/max for scaling
  const allSizes = graphHistory.map(d => d.boxSize);
  const allNN = graphHistory.map(d => d.nnDist);
  const minVal = Math.min(...allSizes, ...allNN) * 0.95;
  const maxVal = Math.max(...allSizes, ...allNN) * 1.05;

  const padding = 20;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  // Draw grid lines
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (graphHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  // Helper to convert value to Y coordinate
  const toY = (val: number) => height - padding - ((val - minVal) / (maxVal - minVal)) * graphHeight;
  const toX = (index: number) => padding + (index / (MAX_GRAPH_POINTS - 1)) * graphWidth;

  // Draw box size line (green)
  ctx.strokeStyle = '#4f8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  graphHistory.forEach((data, i) => {
    const x = toX(i);
    const y = toY(data.boxSize);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw NN distance line (red)
  ctx.strokeStyle = '#f84';
  ctx.beginPath();
  graphHistory.forEach((data, i) => {
    const x = toX(i);
    const y = toY(data.nnDist);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw current values
  const lastData = graphHistory[graphHistory.length - 1];
  ctx.fillStyle = '#4f8';
  ctx.font = '10px monospace';
  ctx.fillText(`${lastData.boxSize.toFixed(1)}Å`, width - 50, toY(lastData.boxSize) - 5);
  ctx.fillStyle = '#f84';
  ctx.fillText(`${lastData.nnDist.toFixed(2)}Å`, width - 50, toY(lastData.nnDist) + 12);
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
  const myToken = ++loadToken;

  try {
    // Load data (may await). Defer scene/physics mutation until after the
    // await so a later call that supersedes us can bail out cleanly.
    const aData = await loadMolecule(nameA);
    const bData = await loadMolecule(nameB);
    if (myToken !== loadToken) return;

    // Clean up anything currently attached, including meshes committed by
    // a prior in-flight call whose awaits resolved before ours.
    moleculeA?.dispose();
    moleculeB?.dispose();
    moleculeA = null;
    moleculeB = null;
    clearMode2();
    physics.clear();
    interactionViz.clear();

    moleculeAData = aData;
    moleculeBData = bData;

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
    // Use molecule-specific LJ params if provided, otherwise fall back to element defaults
    const epsilon = a.epsilon ?? (LJ_PARAMS[a.element]?.epsilon ?? 0.5);
    const sigma = a.sigma ?? (LJ_PARAMS[a.element]?.sigma ?? 3.0);
    return {
      element: a.element,
      x: a.x + cx,
      y: a.y + cy,
      z: a.z + cz,
      charge: a.charge,
      epsilon,
      sigma,
      mass: ELEMENT_MASS[a.element] ?? 12.0,
    };
  });

  const json = JSON.stringify({
    atoms,
    polarizability: data.polarizability,
    virtual_sites: data.virtual_sites ?? [],
  });

  physics.add_molecule(json);
}

async function loadMode2(moleculeName: string, count: number): Promise<void> {
  const myToken = ++loadToken;
  isSimulationRunning = false;

  try {
    const data = await loadMolecule(moleculeName);
    if (myToken !== loadToken) return;

    // Clean up anything currently attached, including a stray mode1 pair
    // that a superseded load may have committed.
    moleculeA?.dispose();
    moleculeB?.dispose();
    moleculeA = null;
    moleculeB = null;
    clearMode2();
    physics.clear();
    interactionViz.clear();

    boxMoleculeData = data;

    // Get target temperature BEFORE calculating box size, since water density
    // depends strongly on temperature (liquid vs ice).
    const targetTemp = parseFloat((document.getElementById('temp-slider') as HTMLInputElement).value);

    // Calculate the volume needed for the molecules at liquid density
    // TIP4P/2005 water density varies with temperature:
    // - 298K (liquid): 0.997 g/cm³ = 0.0334 molecules/Å³
    // - 273K (ice): 0.92 g/cm³ = 0.0308 molecules/Å³ (~8% less dense)
    const isWater = data.name.toLowerCase() === 'water';
    let moleculeVolume: number;
    if (isWater) {
      let density: number;
      if (targetTemp < 273) {
        density = 0.0312;
      } else {
        density = 0.0334;
      }
      moleculeVolume = count / density;
    } else {
      const targetSpacing = 4.5;
      moleculeVolume = Math.pow(targetSpacing * Math.cbrt(count), 3);
    }

    // Size the box with enough headroom around the initial "drop" that a
    // salt crystal (2x2x2 NaCl unit cells, ~11 A wide, placed ~15% from
    // center) and its ions have somewhere to dissolve into. 3.2x puts the
    // box at ~49 A for 125 waters, which keeps the crystal and its dissolved
    // ions clear of the walls.
    const dropSize = Math.cbrt(moleculeVolume);
    const boxSize = dropSize * 3.2;

    physics.set_box_size(boxSize);
    physics.set_periodic(false);  // Default to walls (not periodic) - easier to understand
    physics.set_thermostat(true);
    physics.set_temperature(targetTemp);

    // Barostat: off by default for stable liquid simulation.
    // User can enable to see boiling/condensation effects.
    const barostatBtn = document.getElementById('toggle-barostat');
    let barostatOn = barostatBtn?.classList.contains('active') ?? false;
    physics.set_barostat(barostatOn);
    const pTarget = parseFloat(
      (document.getElementById('pressure-target-slider') as HTMLInputElement).value
    );
    physics.set_target_pressure(pTarget);

    // Create box visualization
    boxGroup = new THREE.Group();
    const halfBox = (boxSize / 2) * ANGSTROM_TO_SCENE;
    INITIAL_BOX_SIZE_FOR_HELPER = boxSize;
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

    // Update box size slider to match
    const boxSizeSlider = document.getElementById('box-size-slider') as HTMLInputElement;
    const boxSizeValue = document.getElementById('box-size-value') as HTMLSpanElement;
    boxSizeSlider.value = boxSize.toString();
    boxSizeValue.textContent = Math.round(boxSize).toString();

    // Update periodic button state (default = Solid Walls, not periodic)
    const periodicBtn = document.getElementById('toggle-periodic') as HTMLButtonElement;
    periodicBtn.classList.add('active');
    periodicBtn.textContent = 'Solid Walls';
    updateBoxAppearance(true);  // Solid walls appearance

    // Place molecules as a "drop" in the center of the box
    // Calculate the size needed for the molecules at liquid density
    const perSide = Math.ceil(Math.cbrt(count));
    const spacing = dropSize / perSide;  // Grid spacing within the drop, not the box

    // Add random jitter to break perfect lattice - helps thermalization
    const jitterFactor = targetTemp < 273 ? 0.03 : 0.15; // 3% for ice, 15% for liquid
    const jitterAmount = spacing * jitterFactor;

    // Offset to center the drop in the box (drop is centered at 0,0,0)
    const dropOffset = dropSize / 2;

    let placed = 0;
    outer:
    for (let ix = 0; ix < perSide; ix++) {
      for (let iy = 0; iy < perSide; iy++) {
        for (let iz = 0; iz < perSide; iz++) {
          if (placed >= count) break outer;
          const jitterX = (Math.random() - 0.5) * jitterAmount;
          const jitterY = (Math.random() - 0.5) * jitterAmount;
          const jitterZ = (Math.random() - 0.5) * jitterAmount;
          // Position within the drop (centered at 0,0,0), not the box
          const x = -dropOffset + spacing * (ix + 0.5) + jitterX;
          const y = -dropOffset + spacing * (iy + 0.5) + jitterY;
          const z = -dropOffset + spacing * (iz + 0.5) + jitterZ;

          addMoleculeToPhysics(boxMoleculeData, x, y, z);

          const renderer = new MoleculeRenderer(boxMoleculeData);
          renderer.getGroup().position.set(
            x * ANGSTROM_TO_SCENE,
            y * ANGSTROM_TO_SCENE,
            z * ANGSTROM_TO_SCENE,
          );
          // Respect the current Cloud toggle state so clouds appear in box
          // mode too. The O(N^2) cloud deformer is not invoked in updateMode2,
          // so clouds render as static semi-transparent spheres (cheap on GPU).
          const cloudOn = document.getElementById('toggle-cloud')?.classList.contains('active') ?? true;
          renderer.setCloudVisible(cloudOn);
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
    const countIdx = parseInt(countSlider.value);
    const actualCount = MOLECULE_COUNT_PRESETS[countIdx];
    loadMode2(selA.value, actualCount);
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
