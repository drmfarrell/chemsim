# Molecule Data Format

Each molecule is stored as a JSON file in `molecules/`.

## Schema

```json
{
  "name": "water",
  "formula": "H2O",
  "atoms": [
    {
      "element": "O",
      "x": 0.0, "y": 0.0, "z": 0.117,
      "charge": -0.834,
      "vdw_radius": 1.52
    }
  ],
  "bonds": [
    { "from": 0, "to": 1, "order": 1 }
  ],
  "cloud_mesh": {
    "vertices": [[x, y, z], ...],
    "faces": [[i, j, k], ...],
    "potentials": [float, ...]
  },
  "polarizability": 1.45,
  "dipole_moment": 1.85,
  "molecular_weight": 18.015
}
```

## Fields

- **atoms**: Optimized 3D geometry. Coordinates in Angstroms. Charges in electron units.
- **bonds**: Connectivity. `from`/`to` are 0-indexed atom indices. `order` is bond order (1=single, 2=double).
- **cloud_mesh**: Electrostatic potential surface mesh.
  - `vertices`: 3D coordinates of mesh vertices (Angstroms)
  - `faces`: Triangle face indices
  - `potentials`: ESP at each vertex (kJ/mol). Negative = electron-rich, positive = electron-poor.
- **polarizability**: Molecular polarizability (Angstrom^3)
- **dipole_moment**: Dipole moment (Debye)
- **molecular_weight**: Molecular weight (g/mol)

## Adding a Molecule

1. Determine the optimized 3D geometry (atom positions)
2. Obtain partial charges (ESP-fit or Mulliken)
3. Run `scripts/generate_molecule_data.py` or create the JSON manually
4. Add the file name to `src/utils/loader.ts` (MOLECULE_LIST array)
5. Rebuild the project

## Charge Sources

- Water: TIP3P model (Jorgensen et al., 1983)
- Other molecules: OPLS-AA force field or Gasteiger charges
- All molecules are charge-neutral (total charge sums to zero)
