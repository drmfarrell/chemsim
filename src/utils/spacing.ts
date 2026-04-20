/**
 * Per-species liquid-density spacing used when grid-placing molecules in a
 * Mode-2 box (both for the primary species in loadMode2 and for
 * secondary populations added via addBunchOfMolecules). Values are the
 * cube root of experimental molar volume at room temperature:
 *   spacing ≈ cbrt(MW / (density · N_A · 1e-24))
 * Picking a spacing smaller than this stuffs molecules inside each
 * other's LJ cores at t=0; the integrator then blows them apart into
 * scattered clumps (what looked like "gas" in the CCl4 demo).
 */

export const MOLECULE_SPACING_A: Record<string, number> = {
  water: 3.1,
  ammonia: 3.5,
  hydrogen_sulfide: 3.7,
  methane: 3.9,
  carbon_dioxide: 4.0,
  methanol: 4.1,
  urea: 4.2,
  tetrafluoromethane: 4.5,
  ethanol: 4.6,
  chloroform: 5.1,
  carbon_tetrachloride: 5.5,
  sodium_ion: 3.0,
  chloride_ion: 3.3,
};

/** Returns the target grid spacing (Å) for the given species. Falls back
 *  to a conservative 4.2 Å for species not in the table. */
export function spacingFor(speciesId: string): number {
  return MOLECULE_SPACING_A[speciesId] ?? 4.2;
}
