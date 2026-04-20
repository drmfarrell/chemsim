/**
 * Ice Ih (hexagonal ice) lattice generator.
 *
 * Produces a small seed crystal of water molecules sitting on the ice Ih
 * lattice (P6_3/mmc, 4 waters per hexagonal unit cell), each oriented so
 * its two H atoms point toward two of its four tetrahedral neighbors —
 * approximately satisfying the Bernal–Fowler ice rules.
 *
 * Each water is returned as a (center-of-mass, orientation-quaternion)
 * pair referenced to the canonical body-frame water geometry (O-H 0.9574 Å,
 * H-O-H 104.5°). The caller reuses the base water MoleculeData; only the
 * COM position and quaternion differ per seed water. This keeps the rigid-
 * body integrator happy (body frame is the canonical principal-axis frame;
 * inertia tensor diagonal is correct) and lets the renderer use a single
 * piece of molecule data with per-water `group.quaternion`.
 *
 * Lattice constants at 273 K / 1 atm: a = 4.511 Å, c = 7.346 Å.
 * O-O nearest-neighbor distance ≈ 2.76 Å.
 */

// ---------------------------------------------------------------------------
// Lattice constants
// ---------------------------------------------------------------------------

const A_LATTICE = 4.511;
const C_LATTICE = 7.346;

// Body-frame vector from COM to O for canonical water
// (O body z = 0.1173, COM body z = (16·0.1173 + 2·(-0.4692))/18 = 0.0521).
const COM_TO_O_Z = 0.1173 - 0.0521;

// Fractional oxygen coordinates inside one hexagonal unit cell.
const FRAC_OXYGENS: [number, number, number][] = [
  [1 / 3, 2 / 3, 1 / 16],
  [2 / 3, 1 / 3, 9 / 16],
  [1 / 3, 2 / 3, 7 / 16],
  [2 / 3, 1 / 3, 15 / 16],
];

// ---------------------------------------------------------------------------
// Vector + rotation helpers
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Quat = [number, number, number, number]; // (w, x, y, z)

function fracToCart(fa: number, fb: number, fc: number): Vec3 {
  return [
    A_LATTICE * (fa - fb * 0.5),
    A_LATTICE * fb * (Math.sqrt(3) / 2),
    C_LATTICE * fc,
  ];
}

const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const vlen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
function vnorm(a: Vec3): Vec3 {
  const l = vlen(a);
  return l > 1e-10 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
const vcross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Convert a rotation matrix (columns = [ex, ey, ez]) to a unit quaternion
 *  in (w, x, y, z) convention matching the physics engine. Standard stable
 *  formula that picks the largest diagonal to avoid sqrt(negative). */
function rotationToQuat(ex: Vec3, ey: Vec3, ez: Vec3): Quat {
  // Rotation matrix laid out as r[row][col].
  const r00 = ex[0], r10 = ex[1], r20 = ex[2];
  const r01 = ey[0], r11 = ey[1], r21 = ey[2];
  const r02 = ez[0], r12 = ez[1], r22 = ez[2];
  const trace = r00 + r11 + r22;
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (r21 - r12) / s;
    y = (r02 - r20) / s;
    z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }
  return [w, x, y, z];
}

/** Quaternion → rotation of a 3-vector. Uses the usual
 *  v' = v + 2·w·(u×v) + 2·u×(u×v) form with u = (x, y, z). */
function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const u: Vec3 = [x, y, z];
  const uv = vcross(u, v);
  const uuv = vcross(u, uv);
  return vadd(v, vadd(vscale(uv, 2 * w), vscale(uuv, 2)));
}

// ---------------------------------------------------------------------------
// Public: SeedWater structure and generator
// ---------------------------------------------------------------------------

export interface SeedWater {
  /** Center-of-mass world position (Å). */
  com: Vec3;
  /** Orientation quaternion (w, x, y, z) mapping canonical water body frame
   *  onto the world lattice orientation. Same convention as the physics
   *  engine's set_molecule_orientation. */
  quaternion: Quat;
}

export interface IceSeedResult {
  waters: SeedWater[];
  /** World-frame oxygen positions; used for the per-oxygen carve-out so
   *  liquid waters skip any grid site that would overlap a seed O. */
  oxygens: Vec3[];
}

/** Pick a default supercell size given the total molecule count in the
 *  simulation. Targets ~10–20 % of N as frozen seed — big enough to
 *  template several H-bond shells, small enough to leave a lot of liquid
 *  around it. Floor at 16 waters (2×2×1) so the crystal is always
 *  recognizably three-dimensional. */
export function seedDimsForCount(totalCount: number): { nA: number; nB: number; nC: number } {
  if (totalCount <= 125) return { nA: 2, nB: 2, nC: 1 }; // 16
  if (totalCount <= 343) return { nA: 2, nB: 2, nC: 2 }; // 32
  if (totalCount <= 729) return { nA: 3, nB: 2, nC: 2 }; // 48
  return { nA: 3, nB: 3, nC: 2 };                         // 72
}

/** Generate an ice Ih seed centered at (cx, cy, cz). */
export function generateIceIhSeed(
  cx: number,
  cy: number,
  cz: number,
  nA: number = 2,
  nB: number = 2,
  nC: number = 2,
): IceSeedResult {
  // 1. Build the oxygen sublattice (nA × nB × nC hexagonal unit cells).
  const oxygens: Vec3[] = [];
  for (let ia = 0; ia < nA; ia++) {
    for (let ib = 0; ib < nB; ib++) {
      for (let ic = 0; ic < nC; ic++) {
        for (const f of FRAC_OXYGENS) {
          oxygens.push(fracToCart(ia + f[0], ib + f[1], ic + f[2]));
        }
      }
    }
  }

  // 2. Center the cluster on origin, then shift to (cx, cy, cz).
  let mx = 0, my = 0, mz = 0;
  for (const o of oxygens) { mx += o[0]; my += o[1]; mz += o[2]; }
  mx /= oxygens.length; my /= oxygens.length; mz /= oxygens.length;
  for (const o of oxygens) { o[0] -= mx; o[1] -= my; o[2] -= mz; }

  // 3. For each oxygen, find its four nearest neighbors (within 3.2 Å).
  const NN_CUTOFF = 3.2;
  const neighbors: number[][] = [];
  for (let i = 0; i < oxygens.length; i++) {
    const cand: { j: number; d: number }[] = [];
    for (let j = 0; j < oxygens.length; j++) {
      if (j === i) continue;
      const d = vlen(vsub(oxygens[j], oxygens[i]));
      if (d < NN_CUTOFF) cand.push({ j, d });
    }
    cand.sort((a, b) => a.d - b.d);
    neighbors.push(cand.slice(0, 4).map(c => c.j));
  }

  // 4. Ice-rule proton assignment. We want every interior oxygen to have
  //    out-degree = 2 (donates 2 H) and in-degree = 2 (accepts 2 H-bonds).
  //    Pure greedy with a 2-out cap prevents mutual donation but doesn't
  //    balance in-degree — over-accepting oxygens end up with 3 H atoms
  //    stacked near them, which gives visible H-H clashes.
  //
  //    Approach: try many random edge orderings with the greedy cap
  //    (balance-aware tiebreak when both ends have slots), score each
  //    by "imbalance cost" = Σ(in_deg - target)² + Σ(out_deg - target)²
  //    where target = min(deg, 2), then keep the best assignment. For
  //    the ~50-edge seed this converges to the global minimum quickly
  //    and is deterministic across runs thanks to the seeded RNG.
  const edges: [number, number][] = [];
  for (let i = 0; i < oxygens.length; i++) {
    for (const j of neighbors[i]) {
      if (j > i) edges.push([i, j]);
    }
  }

  // Mulberry32 — tiny deterministic PRNG for the shuffles.
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function attemptAssignment(seed: number): {
    donors: number[][]; inDeg: number[]; outDeg: number[]; cost: number;
  } {
    const r = rng(seed);
    const shuffled = edges.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const outDeg = new Array<number>(oxygens.length).fill(0);
    const inDeg  = new Array<number>(oxygens.length).fill(0);
    const donors: number[][] = Array.from({ length: oxygens.length }, () => []);
    for (const [a, b] of shuffled) {
      // Hard caps: no water donates more than 2 H, and no water accepts
      // more than 2 H-bonds (the second cap was the missing piece —
      // without it, over-accepting oxygens force H atoms into the same
      // region and we see 1-Å H-H clashes). If neither direction fits,
      // leave the edge undirected.
      const canAToB = outDeg[a] < 2 && inDeg[b] < 2;
      const canBToA = outDeg[b] < 2 && inDeg[a] < 2;
      if (canAToB && canBToA) {
        // Break the tie by pointing toward the endpoint with fewer
        // current acceptances — this biases toward balanced in-degrees.
        if (inDeg[b] <= inDeg[a]) {
          donors[a].push(b); outDeg[a]++; inDeg[b]++;
        } else {
          donors[b].push(a); outDeg[b]++; inDeg[a]++;
        }
      } else if (canAToB) {
        donors[a].push(b); outDeg[a]++; inDeg[b]++;
      } else if (canBToA) {
        donors[b].push(a); outDeg[b]++; inDeg[a]++;
      }
      // else: neither cap allows this edge to be directed; skip.
    }
    // Cost: penalize deviation from ideal 2-in/2-out for interior
    // vertices (degree 4). Boundary vertices (deg < 4) can't hit the
    // target and we forgive them.
    let cost = 0;
    for (let i = 0; i < oxygens.length; i++) {
      const deg = neighbors[i].length;
      const ideal = Math.min(2, Math.floor(deg / 2) + ((deg % 2) & 1));
      cost += (inDeg[i]  - ideal) * (inDeg[i]  - ideal);
      cost += (outDeg[i] - ideal) * (outDeg[i] - ideal);
      // Heavy penalty for an acceptor exceeding 2: that's the specific
      // failure mode that stacks H atoms on top of each other.
      if (inDeg[i] > 2) cost += 100 * (inDeg[i] - 2) * (inDeg[i] - 2);
    }
    return { donors, inDeg, outDeg, cost };
  }

  let best = attemptAssignment(0);
  for (let seed = 1; seed < 4096; seed++) {
    const trial = attemptAssignment(seed);
    if (trial.cost < best.cost) best = trial;
    if (best.cost === 0) break;
  }
  const donorsFor = best.donors;

  // 5. For each water, compute the orientation quaternion that rotates the
  //    canonical water body frame into the world orientation where its two
  //    H atoms point along the donor-direction half-plane.
  const waters: SeedWater[] = [];
  for (let i = 0; i < oxygens.length; i++) {
    const O = oxygens[i];
    const donorIdxs = donorsFor[i];

    let d1: Vec3, d2: Vec3;
    if (donorIdxs.length >= 2) {
      d1 = vnorm(vsub(oxygens[donorIdxs[0]], O));
      d2 = vnorm(vsub(oxygens[donorIdxs[1]], O));
    } else if (donorIdxs.length === 1) {
      // Surface water with only one donor assigned: construct a second
      // direction at ~104.5° from the first, in a plane chosen to point
      // away from the cluster interior.
      d1 = vnorm(vsub(oxygens[donorIdxs[0]], O));
      const interior: Vec3 = vnorm([-O[0], -O[1], -O[2]]);
      const perp = vnorm(vcross(d1, interior));
      const angle = (104.5 * Math.PI) / 180;
      d2 = vadd(vscale(d1, Math.cos(angle)), vscale(perp, Math.sin(angle)));
    } else {
      // Completely disconnected — shouldn't happen for the default supercell.
      d1 = [1, 0, 0];
      d2 = [-Math.cos((104.5 * Math.PI) / 180), Math.sin((104.5 * Math.PI) / 180), 0];
    }

    // World-frame body-axis targets:
    //   body -z (= bisector from O toward H midpoint) → world (d1 + d2) side
    //   body +x (= H2 → H1 direction)                 → world (d1 - d2) side
    //   body +y (= normal to H-O-H plane)             → cross(z, x)
    const bisector = vnorm(vadd(d1, d2));          // body -z maps here
    const worldZ = vscale(bisector, -1);           // body +z
    let worldX = vnorm(vsub(d1, d2));              // body +x
    // Re-orthogonalize worldX against worldZ, just in case numerical
    // slop from d1/d2 being perfectly unit broke the orthogonality guard
    // (d1 - d2) ⊥ (d1 + d2) holds exactly for unit vectors.
    const dot = worldX[0] * worldZ[0] + worldX[1] * worldZ[1] + worldX[2] * worldZ[2];
    if (Math.abs(dot) > 1e-6) {
      worldX = vnorm(vsub(worldX, vscale(worldZ, dot)));
    }
    const worldY = vnorm(vcross(worldZ, worldX));
    const q = rotationToQuat(worldX, worldY, worldZ);

    // COM = O - q·(body O from COM), since q maps body (0,0,COM_TO_O_Z)
    // = (0, 0, COM_TO_O_Z) onto worldZ · COM_TO_O_Z.
    const oOffsetWorld = quatRotate(q, [0, 0, COM_TO_O_Z]);
    const com: Vec3 = [O[0] - oOffsetWorld[0], O[1] - oOffsetWorld[1], O[2] - oOffsetWorld[2]];

    waters.push({ com: [com[0] + cx, com[1] + cy, com[2] + cz], quaternion: q });
  }

  // 6. Final oxygen list used by the caller's carve-out logic. Oxygens
  //    were already re-centered on (0, 0, 0); shift to requested origin.
  const worldOxygens: Vec3[] = oxygens.map(o => [o[0] + cx, o[1] + cy, o[2] + cz]);

  return { waters, oxygens: worldOxygens };
}

/** Minimum distance from a point to any oxygen in the seed. Used by the
 *  liquid-placement code to skip grid sites that would overlap the seed. */
export function minDistToSeedOxygen(px: number, py: number, pz: number, seedOxygens: Vec3[]): number {
  let best = Infinity;
  for (const o of seedOxygens) {
    const dx = o[0] - px;
    const dy = o[1] - py;
    const dz = o[2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
