#!/usr/bin/env python3
"""
Compare Python reference values (results/validation/reference_values.json) against
our Rust/WASM physics (results/validation/our_values.json).

Prints a pass/fail table. Exits nonzero if any check fails outside tolerance.
"""

import json
import os
import sys


TOLERANCE_RELATIVE = 0.01   # 1 % relative tolerance for same-model comparisons
TOLERANCE_ABS_KJMOL = 0.1   # kJ/mol absolute tolerance for small energies


def pct_diff(ours, ref):
    if abs(ref) < 1e-10:
        return abs(ours - ref)
    return abs(ours - ref) / abs(ref) * 100


def check(name, ours, ref, tol_pct=1.0, tol_abs=0.1, unit=""):
    diff = abs(ours - ref)
    if abs(ref) < 1e-10:
        passed = diff < tol_abs
        pct = "-"
    else:
        rel = diff / abs(ref) * 100
        passed = rel < tol_pct or diff < tol_abs
        pct = f"{rel:.2f}%"

    status = "PASS" if passed else "FAIL"
    unit_s = f" {unit}" if unit else ""
    print(f"  [{status}] {name:45s}: ours={ours:+10.4f}{unit_s}  ref={ref:+10.4f}{unit_s}  diff={diff:.4f} ({pct})")
    return passed


def main():
    if not os.path.exists("results/validation/reference_values.json"):
        print("ERROR: results/validation/reference_values.json missing. Run compute_references.py")
        sys.exit(2)
    if not os.path.exists("results/validation/our_values.json"):
        print("ERROR: results/validation/our_values.json missing. Run cargo test --test validation")
        sys.exit(2)

    with open("results/validation/reference_values.json") as f:
        ref = json.load(f)
    with open("results/validation/our_values.json") as f:
        ours = json.load(f)

    all_pass = True

    print("=" * 80)
    print("SECTION 1: Implementation fidelity (our Rust vs Python, same model)")
    print("Tolerance: 1% relative or 0.1 kJ/mol absolute.")
    print("=" * 80)

    # Dipole: both classical TIP3P
    p = check(
        "water dipole (classical TIP3P)",
        ours["water_dipole_classical_debye"],
        ref["water_dipole"]["tip3p_classical_debye"],
        unit="D",
    )
    all_pass &= p

    # Water dimer classical minimum
    our_min = ours["water_dimer_classical_minimum"]
    ref_min = ref["water_dimer_classical_minimum"]
    p = check(
        "water dimer classical min energy",
        our_min["total_kJ_mol"],
        ref_min["classical_total_kJ_mol"],
        unit="kJ/mol",
    )
    all_pass &= p
    p = check(
        "water dimer classical min r_OO",
        our_min["r_oo"],
        ref_min["r_oo"],
        unit="A",
    )
    all_pass &= p

    # SimulationSystem at same geometry
    sys_val = ours["water_dimer_system_at_minimum"]
    p = check(
        "SimulationSystem energy at min geometry",
        sys_val["total_kJ_mol"],
        our_min["total_kJ_mol"],
        unit="kJ/mol",
    )
    all_pass &= p

    # Methane dimer
    p = check(
        "CH4-CH4 total energy at 4 A",
        ours["methane_dimer_4A"]["total_kJ_mol"],
        ref["methane_dimer_4A"]["total_kJ_mol"],
        unit="kJ/mol",
    )
    all_pass &= p
    # Water-methane
    p = check(
        "H2O-CH4 total energy at 4 A",
        ours["water_methane_4A"]["total_kJ_mol"],
        ref["water_methane_4A"]["total_kJ_mol"],
        unit="kJ/mol",
    )
    all_pass &= p

    # LJ minimum
    lj_t = ours["lj_minimum_test"]
    p = check(
        "LJ energy at sigma * 2^(1/6)",
        lj_t["actual"],
        -lj_t["expected_eps"],
        unit="kJ/mol",
    )
    all_pass &= p

    # ESP at probes (classical vs classical should match exactly)
    for probe in ref["water_esp"]["classical_tip3p_kJ_mol_per_e"]:
        p = check(
            f"ESP classical @ {probe}",
            ours["water_esp_classical_kJ_mol_per_e"][probe],
            ref["water_esp"]["classical_tip3p_kJ_mol_per_e"][probe],
            unit="kJ/(mol*e)",
        )
        all_pass &= p

    print()
    print("=" * 80)
    print("SECTION 2: Model fidelity (our classical TIP3P/OPLS vs QM/experiment)")
    print("These are expected to differ: TIP3P is a simplified classical model.")
    print("Reported deltas are informational, not pass/fail.")
    print("=" * 80)

    qm_dipole = ref["water_dipole"]["qm_hf_6_31G_debye"]
    exp_dipole = ref["water_dipole"]["experimental_debye"]
    our_dipole = ours["water_dipole_classical_debye"]
    print(f"  water dipole: ours (TIP3P) = {our_dipole:.3f} D, QM HF/6-31G* = {qm_dipole:.3f} D, experimental = {exp_dipole} D")
    print(f"    TIP3P is well-known to overestimate the dipole (to mimic many-body polarization)")

    qm_291 = ref["water_dimer_qm_at_291"]["interaction_energy_kJ_mol"]
    print(f"  water dimer QM HF/6-31G* at r_OO=2.91: {qm_291:.2f} kJ/mol (published ref: ~-20 to -25 kJ/mol)")

    # ESP classical vs QM at each probe
    print("  water ESP classical vs QM:")
    for probe in ref["water_esp"]["classical_tip3p_kJ_mol_per_e"]:
        c = ref["water_esp"]["classical_tip3p_kJ_mol_per_e"][probe]
        q = ref["water_esp"]["qm_hf_6_31G_kJ_mol_per_e"][probe]
        delta = c - q
        print(f"    {probe:14s}: classical = {c:+7.2f}  QM = {q:+7.2f}  delta = {delta:+7.2f}  kJ/(mol*e)")

    # Additional reference: optimized dimer
    if os.path.exists("results/validation/water_dimer_minimum.json"):
        with open("results/validation/water_dimer_minimum.json") as f:
            opt = json.load(f)
        print(f"  water dimer optimized: E = {opt['minimum_energy_kJ_mol']:.2f} kJ/mol at r_OO = {opt['r_OO_A']:.2f} A")
        print(f"    (literature TIP3P: -26.3 kJ/mol at r_OO = 2.75 A, Jorgensen 1983)")

    print()
    print("=" * 80)
    print("OVERALL: " + ("PASS (all Section 1 checks passed)" if all_pass else "FAIL (some Section 1 checks failed)"))
    print("=" * 80)

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
