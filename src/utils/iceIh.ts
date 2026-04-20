/**
 * Ice Ih (hexagonal ice) lattice generator.
 *
 * Produces a small seed crystal of water molecules with oxygens sitting on
 * the ice Ih lattice (P6_3/mmc, 4 waters per hexagonal unit cell) and each
 * water oriented so its two H atoms point toward two of its four nearest O
 * neighbors — i.e. approximately satisfying the Bernal–Fowler ice rules.
 *
 * The proton assignment is a deterministic greedy pass (not a true rule-
 * respecting Monte Carlo shuffle) so the seed isn't a perfect proton-ordered
 * ice Ih configuration. That's fine for pedagogy: at T < 270 K the sim
 * relaxes the initial H orientations into a stable ice-like network within
 * a few ps, and the surrounding supercooled liquid then freezes onto the
 * seed. A perfect starting configuration isn't what makes the demo work —
 * having enough seed mass that it doesn't melt before the liquid reorders
 * is.
 *
 * Lattice parameters (ice Ih at 273 K, atmospheric pressure):
 *   a = 4.511 Å, c = 7.346 Å. O–O nearest-neighbor distance ≈ 2.76 Å.
 */

// ---------------------------------------------------------------------------
// Lattice constants and canonical water geometry
// ---------------------------------------------------------------------------

const A_LATTICE = 4.511;
const C_LATTICE = 7.346;

// OH bond length in the canonical body frame — same as water.json geometry.
const OH_BOND_LEN = Math.hypot(0.7572, -0.4692 - 0.1173);

// Fractional oxygen coordinates inside one hexagonal unit cell (4 waters).
// Values are the standard ice Ih sublattice positions from, e.g.,
// Hayward & Reimers (1997), reduced to the wurtzite-like 4-site basis.
const FRAC_OXYGENS: [number, number, number][] = [
  [1 / 3, 2 / 3, 1 / 16],
  [2 / 3, 1 / 3, 9 / 16],
  [1 / 3, 2 / 3, 7 / 16],
  [2 / 3, 1 / 3, 15 / 16],
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function fracToCart(fa: number, fb: number, fc: number): [number, number, number] {
  // Hexagonal (a, b at 120°) → Cartesian.
  const x = A_LATTICE * (fa - fb * 0.5);
  const y = A_LATTICE * fb * (Math.sqrt(3) / 2);
  const z = C_LATTICE * fc;
  return [x, y, z];
}

function vsub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vadd(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vscale(a: [number, number, number], s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vlen(a: [number, number, number]): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

function vnorm(a: [number, number, number]): [number, number, number] {
  const l = vlen(a);
  return l > 1e-10 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

function vcross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// ---------------------------------------------------------------------------
// Public: generate an ice Ih seed
// ---------------------------------------------------------------------------

export interface SeedWater {
  /** World-frame atom positions for O, H1, H2 in that order. */
  atoms: [number, number, number][];
}

/** Generate an ice Ih seed centered at (cx, cy, cz). `nA`, `nB`, `nC` are
 *  the supercell dimensions along the three hexagonal axes; total waters
 *  returned = 4 * nA * nB * nC. Default 2×2×2 = 32 waters (~9×9×15 Å cluster). */
export function generateIceIhSeed(
  cx: number,
  cy: number,
  cz: number,
  nA: number = 2,
  nB: number = 2,
  nC: number = 2,
): SeedWater[] {
  // 1. Build all oxygen Cartesian positions in the supercell.
  const oxygens: [number, number, number][] = [];
  for (let ia = 0; ia < nA; ia++) {
    for (let ib = 0; ib < nB; ib++) {
      for (let ic = 0; ic < nC; ic++) {
        for (const frac of FRAC_OXYGENS) {
          oxygens.push(fracToCart(ia + frac[0], ib + frac[1], ic + frac[2]));
        }
      }
    }
  }

  // 2. Shift so the cluster is centered at the origin. This makes the
  //    requested (cx, cy, cz) the geometric center rather than the corner.
  let mx = 0, my = 0, mz = 0;
  for (const o of oxygens) { mx += o[0]; my += o[1]; mz += o[2]; }
  mx /= oxygens.length; my /= oxygens.length; mz /= oxygens.length;
  for (const o of oxygens) { o[0] -= mx; o[1] -= my; o[2] -= mz; }

  // 3. For each oxygen, find the indices of its four nearest neighbors.
  //    In ideal ice Ih every interior O has exactly 4 at ~2.76 Å. Edge
  //    oxygens will have fewer — we just take whatever's within 3.2 Å.
  const NN_CUTOFF = 3.2;
  const neighbors: number[][] = [];
  for (let i = 0; i < oxygens.length; i++) {
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < oxygens.length; j++) {
      if (j === i) continue;
      const d = vlen(vsub(oxygens[j], oxygens[i]));
      if (d < NN_CUTOFF) dists.push({ j, d });
    }
    dists.sort((a, b) => a.d - b.d);
    neighbors.push(dists.slice(0, 4).map(x => x.j));
  }

  // 4. Greedy proton-donor assignment. Each water donates to exactly 2 of
  //    its neighbors. We walk oxygens in order, and for each one pick its
  //    two donor neighbors as the two with the lowest "donate-count so far"
  //    (so each O ends up accepting roughly two H bonds too, approximating
  //    the ice rules without a full MC shuffle).
  const donateCount: number[] = new Array(oxygens.length).fill(0);
  const donorsFor: number[][] = [];
  for (let i = 0; i < oxygens.length; i++) {
    const nbrs = neighbors[i];
    // Sort neighbors by how many H-bonds they've already accepted, tiebreak
    // by distance (already sorted).
    const ranked = [...nbrs].sort((a, b) => donateCount[a] - donateCount[b]);
    const chosen = ranked.slice(0, Math.min(2, ranked.length));
    donorsFor.push(chosen);
    for (const n of chosen) donateCount[n]++;
  }

  // 5. For each water, place H1 and H2 along vectors toward the chosen donors.
  //    The OH bond length is held at the canonical value; the actual H-O-H
  //    angle will come out as the angle between the two donor-direction
  //    vectors (tetrahedral-ish, ~109°, vs water's equilibrium 104.5°). Close
  //    enough for the sim to relax.
  const seed: SeedWater[] = [];
  for (let i = 0; i < oxygens.length; i++) {
    const O = oxygens[i];
    const donors = donorsFor[i];

    let dir1: [number, number, number];
    let dir2: [number, number, number];

    if (donors.length >= 2) {
      dir1 = vnorm(vsub(oxygens[donors[0]], O));
      dir2 = vnorm(vsub(oxygens[donors[1]], O));
    } else if (donors.length === 1) {
      // Edge water with only one neighbor picked: fall back to a second
      // direction tetrahedrally opposite to the first.
      dir1 = vnorm(vsub(oxygens[donors[0]], O));
      const perp = Math.abs(dir1[2]) < 0.9 ? vnorm(vcross(dir1, [0, 0, 1])) : vnorm(vcross(dir1, [1, 0, 0]));
      const angle = (104.5 * Math.PI) / 180;
      dir2 = vadd(vscale(dir1, Math.cos(angle)), vscale(perp, Math.sin(angle)));
    } else {
      // Completely isolated — shouldn't happen for the default supercell.
      dir1 = [1, 0, 0];
      dir2 = [-Math.cos((104.5 * Math.PI) / 180), Math.sin((104.5 * Math.PI) / 180), 0];
    }

    const H1 = vadd(O, vscale(dir1, OH_BOND_LEN));
    const H2 = vadd(O, vscale(dir2, OH_BOND_LEN));

    // Translate into the requested box location.
    seed.push({
      atoms: [
        [O[0] + cx, O[1] + cy, O[2] + cz],
        [H1[0] + cx, H1[1] + cy, H1[2] + cz],
        [H2[0] + cx, H2[1] + cy, H2[2] + cz],
      ],
    });
  }

  return seed;
}

/** Approximate bounding-sphere radius of a seed generated with the given
 *  supercell dimensions. Used by the liquid-placement code to carve out a
 *  central region so liquid waters don't overlap the seed. */
export function iceSeedRadius(nA: number = 2, nB: number = 2, nC: number = 2): number {
  // Diagonal of the supercell plus a ~2 Å buffer for the outermost H atoms.
  const diag = Math.hypot(nA * A_LATTICE, nB * A_LATTICE * (Math.sqrt(3) / 2), nC * C_LATTICE);
  return diag / 2 + 2.0;
}

// Exported for the Add Ice Seed button so main.ts knows how many liquid
// slots to leave out at the center when re-seeding an existing box.
export const DEFAULT_SEED_SIZE = { nA: 2, nB: 2, nC: 2 } as const;
