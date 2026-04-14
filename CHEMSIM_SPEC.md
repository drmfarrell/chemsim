# ChemSim: Interactive Molecular Interaction Simulator

## Specification Document v1.0

**Author:** Dr. Fountain Farrell, Cheyney University of Pennsylvania
**Target:** Claude Code implementation with parallel research agents
**Date:** April 2026

---

## 1. Project Overview

### 1.1 What This Is

A browser-based, WebXR-compatible interactive molecular simulation where students can:

1. Place two molecules near each other and watch their electrostatic surfaces (electron clouds) deform in response to each other's presence
2. Fill a box with many molecules and observe emergent collective behavior (why water is liquid, why methane is gas)
3. Adjust temperature and watch phase transitions
4. Interact in VR (Meta Quest 3 compatible) or on a flat screen with mouse/touch

### 1.2 What This Is NOT

- Not a quantum chemistry calculator (we use pre-computed partial charges and classical electrostatics)
- Not a reaction simulator (no bond breaking/forming in v1)
- Not a protein folder
- The physics must be qualitatively correct and pedagogically useful, not publication-grade

### 1.3 Why This Matters

No existing educational tool lets students drag one molecule toward another and see the electrostatic surfaces respond in real time. PhET's "Atomic Interactions" shows Lennard-Jones potentials between featureless spheres. MolCalc shows properties of isolated molecules. Nothing bridges the gap: showing students WHY molecules attract, repel, and orient based on their charge distributions. This fills that gap.

### 1.4 Target Users

Undergraduate general chemistry and biology students. Assume no programming knowledge. Assume some students are on Chromebooks, some on phones, some may have access to Meta Quest headsets. The application must degrade gracefully: VR if available, 3D on desktop/laptop, simplified 3D on mobile.

---

## 2. Architecture

### 2.1 Technology Stack

```
Presentation Layer:  Three.js (3D rendering, WebXR support built-in)
Physics Engine:      Rust compiled to WebAssembly (WASM)
UI Layer:            Vanilla JS or lightweight framework (Preact/Svelte preferred over React for bundle size)
Build System:        Vite
Testing:             Playwright (browser automation for self-testing agent)
```

### 2.2 Why This Stack

- **Three.js**: Mature, WebXR-ready, huge ecosystem. Handles stereoscopic VR rendering natively.
- **Rust -> WASM**: The physics engine must compute electrostatic interactions, Lennard-Jones potentials, and cloud deformation for potentially hundreds of particles at 60+ FPS. JavaScript is too slow. Rust compiles to WASM with near-native performance and runs in all modern browsers. No server needed.
- **Vanilla JS / Preact / Svelte**: The UI is simple (molecule picker, temperature slider, mode selector). A heavy framework like React adds unnecessary bundle weight. If the developer strongly prefers React, that's acceptable but not ideal.
- **Vite**: Fast dev server, native WASM support, good for iterative development.
- **Playwright**: Enables the automated test-user agent (see Section 7).

### 2.3 Architecture Diagram

```
+-----------------------------------------------------------+
|  Browser (Desktop / Mobile / Quest Browser)               |
|                                                           |
|  +------------------+    +----------------------------+   |
|  |   UI Layer        |    |   Three.js Scene           |   |
|  |   (Svelte/JS)     |    |   - Molecule meshes        |   |
|  |   - Molecule menu  |--->|   - Electron cloud meshes  |   |
|  |   - Temp slider    |    |   - Lights, camera         |   |
|  |   - Mode selector  |    |   - WebXR session (if VR)  |   |
|  |   - Energy readout |    +-------------+--------------+   |
|  +------------------+                    |                  |
|                                          | Each frame:      |
|                          +---------------v--------------+   |
|                          |   WASM Physics Engine (Rust)  |   |
|                          |   - Particle positions        |   |
|                          |   - Electrostatic calc        |   |
|                          |   - Lennard-Jones forces      |   |
|                          |   - Cloud deformation calc    |   |
|                          |   - Velocity Verlet integrator|   |
|                          +------------------------------+   |
+-----------------------------------------------------------+
```

### 2.4 Data Flow Per Frame

1. UI sends user inputs to physics engine (drag position, temperature change)
2. Physics engine computes forces between all particle pairs
3. Physics engine updates positions via Velocity Verlet integration
4. Physics engine computes cloud deformation vectors for each molecule
5. Physics engine returns new positions + deformation data to JS
6. Three.js updates mesh positions and deforms cloud geometry
7. Three.js renders frame (stereo if VR)

Target: 60 FPS on desktop, 72 FPS on Quest 3 (minimum for comfort)

---

## 3. Simulation Modes

### 3.1 Mode 1: Two-Molecule Interaction (MVP -- Build This First)

**Scene:** Two molecules in an empty space. One is fixed at center (or free-floating). The other is controlled by the user (mouse drag on desktop, hand/controller in VR).

**Molecules available (v1 set -- matches MolCalc lab):**
- H2O (water)
- H2S (hydrogen sulfide)
- CO2 (carbon dioxide)
- CH4 (methane)
- CCl4 (carbon tetrachloride)
- CHCl3 (chloroform)
- CH3OH (methanol / ethanol)
- CF4 (tetrafluoromethane)
- NH3 (ammonia)
- CH4N2O (urea)

**For each molecule, we need pre-computed data:**
- Atom positions (3D coordinates from optimized geometry)
- Partial charges on each atom (from semi-empirical or DFT calculation)
- Van der Waals radii for each atom
- Electrostatic potential surface (sampled on a mesh surrounding the molecule)

**What the student sees:**
- Ball-and-stick model at the core of each molecule
- Translucent electrostatic potential surface surrounding each molecule (red = electron-rich/negative, blue = electron-poor/positive, same color scheme as MolCalc)
- As molecule B approaches molecule A, the surfaces visually deform:
  - Electron-rich (red) regions on A bulge slightly toward electron-poor (blue) regions on B
  - Electron-poor (blue) regions on A are repelled by electron-poor (blue) regions on B
  - The magnitude of deformation increases as distance decreases
- A real-time energy readout showing: total interaction energy, distance between molecular centers, and a qualitative indicator (green = favorable/attractive, red = unfavorable/repulsive)
- Optional: force arrows showing the net force direction and magnitude

**Student interactions:**
- Drag molecule B around molecule A in 3D
- Rotate molecule B to different orientations
- Toggle cloud visibility on/off
- Toggle ball-and-stick vs space-filling vs cloud-only view
- Select molecule pair from dropdown
- "Snap to optimal" button that animates molecule B to the lowest-energy orientation/position

**Key pedagogical moments this enables:**
- Dragging H2O toward H2O: discover that O...H-O alignment is strongly favorable (the red region of one molecule faces the blue region of the other)
- Rotating H2O to H...H alignment: see the energy spike positive (repulsion)
- Comparing H2O...H2O vs H2S...H2S: see that H2O has much deeper energy well
- CCl4...CCl4: see very weak, orientation-independent attraction (uniform surfaces)
- H2O...CH4: see weak interaction (nonpolar molecule can't "find" a good orientation)

### 3.2 Mode 2: Many-Molecule Box

**Scene:** A 3D box containing N molecules (adjustable, default 50, max ~200 depending on hardware). All molecules are the same type (or optionally a mixture).

**What the student sees:**
- Molecules moving, rotating, colliding, clustering
- Electrostatic surfaces visible (can be toggled off for performance)
- Temperature slider
- Pressure/density readout
- Optional: highlight one molecule and track its path
- Optional: show instantaneous "interaction network" -- lines connecting molecules that are currently attracting each other, colored by strength

**Key pedagogical moments:**
- Water at 300K: molecules form transient clusters, constantly rearranging. Liquid behavior visible.
- Methane at 300K: molecules barely interact, filling the whole box. Gas behavior visible.
- Water as temperature increases past 373K: clusters break apart, transition to gas
- Water as temperature decreases below 273K: molecules lock into a lattice (simplified, not real ice structure, but the concept of solidification)
- Side-by-side comparison: water box vs methane box at same temperature. WHY is one liquid and the other gas? The electrostatic surfaces tell the story.

**Physics model:**
- Lennard-Jones potential for van der Waals interactions
- Coulomb potential between partial charges on atoms
- Optional: simple polarization model (induced dipoles)
- Velocity Verlet integration
- Thermostat (Berendsen or Nose-Hoover) for temperature control
- Periodic boundary conditions (molecules that exit one side re-enter the other)

### 3.3 Mode 3: Guided Reaction Visualization (Future / v2)

NOT a real reactive simulation. Instead, pre-computed reaction pathways are animated with electrostatic surfaces. The student sees bonds stretch, break, and reform with the electron clouds redistributing. This is an animation, not a simulation, but it's pedagogically valuable.

Potential reactions to visualize:
- Acid-base: HCl donating H+ to H2O
- Neutralization: H3O+ meeting OH-

This mode is out of scope for v1 but the architecture should not preclude it.

### 3.4 Mode 4: Catalytic Surface (Future / v3)

Way out of scope. Mentioned here for architectural awareness only. If the simulation engine is designed with extensibility in mind, adding a static surface of fixed atoms that interact with mobile molecules is not architecturally different from Mode 2.

---

## 4. Electrostatic Cloud Rendering

This is the core visual innovation. Getting this right is what makes the project unique.

### 4.1 Static Cloud (No Interaction)

Each molecule has a pre-computed electrostatic potential surface. This is a 3D mesh (icosphere or marching cubes output) where each vertex has:
- A position (relative to molecular center)
- A color (mapped from electrostatic potential: red for negative, white for neutral, blue for positive)
- A transparency value

The mesh is rendered as a translucent shell around the ball-and-stick model. Three.js MeshPhysicalMaterial with transmission or a custom shader.

### 4.2 Dynamic Cloud Deformation (The Hard Part)

When molecule B approaches molecule A, A's cloud must deform. This is NOT a real quantum calculation. It is an approximation:

**Approach: Point-charge induced deformation**

For each vertex V on molecule A's cloud mesh:
1. Compute the electrostatic field E at V due to all partial charges on molecule B
2. The vertex displacement is proportional to E, scaled by a "polarizability" parameter for the atom nearest to V
3. Electron-rich vertices (red) are displaced TOWARD positive fields (attracted to blue regions on B)
4. Electron-poor vertices (blue) are displaced AWAY from positive fields

This is physically motivated (it approximates induced polarization) and computationally cheap (it's just summing Coulomb contributions from ~5-20 point charges per molecule at each vertex).

**Performance consideration:** A typical cloud mesh might have 500-2000 vertices. With 2 molecules, that's 1000-4000 vertex updates per frame, each requiring a sum over the other molecule's charges. This is O(V * Q) per frame where V ~ 1000 and Q ~ 10-20. Roughly 10,000-20,000 multiply-adds per frame. Trivial for WASM.

For Mode 2 (many molecules), cloud deformation is expensive because every molecule is deformed by every other molecule. Options:
- Only deform clouds for the N nearest neighbors (cutoff radius)
- Only deform the cloud of the molecule the student is focused on / has selected
- Toggle: "cloud deformation" on/off, default off in Mode 2 for performance

### 4.3 Color Scheme

Match MolCalc exactly so students have visual continuity from the MolCalc lab:
- Deep red: strongly negative (electron-rich)
- White/light gray: neutral
- Deep blue: strongly positive (electron-poor)

Use a continuous color gradient. The RGB values should be configurable in a single constants file.

---

## 5. VR Implementation

### 5.1 WebXR Integration

Three.js provides `renderer.xr.enabled = true` and session management. The application should:

1. Detect WebXR availability on page load
2. Show "Enter VR" button if available
3. On VR entry: switch to stereoscopic rendering, enable hand/controller input
4. On VR exit: return to flat-screen mode seamlessly

### 5.2 VR Interaction Model

- **Grab:** Close hand (pinch gesture or trigger button) near a molecule to grab it
- **Drag:** Move hand while grabbing to reposition molecule
- **Rotate:** Twist wrist while grabbing to rotate molecule
- **UI panels:** Floating panels in 3D space for molecule selection, temperature slider, mode switching. Raycast from controller to interact.
- **Scale:** Pinch-zoom with two hands to scale the entire simulation up or down (lean into a cluster, or zoom out to see the whole box)

### 5.3 Performance Targets for Quest 3

- 72 FPS minimum (90 preferred)
- Quest 3 Snapdragon XR2 Gen 2 has a capable GPU but limited compared to desktop
- Budget: ~100 molecules MAX in Mode 2 on Quest, ~200 on desktop
- Cloud deformation: limit to selected molecule only on Quest
- LOD (level of detail): reduce cloud mesh vertex count for distant molecules

### 5.4 Fallback for Non-VR

- Desktop: mouse drag to rotate scene (OrbitControls), click-drag molecules
- Mobile/tablet: touch to rotate, two-finger drag molecules
- All features available in flat-screen mode, VR just adds immersion

---

## 6. Molecular Data Pipeline

### 6.1 Pre-computation (Offline, Before the App Runs)

For each molecule in the library, we need a JSON data file containing:

```json
{
  "name": "water",
  "formula": "H2O",
  "atoms": [
    { "element": "O", "x": 0.0, "y": 0.0, "z": 0.117, "charge": -0.834, "vdw_radius": 1.52 },
    { "element": "H", "x": 0.757, "y": 0.0, "z": -0.469, "charge": 0.417, "vdw_radius": 1.20 },
    { "element": "H", "x": -0.757, "y": 0.0, "z": -0.469, "charge": 0.417, "vdw_radius": 1.20 }
  ],
  "bonds": [
    { "from": 0, "to": 1, "order": 1 },
    { "from": 0, "to": 2, "order": 1 }
  ],
  "cloud_mesh": {
    "vertices": [[x,y,z], ...],
    "faces": [[i,j,k], ...],
    "potentials": [float, ...]
  },
  "polarizability": 1.45,
  "dipole_moment": 1.85,
  "molecular_weight": 18.015
}
```

**How to generate this data:**

Option A (preferred): Use PySCF or Psi4 (open-source quantum chemistry packages) to run a DFT calculation on each molecule, extract Mulliken or ESP-fit charges, and compute the electrostatic potential on a surface mesh.

Option B (faster, less accurate): Use RDKit to generate 3D coordinates and Gasteiger charges, and compute the surface analytically from the point charges.

Option C (if time-constrained): Manually curate from published data. The molecule set is small (~10 molecules in v1).

The data pipeline should be a standalone Python script that takes a SMILES string and outputs the JSON file. This allows easy expansion of the molecule library.

### 6.2 Data File Size Estimate

Per molecule: ~5-20 KB for atoms/bonds/charges, ~50-200 KB for cloud mesh (depending on resolution). Total library for 10 molecules: ~0.5 - 2 MB. Trivial to load.

---

## 7. Automated Test-User Agent (Playwright)

### 7.1 Purpose

Since Claude Code cannot visually evaluate a 3D rendered scene, we use Playwright to automate browser interaction and capture screenshots + data for evaluation. This enables iterative development without constant human review.

### 7.2 Test Framework

```
tests/
  e2e/
    mode1_basic.spec.ts        # Does the app load? Are two molecules visible?
    mode1_drag.spec.ts         # Drag molecule B toward A. Does energy change?
    mode1_orientation.spec.ts  # Rotate molecule B. Does energy readout vary?
    mode1_cloud_deform.spec.ts # Screenshot at distance=far vs distance=near. Are clouds different?
    mode1_pairs.spec.ts        # Load each molecule pair. No crashes.
    mode2_basic.spec.ts        # Does box mode load with 50 molecules?
    mode2_temperature.spec.ts  # Change temp slider. Do molecules speed up/slow down?
    mode2_phase.spec.ts        # Set temp very low. Do molecules cluster? (measure avg nearest-neighbor distance)
    vr_entry.spec.ts           # WebXR session creation (emulated)
    performance.spec.ts        # FPS counter stays above 30 for 10 seconds
  unit/
    physics_engine.test.ts     # Unit tests for WASM physics: known force values, energy conservation
    cloud_deform.test.ts       # Known deformation for test configuration
    data_loader.test.ts        # Molecule JSON files parse correctly
```

### 7.3 Screenshot Comparison

For visual tests (cloud deformation, rendering correctness):
1. Render scene in headless Chromium via Playwright
2. Capture screenshot as PNG
3. Compare against reference screenshot (pixel diff with tolerance)
4. If diff exceeds threshold, flag for human review

Initial reference screenshots are generated on first run and committed to the repo. Human (Fountain) approves them. Subsequent runs compare against approved references.

### 7.4 Physics Validation Tests

The WASM physics engine should be testable independently of the renderer:

- Two point charges at known distance: force should match Coulomb's law within tolerance
- Lennard-Jones potential minimum: should occur at expected sigma * 2^(1/6)
- Energy conservation: total energy in NVE ensemble should drift less than 1% over 1000 steps
- Two water molecules at known geometry: interaction energy should match published values within 20% (we're approximate, not exact)

### 7.5 How Claude Code Uses This

After writing or modifying code:
1. `npm run build` (compile Rust to WASM, bundle JS)
2. `npm run test:unit` (run physics unit tests)
3. `npm run test:e2e` (launch Playwright, run browser tests)
4. If tests pass: continue to next feature
5. If tests fail: read error output, fix, repeat
6. Every N iterations: capture screenshots and present to user for visual review

---

## 8. Parallel Research Agent Instructions

### 8.1 Purpose

While the implementation agent builds the software, a separate agent (or set of agents) should conduct comprehensive research in parallel. This research informs the project and identifies funding opportunities.

### 8.2 Research Task 1: Prior Art Search

Search comprehensively for any existing tool that does what ChemSim does. The goal is to confirm the gap and identify anything we might build on rather than reinvent.

**Search queries to run (adapt as results inform further searches):**

```
"interactive molecular electrostatic" drag education simulation
"electron cloud" deformation interaction browser visualization
"real-time" "electrostatic potential" two molecules interactive
WebXR molecular simulation chemistry education
"induced polarization" visualization interactive undergraduate
molecular dynamics browser WebAssembly education
"intermolecular interaction" simulation "drag and drop" molecules
Three.js molecular visualization electrostatic surface
WebGL molecular dynamics interactive education chemistry
"virtual reality" molecular interaction chemistry undergraduate
```

**Also search for:**
- GitHub repositories with keywords: molecular, electrostatic, WebGL, education, interactive
- Published papers on interactive molecular visualization for education (Google Scholar)
- NSF/NIH funded projects doing similar work (NSF Award Search, NIH Reporter)
- Any commercially available VR chemistry education tools

**Deliverable:** A report with:
- List of every tool found, with URL, description, and assessment of how close it is to ChemSim
- Clear statement of what gap ChemSim fills that nothing else does
- Any open-source code that could be reused (e.g., existing Three.js molecular renderers)

### 8.3 Research Task 2: Grant Mechanism Search

Search for grant mechanisms that would fund development of this tool. The PI would be Dr. Fountain Farrell, a Visiting Assistant Professor at Cheyney University of Pennsylvania (an HBCU).

**Key angles:**
- HBCU faculty developing educational technology
- Computational chemistry education for underrepresented students
- VR/immersive learning in STEM education
- Open-source educational software development

**Specific programs to investigate:**

```
NSF IUSE (Improving Undergraduate STEM Education)
NSF HBCU-UP (HBCU Undergraduate Program)
NSF DUE (Division of Undergraduate Education)
NSF OAC (Office of Advanced Cyberinfrastructure) -- educational software
NIH SEPA (Science Education Partnership Award)
DOE (Department of Education) grants for educational technology
HHMI (Howard Hughes Medical Institute) educational grants
Sloan Foundation digital learning initiatives
Google.org education grants
Meta (Immersive Learning grants -- they make Quest headsets)
Anthropic academic partnerships (worth exploring)
ACS (American Chemical Society) education grants
Cottrell Scholar Awards (Research Corporation)
```

**Also search for:**
- Recent funded projects at HBCUs involving VR or simulation-based education
- Typical budget ranges for educational software development grants
- Letter of intent / proposal deadlines for the most relevant mechanisms

**Deliverable:** A report with:
- Ranked list of grant mechanisms by fit, with deadlines, typical award sizes, and URLs
- For the top 3-5 mechanisms: summary of what the proposal would need to emphasize
- Examples of recently funded similar projects (as models)
- Draft of a 1-paragraph project summary suitable for a letter of intent

### 8.4 Research Task 3: Technical Feasibility

Search for existing open-source code that could accelerate development:

```
GitHub: Three.js molecule viewer
GitHub: WebAssembly molecular dynamics
GitHub: Rust molecular simulation WASM
GitHub: WebXR chemistry
GitHub: electrostatic surface mesh generation
GitHub: PySCF electrostatic potential surface export
GitHub: RDKit 3D molecular properties JSON
```

**Deliverable:** A report with:
- List of repos with stars, last commit date, license, and relevance assessment
- Recommended repos to fork or use as dependencies
- Estimated time savings from reuse vs building from scratch

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Target: 1-2 weeks of Claude Code time)

1. Set up Vite project with Three.js and WASM build pipeline
2. Create Rust physics engine skeleton: Coulomb force, Lennard-Jones, Velocity Verlet
3. Compile to WASM and verify it runs in browser
4. Render a single molecule (ball-and-stick + translucent cloud) in Three.js
5. Implement OrbitControls for camera
6. Load molecule data from JSON
7. Set up Playwright test framework
8. Write and pass basic unit tests for physics engine

### Phase 2: Mode 1 -- Two-Molecule Interaction (Target: 2-3 weeks)

1. Render two molecules simultaneously
2. Implement mouse drag to move molecule B
3. Implement physics: compute interaction energy between the two molecules
4. Display energy readout in UI
5. Implement cloud deformation (the core visual innovation)
6. Tune deformation parameters until it looks physically reasonable
7. Add molecule pair selector dropdown
8. Add "snap to optimal" animation
9. Add view mode toggles (ball-and-stick, space-filling, cloud-only)
10. Write and pass Mode 1 Playwright tests
11. **CHECKPOINT: Human review. Fountain evaluates the visual output and interaction feel.**

### Phase 3: Mode 2 -- Many-Molecule Box (Target: 2-3 weeks)

1. Extend physics engine to handle N molecules with periodic boundary conditions
2. Implement thermostat (Berendsen initially, Nose-Hoover if time permits)
3. Render N molecules in a box with walls or periodic boundaries
4. Implement temperature slider
5. Performance optimization: spatial partitioning (cell list) for force calculation
6. LOD for distant molecules
7. "Tag and follow" one molecule feature
8. Interaction network visualization (optional, if performance allows)
9. Write and pass Mode 2 Playwright tests
10. **CHECKPOINT: Human review.**

### Phase 4: VR (Target: 1-2 weeks)

1. Enable WebXR on renderer
2. Implement hand/controller grab, drag, rotate for molecules
3. Implement floating UI panels in 3D space
4. Test on Quest 3 browser (requires Fountain or a collaborator with headset)
5. Performance optimization for mobile GPU
6. **CHECKPOINT: Human review on actual headset.**

### Phase 5: Polish and Pedagogy (Target: 1 week)

1. Guided tutorial / onboarding for students
2. Pre-set "experiments" (e.g., "Compare water vs methane" with guided prompts)
3. Screenshot/export feature (students capture scenes for lab reports)
4. Accessibility: keyboard controls, screen reader labels for UI elements
5. Documentation: student user guide, instructor guide

---

## 10. File Structure

```
chemsim/
  README.md
  package.json
  vite.config.ts
  tsconfig.json
  
  src/
    main.ts                    # Entry point
    scene/
      SceneManager.ts          # Three.js scene setup, camera, lights
      MoleculeRenderer.ts      # Renders ball-and-stick + cloud mesh
      CloudDeformer.ts         # Applies deformation vectors to cloud mesh
      InteractionVisualizer.ts # Energy readout, force arrows, interaction lines
      VRManager.ts             # WebXR session, hand tracking, VR UI panels
    ui/
      MoleculeSelector.ts      # Dropdown for molecule selection
      TemperatureSlider.ts     # Temperature control
      ModeSelector.ts          # Switch between Mode 1, Mode 2
      EnergyDisplay.ts         # Real-time energy readout
      ViewToggles.ts           # Cloud on/off, view mode, etc.
    physics/                   # This is the Rust crate, compiled to WASM
      Cargo.toml
      src/
        lib.rs                 # WASM entry points
        coulomb.rs             # Coulomb force calculation
        lennard_jones.rs       # LJ potential and force
        integrator.rs          # Velocity Verlet
        thermostat.rs          # Temperature control
        deformation.rs         # Cloud vertex deformation calculation
        system.rs              # Manages all particles, runs simulation step
    data/
      molecules/
        water.json
        hydrogen_sulfide.json
        carbon_dioxide.json
        methane.json
        carbon_tetrachloride.json
        chloroform.json
        methanol.json
        tetrafluoromethane.json
        ammonia.json
        urea.json
      README.md                # Documents JSON format and how to add molecules
    utils/
      constants.ts             # Colors, physical constants, default parameters
      loader.ts                # Loads and parses molecule JSON
  
  scripts/
    generate_molecule_data.py  # PySCF/RDKit script to generate JSON from SMILES
    requirements.txt
  
  tests/
    e2e/                       # Playwright tests (see Section 7)
    unit/                      # Physics engine tests
  
  docs/
    STUDENT_GUIDE.md
    INSTRUCTOR_GUIDE.md
    ARCHITECTURE.md
```

---

## 11. Key Design Decisions and Constraints

### 11.1 Cloud Deformation Must Be Fast, Not Exact

The electron cloud deformation is the visual centerpiece. It must update every frame (16ms budget at 60 FPS). The approximation described in Section 4.2 (point-charge induced displacement) is computationally cheap and physically motivated. It will NOT reproduce real quantum mechanical polarization quantitatively. It WILL show students the right qualitative behavior: red regions attract blue regions, like charges repel, closer distance means stronger deformation. That's the pedagogical goal.

### 11.2 No Server Required

Everything runs client-side. No backend server, no API calls, no accounts, no data collection. A student opens a URL and the simulation loads. This is critical for accessibility and for institutional adoption (no IT department approval needed, no FERPA concerns).

### 11.3 Offline Capable

Once loaded, the app should work offline (service worker / PWA). Students in areas with unreliable internet can load it once and use it later.

### 11.4 Open Source

The project should be MIT-licensed and hosted on GitHub. This supports grant applications (broader impacts) and allows other institutions to use and contribute.

### 11.5 Mobile-First Performance Budget

If it doesn't run on a 3-year-old Chromebook, it doesn't ship. Target: 50 molecules at 30 FPS on low-end hardware in Mode 2. Desktop can handle more. Quest 3 is somewhere in between.

### 11.6 No Em Dashes

All documentation, UI text, and comments must avoid em dashes. Use commas, semicolons, colons, parentheses, or separate sentences instead. This is a standing preference.

---

## 12. Success Criteria

### 12.1 Mode 1 MVP Is Successful If:

- [ ] Student can select H2O + H2O pair
- [ ] Student can drag one water molecule toward the other
- [ ] Electrostatic clouds are visible and color-coded (red/blue)
- [ ] Clouds visibly deform as molecules approach
- [ ] Energy readout changes in real time (negative when favorable, positive when unfavorable)
- [ ] Rotating the dragged molecule changes the energy (orientation matters)
- [ ] "Snap to optimal" finds the hydrogen-bonding geometry
- [ ] All 10 molecules load without crashing
- [ ] FPS stays above 30 on a Chromebook
- [ ] A gen chem student shown the simulation says "oh, THAT'S why water does that"

### 12.2 Mode 2 Is Successful If:

- [ ] 50 water molecules in a box at 300K look like a liquid (clustered, moving, but cohesive)
- [ ] 50 methane molecules in a box at 300K look like a gas (spread out, fast, bouncing off walls)
- [ ] Lowering temperature causes visible clustering/solidification
- [ ] Raising temperature causes visible dissociation/boiling
- [ ] Side-by-side comparison of water vs methane at same temperature is visually dramatic
- [ ] FPS stays above 30 with 50 molecules on desktop

### 12.3 VR Is Successful If:

- [ ] App enters VR mode on Quest 3 browser
- [ ] Student can grab and move molecules with hands/controllers
- [ ] 72 FPS maintained in Mode 1
- [ ] Student reports feeling "inside" the chemistry

---

## 13. Known Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cloud deformation looks wrong / unphysical | High - undermines trust | Tune parameters against known water dimer geometry. Get chemistry faculty feedback early. |
| WASM build pipeline is complex | Medium - slows development | Start with pure JS physics engine, port to WASM when performance demands it |
| Quest 3 performance is insufficient | Medium - limits VR mode | Aggressive LOD, reduce cloud resolution in VR, limit molecule count |
| Pre-computed molecular data is hard to generate | Medium - blocks content | Start with manually curated data for water (published widely), automate pipeline later |
| Students find interface confusing | High - defeats purpose | Build guided tutorial mode. Test with actual students early. |
| WebXR API changes or Quest browser has bugs | Low - VR is enhancement | Desktop/mobile is the primary target. VR is bonus. |

---

## 14. References and Resources

### Physics
- Allen & Tildesley, "Computer Simulation of Liquids" (2017) -- canonical MD reference
- TIP3P water model parameters (Jorgensen et al., 1983) -- partial charges and LJ parameters for water
- OPLS-AA force field -- partial charges for organic molecules

### Three.js + WebXR
- https://threejs.org/docs/#api/en/renderers/WebXRManager
- https://immersiveweb.dev/ -- WebXR standards and device support
- https://github.com/nicolo-ribaudo/three-vrm -- Three.js VR interaction examples

### Rust + WASM
- https://rustwasm.github.io/docs/book/ -- Rust WASM book
- https://github.com/nicolo-ribaudo/wasm-bindgen -- Rust-JS interop

### Molecular Data
- https://molcalc.org -- electrostatic potential reference visuals
- https://www.rcsb.org -- protein data bank (for future Mode 3/4)
- https://pubchem.ncbi.nlm.nih.gov -- molecular properties and geometries

---

## Appendix A: Glossary for Non-Technical Readers

- **WASM (WebAssembly):** A way to run code written in fast languages (like Rust) inside a web browser at near-native speed
- **Three.js:** A JavaScript library for rendering 3D graphics in web browsers
- **WebXR:** A browser API that enables virtual reality and augmented reality experiences
- **Lennard-Jones potential:** A mathematical model describing how atoms attract at medium range and repel at very close range
- **Coulomb potential:** The electrostatic force between charged particles (opposite charges attract, like charges repel)
- **Velocity Verlet:** A numerical method for computing how particles move over time given the forces acting on them
- **Playwright:** A tool for automating web browsers, used here to test the application without a human clicking around
- **LOD (Level of Detail):** Rendering distant objects with fewer polygons to save processing power
- **Periodic boundary conditions:** When a molecule exits one side of the simulation box, it re-enters from the opposite side, simulating an infinite bulk material
