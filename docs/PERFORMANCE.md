# Performance

How the physics loop got from "64-molecule dissolution takes forever" to
"1000-molecule demos at 20× wall-clock on a workstation", and what
knobs are available to tune further.

This document captures the layered optimizations currently shipped, so
future maintainers don't rip out something load-bearing thinking it's
unnecessary.

---

## Current architecture (what makes the sim fast)

A single `physics.step_n(k)` wasm call does `k` Velocity-Verlet steps.
Each step:

1. **Reuses** forces + torques from the end of the previous step (no
   re-compute at step start). See `forces_valid` in
   `src/physics/src/system.rs`.
2. **Integrates** positions + rotations using rigid-body quaternion
   math (water O–H bonds are constrained by construction — no SHAKE
   pass needed).
3. **Computes new forces** in parallel via a persistent spin-wait
   worker pool. Dispatch latency is ~1–10 µs, orders of magnitude
   better than rayon's ~1–2 ms per `par_iter` on wasm.
4. Applies thermostat, records virial, runs barostat if enabled.
5. Caches the new forces for step N+1 to consume.

The force compute itself uses:

- A **cell list** bounded by the user-chosen interaction cutoff
  (default 8 Å in the Fast preset). Neighbor walks are 27 cells
  around each molecule's home cell (wrap-around for periodic mode,
  clipped for solid walls).
- A **per-molecule parallel pattern**: each worker owns a contiguous
  range of molecule indices and writes into disjoint
  `accum[i]` slots, so no locking or reduction is needed.
- A **fused Coulomb + Lennard-Jones kernel** (`coulomb_lj_force_raw`)
  that computes dx/dy/dz/r²/√r once per atom-atom pair instead of
  twice.
- Optional **wasm SIMD** (`+simd128`) kernel
  (`coulomb_lj_force_raw_x2_v`) that processes two atom-atom pairs per
  instruction using `f64x2` lanes, with wide `v128_load` reads from the
  SoA atom arrays.

All the performance-critical fields live in parallel `Vec<f64>`
arrays on `Molecule` (`atom_pos_x`, `atom_pos_y`, `atom_pos_z`,
`atom_charges`, `atom_epsilons`, `atom_sigmas`) so adjacent atoms are
16 bytes apart in memory — the authoritative `Vec<Atom>` stays
around for slow-path / serialization.

---

## The persistent worker pool

`src/physics/src/persistent_pool.rs` owns a singleton pool of workers
spawned via `rayon::spawn` at init time. Workers spin on a shared
atomic sequence counter instead of parking on `Atomics.wait`, so
dispatch latency drops from milliseconds to microseconds.

**Cost**: each worker burns ~100% CPU while alive. Mitigated by:

- The pool is **parked** (workers shut down, CPU freed) whenever the
  simulation is paused, the user switches to Mode 1, or the tab is
  hidden. See `matchPoolToRunState` in `src/main.ts`.
- Default worker count is `navigator.hardwareConcurrency - 2` so the
  OS + UI + main thread always have breathing room.
- The Advanced panel exposes a **Threads slider** for live tuning;
  changes take effect instantly via `set_persistent_pool_workers`.

**Constraint**: the pool occupies all of rayon's worker threads.
`rayon::par_iter` / `rayon::scope` / `rayon::broadcast` would
deadlock while the pool is alive. Any new parallel callers must go
through `persistent_pool::dispatch_global`.

---

## Secure context (the bug that hid a 10× gain)

`SharedArrayBuffer`, service workers, and `crossOriginIsolated` all
require the page to be served over a **secure context**:
`https://` or `localhost` / `127.0.0.1`. Plain HTTP on an IP address
(`http://10.x.y.z:3000`) is **not** secure, and
`SharedArrayBuffer` is silently disabled. When that happens
`initThreadPool` throws, the wasm-thread init is skipped, and every
"parallel" code path falls through to serial.

Fixes baked into the repo:

- **Vite serves HTTPS** via `@vitejs/plugin-basic-ssl` (vite.config.ts).
  Self-signed cert; browser warns once per host.
- **Service worker** (`public/sw.js`) leaves navigation requests
  alone so COOP/COEP headers from Vite always reach the browser.
- **Playwright** points at `https://localhost:3000` with
  `ignoreHTTPSErrors: true`.

If you ever see `ChemSim: crossOriginIsolated=false` in the console,
the secure-context is broken upstream — probably someone visiting
over plain `http://<ip>` or a corporate proxy terminating TLS.

---

## Measuring

Everything below assumes the dev server is up at `https://` and the
page is loaded. Open the browser console.

### Dispatch latency (persistent pool)

```js
__chemsim.benchPoolDispatch(2000)
```
Returns `{ totalMs, perDispatchUs, nIters }`. Expect 1–10 µs on a
modern CPU. Higher means something's wrong (e.g. pool not initialized,
rayon contention).

### Force compute (serial vs parallel)

```js
{
  const n = __chemsim.boxMolecules.length;
  let s=0, p=0;
  for (let i=0;i<30;i++) s += __chemsim.physics.bench_forces_serial();
  for (let i=0;i<30;i++) p += __chemsim.physics.bench_forces_parallel();
  console.log(`N=${n} serial=${(s/30).toFixed(2)}ms parallel=${(p/30).toFixed(2)}ms speedup=${(s/p).toFixed(2)}x`);
}
```

**What to expect**:

- Speedup scales with worker count but sub-linearly — per-worker
  chunks of ~20–40 molecules finish unevenly, so 22 workers rarely
  hit a full 22× versus 1.
- Speedup is lower at small N (per-worker chunk gets tiny compared
  to spin-wait overhead). Below ~N=60 serial usually wins.

### Full-step throughput

```js
const r = __chemsim.benchSteps(500);
console.log(`${r.stepsPerSec.toFixed(0)} steps/sec`);
```
This is the real wall-clock rate the sim advances when it's running.

---

## Dials (in order of impact)

1. **Cutoff** (`Advanced → Cutoff` slider, 6–14 Å).
   Largest single lever. Going 12 → 8 Å roughly halves pair count.
   Default 8 Å in the Fast preset; loses some long-range Coulomb
   accuracy but dissolution / phase-transition qualitative behavior
   is intact.

2. **Timestep** (`Advanced → Timestep` slider, 1–4 fs).
   Multiplies sim time per step. 3 fs is safe for rigid TIP4P water;
   4 fs is the rough ceiling before the rotational integrator loses
   accuracy. Below 2 fs is only for precise energy measurements.

3. **Molecule count** (main-panel slider, preset cubes 2³–10³).
   Physics cost scales ~linearly in N with cell list, but the render
   cost (cloud meshes with transparency) scales worse. 125–216 is the
   sweet spot for classroom dissolution demos; 512+ starts to tax both
   CPU and GPU on typical laptops.

4. **Thread count** (`Advanced → Threads` slider).
   Default = `hardwareConcurrency - 2`. More workers → less wall-clock
   per force compute up to diminishing returns around 2× molecules per
   worker; beyond that per-chunk overhead dominates.

5. **Speed multiplier** (main panel slider, 1–50×).
   Multiplies `stepsPerFrame` (which is base 5). No artificial cap
   anymore — if you crank it past what the machine can keep up with,
   FPS just drops.

---

## What didn't work / don't try again

- **Rayon's `par_iter` for the hot force loop on wasm**. Overhead per
  dispatch is ~1 ms minimum; at 100 steps/frame that's 200 ms/frame
  wasted in scheduling alone. Replaced with the persistent pool.

- **`par_iter().fold(...).reduce(...)` with per-chunk `Vec`
  accumulators.** Each chunk allocated a fresh N-sized scratch Vec.
  For small cell counts rayon barely split the work, so one chunk
  accumulator ate the whole allocation budget. The current per-
  molecule `par_iter_mut` into a pre-sized output Vec is strictly
  better.

- **`par_iter().filter_map(...).collect::<Vec<PairDelta>>()`**. The
  intermediate collect allocation dominated on wasm. Per-molecule
  accumulation into pre-sized output avoids it.

- **Generic thread-pool via `std::thread::spawn` on wasm.**
  `std::thread::spawn` traps with `unreachable` unless called from
  within wasm-bindgen-rayon's machinery; we use `rayon::spawn`
  instead to occupy rayon's already-spawned workers.

- **Two force computes per step (Velocity Verlet's naive form).**
  The start-of-step compute produces the same result as the previous
  step's end-of-step compute — positions don't change between step
  boundaries unless the barostat rescales. Now cached.

- **Clone of the atom's element `String` inside the pair force
  loop.** Every atom-atom pair allocated a `String`; on the parallel
  path workers contended on the wasm allocator. The raw-coordinate
  kernels (`coulomb_force_raw`, `lj_force_raw`,
  `coulomb_lj_force_raw`) take f64 args directly and don't touch the
  Atom struct at all.

---

## Roughly where we are

On a Ryzen Threadripper 1920X (12 cores / 24 threads), Fast preset,
22 workers, persistent pool:

| N    | Force compute (ms) | Steps/sec | FPS at 20× |
|------|---------------------|-----------|------------|
| 64   | ~0.2                | ~2500     | 60+        |
| 125  | ~0.4                | ~1500     | 40–50      |
| 216  | ~0.7                | ~900      | ~30        |
| 512  | ~2                  | ~300      | ~15        |
| 1000 | ~5                  | ~120      | ~6         |

Numbers degrade ~3× on a Quest 2 / low-end laptop. Crystal-formation
demos (ice lattice, NaCl dissolution kinetics) want N ≥ 125 and run
comfortably on modern workstations.
