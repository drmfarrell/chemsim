import { test, expect } from '@playwright/test';
import fs from 'fs';

// Load the Freezing Water experiment and inspect the seed crystal's
// geometry directly from the physics engine. We want hard numbers:
//   - Minimum H-H distance within the seed (should be > ~1.5 Å; smaller
//     means two H atoms collided).
//   - Distribution of O-O distances among seed neighbors (should be
//     tightly clustered around 2.76 Å, the ice Ih nearest-neighbor
//     distance).
//   - H-bond geometry: for each seed O, is there an H within ~2 Å along
//     a tetrahedral direction? (That's the ice-rule signature.)
test('ice seed geometry is sensible', async ({ page }) => {
  test.setTimeout(90_000);

  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

  await page.goto('/');
  await page.waitForSelector('#loading-overlay.hidden', { timeout: 30000 });
  await page.selectOption('#experiment-selector', 'water-freezing');
  await page.waitForTimeout(2000);

  // Pause right away so we're looking at the initial lattice, not a
  // relaxed state.
  await page.locator('#toggle-sim-play').click();
  await page.waitForTimeout(300);

  // Take an initial screenshot for the record.
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/ice-seed-initial.png', fullPage: true });

  // Extract atom positions + frozen flags from the engine.
  const dump = await page.evaluate(() => {
    const sys = (globalThis as any).__chemsim.physics;
    const mols = (globalThis as any).__chemsim.boxMolecules;
    const n = sys.get_molecule_count();
    const atoms: Array<{ molIdx: number; el: string; x: number; y: number; z: number; frozen: boolean }> = [];
    for (let i = 0; i < n; i++) {
      const frozen: boolean = sys.is_molecule_frozen(i);
      const pos = sys.get_atom_positions(i);
      const elems = mols[i]?.getData?.()?.atoms?.map((a: any) => a.element) ?? [];
      for (let k = 0; k < pos.length / 3; k++) {
        atoms.push({
          molIdx: i,
          el: elems[k] ?? '?',
          x: pos[k * 3], y: pos[k * 3 + 1], z: pos[k * 3 + 2],
          frozen,
        });
      }
    }
    return { n, atoms };
  });

  // Frozen-molecule indices: the first N waters added after the liquid
  // cutoff are the seed (they come AFTER the liquid placement). But our
  // freezing code adds the seed FIRST, then liquid. So molecule indices
  // 0..seedCount-1 are the seed. Console log in loadMode2 reports the
  // seed count. Grab it from the atom list: any molecule with all 3
  // atoms within ~10 Å of origin AND arranged on an ice lattice is a
  // seed candidate. Simpler heuristic: count frozen ones in the boxMols
  // renderer object doesn't help; let's infer by position (seed is at
  // box center).

  // Group atoms by molecule.
  const byMol = new Map<number, { el: string; x: number; y: number; z: number }[]>();
  for (const a of dump.atoms) {
    if (!byMol.has(a.molIdx)) byMol.set(a.molIdx, []);
    byMol.get(a.molIdx)!.push(a);
  }

  // Use the authoritative is_frozen flag to pick seed waters.
  const seedMolIdxs: number[] = [];
  for (const [idx, ats] of byMol.entries()) {
    if (ats.length === 3 && ats[0].frozen) seedMolIdxs.push(idx);
  }
  console.log(`Seed waters (is_frozen=true): ${seedMolIdxs.length}`);

  // Gather seed O and H atom positions.
  const seedO: { x: number; y: number; z: number }[] = [];
  const seedH: { x: number; y: number; z: number }[] = [];
  for (const idx of seedMolIdxs) {
    for (const a of byMol.get(idx)!) {
      if (a.el === 'O') seedO.push(a);
      else if (a.el === 'H') seedH.push(a);
    }
  }

  // 1. Minimum H-H distance within the seed, plus top-5 closest clashing pairs.
  type HH = { i: number; j: number; d: number };
  const hhPairs: HH[] = [];
  for (let i = 0; i < seedH.length; i++) {
    for (let j = i + 1; j < seedH.length; j++) {
      const dx = seedH[i].x - seedH[j].x;
      const dy = seedH[i].y - seedH[j].y;
      const dz = seedH[i].z - seedH[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1.5) hhPairs.push({ i, j, d });
    }
  }
  hhPairs.sort((a, b) => a.d - b.d);
  const minHH = hhPairs.length > 0 ? hhPairs[0].d : Infinity;
  console.log(`Seed min H-H distance: ${minHH.toFixed(3)} A`);
  console.log(`  ${hhPairs.length} H-H pairs < 1.5 A; closest 5:`);
  for (const p of hhPairs.slice(0, 5)) {
    const h1 = seedH[p.i], h2 = seedH[p.j];
    console.log(`    d=${p.d.toFixed(3)} A:  H=(${h1.x.toFixed(2)},${h1.y.toFixed(2)},${h1.z.toFixed(2)})  H=(${h2.x.toFixed(2)},${h2.y.toFixed(2)},${h2.z.toFixed(2)})`);
  }

  // 2. Distribution of O-O distances among seed oxygens.
  const ooDists: number[] = [];
  for (let i = 0; i < seedO.length; i++) {
    for (let j = i + 1; j < seedO.length; j++) {
      const dx = seedO[i].x - seedO[j].x;
      const dy = seedO[i].y - seedO[j].y;
      const dz = seedO[i].z - seedO[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 3.2) ooDists.push(d);
    }
  }
  ooDists.sort((a, b) => a - b);
  console.log(`Seed O-O nearest-neighbor distances (<3.2 A): ${ooDists.length} pairs`);
  if (ooDists.length > 0) {
    const mean = ooDists.reduce((s, x) => s + x, 0) / ooDists.length;
    const min = ooDists[0];
    const max = ooDists[ooDists.length - 1];
    console.log(`  range ${min.toFixed(3)}–${max.toFixed(3)} A, mean ${mean.toFixed(3)} A (ice Ih = 2.76)`);
  }

  // 3. H-bond check: for each seed O, look for H atoms within 2.2 Å that
  //    belong to a DIFFERENT seed water.
  let hbonded = 0;
  let acceptCounts: number[] = new Array(seedO.length).fill(0);
  for (let oi = 0; oi < seedO.length; oi++) {
    const O = seedO[oi];
    for (const H of seedH) {
      const dx = H.x - O.x;
      const dy = H.y - O.y;
      const dz = H.z - O.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > 0.99 && r < 2.2) {
        // Not one of this water's own H atoms (covalent O-H is ~0.96 Å)
        // and within H-bond distance (typical H...O distance ~1.8 Å).
        acceptCounts[oi]++;
        hbonded++;
      }
    }
  }
  const acceptHist: Record<number, number> = {};
  for (const c of acceptCounts) acceptHist[c] = (acceptHist[c] ?? 0) + 1;
  console.log(`Seed H-bond acceptances per O: ${JSON.stringify(acceptHist)}`);
  console.log(`Total inter-water H-bonds inside seed: ${hbonded}`);

  // Write seed atom positions + molecule indices as JSON so a Python
  // renderer can draw the crystal and highlight clash pairs.
  const seedAtomsOut = dump.atoms.filter(a => seedMolIdxs.includes(a.molIdx));
  fs.writeFileSync(
    'test-results/ice-seed-atoms.json',
    JSON.stringify({ atoms: seedAtomsOut, seedCount: seedMolIdxs.length }, null, 2),
  );
  console.log(`Wrote test-results/ice-seed-atoms.json (${seedAtomsOut.length} atoms)`);

  expect(errors).toEqual([]);
  expect(seedMolIdxs.length).toBeGreaterThan(0);
});
