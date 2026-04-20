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
import {
  WATER_MODELS,
  DEFAULT_WATER_MODEL_ID,
  suggestModelForTemperature,
} from './utils/waterModels';
import {
  generateIceIhSeed,
  seedDimsForCount,
  minDistToSeedOxygen,
} from './utils/iceIh';
import init, {
  SimulationSystem,
  initThreadPool,
  init_persistent_pool,
  shutdown_persistent_pool,
  bench_pool_dispatch,
  persistent_pool_ready,
  set_persistent_pool_workers,
  persistent_pool_worker_count,
} from './wasm-pkg/chemsim_physics';

// Molecule count presets for box mode (perfect cubes for even grid placement)
const MOLECULE_COUNT_PRESETS = [8, 27, 64, 125, 216, 343, 512, 729, 1000]; // 2³..10³

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

// Active water force-field model. Applied to every `water` MoleculeData
// before it reaches the renderer or the physics engine, so both views agree.
// Experiments can override this on load (e.g. 'tip4p-ice' for freezing);
// the Advanced panel dropdown lets the user override further. Switching
// models rebuilds the mode-2 box rather than hot-swapping mid-run.
let currentWaterModelId: string = DEFAULT_WATER_MODEL_ID;

// Set by loadExperiment if the current demo needs a pre-placed ice seed
// at the center of the water drop (freezing demo). Consumed once by
// loadMode2 which carves the seed region out of the liquid grid before
// dropping the crystal in. Reset when the user changes molecule, count,
// or model so subsequent Mode-2 loads don't unexpectedly seed.
let activeIceSeedExperiment: boolean = false;

// Molecule indices of frozen waters (seed + auto-promoted) currently
// carrying the ice-blue tint. Transitions in is_frozen are synced to
// setFrozenTint each animation frame. Reset on every new Mode-2 load.
const seedTinted: Set<number> = new Set();

// Running accumulator for auto-freeze throttling: we call
// auto_freeze_near_frozen every ~2 sim-ps of elapsed time, not every
// frame, so the crystal growth looks the same regardless of speed
// multiplier and doesn't flash through all waters in one frame.
let autoFreezePsAccum = 0;
const AUTO_FREEZE_INTERVAL_PS = 2.0;
const AUTO_FREEZE_MAX_PER_CALL = 3;
// Quietness gate: a water must be tumbling slower than this before it
// gets promoted to frozen. Bulk liquid water at 240 K typically shows
// mean |ω| around 5–10 rad/ps; this cutoff filters those out and
// captures only molecules that have genuinely settled into the H-bond
// network surrounding the crystal.
const AUTO_FREEZE_OMEGA_MAX_RAD_PS = 3.0;
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
// Desired persistent-pool size (what the Threads slider is set to). The
// live pool may be parked (workers shut down) when the sim is paused or
// the tab is hidden — this holds the count to restore on resume.
let desiredWorkerCount = 0;

/// Park (shut down) or resume the persistent worker pool to match the
/// sim's current run state. Workers spin at 100% CPU when alive, so we
/// tear them down while the sim is paused / the tab is hidden to give
/// the laptop a break, and bring them back up the moment the user hits
/// Play again. Falls back to serial cell list while parked (compute
/// path auto-detects pool_worker_count == 0).
function matchPoolToRunState(): void {
  if (desiredWorkerCount === 0) return;
  const shouldRun = isSimulationRunning && currentMode === 'mode2' && !document.hidden;
  const alive = persistent_pool_worker_count() > 0;
  if (shouldRun && !alive) {
    init_persistent_pool(desiredWorkerCount);
  } else if (!shouldRun && alive) {
    shutdown_persistent_pool();
  }
}

/// Single point of truth for sim run-state: flips the bool, updates the
/// Play/Pause button text + active class, and parks or wakes the worker
/// pool. Every caller that used to set `isSimulationRunning` directly
/// should route through here so the UI and pool never drift out of sync.
function setSimRunning(running: boolean): void {
  isSimulationRunning = running;
  const btn = document.getElementById('toggle-sim-play') as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = running ? 'Pause' : 'Play';
    btn.classList.toggle('active', running);
  }
  matchPoolToRunState();
}
let showInteractionNetwork = false;
let networkLines: THREE.LineSegments | null = null;
let statsUpdateCounter = 0;
let tutorial: Tutorial;

// Graph data for tracking box size and NN distance over time
const MAX_GRAPH_POINTS = 200;
let graphHistory: { nnDist: number; omega: number; timePs: number }[] = [];
let showGraph = true;

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
      // Rayon hosts the persistent workers. Size its pool to the machine's
      // logical core count (capped at 32 to keep wasm memory reasonable)
      // so the user can later scale the persistent pool up to that ceiling.
      const nCores = Math.max(2, Math.min(32, navigator.hardwareConcurrency || 4));
      await initThreadPool(nCores);
      console.log(`ChemSim: rayon thread pool initialized with ${nCores} threads`);
      // Default persistent pool size leaves 2 cores free (one for the main
      // thread driving dispatch/render, one breathing room for the OS/UI).
      // User can override this via the Threads slider in the Advanced panel.
      const defaultWorkers = Math.max(1, nCores - 2);
      const storedWorkers = parseInt(
        localStorage.getItem('chemsim.workers') || String(defaultWorkers),
      );
      const workerCount = Math.max(1, Math.min(nCores, storedWorkers));
      init_persistent_pool(workerCount);
      console.log(`ChemSim: persistent spin-pool ready (${workerCount} workers, ${nCores} available)`);
      // Park the workers immediately — we don't enter Mode 2 on load, so
      // nothing's asking for forces yet. They'll spin back up when the
      // user hits Play.
      desiredWorkerCount = workerCount;
      shutdown_persistent_pool();
      // Stash for the UI wiring below.
      (globalThis as any).__chemsim_core_limit = nCores;
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
    // Measure persistent-pool dispatch latency. Compare against rayon's
    // ~1-2 ms per par_iter. Target: <100 us.
    benchPoolDispatch(nIters: number) {
      if (!persistent_pool_ready()) return { error: 'persistent pool not initialized' };
      const totalMs = bench_pool_dispatch(nIters);
      return {
        totalMs,
        perDispatchUs: (totalMs / nIters) * 1000,
        nIters,
      };
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

  // Molecule selectors. In Mode 1 a change on either selector rebuilds
  // the interacting pair. In Mode 2 only Molecule A matters — the box is
  // mono-species — so we reload the mode-2 box with the new molecule at
  // the current count. Previously both selectors unconditionally called
  // loadMode1Pair, which put a Mode-1 pair into a scene whose
  // currentMode was still 'mode2', so the pointer handlers refused to
  // let the user drag the new molecules.
  const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
  const selB = document.getElementById('molecule-b-selector') as HTMLSelectElement;
  const reloadForSelectorChange = () => {
    if (currentMode === 'mode2') {
      // Switching molecule mid-experiment drops us out of any
      // experiment-specific setup (ice seed, etc.) by design.
      activeIceSeedExperiment = false;
      const countSliderEl = document.getElementById('molecule-count-slider') as HTMLInputElement;
      const idx = parseInt(countSliderEl.value);
      loadMode2(selA.value, MOLECULE_COUNT_PRESETS[idx]);
    } else {
      loadMode1Pair(selA.value, selB.value);
    }
  };
  selA.addEventListener('change', reloadForSelectorChange);
  selB.addEventListener('change', reloadForSelectorChange);

  // Temperature slider
  const tempSlider = document.getElementById('temp-slider') as HTMLInputElement;
  const tempValue = document.getElementById('temp-value') as HTMLSpanElement;
  tempSlider.addEventListener('input', () => {
    tempValue.textContent = tempSlider.value;
    physics.set_temperature(parseFloat(tempSlider.value));
  });

  // Molecule count slider - uses preset perfect cube values for even grid placement
  const MOLECULE_COUNT_PRESETS = [8, 27, 64, 125, 216, 343, 512, 729, 1000]; // 2³..10³
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

  // Mode 2: Play/Pause — all UI + pool state change lives in setSimRunning.
  document.getElementById('toggle-sim-play')!.addEventListener('click', () => {
    setSimRunning(!isSimulationRunning);
  });

  // Also park workers when the tab is backgrounded — no point burning
  // 2000% CPU for a simulation nobody can see.
  document.addEventListener('visibilitychange', matchPoolToRunState);

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
    // Box-size floor depends on cutoff (MI convention needs box > 2·cutoff).
    // Update the box-size slider's lower bound when the cutoff changes so
    // the user can't subsequently shrink into an invalid configuration.
    const n = boxMolecules.length;
    if (n > 0) {
      const boxSlider = document.getElementById('box-size-slider') as HTMLInputElement | null;
      if (boxSlider) {
        const floor = Math.ceil(Math.max(Math.cbrt(n * 20), v * 2 + 1));
        boxSlider.min = String(floor);
        if (parseFloat(boxSlider.value) < floor) {
          boxSlider.value = String(floor);
          physics.set_box_size(floor);
        }
      }
    }
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

  // Threads slider: lets the user dial the persistent pool up or down
  // at runtime. Range max is the machine's logical core count; the slider
  // is hidden if threading never initialized (e.g. plain http over IP).
  const threadsSlider = document.getElementById('threads-slider') as HTMLInputElement;
  const threadsValue = document.getElementById('threads-value') as HTMLSpanElement;
  const threadsMaxLabel = document.getElementById('threads-max-label') as HTMLSpanElement;
  const coreLimit = ((globalThis as any).__chemsim_core_limit as number) ?? 1;
  // After the startup-time shutdown, desiredWorkerCount holds the target.
  const initialWorkers = desiredWorkerCount;
  if (initialWorkers === 0) {
    // No threading available (insecure context or init failed) — hide the
    // knob so students aren't confused by a dead control.
    threadsSlider.parentElement!.style.display = 'none';
  } else {
    threadsSlider.max = coreLimit.toString();
    threadsSlider.value = initialWorkers.toString();
    threadsValue.textContent = initialWorkers.toString();
    threadsMaxLabel.textContent = `(of ${coreLimit})`;
    threadsSlider.addEventListener('input', () => {
      const n = parseInt(threadsSlider.value);
      threadsValue.textContent = n.toString();
    });
    threadsSlider.addEventListener('change', () => {
      const n = parseInt(threadsSlider.value);
      desiredWorkerCount = n;
      localStorage.setItem('chemsim.workers', String(n));
      // If the pool is currently alive, resize it in place. If it's
      // parked (paused / hidden tab), just update the target — next
      // resume will use the new count.
      if (persistent_pool_worker_count() > 0) {
        set_persistent_pool_workers(n);
      }
      console.log(`ChemSim: persistent pool target = ${n} workers`);
    });
  }

  // Water-model dropdown: pick the classical force field used for every
  // water molecule. Change rebuilds mode-2 so the new charges / LJ take
  // effect cleanly (live-swap would cause a discontinuous energy jump).
  const waterModelSel = document.getElementById('water-model-selector') as HTMLSelectElement;
  waterModelSel.value = currentWaterModelId;
  waterModelSel.addEventListener('change', () => {
    setWaterModelId(waterModelSel.value, /*rebuild=*/true);
  });
  // Temperature-change listener also re-renders the hint so the warning
  // tracks the slider live.
  const tempSliderForHint = document.getElementById('temp-slider') as HTMLInputElement;
  tempSliderForHint.addEventListener('input', updateWaterModelHint);
  // Initial hint draw.
  updateWaterModelHint();

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
  document.getElementById('add-ice-seed-btn')!.addEventListener('click', () => {
    if (currentMode !== 'mode2' || !boxMoleculeData || boxMoleculeData.name.toLowerCase() !== 'water') {
      alert('Please switch to Mode 2 and load a water simulation first.');
      return;
    }
    if (currentWaterModelId !== 'tip4p-ice') {
      const ok = confirm(
        `The current water model (${WATER_MODELS[currentWaterModelId]?.label ?? currentWaterModelId}) ` +
        `melts below ~${WATER_MODELS[currentWaterModelId]?.meltingPointK ?? 0} K. ` +
        `An ice seed will melt immediately. Continue anyway?`,
      );
      if (!ok) return;
    }
    const n = addIceSeed(0, 0, 0);
    console.log(`Ice seed: ${n} waters placed at center`);
  });

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

  // Graph toggle (default: on — see index.html's #graph-container/display).
  const graphBtn = document.getElementById('toggle-graph') as HTMLButtonElement;
  const graphContainer = document.getElementById('graph-container') as HTMLDivElement;
  graphBtn.addEventListener('click', () => {
    showGraph = !showGraph;
    if (showGraph) {
      graphContainer.style.display = 'block';
      graphBtn.textContent = 'Hide Graph';
      graphBtn.classList.add('active');
      graphHistory = [];
    } else {
      graphContainer.style.display = 'none';
      graphBtn.textContent = 'Show Graph';
      graphBtn.classList.remove('active');
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

  // Apply the experiment's water-model preference before the mode switch
  // triggers any loads, so the new molecules come up with the right model.
  if (exp.waterModel && WATER_MODELS[exp.waterModel]) {
    setWaterModelId(exp.waterModel, /*rebuild=*/false);
  }

  // Consumed by the first Mode-2 load that runs after this experiment
  // load; cleared afterwards so a later count/model change doesn't
  // accidentally re-seed.
  activeIceSeedExperiment = !!exp.iceSeed;

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
    // No artificial auto-throttle anymore — if the user cranks the slider
    // past what the machine can keep up with, frames just drop. Honest.
    const stepsPerFrame = baseSteps * simSpeedMultiplier;
    physics.step_n(stepsPerFrame);
    effectiveSpeedMultiplier = simSpeedMultiplier;

    // Local melting: ions approaching the seed unfreeze it locally.
    const thawed = physics.unfreeze_near_ions(4.5);

    // Temperature-driven melting: if the target T has crossed above the
    // current water model's melting point, release all frozen molecules
    // back into normal dynamics. Without this escape hatch they stay
    // rigid at 400 K and the thermostat can't touch them. Runs at most
    // once per crossing; if T drops back below Tm and you want the
    // crystal back, re-seed with Add Ice Seed.
    let meltedAll = 0;
    const model = WATER_MODELS[currentWaterModelId];
    const tempSlider = document.getElementById('temp-slider') as HTMLInputElement | null;
    if (model && tempSlider && seedTinted.size > 0) {
      const targetT = parseFloat(tempSlider.value);
      if (targetT > model.meltingPointK) {
        meltedAll = physics.unfreeze_all_frozen();
      }
    }

    // Crystal growth: liquid waters H-bonded to the crystal get promoted
    // to frozen on a sim-time schedule. Keeps growth pace consistent
    // across speed multipliers. Skip entirely if we're above Tm — can't
    // grow ice in a too-warm bath.
    const dtFs = parseFloat(
      (document.getElementById('timestep-slider') as HTMLInputElement).value,
    );
    const elapsedPs = (stepsPerFrame * dtFs) / 1000;
    autoFreezePsAccum += elapsedPs;
    let promoted = 0;
    const aboveTm = model && tempSlider
      ? parseFloat(tempSlider.value) > model.meltingPointK
      : false;
    if (!aboveTm && seedTinted.size > 0 && autoFreezePsAccum >= AUTO_FREEZE_INTERVAL_PS) {
      promoted = physics.auto_freeze_near_frozen(
        AUTO_FREEZE_MAX_PER_CALL,
        AUTO_FREEZE_OMEGA_MAX_RAD_PS,
      );
      autoFreezePsAccum = 0;
    }

    // Sync tints for any frozen-state transitions from melting, ion
    // contact, or growth. Only touch molecules whose flag disagrees
    // with the cached set.
    if (thawed > 0 || promoted > 0 || meltedAll > 0) {
      for (let i = 0; i < boxMolecules.length; i++) {
        const nowFrozen = physics.is_molecule_frozen(i);
        const wasTinted = seedTinted.has(i);
        if (nowFrozen && !wasTinted) {
          boxMolecules[i].setFrozenTint(true);
          seedTinted.add(i);
        } else if (!nowFrozen && wasTinted) {
          boxMolecules[i].setFrozenTint(false);
          seedTinted.delete(i);
        }
      }
    }

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
  const simTime = document.getElementById('sim-time');
  const simPressure = document.getElementById('sim-pressure');
  const simBox = document.getElementById('sim-box-size');

  if (simTemp) simTemp.textContent = `${Math.round(temp)} K`;
  if (simKE) simKE.textContent = `${ke.toFixed(1)} kJ/mol`;
  if (simStep) simStep.textContent = step.toString();
  if (simTime) {
    // Timestep slider is in fs for legibility; time = steps * dt_fs / 1000 ps.
    const dtFs = parseFloat(
      (document.getElementById('timestep-slider') as HTMLInputElement).value,
    );
    const timePs = (Number(step) * dtFs) / 1000;
    simTime.textContent = timePs < 10
      ? `${timePs.toFixed(2)} ps`
      : timePs < 1000
        ? `${timePs.toFixed(1)} ps`
        : `${(timePs / 1000).toFixed(2)} ns`;
  }
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

    // Add to graph history. Ordering front: mean |ω| of the non-frozen
    // ("liquid") molecules. Drops as water molecules orient into the
    // H-bond network and stop tumbling — a freezing order parameter.
    if (showGraph) {
      const dtFs = parseFloat(
        (document.getElementById('timestep-slider') as HTMLInputElement).value,
      );
      const timePs = (Number(step) * dtFs) / 1000;
      const omega = physics.get_mean_angular_speed_liquid();
      graphHistory.push({ nnDist, omega, timePs });
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

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  const padding = 20;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  // Grid lines
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (graphHeight / 4) * i;
    ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
  }

  const toX = (index: number) => padding + (index / (MAX_GRAPH_POINTS - 1)) * graphWidth;

  // Two independent series with their own Y axes so NN (≈3 Å) and
  // angular speed (≈0–15 rad/ps) are both legible on one canvas.
  function drawSeries(
    values: number[],
    color: string,
    lo: number,
    hi: number,
    labelFmt: (v: number) => string,
    labelOffset: number,
  ) {
    const toY = (val: number) => height - padding - ((val - lo) / (hi - lo)) * graphHeight;
    ctx!.strokeStyle = color;
    ctx!.lineWidth = 2;
    ctx!.beginPath();
    values.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      if (i === 0) ctx!.moveTo(x, y); else ctx!.lineTo(x, y);
    });
    ctx!.stroke();
    const last = values[values.length - 1];
    ctx!.fillStyle = color;
    ctx!.font = '10px monospace';
    ctx!.fillText(labelFmt(last), width - 60, toY(last) + labelOffset);
  }

  const nnSeries = graphHistory.map(d => d.nnDist);
  const omegaSeries = graphHistory.map(d => d.omega);

  // NN dist scale: wrap the actual min/max with a little headroom.
  const nnLo = Math.min(...nnSeries) * 0.97;
  const nnHi = Math.max(...nnSeries) * 1.03;
  drawSeries(nnSeries, '#f84', nnLo, nnHi, v => `${v.toFixed(2)} Å`, -5);

  // Angular-speed scale: pinned to 0 so a drop is visually unmistakable.
  const omegaHi = Math.max(...omegaSeries, 5) * 1.1;
  drawSeries(omegaSeries, '#6af', 0, omegaHi, v => `${v.toFixed(2)} rad/ps`, 12);
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

    moleculeAData = applyActiveWaterModel(aData);
    moleculeBData = applyActiveWaterModel(bData);

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

/** Switch the active water model. If `rebuild` is true and we're in mode 2
 *  with water, reload the box so the new charges / LJ take effect. The
 *  dropdown is kept in sync, and the temperature hint is refreshed. */
function setWaterModelId(newId: string, rebuild: boolean): void {
  if (!WATER_MODELS[newId] || newId === currentWaterModelId) {
    // Still sync the dropdown in case an experiment picked the current value.
    const sel = document.getElementById('water-model-selector') as HTMLSelectElement | null;
    if (sel) sel.value = currentWaterModelId;
    updateWaterModelHint();
    return;
  }
  currentWaterModelId = newId;
  const sel = document.getElementById('water-model-selector') as HTMLSelectElement | null;
  if (sel) sel.value = newId;
  updateWaterModelHint();
  if (!rebuild) return;
  if (currentMode === 'mode2' && boxMoleculeData
      && boxMoleculeData.name.toLowerCase() === 'water') {
    const countSlider = document.getElementById('molecule-count-slider') as HTMLInputElement;
    const selA = document.getElementById('molecule-a-selector') as HTMLSelectElement;
    const idx = parseInt(countSlider.value);
    loadMode2(selA.value, MOLECULE_COUNT_PRESETS[idx]);
  }
}

/** Refresh the Advanced-panel hint that warns when the current target
 *  temperature falls outside the selected model's comfort range. */
function updateWaterModelHint(): void {
  const hintEl = document.getElementById('water-model-hint');
  if (!hintEl) return;
  const model = WATER_MODELS[currentWaterModelId];
  if (!model) { hintEl.textContent = ''; return; }

  const tempInput = document.getElementById('temp-slider') as HTMLInputElement | null;
  const t = tempInput ? parseFloat(tempInput.value) : NaN;

  const suggestion = !isNaN(t) ? suggestModelForTemperature(currentWaterModelId, t) : null;
  if (suggestion) {
    hintEl.innerHTML =
      `${model.notes}<br>` +
      `<b>${Math.round(t)} K is outside ${model.label}'s calibrated range</b> ` +
      `(${model.usefulRangeK[0]}–${model.usefulRangeK[1]} K). ` +
      `<a href="#" id="water-model-swap" style="color:#6af;">Switch to ${suggestion.label}</a>.`;
    const link = document.getElementById('water-model-swap');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        setWaterModelId(suggestion.id, true);
      });
    }
  } else {
    hintEl.textContent = model.notes;
  }
}

/** If `data` is water, clone it with atom charges / LJ / virtual sites
 *  overridden to match the active water model (see waterModels.ts). Any
 *  other molecule is returned unchanged. Caller uses the returned
 *  MoleculeData for both rendering and physics so the two stay in sync. */
function applyActiveWaterModel(data: MoleculeData): MoleculeData {
  if (data.name.toLowerCase() !== 'water') return data;
  const model = WATER_MODELS[currentWaterModelId];
  if (!model) return data;

  const atoms = data.atoms.map(a => {
    const copy = { ...a };
    if (a.element === 'O') {
      copy.charge = model.oCharge;
      copy.epsilon = model.oEpsilon;
      copy.sigma = model.oSigma;
    } else if (a.element === 'H') {
      copy.charge = model.hCharge;
    }
    return copy;
  });

  const virtual_sites = model.mCharge !== null
    ? [{ charge: model.mCharge, ref_atoms: [0, 1, 2], site_type: 'tip4p' }]
    : [];

  return { ...data, atoms, virtual_sites };
}

/** Place an ice Ih seed crystal at (cx, cy, cz). Each seed water is added
 *  to both the physics engine and the scene, then frozen so it acts as a
 *  stable substrate. Pair forces still flow normally so liquid neighbors
 *  interact with the seed.
 *
 *  `dims` controls the supercell (defaults to an N-appropriate size for
 *  the current box). Returns the number of waters placed plus the seed's
 *  oxygen world positions so the caller can skip overlapping liquid
 *  grid sites. */
function addIceSeed(
  cx: number,
  cy: number,
  cz: number,
  dims?: { nA: number; nB: number; nC: number },
): { placed: number; oxygens: [number, number, number][] } {
  if (!boxMoleculeData || boxMoleculeData.name.toLowerCase() !== 'water') {
    return { placed: 0, oxygens: [] };
  }
  const cloudOn = document.getElementById('toggle-cloud')?.classList.contains('active') ?? true;
  const d = dims ?? seedDimsForCount(boxMolecules.length || 125);
  const { waters, oxygens } = generateIceIhSeed(cx, cy, cz, d.nA, d.nB, d.nC);

  // Every seed water uses the canonical water MoleculeData unchanged;
  // only the COM and orientation quaternion differ. This keeps the rigid-
  // body frame == canonical principal-axis frame, so init_rigid_body
  // computes the right inertia tensor (no off-diagonal terms).
  let placed = 0;
  for (const w of waters) {
    addMoleculeToPhysics(boxMoleculeData, w.com[0], w.com[1], w.com[2]);
    const molIdx = physics.get_molecule_count() - 1;
    physics.set_molecule_orientation(
      molIdx,
      w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3],
    );
    physics.set_molecule_frozen(molIdx, true);

    const renderer = new MoleculeRenderer(boxMoleculeData);
    const group = renderer.getGroup();
    group.position.set(
      w.com[0] * ANGSTROM_TO_SCENE,
      w.com[1] * ANGSTROM_TO_SCENE,
      w.com[2] * ANGSTROM_TO_SCENE,
    );
    // Three.js Quaternion uses (x, y, z, w); physics engine uses (w, x, y, z).
    group.quaternion.set(w.quaternion[1], w.quaternion[2], w.quaternion[3], w.quaternion[0]);
    renderer.setCloudVisible(cloudOn);
    renderer.setFrozenTint(true);
    sceneManager.scene.add(group);
    boxMolecules.push(renderer);
    seedTinted.add(molIdx);
    placed++;
  }
  return { placed, oxygens };
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
  setSimRunning(false);

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

    boxMoleculeData = applyActiveWaterModel(data);

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

    // Size the box. Default: 3.2x drop size with solid walls — leaves
    // room for salt crystals and dissolved ions, and walls contain the
    // liquid even though it's not at a true equilibrium density.
    //
    // For the freezing demo we do the opposite: tighten the box around
    // the drop (1.3x) and use periodic boundaries. Without that, surface
    // waters with high thermal kinetic energy escape the drop and drift
    // through the empty vacuum region — physically real (zero-g
    // microscopic droplet) but visually a mess. Periodic BCs let
    // escapees wrap back around to the other side; no net drift.
    const wantIceSeed = activeIceSeedExperiment && isWater
      && WATER_MODELS[currentWaterModelId]?.id === 'tip4p-ice';
    const dropSize = Math.cbrt(moleculeVolume);
    const boxSize = wantIceSeed ? dropSize * 1.3 : dropSize * 3.2;

    physics.set_box_size(boxSize);
    physics.set_periodic(wantIceSeed);
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

    // Update box size slider to match, and set a lower bound so the user
    // can't shrink the box below something physically sensible. Floor is
    // max of:
    //   - liquid-density packing limit (~20 Å³/molecule: close-packed
    //     but not unphysical),
    //   - 2× the interaction cutoff (minimum-image convention needs
    //     box > 2·cutoff; otherwise pairs are double-counted across the
    //     wrap and forces blow up).
    const boxSizeSlider = document.getElementById('box-size-slider') as HTMLInputElement;
    const boxSizeValue = document.getElementById('box-size-value') as HTMLSpanElement;
    const cutoff = parseFloat(
      (document.getElementById('cutoff-slider') as HTMLInputElement).value,
    );
    const minBox = Math.ceil(Math.max(Math.cbrt(count * 20), cutoff * 2 + 1));
    boxSizeSlider.min = String(minBox);
    boxSizeSlider.value = boxSize.toString();
    boxSizeValue.textContent = Math.round(boxSize).toString();

    // Update periodic button + box appearance to match the actual mode.
    const periodicBtn = document.getElementById('toggle-periodic') as HTMLButtonElement;
    if (wantIceSeed) {
      periodicBtn.classList.remove('active');
      periodicBtn.textContent = 'Periodic';
      updateBoxAppearance(false);
    } else {
      periodicBtn.classList.add('active');
      periodicBtn.textContent = 'Solid Walls';
      updateBoxAppearance(true);
    }

    // If the active experiment wants an ice seed at the center (freezing
    // demo), add it BEFORE the liquid so we know where its oxygens sit;
    // the liquid loop then skips any grid site that would overlap the
    // seed. Seed waters count against `count`, so the total molecule
    // budget stays what the slider says. (wantIceSeed is already
    // computed above for box-size selection.)
    const wantSeed = wantIceSeed;
    let seedOxygens: [number, number, number][] = [];
    if (wantSeed) {
      const dims = seedDimsForCount(count);
      const r = addIceSeed(0, 0, 0, dims);
      seedOxygens = r.oxygens;
      console.log(`Ice seed: ${r.placed} waters placed (${dims.nA}x${dims.nB}x${dims.nC} supercell)`);
    }
    // How close can a liquid water's COM sit to a seed oxygen before we
    // call it an overlap? One liquid water-water O-O distance (~2.7 Å)
    // is the natural threshold — closer than that and the LJ cores push
    // the liquid away violently. Use 2.6 so the first liquid shell can
    // hug the seed at roughly H-bond distance.
    const SEED_OVERLAP_CUTOFF = 2.6;

    // Place molecules as a "drop" in the center of the box
    // Calculate the size needed for the molecules at liquid density
    const perSide = Math.ceil(Math.cbrt(count));
    const spacing = dropSize / perSide;  // Grid spacing within the drop, not the box

    // Add random jitter to break perfect lattice - helps thermalization
    const jitterFactor = targetTemp < 273 ? 0.03 : 0.15; // 3% for ice, 15% for liquid
    const jitterAmount = spacing * jitterFactor;

    // Offset to center the drop in the box (drop is centered at 0,0,0)
    const dropOffset = dropSize / 2;

    // When the seed is on, the slider's `count` is the total target
    // (seed + liquid) — don't exceed it with the liquid loop.
    const seedCount = wantSeed ? boxMolecules.length : 0;
    const liquidTarget = Math.max(0, count - seedCount);

    let placed = 0;
    outer:
    for (let ix = 0; ix < perSide; ix++) {
      for (let iy = 0; iy < perSide; iy++) {
        for (let iz = 0; iz < perSide; iz++) {
          if (placed >= liquidTarget) break outer;
          const jitterX = (Math.random() - 0.5) * jitterAmount;
          const jitterY = (Math.random() - 0.5) * jitterAmount;
          const jitterZ = (Math.random() - 0.5) * jitterAmount;
          // Position within the drop (centered at 0,0,0), not the box
          const x = -dropOffset + spacing * (ix + 0.5) + jitterX;
          const y = -dropOffset + spacing * (iy + 0.5) + jitterY;
          const z = -dropOffset + spacing * (iz + 0.5) + jitterZ;

          // Skip grid sites that would overlap a seed oxygen. Per-O check
          // (not a single sphere) so liquid hugs the seed along its long
          // c-axis and its shorter a/b axes equally well.
          if (wantSeed && seedOxygens.length > 0) {
            if (minDistToSeedOxygen(x, y, z, seedOxygens) < SEED_OVERLAP_CUTOFF) continue;
          }

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

    if (wantSeed) {
      console.log(`Liquid: ${placed} waters around ${seedOxygens.length}-oxygen seed`);
    }

    // Initialize velocities and start simulation
    physics.init_velocities();
    setSimRunning(true);

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
  seedTinted.clear();
  autoFreezePsAccum = 0;
  // Old history is meaningless once the box changes species, count,
  // or is re-seeded — wipe it so the graph restarts cleanly.
  graphHistory = [];

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
  // Mode change means either (a) we're leaving mode 2 so workers can
  // park, or (b) we're entering mode 2 but Play hasn't been hit yet —
  // either way, the right state is "parked".
  setSimRunning(false);

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
