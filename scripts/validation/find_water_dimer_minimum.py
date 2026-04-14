#!/usr/bin/env python3
"""
Find the true TIP3P water dimer minimum by orientation + distance search.

The 'linear H-bond' geometry is: one donor O-H points along the acceptor's
lone-pair axis, with O...H distance around 1.8-2.0 A.

Reference target: Jorgensen et al. 1983 TIP3P water dimer.
  E = -26.3 kJ/mol at r(O-O) = 2.75 A (from TIP3P paper).

Writes results to results/validation/water_dimer_minimum.json.
"""

import json
import math
import os

import numpy as np
from scipy.optimize import minimize

COULOMB_K = 1389.35
LJ_PARAMS = {
    "H":  (0.01,   2.50),
    "O":  (0.6502, 3.12),
}
TIP3P_CHARGES = {"O": -0.834, "H": 0.417}

WATER_ATOMS_LOCAL = [
    ("O",  0.0,     0.0,  0.1173),
    ("H",  0.7572,  0.0, -0.4692),
    ("H", -0.7572,  0.0, -0.4692),
]


def pair_energy_tip3p_lj(atoms_a, atoms_b):
    """atoms: list of (elem, x, y, z)"""
    e_c = 0.0
    e_lj = 0.0
    for ea, ax, ay, az in atoms_a:
        qa = TIP3P_CHARGES[ea]
        eps_a, sig_a = LJ_PARAMS[ea]
        for eb, bx, by, bz in atoms_b:
            qb = TIP3P_CHARGES[eb]
            eps_b, sig_b = LJ_PARAMS[eb]
            dx = bx - ax
            dy = by - ay
            dz = bz - az
            r2 = dx*dx + dy*dy + dz*dz
            if r2 < 0.01: continue
            r = math.sqrt(r2)
            e_c += COULOMB_K * qa * qb / r
            sigma = (sig_a + sig_b) / 2.0
            eps = math.sqrt(eps_a * eps_b)
            if eps > 1e-10:
                s6 = (sigma*sigma / r2) ** 3
                s12 = s6 * s6
                e_lj += 4.0 * eps * (s12 - s6)
    return e_c + e_lj, e_c, e_lj


def quat_from_euler(yaw, pitch, roll):
    """Yaw-pitch-roll to quaternion (w, x, y, z)."""
    cy = math.cos(yaw * 0.5); sy = math.sin(yaw * 0.5)
    cp = math.cos(pitch * 0.5); sp = math.sin(pitch * 0.5)
    cr = math.cos(roll * 0.5); sr = math.sin(roll * 0.5)
    w = cr * cp * cy + sr * sp * sy
    x = sr * cp * cy - cr * sp * sy
    y = cr * sp * cy + sr * cp * sy
    z = cr * cp * sy - sr * sp * cy
    return (w, x, y, z)


def rotate_by_quat(pos, q):
    """Rotate position vector by quaternion (w, x, y, z)."""
    w, qx, qy, qz = q
    # v' = q * v * q^-1, using Rodrigues formula
    x, y, z = pos
    # r = 2 * (q_vec x v) ; out = v + q_w * r + q_vec x r
    # simpler: use full matrix
    xx = qx*qx; yy = qy*qy; zz = qz*qz
    wx = w*qx; wy = w*qy; wz = w*qz
    xy = qx*qy; xz = qx*qz; yz = qy*qz
    m00 = 1 - 2*(yy+zz); m01 = 2*(xy - wz); m02 = 2*(xz + wy)
    m10 = 2*(xy + wz); m11 = 1 - 2*(xx+zz); m12 = 2*(yz - wx)
    m20 = 2*(xz - wy); m21 = 2*(yz + wx); m22 = 1 - 2*(xx+yy)
    return (m00*x + m01*y + m02*z,
            m10*x + m11*y + m12*z,
            m20*x + m21*y + m22*z)


def build_dimer(tx, ty, tz, yaw, pitch, roll):
    """
    Build a water dimer. Molecule A at origin (standard), molecule B rotated
    by (yaw, pitch, roll) around its OWN center and translated by (tx, ty, tz).
    """
    atoms_a = list(WATER_ATOMS_LOCAL)
    q = quat_from_euler(yaw, pitch, roll)
    # Rotate B's atoms around B's COM (which for a water molecule is approx. the O
    # because O is much heavier than H; for consistency we use the mass-weighted COM).
    # Mass-weighted COM of local water:
    mass = {"O": 15.999, "H": 1.008}
    total_m = sum(mass[e] for e, _, _, _ in WATER_ATOMS_LOCAL)
    com = (
        sum(mass[e] * x for e, x, _, _ in WATER_ATOMS_LOCAL) / total_m,
        sum(mass[e] * y for e, _, y, _ in WATER_ATOMS_LOCAL) / total_m,
        sum(mass[e] * z for e, _, _, z in WATER_ATOMS_LOCAL) / total_m,
    )
    atoms_b = []
    for e, x, y, z in WATER_ATOMS_LOCAL:
        # Relative to COM
        rel = (x - com[0], y - com[1], z - com[2])
        rotated = rotate_by_quat(rel, q)
        atoms_b.append((e,
                        rotated[0] + com[0] + tx,
                        rotated[1] + com[1] + ty,
                        rotated[2] + com[2] + tz))
    return atoms_a, atoms_b


def objective(params):
    tx, ty, tz, yaw, pitch, roll = params
    a, b = build_dimer(tx, ty, tz, yaw, pitch, roll)
    e, _, _ = pair_energy_tip3p_lj(a, b)
    return e


def find_minimum():
    """
    Run a grid search for a promising starting point, then refine with
    scipy.optimize.minimize.

    The H-bonded geometry has B's H pointing at A's oxygen from above/below.
    Initial guess: B translated +3 Å in z, flipped 180 about x so its hydrogens
    point down.
    """
    best = (float("inf"), None)
    # Grid search for starting points
    for tz in [2.5, 2.75, 3.0, 3.25]:
        for tx in [-0.5, 0.0, 0.5]:
            for yaw in [0.0, math.pi]:
                for pitch in [0.0, math.pi/2, math.pi]:
                    for roll in [0.0, math.pi/2, math.pi, 3*math.pi/2]:
                        p = [tx, 0.0, tz, yaw, pitch, roll]
                        e = objective(p)
                        if e < best[0]:
                            best = (e, p)

    # Refine
    result = minimize(objective, best[1], method="Nelder-Mead",
                      options={"xatol": 1e-5, "fatol": 1e-4, "maxiter": 5000})
    opt_params = result.x
    opt_energy = result.fun

    # Compute final geometry
    a, b = build_dimer(*opt_params)
    oa = np.array(a[0][1:])
    ob = np.array(b[0][1:])
    r_oo = float(np.linalg.norm(ob - oa))

    # Find closest O-H distance
    min_oh = float("inf")
    min_oh_pair = None
    for ea, xa, ya, za in a:
        if ea != "O": continue
        for eb, xb, yb, zb in b:
            if eb != "H": continue
            d = math.sqrt((xa-xb)**2 + (ya-yb)**2 + (za-zb)**2)
            if d < min_oh:
                min_oh = d
                min_oh_pair = ((ea, xa, ya, za), (eb, xb, yb, zb))
    # Also reverse: acceptor's H to donor's O
    for ea, xa, ya, za in a:
        if ea != "H": continue
        for eb, xb, yb, zb in b:
            if eb != "O": continue
            d = math.sqrt((xa-xb)**2 + (ya-yb)**2 + (za-zb)**2)
            if d < min_oh:
                min_oh = d
                min_oh_pair = ((ea, xa, ya, za), (eb, xb, yb, zb))

    # H-bond angle: O(donor)-H...O(acceptor), should be ~180 for linear HB
    # Identify which molecule donates: whichever has the H closest to the other's O.

    return {
        "minimum_energy_kJ_mol": opt_energy,
        "r_OO_A": r_oo,
        "r_OH_closest_A": min_oh,
        "params": {
            "tx": float(opt_params[0]),
            "ty": float(opt_params[1]),
            "tz": float(opt_params[2]),
            "yaw":   float(opt_params[3]),
            "pitch": float(opt_params[4]),
            "roll":  float(opt_params[5]),
        },
        "molecule_a": [{"element": e, "x": x, "y": y, "z": z} for e, x, y, z in a],
        "molecule_b": [{"element": e, "x": x, "y": y, "z": z} for e, x, y, z in b],
        "tip3p_literature_ref": {
            "E_kJ_mol": -26.3,
            "r_OO_A": 2.75,
            "source": "Jorgensen et al. J. Chem. Phys. 79, 926 (1983)",
        },
    }


def main():
    print("Finding true TIP3P water dimer minimum...")
    result = find_minimum()
    print(f"Minimum energy: {result['minimum_energy_kJ_mol']:.3f} kJ/mol")
    print(f"r(O-O): {result['r_OO_A']:.3f} A")
    print(f"r(O-H closest): {result['r_OH_closest_A']:.3f} A")
    print(f"Literature TIP3P ref: -26.3 kJ/mol at r_OO=2.75 A")

    out = "results/validation/water_dimer_minimum.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
