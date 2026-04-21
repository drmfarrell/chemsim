# Notes for Claude (or any coding agent working on this repo)

Read this before touching anything load-bearing. Most of it was learned
the hard way during a long debugging session and isn't obvious from the
code alone.

---

## Build invariants — do not break these without reading the linked doc first

- **Rust toolchain is pinned to nightly** via
  `src/physics/rust-toolchain.toml`. Required for `-Z build-std` in
  `.cargo/config.toml`, which is in turn required to rebuild `libstd`
  with `atomics`/`bulk-memory`/`mutable-globals` target features so
  wasm-bindgen-rayon's worker threads actually use real Atomics.
  Don't "simplify" this to stable Rust — the build will compile but the
  wasm memory won't be shared and the thread pool will trap at init.
- **Build script uses `--features parallel`**:
  `"build:wasm": "cd src/physics && wasm-pack build --target web --out-dir ../../src/wasm-pkg -- --features parallel"`.
  The `parallel` feature pulls in `rayon` + `wasm-bindgen-rayon`.
  Without it the wasm exports no `initThreadPool` and the persistent
  pool has nothing to occupy.
- **Vite serves HTTPS** via `@vitejs/plugin-basic-ssl`. Required
  because `SharedArrayBuffer` is only available in secure contexts
  and IP-address HTTP is not secure. If you see
  `crossOriginIsolated=false` in the browser console, something broke
  this — fix it upstream, don't paper over it.
- **COOP / COEP headers** are set on dev + preview server. Without
  them the browser won't expose `SharedArrayBuffer` even on HTTPS.
  See `server.headers` in `vite.config.ts`.
- **Service worker** (`public/sw.js`) deliberately does **not**
  intercept navigation requests. An earlier version cached
  `index.html`, and Chromium drops COOP/COEP on SW-served
  navigations in some code paths, silently downgrading the page to
  non-isolated. If you're adding SW caching, keep navigation
  pass-through.

See `docs/PERFORMANCE.md` for the full story.

---

## Architecture at a glance

```
src/
  main.ts                  Main app entry, render loop, UI wiring
                           TODO (tech debt): at 2000+ lines with ~30
                           module-level `let`s this is the biggest
                           maintenance risk in the codebase. Split
                           into state/SimState.ts (centralized state
                           machine) + ui/SimControls.ts + ui/Mode2Loader.ts
                           before the next round of major features.
  scene/                   Three.js scene, molecule rendering, VR
  physics/                 Rust crate compiled to wasm
    src/
      lib.rs               Atom/Molecule structs, Atom helpers
      system.rs            SimulationSystem (step, force dispatch,
                           Berendsen barostat, bench_* gated behind
                           `benchmarks` cargo feature)
      coulomb.rs           Coulomb kernels (incl. SIMD)
      lennard_jones.rs     LJ kernels, fused Coulomb+LJ kernel
      integrator.rs        Velocity Verlet translation
      rotation.rs          Quaternion rotation integrator
      thermostat.rs        Berendsen thermostat
      deformation.rs       Electron-cloud vertex deformation (Mode 1)
      persistent_pool.rs   Spin-wait worker pool (NOT rayon par_iter!)
  data/molecules/*.json    Molecule definitions + cloud meshes
                           (regenerated via scripts/generate_molecule_data.py)
  ui/AskPanel.ts           Opt-in (`?ask=1`) LLM tutor — Anthropic or
                           OpenAI-compatible. See docs/ASK_PANEL.md.
  ui/ResultsExport.ts      Save Results → CSV + snapshot + data-
                           dictionary HTML report.
  utils/iceIh.ts           Ice Ih seed-crystal generator.
  utils/waterModels.ts     TIP3P / TIP4P/2005 / TIP4P/Ice.
  utils/spacing.ts         Per-species liquid-density grid spacing.
  ui/                      Experiments, tutorial, glossary
  utils/                   Constants, molecule loader
  wasm-pkg/                wasm-pack output (gitignored)
public/sw.js               Service worker (skips navigations)
scripts/generate_molecule_data.py  Regenerate molecule JSON + clouds
tests/e2e/*.spec.ts        Playwright tests
docs/                      Human-facing docs
```

---

## Hot paths — where the sim spends its time

1. `SimulationSystem::step()` → `compute_all_forces()` →
   `compute_forces_cell_list_parallel()` → persistent pool dispatch
   → each worker runs `force_worker()` → per-molecule walk of the
   27-cell neighborhood → `compute_pair_force()` → fused
   `coulomb_lj_force_raw` (or `_x2_v` under SIMD).
2. Force caching halves work: step N's end-of-step forces are reused
   as step N+1's start forces (invalidated by barostat or topology
   changes). Flag: `forces_valid` on `SimulationSystem`.
3. Main thread reads `get_all_positions()` / `get_all_orientations()`
   and drives Three.js transforms. This is negligible.

Before touching any of these, read:

- `docs/PERFORMANCE.md` section "What didn't work"
- The comment block atop `persistent_pool.rs`

---

## Debug / bench hooks exposed on `globalThis.__chemsim`

```js
__chemsim.physics                     // SimulationSystem instance
__chemsim.boxMolecules                // MoleculeRenderer[] in Mode 2
__chemsim.benchSteps(n)               // time n full step()s
__chemsim.benchPoolDispatch(n_iters)  // dispatch latency of the pool
__chemsim.physics.bench_forces_serial()    // ms per serial force compute
__chemsim.physics.bench_forces_parallel()  // ms per parallel force compute
__chemsim.physics.bench_compute_all_forces() // with the alloc + cap wrapper
__chemsim.physics.bench_step_one()    // one full step including both force evals
__chemsim.physics.bench_step_split()  // ms breakdown per step phase
__chemsim.physics.bench_step_components()  // ms per integrator component
__chemsim.physics.bench_overhead()    // [alloc_ms, parallel_ms, caps_ms]
```

These are the ones that exist **as of writing** — keep them or add
more as the code evolves. They live in `src/physics/src/system.rs`
and `src/main.ts`.

---

## Patterns you should follow

- **State changes that affect sim running** go through
  `setSimRunning(bool)` in `src/main.ts`. It updates the flag, the
  Play/Pause button, and parks/wakes the worker pool in one shot.
  Setting `isSimulationRunning` directly will desync the UI.
- **Position mutations** that happen outside `step()` must clear
  `forces_valid` on `SimulationSystem` (see `set_molecule_position`,
  `remove_last_molecule`, etc. for the pattern). Otherwise the next
  step reuses stale cached forces.
- **Atom data in hot loops**: read from the SoA arrays
  (`atom_pos_x`, `atom_charges`, etc.) not through
  `self.atoms[i].x`. AoS layout puts adjacent atoms 80 bytes apart
  and kills SIMD wide loads.
- **Parking the pool** whenever the sim is paused / tab hidden /
  mode switched. Use `matchPoolToRunState()` after any state change
  that could affect run state — don't call `init_persistent_pool` /
  `shutdown_persistent_pool` directly unless you're that helper.

---

## Anti-patterns — likely to break things

- **Calling `rayon::par_iter` / `rayon::scope` /
  `rayon::broadcast` anywhere**. The persistent pool occupies all
  rayon workers; any new rayon scheduler call will deadlock.
  Route parallelism through `persistent_pool::dispatch_global`.
- **Using `std::thread::spawn` on wasm**. Traps with `unreachable`.
  Use `rayon::spawn` if you need to occupy a worker.
- **Caching mutable data across workers**. Workers read
  `SimulationSystem` via `&*const SimulationSystem` — any mutation
  from another thread is UB. All pool dispatches assume read-only
  shared state + disjoint per-worker output slots.
- **Assuming `crossOriginIsolated` is always true.** Code paths
  downstream of it must gracefully fall back when it's not (see
  `compute_forces_cell_list_parallel`'s `pool_worker_count() == 0`
  check).

---

## Common failure modes and what they mean

| Symptom | Likely cause |
|---------|--------------|
| Browser console: `crossOriginIsolated=false` | Served over plain HTTP on an IP, or SW cached index.html without headers. Fix via `https://` URL, or unregister the SW + clear site data. |
| Wasm build error: `failed to find __wasm_init_tls` | `.cargo/config.toml` is missing `link-arg=--shared-memory` + `--import-memory`. See the existing file. |
| `RuntimeError: unreachable` at `init_persistent_pool` | `std::thread::spawn` called outside wasm-bindgen-rayon glue. Persistent pool must use `rayon::spawn`. |
| `DataCloneError: #<Memory> could not be cloned` | wasm memory wasn't emitted as `shared`. Rebuild with the full `.cargo/config.toml` rustflags (`+atomics,+bulk-memory,+mutable-globals`) and the linker args. |
| "Parallel" benchmark slower than "serial" | Per-dispatch overhead exceeds compute savings. Either N is too small (expected below ~N=60) or the pool isn't actually parallelizing (check `bench_pool_dispatch` — should be single-digit µs). |
| Play button highlighted but sim not stepping | State desync — caller updated `isSimulationRunning` directly. Route through `setSimRunning(running)`. |
| Only one CPU core busy during active sim | Pool is parked (paused / tab hidden / Mode 1). Or `initThreadPool` failed earlier — check console for `crossOriginIsolated` warning. |

---

## Things you're likely to be asked to do next

- **Regenerate molecule JSONs.** Don't hand-edit vertex/face arrays;
  use `scripts/generate_molecule_data.py`. A broken ion JSON (62
  verts but faces referencing index 63) shipped once and rendered
  the electron clouds as garbage. Verify with:
  ```
  python3 -c "import json; d=json.load(open('src/data/molecules/NAME.json')); c=d['cloud_mesh']; assert max(max(f) for f in c['faces']) < len(c['vertices']); print('OK')"
  ```

- **Add a new molecule.** Append a dict to `MOLECULES` in the
  generator, run it, commit the new JSON. Atom fields the physics
  cares about: `element`, `x/y/z`, `charge`, `epsilon`, `sigma`,
  `mass`. Skip fields and it'll use element defaults from
  `src/utils/constants.ts`.

- **VR / Quest performance.** Cloud meshes are the bottleneck (not
  physics) for mobile GPUs. Plan of attack in
  `docs/PERFORMANCE.md` → the Quest section. Lower-poly cloud mesh,
  foveated rendering, auto-drop to Fast preset on XR session entry.

- **Another perf lever.** The single remaining big one is
  SoA-everywhere + broader SIMD coverage: extend SIMD beyond the
  atom-atom kernel into virtual-site Coulomb and the 27-cell
  neighbor walk. Substantial refactor; don't start without a
  measured baseline you're trying to beat.

---

## Don't waste cycles on

- Making `std::thread` work on wasm. It won't without forking
  wasm-bindgen-rayon.
- Trying to reduce rayon's `Atomics.wait` latency. It's browser-level;
  the persistent pool exists precisely to bypass it.
- Caching forces across a **barostat** step. Barostat rescales
  positions; the `forces_valid` flag correctly invalidates on that
  path.
- Sub-millisecond optimizations in `src/main.ts`. Render-loop JS is
  not the bottleneck for anything below N=1000.

---

## Tests

- `npm run test:unit` — vitest on molecule JSON validators and a few
  math helpers.
- `npm run test:e2e` — Playwright. Headless Chromium. **Playwright's
  webserver is HTTPS**; tests use `ignoreHTTPSErrors: true`.
- `cd src/physics && cargo test` — Rust unit tests (coulomb, LJ,
  integrator). **These don't run the parallel path** (no rayon
  worker pool on native).
- `tests/e2e/rayon_init.spec.ts` — smoke test that the pool
  initializes and Mode 2 runs.
- `tests/e2e/pool_bench.spec.ts` — measures dispatch latency.
- `tests/e2e/rayon_perf.spec.ts` — measures force compute serial vs
  parallel at N=125.

If a change touches physics/parallel/SW/HTTPS, run all three e2e tests.
Expect ~1 minute.
