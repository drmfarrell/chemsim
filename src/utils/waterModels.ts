/**
 * Classical water models selectable from Experiments and the Advanced panel.
 * All energies in kJ/mol; distances in Angstroms; charges in electron units.
 *
 * Canonical sources:
 *   - TIP3P:      Jorgensen et al., J. Chem. Phys. 79 (1983) 926
 *   - TIP4P/2005: Abascal & Vega, J. Chem. Phys. 123 (2005) 234505
 *   - TIP4P/Ice:  Abascal, Sanz, Garcia Fernandez, Vega, J. Chem. Phys. 122 (2005) 234511
 *
 * Published epsilons are in kcal/mol in the original papers; we convert
 * to kJ/mol here (1 kcal = 4.184 kJ) because the physics engine's Coulomb
 * constant and Boltzmann constant are both in kJ/mol.
 */

export interface WaterModel {
  id: string;
  label: string;
  description: string;
  /** Atmospheric-pressure melting point of ice Ih in this model (K). */
  meltingPointK: number;
  /** Temperature window where this model is considered reasonable for the
   *  purpose (liquid stable + not in the model's known-bad regime). Used
   *  for the "you picked the wrong model" hint, not a hard cutoff. */
  usefulRangeK: [number, number];
  /** Charge on the oxygen atom. 0 for 4-site TIP4P variants (charge lives
   *  on the M site); -0.834 for TIP3P (3-site). */
  oCharge: number;
  /** Charge on each hydrogen atom. */
  hCharge: number;
  /** Oxygen Lennard-Jones depth in kJ/mol. */
  oEpsilon: number;
  /** Oxygen Lennard-Jones sigma in Angstroms. */
  oSigma: number;
  /** Charge on the virtual M site, or null for 3-site models with no vsite. */
  mCharge: number | null;
  /** Notes shown in the UI near the dropdown. */
  notes: string;
}

export const WATER_MODELS: Record<string, WaterModel> = {
  'tip3p': {
    id: 'tip3p',
    label: 'TIP3P',
    description: '3-site rigid water. Cheap and ubiquitous in biomolecular MD.',
    meltingPointK: 146,
    usefulRangeK: [260, 400],
    oCharge: -0.834,
    hCharge: 0.417,
    oEpsilon: 0.6364,
    oSigma: 3.1507,
    mCharge: null,
    notes: 'Freezes ~150 K below reality. Use for liquid/gas demos, not ice.',
  },
  'tip4p-2005': {
    id: 'tip4p-2005',
    label: 'TIP4P/2005',
    description: '4-site rigid water with M-site. Accurate liquid density and phase diagram.',
    meltingPointK: 252,
    usefulRangeK: [255, 400],
    oCharge: 0.0,
    hCharge: 0.5564,
    oEpsilon: 0.7749,
    oSigma: 3.1589,
    mCharge: -1.1128,
    notes: 'Good all-rounder. Melts ~20 K below experiment — ice demos need TIP4P/Ice.',
  },
  'tip4p-ice': {
    id: 'tip4p-ice',
    label: 'TIP4P/Ice',
    description: '4-site water parameterized against ice phases. Melting point ~270 K.',
    meltingPointK: 270,
    usefulRangeK: [200, 310],
    oCharge: 0.0,
    hCharge: 0.5897,
    oEpsilon: 0.8822,
    oSigma: 3.1668,
    mCharge: -1.1794,
    notes: 'Best choice for freezing/ice demos. Overcohesive as a liquid above ~310 K.',
  },
};

export const DEFAULT_WATER_MODEL_ID = 'tip4p-2005';

/** Suggest a model when the user's target temperature falls outside the
 *  current model's usefulRangeK. Returns null if the current model is fine. */
export function suggestModelForTemperature(
  currentModelId: string,
  targetTempK: number,
): WaterModel | null {
  const current = WATER_MODELS[currentModelId];
  if (!current) return null;
  const [lo, hi] = current.usefulRangeK;
  if (targetTempK >= lo && targetTempK <= hi) return null;

  let best: WaterModel | null = null;
  let bestDist = Infinity;
  for (const m of Object.values(WATER_MODELS)) {
    if (m.id === currentModelId) continue;
    const [mlo, mhi] = m.usefulRangeK;
    if (targetTempK >= mlo && targetTempK <= mhi) {
      const dist = Math.min(Math.abs(targetTempK - m.meltingPointK), Math.abs(targetTempK - (mlo + mhi) / 2));
      if (dist < bestDist) { best = m; bestDist = dist; }
    }
  }
  return best;
}
