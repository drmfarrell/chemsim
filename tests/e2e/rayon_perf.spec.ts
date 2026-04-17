import { test } from '@playwright/test';

test('serial vs parallel force compute at 125 molecules', async ({ page, context }) => {
  await context.route('**/sw.js', (r) => r.abort());
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  await page.goto('/');
  await page.waitForSelector('#loading-overlay.hidden', { timeout: 30000 });

  await page.selectOption('#mode-selector', 'mode2');
  await page.waitForTimeout(500);
  const slider = page.locator('#molecule-count-slider');
  await slider.fill('3');
  await slider.dispatchEvent('input');
  await slider.dispatchEvent('change');
  await page.waitForTimeout(6000);
  await page.click('#toggle-sim-play'); // pause the render-loop stepping

  // Higher-precision: wall-time-only, run many iters in JS, skip Date.now
  // rounding inside each bench_* call.
  const result = await page.evaluate(() => {
    const physics = (globalThis as any).__chemsim.physics;
    const N_ITERS = 100;
    // Warmup
    for (let i = 0; i < 5; i++) {
      physics.bench_forces_serial();
      physics.bench_forces_parallel();
    }
    let t0 = performance.now();
    for (let i = 0; i < N_ITERS; i++) physics.bench_forces_serial();
    const serialMs = (performance.now() - t0) / N_ITERS;
    t0 = performance.now();
    for (let i = 0; i < N_ITERS; i++) physics.bench_forces_parallel();
    const parallelMs = (performance.now() - t0) / N_ITERS;
    t0 = performance.now();
    for (let i = 0; i < N_ITERS; i++) physics.bench_step_one();
    const stepMs = (performance.now() - t0) / N_ITERS;
    return {
      forcesSerialMs: serialMs,
      forcesParallelMs: parallelMs,
      fullStepMs: stepMs,
      nCores: (navigator as any).hardwareConcurrency,
      n: (globalThis as any).__chemsim.boxMolecules.length,
    };
  });

  console.log(
    `PERF N=${result.n} on ${result.nCores} cores:\n` +
      `  forces serial   = ${result.forcesSerialMs.toFixed(2)}ms\n` +
      `  forces parallel = ${result.forcesParallelMs.toFixed(2)}ms\n` +
      `  full step       = ${result.fullStepMs.toFixed(2)}ms\n` +
      `  force speedup   = ${(result.forcesSerialMs / result.forcesParallelMs).toFixed(2)}x\n` +
      `  non-force time per step = ${(result.fullStepMs - 2 * result.forcesParallelMs).toFixed(2)}ms\n` +
      `  steps/sec       = ${(1000 / result.fullStepMs).toFixed(0)}`
  );

  // Break compute_all_forces into: alloc-the-Vecs, parallel-compute, cap-loops.
  const overhead = await page.evaluate(() => {
    const physics = (globalThis as any).__chemsim.physics;
    physics.bench_overhead();
    return physics.bench_overhead();
  });
  console.log('compute_all_forces overhead breakdown (avg ms per call):');
  console.log(`  alloc forces+torques = ${overhead[0].toFixed(3)}ms`);
  console.log(`  parallel compute     = ${overhead[1].toFixed(3)}ms`);
  console.log(`  force/torque caps    = ${overhead[2].toFixed(3)}ms`);

  // Also time step() split into its 4 phases.
  const split = await page.evaluate(() => {
    const physics = (globalThis as any).__chemsim.physics;
    const iters = 30;
    const labels = ['force_call_1', 'integrator', 'force_call_2', 'rest'];
    const sums = new Array(labels.length).fill(0);
    physics.bench_step_split();
    for (let i = 0; i < iters; i++) {
      const parts = physics.bench_step_split();
      for (let k = 0; k < labels.length; k++) sums[k] += parts[k];
    }
    return labels.map((label, k) => ({ label, ms: sums[k] / iters }));
  });
  console.log('STEP SPLIT (avg ms per pass):');
  for (const { label, ms } of split) console.log(`  ${label.padEnd(14)} = ${ms.toFixed(3)}ms`);

  // Compare bench_forces_parallel (direct call to parallel fn) vs
  // bench_compute_all_forces (wrapper that allocates + caps). Should be
  // nearly identical; if they're not, the wrapper is doing hidden work.
  const compare = await page.evaluate(() => {
    const physics = (globalThis as any).__chemsim.physics;
    physics.bench_forces_parallel();
    physics.bench_compute_all_forces();
    let a = 0, b = 0;
    for (let i = 0; i < 30; i++) a += physics.bench_forces_parallel();
    for (let i = 0; i < 30; i++) b += physics.bench_compute_all_forces();
    return { forcesParallel: a / 30, computeAllForces: b / 30 };
  });
  console.log(`DIRECT COMPARE: bench_forces_parallel=${compare.forcesParallel.toFixed(2)}ms  bench_compute_all_forces=${compare.computeAllForces.toFixed(2)}ms`);
});
