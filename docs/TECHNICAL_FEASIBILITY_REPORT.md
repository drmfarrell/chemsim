# ChemSim Technical Feasibility Report: Open-Source Reuse Assessment

**Prepared:** 2026-04-14
**Scope:** Section 8.4 -- Survey of existing open-source code to accelerate ChemSim development

---

## 1. Web-Based Molecular Viewers

### 1.1 3Dmol.js

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/3dmol/3Dmol.js](https://github.com/3dmol/3Dmol.js) |
| Stars | ~965 |
| License | BSD (permissive) |
| Last Commit | January 2026 (v2.5.4) |
| Language | JavaScript (WebGL) |

**Description:** WebGL-accelerated molecular graphics library supporting PDB, SDF, MOL2, XYZ, CIF, MMTF, and many other formats. Offers surface computation (van der Waals, solvent-accessible, molecular), diverse styling (ball-and-stick, cartoon, surface coloring), and interactive picking.

**Relevance to ChemSim:** HIGH. Directly applicable as the primary 3D rendering layer. Supports electrostatic surface coloring, volumetric data rendering, and label/annotation overlays. A React wrapper exists ([Autodesk/molecule-3d-for-react](https://github.com/Autodesk/molecule-3d-for-react), 70 stars, Apache-2.0) that could serve as a starting template for ChemSim's UI integration.

---

### 1.2 Mol* (Molstar)

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/molstar/molstar](https://github.com/molstar/molstar) |
| Stars | ~929 |
| License | MIT |
| Last Commit | April 2026 (v5.8.0) |
| Language | TypeScript (98%) |

**Description:** Next-generation macromolecular visualization stack jointly developed by PDBe and RCSB PDB. Handles hundreds of superimposed protein structures, MD trajectories, and cell-level models with tens of millions of atoms. Uses BinaryCIF for efficient data delivery.

**Relevance to ChemSim:** MEDIUM-HIGH. Extremely powerful for large biomolecular structures. The TypeScript codebase is modern and well-architected. However, it is heavily oriented toward protein/macromolecular visualization rather than small-molecule interaction simulation. Its plugin architecture and state management patterns are valuable reference material. Could serve as an alternative to 3Dmol.js if ChemSim scope expands to macromolecules.

---

### 1.3 NGL Viewer

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/nglviewer/ngl](https://github.com/nglviewer/ngl) |
| Stars | ~722 |
| License | MIT |
| Last Commit | April 2025 |
| Language | TypeScript (88%) |

**Description:** WebGL-based viewer for proteins, DNA/RNA, and related structures. Supports mmCIF, PDB, density volumes, and many other formats. Offers animations, picking, and image export. Also has a Jupyter widget companion ([nglviewer/nglview](https://github.com/nglviewer/nglview)).

**Relevance to ChemSim:** MEDIUM. Solid viewer but less actively maintained than Mol* (which supersedes it in the RCSB PDB ecosystem). Its trajectory playback code could be useful reference for ChemSim's simulation replay feature.

---

### 1.4 Speck

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/wwwtyro/speck](https://github.com/wwwtyro/speck) |
| Stars | ~420 |
| License | Unlicense (public domain) |
| Last Commit | Older (not recently maintained) |
| Language | JavaScript (96%) |

**Description:** Produces exceptionally attractive molecule renders using ambient occlusion, imposter-based atom/bond rendering, depth-aware outlines, and depth-of-field effects. A modernized TypeScript rewrite exists ([vangelov/modern-speck](https://github.com/vangelov/modern-speck)) using WebGL 2 and Vite.

**Relevance to ChemSim:** MEDIUM. Rendering techniques (ambient occlusion, imposters) are directly applicable for ChemSim's visual quality goals. The public domain license means zero friction for code reuse. Not a full viewer, but the shader pipeline is valuable.

---

### 1.5 iMolecule

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/patrickfuller/imolecule](https://github.com/patrickfuller/imolecule) |
| Stars | ~86 |
| License | MIT |
| Last Commit | Older (not recently maintained) |
| Language | JavaScript (66%) |

**Description:** Embeddable WebGL molecule viewer with built-in file format conversion and IPython notebook integration.

**Relevance to ChemSim:** LOW. Useful as a lightweight reference for embedding molecular visualization in web apps, but 3Dmol.js and Mol* are far more capable.

---

## 2. WebAssembly and Rust Simulation Engines

### 2.1 Lumol

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/lumol-org/lumol](https://github.com/lumol-org/lumol) |
| Stars | ~209 |
| License | BSD-3-Clause |
| Last Commit | December 2025 |
| Language | Rust (99.5%) |

**Description:** Classical molecular simulation engine written in Rust. Supports pair interactions (Lennard-Jones, Buckingham, Born-Mayer-Huggins), electrostatics (Ewald, Wolf), molecular dynamics (NVE, NVT, NPT ensembles), Monte Carlo, and energy minimization. Designed for extensibility with modular force field and integrator architecture.

**Relevance to ChemSim:** HIGH. This is the most directly relevant Rust-based MD engine. Its modular Rust architecture makes it a strong candidate for compilation to WASM via wasm-bindgen. Key concerns: the project has limited maintainer activity (see GitHub issue #264 "Is Lumol abandoned?"), and it is self-described as alpha software. Forking and maintaining a ChemSim-specific branch is likely necessary.

---

### 2.2 wasm-bindgen

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/wasm-bindgen/wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen) |
| Stars | ~9,000 |
| License | Apache-2.0 / MIT dual license |
| Last Commit | Active (2026) |
| Language | Rust (96%) |

**Description:** The standard toolchain for high-level interactions between Rust/WASM modules and JavaScript. Provides seamless import of JS functions into Rust and export of Rust functions to JS.

**Relevance to ChemSim:** CRITICAL DEPENDENCY. Any Rust-to-WASM compilation path for ChemSim's simulation engine will use wasm-bindgen. Mature, well-maintained, and heavily adopted.

---

### 2.3 Ten Minute Physics (Rust/WASM)

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/cerrno/ten-minute-physics-rs](https://github.com/cerrno/ten-minute-physics-rs) |
| Stars | ~147 |
| License | MIT |
| Last Commit | Recent |
| Language | Rust (97%) |

**Description:** Reimplementation of Matthias Muller's physics simulation demos in Rust compiled to WASM with WebGL rendering. Demonstrates ~3x speedup over the original JavaScript versions. Covers particle systems, soft-body simulation, fluid dynamics, and rigid body physics.

**Relevance to ChemSim:** MEDIUM-HIGH. Excellent reference architecture for how to structure a Rust/WASM physics simulation with WebGL rendering. The shared memory model between WASM and JS, the rendering loop patterns, and the build pipeline (wasm-pack + Webpack) are directly applicable to ChemSim.

---

### 2.4 molecular-dynamics-wasm

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/vijaysharmay/molecular-dynamics-wasm](https://github.com/vijaysharmay/molecular-dynamics-wasm) |
| Stars | <5 |
| License | Not specified |
| Last Commit | Older |
| Language | Rust (54%) |

**Description:** Demonstration of MD algorithms (Leap Frog, Velocity Verlet, Beeman, Runge-Kutta) implemented in Rust and compiled to WASM for browser execution.

**Relevance to ChemSim:** LOW-MEDIUM. Small proof-of-concept showing that MD integrators work in WASM. Useful as a reference for integrator implementations but not production-grade.

---

### 2.5 rd-system-wasm (Reaction-Diffusion)

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/msakuta/rd-system-wasm](https://github.com/msakuta/rd-system-wasm) |
| Stars | ~4 |
| License | Not specified |
| Last Commit | September 2020 |
| Language | Rust (57%) |

**Description:** Reaction-diffusion system simulation in WASM with Rust. Interactive browser-based simulation with parameter sliders and mouse interaction.

**Relevance to ChemSim:** LOW. Demonstrates Rust/WASM interactive simulation patterns but is not molecular dynamics. The UI interaction model (parameter sliders, mouse input) is a useful reference.

---

## 3. Cheminformatics and Data Pipelines

### 3.1 RDKit

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/rdkit/rdkit](https://github.com/rdkit/rdkit) |
| Stars | ~3,400 |
| License | BSD-3-Clause |
| Last Commit | March 2026 |
| Language | C++ / Python |

**Description:** Industry-standard cheminformatics and machine-learning library. Provides molecular descriptor computation, fingerprinting, force field optimization (UFF, MMFF), 3D coordinate generation (ETKDG), and database cartridges.

**Relevance to ChemSim:** HIGH. Essential for the backend data pipeline. Generates 3D conformers, computes molecular properties, and exports to JSON (both commonchem and rdkitjson formats). The `Chem.MolsToJSONData()` function exports molecules with full 3D coordinates and properties to JSON, which is the ideal interchange format for feeding data to ChemSim's frontend.

---

### 3.2 RDKit.js (WASM)

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/rdkit/rdkit-js](https://github.com/rdkit/rdkit-js) |
| Stars | ~225 |
| License | BSD-3-Clause |
| Last Commit | Recent |
| Language | C++ compiled to WASM |

**Description:** Official JavaScript/WASM distribution of RDKit. Provides a subset of RDKit cheminformatics functionality directly in the browser, including 2D depiction, substructure search, descriptor calculation, and molecule parsing.

**Relevance to ChemSim:** HIGH. Enables client-side cheminformatics without server round-trips. Users could input SMILES strings and get instant 2D/3D previews, property calculations, and format conversions entirely in the browser. This significantly improves responsiveness for the molecule input workflow.

---

### 3.3 PySCF

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/pyscf/pyscf](https://github.com/pyscf/pyscf) |
| Stars | ~1,600 |
| License | Apache-2.0 |
| Last Commit | January 2026 |
| Language | Python (87%) |

**Description:** Python-based quantum chemistry framework supporting DFT, HF, post-HF methods, and periodic boundary conditions.

**Relevance to ChemSim:** MEDIUM. Relevant for the backend electrostatic potential surface generation pipeline. The `pyscf.tools.cubegen.mep()` function calculates molecular electrostatic potentials and exports them as cube files, which can be converted to mesh data for ChemSim's frontend. Not used at runtime in the browser; this is a preprocessing/backend tool.

---

### 3.4 pyscf_esp

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/swillow/pyscf_esp](https://github.com/swillow/pyscf_esp) |
| Stars | ~4 |
| License | MIT |
| Last Commit | Older (3 commits total) |
| Language | Python (100%) |

**Description:** Minimal utility for computing electrostatic potential charges using PySCF.

**Relevance to ChemSim:** LOW. Very small project, but demonstrates the specific ESP calculation workflow with PySCF that ChemSim's backend would need.

---

## 4. Electrostatic Surface Mesh Generation

### 4.1 esp-surface-generator

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/AstexUK/esp-surface-generator](https://github.com/AstexUK/esp-surface-generator) |
| Stars | ~8 |
| License | Apache-2.0 |
| Last Commit | Older |
| Language | JavaScript (100%) |

**Description:** Generates electrostatic potential surfaces from PQR files. Calculates Connolly surfaces and exports triangle meshes. Evaluates ESP from point charges or electrostatic grids (QM calculations).

**Relevance to ChemSim:** HIGH. Despite low star count, this is directly relevant to ChemSim's electrostatic surface visualization feature. Being JavaScript-native, it could potentially run in the browser. The Connolly surface algorithm and triangle mesh export are exactly what ChemSim needs to render electrostatic potential surfaces.

---

## 5. WebXR and Immersive Chemistry

### 5.1 MolecularWebXR / MoleculARweb

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/molecularwebxr/molecularweb](https://github.com/molecularwebxr/molecularweb) |
| Stars | ~38 |
| License | AGPL-3.0 |
| Last Commit | 2021 (latest release) |
| Language | JavaScript (86%) |

**Description:** Web-based AR/VR platform for chemistry and structural biology education. Uses Three.js for 3D rendering, WebXR API for headset/hand tracking, Cannon.js for real-time physics, and MediaSoup for multiuser audio. Supports fiducial markers and markerless AR. The related HandMol tool integrates ANI-2x and AMBER14 (via OpenMM) for real-time energy minimization.

**Relevance to ChemSim:** MEDIUM. Demonstrates the full WebXR + chemistry stack. The Three.js/WebXR integration patterns and Cannon.js physics coupling are directly applicable. However, the AGPL-3.0 license is restrictive and would require ChemSim to also be AGPL if code is directly incorporated. Better used as an architectural reference rather than a code dependency.

---

### 5.2 Avogadro 2 (avogadrolibs)

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/OpenChemistry/avogadrolibs](https://github.com/OpenChemistry/avogadrolibs) |
| Stars | ~589 |
| License | BSD-3-Clause |
| Last Commit | April 2026 (active) |
| Language | C++ |

**Description:** Cross-platform molecular editor and visualization library from the Open Chemistry project. Provides 3D rendering, analysis, and data processing for computational chemistry. Desktop-oriented, not web-native.

**Relevance to ChemSim:** LOW-MEDIUM. Primarily a desktop application, not web-based. However, its file format parsers, force field implementations, and molecular property calculators could be referenced for algorithm design. Not directly usable in ChemSim's browser environment without porting.

---

## 6. Supporting Infrastructure

### 6.1 OpenMM

| Attribute | Detail |
|-----------|--------|
| Repository | [github.com/openmm/openmm](https://github.com/openmm/openmm) |
| Stars | ~1,800 |
| License | MIT / LGPL |
| Last Commit | April 2026 (v8.5.1) |
| Language | C++ (70%) |

**Description:** High-performance GPU-accelerated molecular simulation toolkit. Supports custom forces, integrators, and platforms (CUDA, OpenCL, CPU).

**Relevance to ChemSim:** MEDIUM. Not directly usable in the browser, but could serve as the backend simulation engine for high-fidelity calculations that are too expensive for WASM. Results would be precomputed and served to ChemSim's frontend. MolecularWebXR already uses OpenMM as a backend for AMBER14 energy minimization via API calls.

---

## 7. Recommended Reuse Strategy

### Tier 1: Direct Dependencies (use as-is via npm/import)

| Project | Role in ChemSim | Time Saved |
|---------|-----------------|------------|
| **3Dmol.js** | Primary 3D molecular rendering | 3-4 months vs. building a WebGL molecule renderer from scratch |
| **RDKit.js** | Client-side cheminformatics (SMILES parsing, 2D/3D generation, property calculation) | 2-3 months vs. implementing cheminformatics in JS |
| **wasm-bindgen** | Rust-to-WASM compilation toolchain | Required infrastructure; no alternative |

### Tier 2: Fork and Adapt

| Project | Role in ChemSim | Time Saved |
|---------|-----------------|------------|
| **Lumol** (fork) | Core MD simulation engine, compiled to WASM | 4-6 months vs. writing an MD engine from scratch in Rust. Requires maintenance commitment due to limited upstream activity. |
| **esp-surface-generator** (fork) | Electrostatic surface mesh generation for browser-side ESP visualization | 1-2 months vs. implementing Connolly surface algorithm and ESP mapping |
| **Speck** (shader extraction) | Ambient occlusion and imposter rendering techniques for high-quality atom visualization | 2-4 weeks vs. developing custom shaders |

### Tier 3: Backend Tools (server-side preprocessing)

| Project | Role in ChemSim | Time Saved |
|---------|-----------------|------------|
| **RDKit** (Python) | Conformer generation, property computation, JSON export for molecule data pipeline | 2-3 months vs. building a backend cheminformatics stack |
| **PySCF** | Quantum-level electrostatic potential surface calculation for high-fidelity ESP data | 1-2 months vs. implementing QM ESP calculations |
| **OpenMM** | High-fidelity MD simulation backend for precomputed trajectories | 3-4 months vs. building a GPU MD engine |

### Tier 4: Reference Architecture (study, do not depend)

| Project | Value to ChemSim |
|---------|------------------|
| **Mol*** | TypeScript architecture patterns, plugin system design, state management for molecular viewers |
| **Ten Minute Physics (Rust/WASM)** | Rust/WASM/WebGL integration patterns, shared memory model, build pipeline |
| **MolecularWebXR** | WebXR + Three.js + physics integration for future VR/AR support (note AGPL license restriction) |
| **NGL Viewer** | Trajectory playback and animation system design |
| **molecular-dynamics-wasm** | MD integrator implementations (Verlet, Beeman, RK4) in Rust/WASM |

---

## 8. Estimated Total Time Savings

| Approach | Estimated Development Time |
|----------|---------------------------|
| Build everything from scratch | 18-24 months (full-time team of 3-4) |
| Reuse strategy outlined above | 8-12 months (full-time team of 3-4) |
| **Estimated savings** | **8-14 months** |

### Breakdown of Savings by Component

| Component | From Scratch | With Reuse | Savings |
|-----------|-------------|------------|---------|
| 3D molecular rendering and interaction | 3-4 months | 2-4 weeks (integrate 3Dmol.js, extract Speck shaders) | ~3 months |
| MD simulation engine (WASM) | 5-7 months | 2-3 months (fork Lumol, adapt for WASM) | ~4 months |
| Cheminformatics pipeline (frontend) | 2-3 months | 2-3 weeks (integrate RDKit.js) | ~2 months |
| Cheminformatics pipeline (backend) | 2-3 months | 3-4 weeks (integrate RDKit + PySCF) | ~2 months |
| Electrostatic surface visualization | 2-3 months | 3-4 weeks (fork esp-surface-generator, integrate with 3Dmol.js surfaces) | ~2 months |
| WebXR support (future) | 2-3 months | 1-2 months (reference MolecularWebXR patterns) | ~1 month |

---

## 9. License Compatibility Summary

All recommended Tier 1 and Tier 2 dependencies use permissive licenses (BSD, MIT, Apache-2.0, or Unlicense) that are compatible with both open-source and commercial distribution of ChemSim. The only restrictive license encountered is AGPL-3.0 (MolecularWebXR), which is classified as Tier 4 (reference only) to avoid copyleft obligations.

| License | Projects | Compatible with Proprietary? |
|---------|----------|------------------------------|
| BSD / BSD-3-Clause | 3Dmol.js, RDKit, RDKit.js, Lumol, Avogadro | Yes |
| MIT | Mol*, NGL, wasm-bindgen, Speck (modern), Ten Minute Physics, OpenMM, pyscf_esp | Yes |
| Apache-2.0 | PySCF, esp-surface-generator, wasm-bindgen | Yes |
| Unlicense | Speck (original) | Yes |
| AGPL-3.0 | MolecularWebXR | No (reference only) |

---

## 10. Key Risks and Mitigations

**Risk 1: Lumol maintenance.** The project has limited contributor activity and open questions about long-term viability.
*Mitigation:* Fork early. The BSD-3 license permits unrestricted forking. Invest in understanding the codebase thoroughly before depending on it. Consider contributing fixes upstream.

**Risk 2: 3Dmol.js performance at scale.** While suitable for small molecules, performance with large simulation trajectories is untested for ChemSim's use case.
*Mitigation:* Benchmark early with representative datasets. Mol* offers better large-scale performance if needed as a fallback.

**Risk 3: RDKit.js WASM bundle size.** The WASM binary for RDKit.js may be large, impacting initial page load.
*Mitigation:* Use code splitting and lazy loading. Only load RDKit.js when the user enters the molecule input workflow.

**Risk 4: esp-surface-generator is minimally maintained (8 stars).**
*Mitigation:* Fork and vendor the code. The core algorithm (Connolly surface + ESP mapping) is well-understood and documented. The small codebase (pure JS) is easy to audit and maintain.

---

## 11. Conclusion

The open-source ecosystem provides strong coverage for ChemSim's core requirements. The recommended strategy centers on 3Dmol.js for rendering, RDKit.js for client-side cheminformatics, a forked Lumol for the WASM simulation engine, and RDKit + PySCF for the backend data pipeline. This approach reduces estimated development time by roughly 40-55%, allowing the team to focus engineering effort on ChemSim's unique value: the interactive simulation experience, the pedagogical UI, and the real-time parameter manipulation interface.
