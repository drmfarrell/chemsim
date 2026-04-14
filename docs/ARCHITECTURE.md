# ChemSim Architecture

## Overview

ChemSim is a browser-based molecular interaction simulator. All computation runs client-side with no server required.

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Rendering | Three.js | 3D graphics, WebXR |
| Physics | Rust -> WASM | Force computation, integration, cloud deformation |
| UI | Vanilla TypeScript | Controls, readouts, tutorial |
| Build | Vite | Dev server, bundling, WASM integration |
| Testing | Vitest + Playwright | Unit tests, E2E browser tests |

## Data Flow Per Frame

```
User Input (mouse drag, temp slider)
    |
    v
Physics Engine (WASM)
    - Compute forces (Coulomb + LJ)
    - Velocity Verlet integration
    - Cloud deformation vectors
    - Thermostat (Mode 2)
    |
    v
Three.js Renderer
    - Update mesh positions
    - Apply cloud deformation
    - Render frame (stereo if VR)
    |
    v
UI Update
    - Energy readout
    - FPS counter
    - Stats (Mode 2)
```

## Module Structure

```
src/
  main.ts                 # Application entry, state management, event handling
  scene/
    SceneManager.ts       # Three.js scene, camera, lights, render loop
    MoleculeRenderer.ts   # Ball-stick + cloud mesh rendering per molecule
    CloudDeformer.ts      # Bridges WASM deformation with Three.js
    InteractionVisualizer.ts  # Energy display, force arrows
    VRManager.ts          # WebXR session, controllers
  ui/
    Tutorial.ts           # Step-by-step onboarding
    Experiments.ts        # Pre-set experiment definitions
  physics/
    src/
      lib.rs              # WASM entry, shared types
      coulomb.rs          # Coulomb force/energy/field
      lennard_jones.rs    # LJ potential and force
      integrator.rs       # Velocity Verlet
      thermostat.rs       # Berendsen thermostat
      deformation.rs      # Cloud vertex displacement
      system.rs           # SimulationSystem: manages all molecules
  utils/
    constants.ts          # Physical constants, colors, defaults
    loader.ts             # Molecule JSON data loading
  data/molecules/         # Pre-computed molecule JSON files
```

## Physics Engine

### Force Computation

For each pair of molecules within the cutoff radius:
1. Sum Coulomb forces between all atom pairs: F = k * q1 * q2 / r^2
2. Sum Lennard-Jones forces between all atom pairs: F = 4*eps * (12*s^12/r^13 - 6*s^6/r^7)
3. Use Lorentz-Berthelot combining rules for mixed-element LJ parameters

### Spatial Partitioning

For > 30 molecules with periodic boundaries, a cell-list algorithm reduces force computation from O(N^2) to O(N) expected time. The simulation box is divided into cells of size equal to the cutoff radius. Only pairs in the same or neighboring cells are evaluated.

### Cloud Deformation

For each cloud mesh vertex:
1. Compute electric field E at vertex due to the other molecule's partial charges
2. Scale displacement by the vertex's local potential (electron-rich vertices move differently than electron-poor ones)
3. Clamp displacement to prevent visual artifacts
4. Update Three.js geometry buffer

## Performance Budget

| Metric | Desktop | Chromebook | Quest 3 |
|--------|---------|------------|---------|
| FPS (Mode 1) | 60 | 60 | 72 |
| FPS (Mode 2, 50 mols) | 60 | 30+ | 60 |
| Max molecules | 200 | 50 | 100 |
| Cloud deformation | Both molecules | Both | Selected only |

## Extensibility

### Adding Molecules

Create a JSON file with atom positions, partial charges, bonds, and a cloud mesh. The Python script in `scripts/` automates this from molecular geometry data.

### Adding Modes

The architecture separates physics from rendering. A new mode (e.g., reaction visualization) would:
1. Load pre-computed trajectory data
2. Feed positions/deformations to existing renderers
3. Add a new mode option to the UI

### VR Enhancements

The VRManager uses Three.js WebXR API. Adding hand tracking, haptic feedback, or floating UI panels requires extending VRManager without changing the physics layer.
