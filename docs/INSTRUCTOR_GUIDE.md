# ChemSim Instructor Guide

## Overview

ChemSim is a browser-based molecular interaction simulator designed for undergraduate general chemistry and biology courses. It fills a gap in existing educational tools: no other tool lets students interactively drag molecules and see electrostatic surfaces deform in real time.

## Pedagogical Goals

ChemSim helps students understand:

1. **Why molecules attract and repel**: Electrostatic interactions between charge distributions
2. **Why orientation matters**: Hydrogen bonding requires specific molecular alignment
3. **Why some substances are liquids and others are gases**: The strength of intermolecular forces determines phase behavior
4. **The connection between molecular properties and bulk behavior**: From two-molecule interactions to collective phenomena

## How to Use in Class

### Lab Activity: Intermolecular Forces (50 minutes)

**Pre-lab**: Students should have covered electronegativity, polarity, and Lewis structures.

**Activity Flow**:

1. (5 min) Students open ChemSim and run the Tutorial
2. (10 min) Guided Experiment: "Hydrogen Bonding in Water"
   - Students drag water molecules and discover the hydrogen bonding geometry
   - They record the minimum energy and optimal distance
3. (10 min) Guided Experiment: "Water vs Methane"
   - Students compare water-water and water-methane interactions
   - Discussion: Why is water liquid at room temperature?
4. (10 min) Exploration: Students choose 2-3 molecule pairs to investigate
   - Compare ammonia-ammonia vs methane-methane
   - Investigate CCl4 (nonpolar but heavy)
5. (10 min) Box Mode: Compare water box vs methane box at 300K
   - Students observe and describe the difference
   - Temperature exploration: What happens when you heat/cool water?
6. (5 min) Wrap-up discussion

**Assessment**: Students submit screenshots of key observations with written explanations.

### Lecture Demonstration

Use ChemSim to visually demonstrate:

- Why water has a high boiling point (strong H-bonds)
- Why oil and water don't mix (weak nonpolar-polar interactions)
- Phase transitions (heat water from 200K to 500K)
- The difference between dipole-dipole and London dispersion forces

### Homework Assignment

Students can access ChemSim from any device. Possible assignments:

1. "Rank these molecule pairs by interaction strength and explain your ranking using the electrostatic surfaces"
2. "Find the optimal geometry for ammonia-water interaction. Draw it and explain why this orientation is favorable."
3. "Record the average nearest-neighbor distance for water at 200K, 300K, 400K, and 500K. Plot the data. What does this tell you about phase transitions?"

## Technical Notes

### System Requirements

- Modern web browser (Chrome, Firefox, Edge, Safari)
- Works on Chromebooks, tablets, phones, and desktops
- No installation required; just open the URL
- Works offline once loaded (PWA)
- No accounts, no data collection, no IT approval needed

### Performance

- Desktop/laptop: 200 molecules at 60 FPS
- Chromebook: 50 molecules at 30+ FPS
- Mobile: 30-50 molecules at 30+ FPS
- VR (Quest 3): 100 molecules at 72 FPS

### Physics Model

The simulation uses:

- **Coulomb electrostatics** with published partial charges (TIP3P for water, OPLS-AA for organics)
- **Lennard-Jones potential** for van der Waals interactions
- **Velocity Verlet integration** for molecular dynamics
- **Berendsen thermostat** for temperature control
- **Point-charge induced deformation** for the cloud visualization (an approximation of induced polarization)

The physics is qualitatively correct and pedagogically useful. It is not publication-grade quantum chemistry. The electrostatic surfaces will show the right trends (red attracts blue, orientation matters for polar molecules, symmetric molecules have uniform surfaces) even though the exact values are approximate.

### Extending the Molecule Library

To add new molecules, create a JSON file in `src/data/molecules/` following the format documented in the codebase. A Python script (`scripts/generate_molecule_data.py`) can generate the required data from molecular geometry and partial charges.

## Connection to MolCalc

ChemSim uses the same color scheme as MolCalc (red = electron-rich, blue = electron-poor) for visual continuity. If your course uses MolCalc for computing molecular properties, students will find ChemSim's visuals immediately familiar.

## Open Source

ChemSim is MIT-licensed and hosted on GitHub. Contributions from other institutions are welcome. The entire application runs client-side with no server dependencies.

## Contact

Dr. Fountain Farrell
Cheyney University of Pennsylvania
