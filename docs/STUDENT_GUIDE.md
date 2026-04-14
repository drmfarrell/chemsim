# ChemSim Student Guide

## What is ChemSim?

ChemSim is an interactive molecular simulation that lets you see how molecules interact through electrostatic forces. You can drag molecules around in 3D space and watch their electron clouds respond in real time.

## Getting Started

1. Open ChemSim in your web browser (Chrome, Firefox, or Edge recommended)
2. The tutorial will guide you through the basics. Click "Tutorial" in the control panel to start it.
3. You'll see two water molecules with colored clouds around them

## Understanding the Display

### The Electrostatic Cloud

The colored cloud around each molecule shows its electrostatic potential:

- **Red regions**: Electron-rich (negative charge). These are areas where electrons spend more time.
- **Blue regions**: Electron-poor (positive charge). These are areas where the atom nuclei are less shielded.
- **White regions**: Neutral, where positive and negative charges are balanced.

### Energy Readout

The energy panel on the right shows:

- **Total Energy**: The overall interaction energy between the two molecules
  - Green/negative values mean the molecules are attracted to each other
  - Red/positive values mean the molecules are repelling each other
- **Distance**: How far apart the molecular centers are (in Angstroms)
- **Coulomb**: The electrostatic component of the interaction
- **LJ**: The Lennard-Jones (van der Waals) component

## Mode 1: Two-Molecule Interaction

### Controls

- **Left-click drag**: Move molecule B (the one on the right) around molecule A
- **Shift + drag** or **Right-click drag**: Rotate molecule B
- **Scroll**: Zoom in/out
- **Middle-click drag**: Rotate the camera around the scene
- **Snap to Optimal**: Automatically finds the lowest-energy orientation

### Keyboard Shortcuts

- **C**: Toggle cloud visibility
- **F**: Toggle force arrows
- **O**: Snap to optimal position
- **1**: Ball-and-stick view
- **2**: Space-filling view
- **3**: Cloud-only view

### Things to Try

1. Drag water toward water with the hydrogens pointing at the oxygen of the other molecule. See the strong attraction? That's a hydrogen bond.
2. Rotate water so the hydrogens face each other. See the energy go positive? Like charges repel.
3. Compare water-water with methane-methane. Why is one interaction so much stronger?

## Mode 2: Many-Molecule Box

Switch to "Many-Molecule Box" mode to see many molecules interacting at once.

### Controls

- **Temperature slider**: Adjust the temperature from 50K to 1000K
- **Molecule count**: Choose how many molecules are in the box (10-200)
- **Play/Pause**: Start or stop the simulation
- **Network**: Show lines connecting molecules that are currently attracting each other
- **Space bar**: Quick pause/play toggle

### Things to Try

1. Run 50 water molecules at 300K. They cluster together (liquid behavior).
2. Run 50 methane molecules at 300K. They spread out and move freely (gas behavior).
3. Start water at 300K and slowly increase to 400K. Watch the clusters break apart (boiling).
4. Start water at 300K and decrease to 100K. Watch the molecules slow down and cluster (freezing).

## Pre-set Experiments

Use the "Experiments" dropdown to load guided investigations. Each experiment sets up the molecules and provides instructions for what to observe.

## VR Mode

If you have a VR headset (like Meta Quest 3), click "Enter VR" to experience the simulation in virtual reality:

- Reach out and grab molecules with your hands
- Move and rotate molecules naturally
- See the 3D structure of molecules up close

## Tips

- If the simulation runs slowly, try reducing the molecule count or turning off clouds
- The simulation works offline once loaded, so you can use it without internet
- Take screenshots for your lab reports using your browser's screenshot feature
- All molecule data is based on published computational chemistry results

## Molecule Library

ChemSim includes 10 molecules:

| Formula | Name | Key Feature |
|---------|------|-------------|
| H2O | Water | Strong hydrogen bonding, polar |
| H2S | Hydrogen Sulfide | Weaker H-bonds than water, larger |
| CO2 | Carbon Dioxide | Linear, nonpolar (despite polar bonds) |
| CH4 | Methane | Tetrahedral, nonpolar, very weak interactions |
| CCl4 | Carbon Tetrachloride | Tetrahedral, nonpolar, larger |
| CHCl3 | Chloroform | Slightly polar, asymmetric |
| CH3OH | Methanol | Polar, hydrogen bonding |
| CF4 | Tetrafluoromethane | Tetrahedral, nonpolar |
| NH3 | Ammonia | Pyramidal, polar, hydrogen bonding |
| CH4N2O | Urea | Highly polar, strong interactions |
