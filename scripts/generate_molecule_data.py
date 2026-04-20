#!/usr/bin/env python3
"""
Generate molecule JSON data files for ChemSim.

Each file contains:
- Atom positions (optimized geometries)
- Partial charges (ESP-fit / published force-field values)
- VDW radii
- Bond connectivity
- A UV-sphere-based cloud mesh (~200 vertices) conforming to the molecular
  van der Waals surface, with electrostatic potential at each vertex.

Uses only the Python standard library.
"""

import json
import math
import os

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
VDW = {"H": 1.20, "C": 1.70, "N": 1.55, "O": 1.52, "F": 1.47, "S": 1.80, "Cl": 1.75}
KE = 1389.35  # Coulomb constant in kJ/mol * Angstrom / e^2 (1389.35 = 332.0637 kcal/mol * 4.184 kJ/kcal)

OUTPUT_DIR = "/home/science2246/chemsim/src/data/molecules"

# ---------------------------------------------------------------------------
# Molecule definitions
# ---------------------------------------------------------------------------

MOLECULES = [
    {
        "filename": "water.json",
        "name": "Water",
        "formula": "H2O",
        "atoms": [
            {"element": "O", "x": 0.0, "y": 0.0, "z": 0.1173, "charge": -0.834, "vdw_radius": VDW["O"]},
            {"element": "H", "x": 0.7572, "y": 0.0, "z": -0.4692, "charge": 0.417, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.7572, "y": 0.0, "z": -0.4692, "charge": 0.417, "vdw_radius": VDW["H"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
        ],
        "polarizability": 1.45,
        "dipole_moment": 1.85,
        "molecular_weight": 18.015,
    },
    {
        "filename": "hydrogen_sulfide.json",
        "name": "Hydrogen Sulfide",
        "formula": "H2S",
        "atoms": [
            {"element": "S", "x": 0.0, "y": 0.0, "z": 0.1030, "charge": -0.470, "vdw_radius": VDW["S"]},
            {"element": "H", "x": 0.9616, "y": 0.0, "z": -0.8239, "charge": 0.235, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.9616, "y": 0.0, "z": -0.8239, "charge": 0.235, "vdw_radius": VDW["H"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
        ],
        "polarizability": 3.63,
        "dipole_moment": 0.97,
        "molecular_weight": 34.081,
    },
    {
        "filename": "carbon_dioxide.json",
        "name": "Carbon Dioxide",
        "formula": "CO2",
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0, "charge": 0.700, "vdw_radius": VDW["C"]},
            {"element": "O", "x": 1.160, "y": 0.0, "z": 0.0, "charge": -0.350, "vdw_radius": VDW["O"]},
            {"element": "O", "x": -1.160, "y": 0.0, "z": 0.0, "charge": -0.350, "vdw_radius": VDW["O"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 2},
            {"from": 0, "to": 2, "order": 2},
        ],
        "polarizability": 2.65,
        "dipole_moment": 0.0,
        "molecular_weight": 44.010,
    },
    {
        "filename": "methane.json",
        "name": "Methane",
        "formula": "CH4",
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0, "charge": -0.240, "vdw_radius": VDW["C"]},
            {"element": "H", "x": 0.6276, "y": 0.6276, "z": 0.6276, "charge": 0.060, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.6276, "y": -0.6276, "z": 0.6276, "charge": 0.060, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.6276, "y": 0.6276, "z": -0.6276, "charge": 0.060, "vdw_radius": VDW["H"]},
            {"element": "H", "x": 0.6276, "y": -0.6276, "z": -0.6276, "charge": 0.060, "vdw_radius": VDW["H"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
            {"from": 0, "to": 4, "order": 1},
        ],
        "polarizability": 2.59,
        "dipole_moment": 0.0,
        "molecular_weight": 16.043,
    },
    {
        "filename": "carbon_tetrachloride.json",
        "name": "Carbon Tetrachloride",
        "formula": "CCl4",
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0, "charge": 0.248, "vdw_radius": VDW["C"]},
            {"element": "Cl", "x": 1.022, "y": 1.022, "z": 1.022, "charge": -0.062, "vdw_radius": VDW["Cl"]},
            {"element": "Cl", "x": -1.022, "y": -1.022, "z": 1.022, "charge": -0.062, "vdw_radius": VDW["Cl"]},
            {"element": "Cl", "x": -1.022, "y": 1.022, "z": -1.022, "charge": -0.062, "vdw_radius": VDW["Cl"]},
            {"element": "Cl", "x": 1.022, "y": -1.022, "z": -1.022, "charge": -0.062, "vdw_radius": VDW["Cl"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
            {"from": 0, "to": 4, "order": 1},
        ],
        "polarizability": 10.50,
        "dipole_moment": 0.0,
        "molecular_weight": 153.823,
    },
    {
        "filename": "chloroform.json",
        "name": "Chloroform",
        "formula": "CHCl3",
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.3364, "charge": 0.180, "vdw_radius": VDW["C"]},
            {"element": "H", "x": 0.0, "y": 0.0, "z": 1.4264, "charge": 0.082, "vdw_radius": VDW["H"]},
            {"element": "Cl", "x": 0.0, "y": 1.6684, "z": -0.2228, "charge": -0.087, "vdw_radius": VDW["Cl"]},
            {"element": "Cl", "x": 1.4447, "y": -0.8342, "z": -0.2228, "charge": -0.087, "vdw_radius": VDW["Cl"]},
            {"element": "Cl", "x": -1.4447, "y": -0.8342, "z": -0.2228, "charge": -0.087, "vdw_radius": VDW["Cl"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
            {"from": 0, "to": 4, "order": 1},
        ],
        "polarizability": 8.50,
        "dipole_moment": 1.04,
        "molecular_weight": 119.378,
    },
    {
        "filename": "methanol.json",
        "name": "Methanol",
        "formula": "CH3OH",
        "atoms": [
            {"element": "C", "x": -0.0482, "y": 0.6645, "z": 0.0, "charge": 0.117, "vdw_radius": VDW["C"]},
            {"element": "O", "x": -0.0482, "y": -0.7587, "z": 0.0, "charge": -0.683, "vdw_radius": VDW["O"]},
            {"element": "H", "x": -0.0482, "y": -1.1473, "z": 0.8795, "charge": 0.418, "vdw_radius": VDW["H"]},
            {"element": "H", "x": 0.9370, "y": 1.0777, "z": 0.0, "charge": 0.049, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.5672, "y": 1.0153, "z": 0.8937, "charge": 0.049, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.5672, "y": 1.0153, "z": -0.8937, "charge": 0.049, "vdw_radius": VDW["H"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 1, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
            {"from": 0, "to": 4, "order": 1},
            {"from": 0, "to": 5, "order": 1},
        ],
        "polarizability": 3.29,
        "dipole_moment": 1.70,
        "molecular_weight": 32.042,
    },
    {
        # Ethanol CH3-CH2-OH. OPLS-AA partial charges; approximate
        # gas-phase trans geometry (C-C 1.53, C-O 1.42, O-H 0.96, tetra
        # H-C-H angles). Dipole + polarizability from CRC. Miscible
        # with water via the hydroxyl; paired with CCl4 (immiscible)
        # it demonstrates the "like dissolves like" rule for students.
        "filename": "ethanol.json",
        "name": "Ethanol",
        "formula": "C2H5OH",
        "atoms": [
            {"element": "C", "x":  1.2650, "y":  0.2550, "z":  0.0000, "charge": -0.180, "vdw_radius": VDW["C"]},  # 0: CH3 carbon
            {"element": "C", "x":  0.0000, "y": -0.4900, "z":  0.0000, "charge":  0.145, "vdw_radius": VDW["C"]},  # 1: CH2 carbon (bonded to O)
            {"element": "O", "x": -1.1650, "y":  0.3100, "z":  0.0000, "charge": -0.683, "vdw_radius": VDW["O"]},  # 2: hydroxyl O
            {"element": "H", "x": -1.9350, "y": -0.2450, "z":  0.0000, "charge":  0.418, "vdw_radius": VDW["H"]},  # 3: hydroxyl H
            {"element": "H", "x":  0.0000, "y": -1.1350, "z":  0.8900, "charge":  0.060, "vdw_radius": VDW["H"]},  # 4: methylene H
            {"element": "H", "x":  0.0000, "y": -1.1350, "z": -0.8900, "charge":  0.060, "vdw_radius": VDW["H"]},  # 5: methylene H
            {"element": "H", "x":  1.3100, "y":  0.8950, "z":  0.8900, "charge":  0.060, "vdw_radius": VDW["H"]},  # 6: methyl H
            {"element": "H", "x":  1.3100, "y":  0.8950, "z": -0.8900, "charge":  0.060, "vdw_radius": VDW["H"]},  # 7: methyl H
            {"element": "H", "x":  2.1260, "y": -0.4250, "z":  0.0000, "charge":  0.060, "vdw_radius": VDW["H"]},  # 8: methyl H
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 1, "to": 2, "order": 1},
            {"from": 2, "to": 3, "order": 1},
            {"from": 1, "to": 4, "order": 1},
            {"from": 1, "to": 5, "order": 1},
            {"from": 0, "to": 6, "order": 1},
            {"from": 0, "to": 7, "order": 1},
            {"from": 0, "to": 8, "order": 1},
        ],
        "polarizability": 5.41,
        "dipole_moment": 1.69,
        "molecular_weight": 46.069,
    },
    {
        "filename": "tetrafluoromethane.json",
        "name": "Tetrafluoromethane",
        "formula": "CF4",
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0, "charge": 0.752, "vdw_radius": VDW["C"]},
            {"element": "F", "x": 0.7567, "y": 0.7567, "z": 0.7567, "charge": -0.188, "vdw_radius": VDW["F"]},
            {"element": "F", "x": -0.7567, "y": -0.7567, "z": 0.7567, "charge": -0.188, "vdw_radius": VDW["F"]},
            {"element": "F", "x": -0.7567, "y": 0.7567, "z": -0.7567, "charge": -0.188, "vdw_radius": VDW["F"]},
            {"element": "F", "x": 0.7567, "y": -0.7567, "z": -0.7567, "charge": -0.188, "vdw_radius": VDW["F"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
            {"from": 0, "to": 4, "order": 1},
        ],
        "polarizability": 2.89,
        "dipole_moment": 0.0,
        "molecular_weight": 88.004,
    },
    {
        "filename": "ammonia.json",
        "name": "Ammonia",
        "formula": "NH3",
        "atoms": [
            {"element": "N", "x": 0.0, "y": 0.0, "z": 0.1165, "charge": -1.020, "vdw_radius": VDW["N"]},
            {"element": "H", "x": 0.0, "y": 0.9377, "z": -0.2717, "charge": 0.340, "vdw_radius": VDW["H"]},
            {"element": "H", "x": 0.8121, "y": -0.4689, "z": -0.2717, "charge": 0.340, "vdw_radius": VDW["H"]},
            {"element": "H", "x": -0.8121, "y": -0.4689, "z": -0.2717, "charge": 0.340, "vdw_radius": VDW["H"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 1},
            {"from": 0, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
        ],
        "polarizability": 2.26,
        "dipole_moment": 1.47,
        "molecular_weight": 17.031,
    },
    {
        "filename": "urea.json",
        "name": "Urea",
        "formula": "CH4N2O",
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0, "charge": 0.880, "vdw_radius": VDW["C"]},
            {"element": "O", "x": 0.0, "y": 0.0, "z": 1.2340, "charge": -0.580, "vdw_radius": VDW["O"]},
            {"element": "N", "x": 0.0, "y": 1.1518, "z": -0.6525, "charge": -0.910, "vdw_radius": VDW["N"]},
            {"element": "N", "x": 0.0, "y": -1.1518, "z": -0.6525, "charge": -0.910, "vdw_radius": VDW["N"]},
            {"element": "H", "x": 0.0, "y": 2.0337, "z": -0.1725, "charge": 0.380, "vdw_radius": VDW["H"]},
            {"element": "H", "x": 0.0, "y": 1.1518, "z": -1.6490, "charge": 0.380, "vdw_radius": VDW["H"]},
            {"element": "H", "x": 0.0, "y": -2.0337, "z": -0.1725, "charge": 0.380, "vdw_radius": VDW["H"]},
            {"element": "H", "x": 0.0, "y": -1.1518, "z": -1.6490, "charge": 0.380, "vdw_radius": VDW["H"]},
        ],
        "bonds": [
            {"from": 0, "to": 1, "order": 2},
            {"from": 0, "to": 2, "order": 1},
            {"from": 0, "to": 3, "order": 1},
            {"from": 2, "to": 4, "order": 1},
            {"from": 2, "to": 5, "order": 1},
            {"from": 3, "to": 6, "order": 1},
            {"from": 3, "to": 7, "order": 1},
        ],
        "polarizability": 5.44,
        "dipole_moment": 4.56,
        "molecular_weight": 60.056,
    },
]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def vec_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

def vec_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])

def vec_scale(v, s):
    return (v[0] * s, v[1] * s, v[2] * s)

def vec_len(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])

def vec_norm(v):
    ln = vec_len(v)
    if ln < 1e-12:
        return (0.0, 0.0, 1.0)
    return (v[0] / ln, v[1] / ln, v[2] / ln)

def vec_cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )

def dist(a, b):
    return vec_len(vec_sub(a, b))


# ---------------------------------------------------------------------------
# UV Sphere generation
# ---------------------------------------------------------------------------

def generate_uv_sphere(n_lat=10, n_lon=20):
    """
    Generate a unit UV sphere.
    Returns (vertices, faces) where vertices are (x,y,z) tuples and
    faces are (i,j,k) index tuples (0-based).
    n_lat = number of *latitude bands* (so n_lat-1 interior rings + 2 poles).
    n_lon = number of longitude steps.
    """
    verts = []
    faces = []

    # North pole
    verts.append((0.0, 0.0, 1.0))

    # Interior rings
    for i in range(1, n_lat):
        phi = math.pi * i / n_lat  # 0 at north pole, pi at south pole
        sp = math.sin(phi)
        cp = math.cos(phi)
        for j in range(n_lon):
            theta = 2.0 * math.pi * j / n_lon
            verts.append((sp * math.cos(theta), sp * math.sin(theta), cp))

    # South pole
    verts.append((0.0, 0.0, -1.0))

    n_verts = len(verts)
    south_pole = n_verts - 1

    # --- Faces ---

    # Top cap: triangles from north pole (index 0) to the first ring (indices 1..n_lon)
    for j in range(n_lon):
        j_next = (j + 1) % n_lon
        faces.append((0, 1 + j, 1 + j_next))

    # Middle bands
    for i in range(n_lat - 2):
        ring_start = 1 + i * n_lon
        next_ring_start = 1 + (i + 1) * n_lon
        for j in range(n_lon):
            j_next = (j + 1) % n_lon
            a = ring_start + j
            b = ring_start + j_next
            c = next_ring_start + j_next
            d = next_ring_start + j
            faces.append((a, d, b))
            faces.append((b, d, c))

    # Bottom cap
    last_ring_start = 1 + (n_lat - 2) * n_lon
    for j in range(n_lon):
        j_next = (j + 1) % n_lon
        faces.append((south_pole, last_ring_start + j_next, last_ring_start + j))

    return verts, faces


# ---------------------------------------------------------------------------
# Cloud mesh generation
# ---------------------------------------------------------------------------

def compute_molecular_center(atoms):
    """Geometric center of all atoms."""
    n = len(atoms)
    cx = sum(a["x"] for a in atoms) / n
    cy = sum(a["y"] for a in atoms) / n
    cz = sum(a["z"] for a in atoms) / n
    return (cx, cy, cz)


def generate_cloud_mesh(atoms, n_lat=10, n_lon=20):
    """
    Generate a molecular-surface-shaped cloud mesh.

    Strategy:
    1. Create a UV sphere centred at the molecular centre.
    2. For each vertex (unit direction from centre), cast a ray outward and
       find the distance at which the ray is 1.5 * vdw_radius from the
       nearest atom.  This "inflates" the sphere to wrap the molecule.
    3. Compute the electrostatic potential at each vertex.
    """
    center = compute_molecular_center(atoms)

    # Pre-extract atom positions and properties
    atom_pos = [(a["x"], a["y"], a["z"]) for a in atoms]
    atom_charge = [a["charge"] for a in atoms]
    atom_vdw = [a["vdw_radius"] for a in atoms]

    # Compute a generous outer radius for the initial sphere
    max_r = 0.0
    for ap, av in zip(atom_pos, atom_vdw):
        r = dist(ap, center) + av * 1.5
        if r > max_r:
            max_r = r

    # Generate unit sphere
    unit_verts, faces = generate_uv_sphere(n_lat, n_lon)

    # Project each vertex onto the molecular surface using a two-pass approach:
    #
    # Pass 1: Project each ray onto a neutral (uniform) molecular surface to
    #          find the basic molecular shape.
    # Pass 2: For each projected vertex, find the nearest atom, then adjust
    #          the vertex distance from that atom based on the atom's charge.
    #          Electron-rich atoms get a larger cloud; electron-poor atoms
    #          get a thinner cloud.

    # Precompute charge-based surface factors per atom
    charge_surface_factors = []
    for aq in atom_charge:
        cf = max(-1.0, min(1.0, aq))
        # Map: charge -1 -> 1.8, charge 0 -> 1.3, charge +1 -> 1.02
        sf = 1.3 - cf * 0.5
        sf = max(1.02, min(1.8, sf))
        charge_surface_factors.append(sf)

    # Pass 1: project onto neutral surface (factor 1.3 for all atoms)
    neutral_factor = 1.3
    raw_verts = []
    for uv in unit_verts:
        direction = vec_norm(uv)
        best_t = 0.5
        for ap, av in zip(atom_pos, atom_vdw):
            vi = vec_sub(center, ap)
            b_coeff = 2.0 * (direction[0]*vi[0] + direction[1]*vi[1] + direction[2]*vi[2])
            c_coeff = (vi[0]**2 + vi[1]**2 + vi[2]**2) - (neutral_factor * av)**2
            discriminant = b_coeff * b_coeff - 4.0 * c_coeff
            if discriminant >= 0:
                sqrt_d = math.sqrt(discriminant)
                t_candidate = max((-b_coeff + sqrt_d) / 2.0, (-b_coeff - sqrt_d) / 2.0)
                if t_candidate > 0 and t_candidate > best_t:
                    best_t = t_candidate
        best_t = min(best_t, max_r * 1.2)
        point = vec_add(center, vec_scale(direction, best_t))
        raw_verts.append(point)

    # Pass 2: adjust each vertex using smooth blending across all atoms.
    # Instead of hard-switching on the nearest atom (which creates seams),
    # we compute a weighted average target distance using inverse-distance
    # weighting from all atoms. Closer atoms have more influence.
    projected_verts = []
    for pt in raw_verts:
        # Compute distances to all atoms
        atom_dists = [dist(pt, ap) for ap in atom_pos]

        # Compute the target surface distance for each atom
        # (how far the cloud should extend from that atom)
        atom_targets = [csf * av for csf, av in zip(charge_surface_factors, atom_vdw)]

        # Inverse-distance weighting with a sharpness exponent.
        # Higher exponent = sharper transitions (but still smooth).
        exponent = 4.0
        weights = []
        for d in atom_dists:
            if d < 0.01:
                d = 0.01
            weights.append(1.0 / (d ** exponent))

        total_weight = sum(weights)
        if total_weight < 1e-10:
            projected_verts.append(pt)
            continue

        # For each atom, compute where it "wants" this vertex to be:
        # at target_dist from that atom in the direction from atom to vertex.
        # Then blend all these desired positions by weight.
        blended = [0.0, 0.0, 0.0]
        for idx in range(len(atom_pos)):
            ap = atom_pos[idx]
            to_vert = vec_sub(pt, ap)
            d = atom_dists[idx]
            if d < 0.01:
                desired = pt
            else:
                to_vert_norm = vec_norm(to_vert)
                desired = vec_add(ap, vec_scale(to_vert_norm, atom_targets[idx]))

            w = weights[idx] / total_weight
            blended[0] += desired[0] * w
            blended[1] += desired[1] * w
            blended[2] += desired[2] * w

        projected_verts.append(tuple(blended))

    # Compute ESP at each vertex
    potentials = []
    for pt in projected_verts:
        v_esp = 0.0
        for ap, q in zip(atom_pos, atom_charge):
            r = dist(pt, ap)
            if r < 0.01:
                r = 0.01  # avoid division by zero
            v_esp += KE * q / r
        potentials.append(round(v_esp, 4))

    # Round vertex coordinates
    rounded_verts = [[round(v[0], 4), round(v[1], 4), round(v[2], 4)] for v in projected_verts]
    face_list = [list(f) for f in faces]

    return {
        "vertices": rounded_verts,
        "faces": face_list,
        "potentials": potentials,
    }


# ---------------------------------------------------------------------------
# Main: generate all molecule files
# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for mol in MOLECULES:
        atoms_data = mol["atoms"]

        cloud_mesh = generate_cloud_mesh(atoms_data, n_lat=24, n_lon=48)

        # Build output structure (matching required schema exactly)
        output = {
            "name": mol["name"],
            "formula": mol["formula"],
            "atoms": [
                {
                    "element": a["element"],
                    "x": a["x"],
                    "y": a["y"],
                    "z": a["z"],
                    "charge": a["charge"],
                    "vdw_radius": a["vdw_radius"],
                }
                for a in atoms_data
            ],
            "bonds": mol["bonds"],
            "cloud_mesh": cloud_mesh,
            "polarizability": mol["polarizability"],
            "dipole_moment": mol["dipole_moment"],
            "molecular_weight": mol["molecular_weight"],
        }

        filepath = os.path.join(OUTPUT_DIR, mol["filename"])
        with open(filepath, "w") as f:
            json.dump(output, f, indent=2)

        n_v = len(cloud_mesh["vertices"])
        n_f = len(cloud_mesh["faces"])
        size_kb = os.path.getsize(filepath) / 1024.0
        print(f"  {mol['filename']:30s}  {n_v:4d} verts  {n_f:4d} faces  {size_kb:7.1f} KB")

    print(f"\nAll {len(MOLECULES)} molecule files written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
