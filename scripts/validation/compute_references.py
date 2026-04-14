#!/usr/bin/env python3
"""
Reference calculations for ChemSim science validation.

Uses RDKit and PySCF to compute reference values we can compare our physics
engine against. Writes results to results/validation/reference_values.json.

Reference quantities:
1. Water dimer interaction energy (Hartree-Fock + DFT, classical TIP3P)
2. Water dimer optimal O...O distance
3. Water dimer angular energy scan
4. Water monomer dipole moment (QM + classical)
5. ESP at probe points around water (QM)
6. Methane-methane interaction energy
7. Water-methane interaction energy
"""

import json
import math
import os
import sys

import numpy as np
from pyscf import gto, scf, dft

# ---------------------------------------------------------------------------
# Physical constants and unit conversions
# ---------------------------------------------------------------------------

HARTREE_TO_KJ_PER_MOL = 2625.4996    # 1 Hartree = 2625.5 kJ/mol
BOHR_TO_ANGSTROM = 0.5291772109
DEBYE_PER_AU = 2.541746                 # 1 au dipole = 2.541746 D
COULOMB_K_KJ_A = 1389.35             # kJ*Å/(mol*e^2) (corrected from 332.0637 kcal/mol * 4.184)

# ---------------------------------------------------------------------------
# Molecule geometries (matching our JSON files in src/data/molecules/)
# ---------------------------------------------------------------------------

WATER_ATOMS = [
    ("O",  0.0,     0.0,  0.1173),
    ("H",  0.7572,  0.0, -0.4692),
    ("H", -0.7572,  0.0, -0.4692),
]

METHANE_ATOMS = [
    ("C",  0.0,     0.0,     0.0    ),
    ("H",  0.6276,  0.6276,  0.6276),
    ("H", -0.6276, -0.6276,  0.6276),
    ("H", -0.6276,  0.6276, -0.6276),
    ("H",  0.6276, -0.6276, -0.6276),
]

# TIP3P charges for water
TIP3P_CHARGES = {"O": -0.834, "H": 0.417}


def atoms_to_pyscf_string(atoms, dx=0.0, dy=0.0, dz=0.0):
    """Convert [(elem, x, y, z), ...] to PySCF atom string format."""
    lines = []
    for elem, x, y, z in atoms:
        lines.append(f"{elem} {x + dx:.6f} {y + dy:.6f} {z + dz:.6f}")
    return "; ".join(lines)


def pyscf_energy(atoms_list, method="hf", basis="6-31G*"):
    """Compute single-point energy in Hartree.

    atoms_list: list of (element, x, y, z) tuples in Angstroms.
    method: "hf" or "b3lyp"
    basis: basis set name
    """
    mol = gto.Mole()
    mol.atom = atoms_to_pyscf_string(atoms_list)
    mol.basis = basis
    mol.unit = "Angstrom"
    mol.verbose = 0
    mol.charge = 0
    mol.build()

    if method == "hf":
        mf = scf.RHF(mol)
    elif method == "b3lyp":
        mf = dft.RKS(mol)
        mf.xc = "b3lyp"
    else:
        raise ValueError(f"Unknown method {method}")

    mf.verbose = 0
    energy = mf.kernel()
    return energy, mf, mol


def water_dimer_atoms(dx, dy=0.0, dz=0.0, orientation="linear_HB"):
    """
    Build a water dimer.

    orientation "linear_HB": molecule B is translated by (dx, dy, dz) with
        molecule B rotated so one of its H atoms points at molecule A's O.
        For simplicity we approximate by placing B along +x, then rotating 180
        deg around y so B's H faces A's O when dx is positive.

    Returns list of 6 (elem, x, y, z) atoms.
    """
    atoms_a = [(e, x, y, z) for e, x, y, z in WATER_ATOMS]
    # Molecule B: start from WATER_ATOMS, rotate 180 deg about y-axis, translate.
    # Rotation: x -> -x, z -> -z, y unchanged.
    atoms_b = []
    for e, x, y, z in WATER_ATOMS:
        atoms_b.append((e, -x + dx, y + dy, -z + dz))
    return atoms_a + atoms_b


def classical_coulomb_lj_energy(
    atoms_a_charge_lj, atoms_b_charge_lj,
):
    """
    Compute classical interaction energy between two sets of atoms with
    partial charges and LJ parameters.

    atoms: list of (x, y, z, charge, epsilon, sigma) in (Å, Å, Å, e, kJ/mol, Å).
    Returns (total, coulomb, lj) in kJ/mol.
    """
    e_coul = 0.0
    e_lj = 0.0
    for ax, ay, az, aq, ae, as_ in atoms_a_charge_lj:
        for bx, by, bz, bq, be, bs_ in atoms_b_charge_lj:
            dx = bx - ax
            dy = by - ay
            dz = bz - az
            r2 = dx * dx + dy * dy + dz * dz
            if r2 < 0.01:
                continue
            r = math.sqrt(r2)
            e_coul += COULOMB_K_KJ_A * aq * bq / r

            sigma = (as_ + bs_) / 2.0
            eps = math.sqrt(ae * be)
            if eps > 1e-10:
                s6 = (sigma * sigma / r2) ** 3
                s12 = s6 * s6
                e_lj += 4.0 * eps * (s12 - s6)

    return e_coul + e_lj, e_coul, e_lj


# LJ parameters matching our src/utils/constants.ts LJ_PARAMS
LJ_PARAMS = {
    "H":  (0.01,   2.50),   # matches our updated H epsilon
    "C":  (0.4577, 3.40),
    "N":  (0.7113, 3.25),
    "O":  (0.6502, 3.12),
    "F":  (0.2552, 2.95),
    "S":  (1.0460, 3.55),
    "Cl": (1.1088, 3.47),
}


def apply_charges_and_lj(atoms, charges):
    """Attach TIP3P-like charges and per-element LJ to a list of atoms."""
    out = []
    for e, x, y, z in atoms:
        q = charges.get(e, 0.0)
        eps, sigma = LJ_PARAMS[e]
        out.append((x, y, z, q, eps, sigma))
    return out


# ---------------------------------------------------------------------------
# Water monomer dipole moment (QM and classical)
# ---------------------------------------------------------------------------

def water_dipole_moments():
    """
    Compute the water dipole moment two ways and return both.

    - QM: HF/6-31G* electronic + nuclear dipole
    - Classical: sum of q_i * r_i using TIP3P charges

    Returns dict with 'qm_debye' and 'tip3p_debye'.
    """
    # QM
    energy, mf, mol = pyscf_energy(WATER_ATOMS, method="hf", basis="6-31G*")
    # PySCF dipole in Debye
    dm = mf.make_rdm1()
    dipole_au = mf.dip_moment(unit="DEBYE", verbose=0)
    qm_dipole_magnitude = float(np.linalg.norm(dipole_au))

    # Classical: sum q * r. Result is in e * Angstrom.
    # Convert: 1 e * Angstrom = 4.80320 D
    E_ANGSTROM_TO_DEBYE = 4.80320
    px, py, pz = 0.0, 0.0, 0.0
    for e, x, y, z in WATER_ATOMS:
        q = TIP3P_CHARGES[e]
        px += q * x
        py += q * y
        pz += q * z
    classical_mag = math.sqrt(px * px + py * py + pz * pz) * E_ANGSTROM_TO_DEBYE

    return {
        "qm_hf_6_31G_debye": qm_dipole_magnitude,
        "tip3p_classical_debye": classical_mag,
        "experimental_debye": 1.85,
    }


# ---------------------------------------------------------------------------
# Water dimer: distance scan
# ---------------------------------------------------------------------------

def water_dimer_distance_scan():
    """
    Scan O...O distance along the +x axis with molecule B rotated so its H
    points at A's O. Returns list of (r, classical_energy_kJ/mol).

    QM scan is skipped here (expensive); we compute it only at the optimal
    geometry below.
    """
    # Find the O-O distance for a simple scan.
    # A's O is at (0, 0, 0.1173). B's O after our translation is at
    # (-0 + dx, 0, -0.1173 + 0) = (dx, 0, -0.1173). So O-O distance is
    # sqrt(dx^2 + 0 + (0.1173 - (-0.1173))^2) = sqrt(dx^2 + 0.2346^2).
    # For dx in [2.5, 6.0] we get O-O in [2.51, 6.0].

    results = []
    for dx in np.linspace(2.4, 8.0, 57):
        atoms = water_dimer_atoms(dx)
        # Classical
        atoms_a = apply_charges_and_lj(atoms[:3], TIP3P_CHARGES)
        atoms_b = apply_charges_and_lj(atoms[3:], TIP3P_CHARGES)
        e_tot, e_c, e_lj = classical_coulomb_lj_energy(atoms_a, atoms_b)

        # O-O distance
        oa = np.array(atoms[0][1:])
        ob = np.array(atoms[3][1:])
        r_oo = float(np.linalg.norm(ob - oa))

        results.append({
            "dx": float(dx),
            "r_oo": r_oo,
            "classical_total_kJ_mol": float(e_tot),
            "classical_coulomb_kJ_mol": float(e_c),
            "classical_lj_kJ_mol": float(e_lj),
        })
    return results


def water_dimer_qm_at_distance(r_oo_target):
    """
    Compute QM interaction energy for a water dimer with a given O-O distance
    in the linear H-bond orientation. Uses HF/6-31G*.

    Interaction energy = E(dimer) - 2*E(monomer).
    """
    # Solve for dx such that r_oo = r_oo_target.
    # r_oo^2 = dx^2 + 0.2346^2
    if r_oo_target ** 2 <= 0.2346 ** 2:
        raise ValueError(f"Target r_oo {r_oo_target} too small")
    dx = math.sqrt(r_oo_target ** 2 - 0.2346 ** 2)
    atoms = water_dimer_atoms(dx)

    e_dimer_hartree, _, _ = pyscf_energy(atoms, method="hf", basis="6-31G*")
    e_monomer_hartree, _, _ = pyscf_energy(WATER_ATOMS, method="hf", basis="6-31G*")

    interaction = (e_dimer_hartree - 2 * e_monomer_hartree) * HARTREE_TO_KJ_PER_MOL
    return {
        "r_oo": r_oo_target,
        "method": "HF/6-31G*",
        "interaction_energy_kJ_mol": float(interaction),
    }


# ---------------------------------------------------------------------------
# Water dimer: orientation scan (rotate B around O-O axis)
# ---------------------------------------------------------------------------

def water_dimer_orientation_scan(r_oo=2.91):
    """
    At fixed O-O distance, rotate molecule B around the O-O axis (x-axis) by
    angle theta and compute classical energy. Starts at the linear H-bond
    orientation (theta=0) and sweeps 360 degrees.
    """
    dx = math.sqrt(r_oo ** 2 - 0.2346 ** 2)
    results = []
    # Build molecule B atoms (pre-rotation)
    atoms_a = WATER_ATOMS
    # B is A rotated 180 deg about y, translated by (dx, 0, 0).
    atoms_b_base = [(e, -x + dx, y, -z) for e, x, y, z in WATER_ATOMS]
    # We'll rotate atoms_b around the x-axis passing through B's oxygen.
    o_b = atoms_b_base[0]
    ob_x, ob_y, ob_z = o_b[1], o_b[2], o_b[3]

    for theta_deg in range(0, 361, 15):
        theta = math.radians(theta_deg)
        c, s = math.cos(theta), math.sin(theta)
        atoms_b_rot = []
        for e, x, y, z in atoms_b_base:
            # Translate to origin relative to B's O, rotate about x, translate back
            y_rel = y - ob_y
            z_rel = z - ob_z
            new_y = y_rel * c - z_rel * s + ob_y
            new_z = y_rel * s + z_rel * c + ob_z
            atoms_b_rot.append((e, x, new_y, new_z))

        atoms_a_list = apply_charges_and_lj(atoms_a, TIP3P_CHARGES)
        atoms_b_list = apply_charges_and_lj(atoms_b_rot, TIP3P_CHARGES)
        e_tot, e_c, e_lj = classical_coulomb_lj_energy(atoms_a_list, atoms_b_list)
        results.append({
            "theta_deg": theta_deg,
            "classical_total_kJ_mol": float(e_tot),
        })
    return results


# ---------------------------------------------------------------------------
# Electrostatic potential at probe points (QM vs our point-charge model)
# ---------------------------------------------------------------------------

def water_esp_at_probes():
    """
    Compute ESP at several probe points around a water molecule two ways:
    1. QM: from HF/6-31G* electron density + nuclear charges
    2. Classical: from TIP3P point charges
    """
    # Probe points: above O (lone pair region), along O-H bonds, behind H
    probes = {
        "above_O": (0.0, 0.0, 2.5),          # directly above O (lone pair)
        "below_O": (0.0, 0.0, -1.5),         # between H atoms, opposite side
        "along_OH": (1.5, 0.0, -0.8),        # extension of O-H bond (past H)
        "perpendicular": (0.0, 2.0, 0.117),  # perpendicular to molecular plane
        "far_above": (0.0, 0.0, 5.0),        # far field test
    }

    # Classical ESP from TIP3P charges
    classical = {}
    for name, (px, py, pz) in probes.items():
        v = 0.0
        for elem, ax, ay, az in WATER_ATOMS:
            q = TIP3P_CHARGES[elem]
            r = math.sqrt((px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2)
            if r > 0.01:
                v += COULOMB_K_KJ_A * q / r
        classical[name] = float(v)

    # QM ESP via PySCF
    # Build molecule
    mol = gto.Mole()
    mol.atom = atoms_to_pyscf_string(WATER_ATOMS)
    mol.basis = "6-31G*"
    mol.unit = "Angstrom"
    mol.verbose = 0
    mol.build()

    mf = scf.RHF(mol)
    mf.verbose = 0
    mf.kernel()

    dm = mf.make_rdm1()

    # ESP at each probe
    qm = {}
    for name, (px, py, pz) in probes.items():
        # Use the integrals to compute V(r) = sum_i Z_i/|R_i - r| - integral dm(r') / |r' - r|
        # Nuclear contribution
        v_nuc = 0.0
        for i in range(mol.natm):
            Z = mol.atom_charge(i)
            coord = mol.atom_coord(i)  # in bohr
            probe_bohr = np.array([px, py, pz]) / BOHR_TO_ANGSTROM
            r = float(np.linalg.norm(coord - probe_bohr))
            if r > 0.001:
                v_nuc += Z / r  # Hartree units

        # Electron contribution: -integral rho(r') / |r' - r| dr'
        # Use PySCF's with_rinv_origin for 1/|r - R| integrals.
        probe_bohr = np.array([px, py, pz]) / BOHR_TO_ANGSTROM
        with mol.with_rinv_origin(probe_bohr):
            ao_int = mol.intor("int1e_rinv")
        v_elec = -np.einsum("ij,ji->", ao_int, dm)  # Hartree

        v_total_hartree = v_nuc + v_elec
        # Convert Hartree/e to kJ/mol per e
        v_kj_mol = float(v_total_hartree * HARTREE_TO_KJ_PER_MOL)
        qm[name] = v_kj_mol

    return {
        "probe_points": probes,
        "classical_tip3p_kJ_mol_per_e": classical,
        "qm_hf_6_31G_kJ_mol_per_e": qm,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    results = {}

    print("[1/6] Water monomer dipole moments...")
    results["water_dipole"] = water_dipole_moments()
    print(f"    QM HF/6-31G*:  {results['water_dipole']['qm_hf_6_31G_debye']:.3f} D")
    print(f"    TIP3P classic: {results['water_dipole']['tip3p_classical_debye']:.3f} D")
    print(f"    Experimental:  {results['water_dipole']['experimental_debye']} D")

    print("[2/6] Water dimer classical distance scan...")
    scan = water_dimer_distance_scan()
    min_point = min(scan, key=lambda x: x["classical_total_kJ_mol"])
    print(f"    Classical minimum: {min_point['classical_total_kJ_mol']:.2f} kJ/mol at r_oo = {min_point['r_oo']:.3f} A")
    results["water_dimer_classical_scan"] = scan
    results["water_dimer_classical_minimum"] = min_point

    print("[3/6] Water dimer QM reference at known optimum (r_oo = 2.91 A)...")
    qm_at_291 = water_dimer_qm_at_distance(2.91)
    print(f"    QM HF/6-31G* at r_oo=2.91: {qm_at_291['interaction_energy_kJ_mol']:.2f} kJ/mol")
    results["water_dimer_qm_at_291"] = qm_at_291

    # Also at classical minimum
    r_class_min = min_point["r_oo"]
    qm_at_class = water_dimer_qm_at_distance(r_class_min)
    print(f"    QM HF/6-31G* at r_oo={r_class_min:.2f}: {qm_at_class['interaction_energy_kJ_mol']:.2f} kJ/mol")
    results["water_dimer_qm_at_classical_min"] = qm_at_class

    print("[4/6] Water dimer orientation scan (classical)...")
    results["water_dimer_orientation"] = water_dimer_orientation_scan(r_oo=2.91)
    min_theta = min(results["water_dimer_orientation"], key=lambda x: x["classical_total_kJ_mol"])
    max_theta = max(results["water_dimer_orientation"], key=lambda x: x["classical_total_kJ_mol"])
    print(f"    Lowest at theta={min_theta['theta_deg']}: {min_theta['classical_total_kJ_mol']:.2f} kJ/mol")
    print(f"    Highest at theta={max_theta['theta_deg']}: {max_theta['classical_total_kJ_mol']:.2f} kJ/mol")

    print("[5/6] ESP at probe points around water (QM vs classical)...")
    results["water_esp"] = water_esp_at_probes()
    for probe in results["water_esp"]["probe_points"]:
        q = results["water_esp"]["qm_hf_6_31G_kJ_mol_per_e"][probe]
        c = results["water_esp"]["classical_tip3p_kJ_mol_per_e"][probe]
        print(f"    {probe:16s}: QM={q:+7.2f}  Classical={c:+7.2f}  kJ/(mol*e)")

    print("[6/6] Methane dimer and methane-water (classical only, small effect)...")
    # Methane dimer at 4 A C-C
    atoms_a = [(e, x, y, z) for e, x, y, z in METHANE_ATOMS]
    atoms_b = [(e, x + 4.0, y, z) for e, x, y, z in METHANE_ATOMS]
    ch4_charges = {"C": -0.24, "H": 0.06}
    a = apply_charges_and_lj(atoms_a, ch4_charges)
    b = apply_charges_and_lj(atoms_b, ch4_charges)
    e_tot, e_c, e_lj = classical_coulomb_lj_energy(a, b)
    results["methane_dimer_4A"] = {
        "r_cc": 4.0,
        "total_kJ_mol": float(e_tot),
        "coulomb_kJ_mol": float(e_c),
        "lj_kJ_mol": float(e_lj),
    }
    print(f"    CH4-CH4 at 4A: {e_tot:.2f} kJ/mol (LJ={e_lj:.2f}, Coulomb={e_c:.2f})")

    # Water-methane at 4 A O-C
    atoms_w = [(e, x, y, z) for e, x, y, z in WATER_ATOMS]
    atoms_ch4 = [(e, x + 4.0, y, z) for e, x, y, z in METHANE_ATOMS]
    w = apply_charges_and_lj(atoms_w, TIP3P_CHARGES)
    m = apply_charges_and_lj(atoms_ch4, ch4_charges)
    e_tot, e_c, e_lj = classical_coulomb_lj_energy(w, m)
    results["water_methane_4A"] = {
        "separation": 4.0,
        "total_kJ_mol": float(e_tot),
        "coulomb_kJ_mol": float(e_c),
        "lj_kJ_mol": float(e_lj),
    }
    print(f"    H2O-CH4 at 4A: {e_tot:.2f} kJ/mol (LJ={e_lj:.2f}, Coulomb={e_c:.2f})")

    # Write output
    out_path = "results/validation/reference_values.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
