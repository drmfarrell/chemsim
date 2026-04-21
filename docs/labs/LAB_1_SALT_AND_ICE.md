# Lab 1 · Molecules, States of Matter, and Why Salt Melts Ice

**Name:** ___________________________   **Date:** _______________

## What you'll do

You'll use ChemSim — a browser-based molecular simulation — to:

1. See how individual molecules "feel" each other through electrostatic attraction and repulsion.
2. Watch many molecules together behave as liquid, solid, or gas.
3. Figure out, at the molecular level, **why adding salt makes ice melt**.

## Getting started

1. Plug in your laptop. The simulation will use most of your CPU while running — on battery alone it'll slow down and drain quickly.
2. Open ChemSim in a modern browser (Chrome, Edge, or Firefox work best).
3. Wait for the loading screen to finish. You should see a dark 3D scene with two water molecules.
4. **If the view drifts off-center at any point, press `V` on your keyboard to re-center.** There's a small reminder in the bottom-right corner of the screen.

---

## Part 1 — How two molecules interact (≈ 20 min)

In Mode 1 ("Two-Molecule Interaction"), the app shows **two molecules** you can pick up and rotate, and a live readout of the energy of interaction between them. Your goal in this part is to build an intuition for what that energy means and why molecules stick together or push apart.

### 1.1 — Orient yourself

With two waters on screen:

- The **red** regions around each molecule mean that part of the molecule is **electron-rich** — it has extra negative charge (the oxygen's "back side").
- The **blue** regions mean **electron-poor** — extra positive charge (the hydrogen atoms).
- Everywhere in between shades to white.

The colors you see are the **electrostatic potential** around each molecule. Where a region is red, a positive charge nearby would be *attracted* in. Where a region is blue, a negative charge would be attracted.

> **Controls you'll need**
> - **Left-click + drag** on molecule B to move it.
> - **Shift + left-click + drag** (or right-click + drag) on molecule B to rotate it.
> - **Left-click + drag on empty space** to rotate your view of the whole scene.
> - **Mouse wheel** to zoom.
> - **Press `V`** to re-center the view if you get lost.

Look at the right-side panel. The big number labeled **"Total Energy"** is the *interaction energy* between the two molecules, in **kJ/mol**.

- **Negative** interaction energy = the molecules are **attracted** to each other. They'd rather be like this than apart.
- **Positive** interaction energy = the molecules **repel**. They'd rather be apart.
- **Zero** = they don't feel each other much (usually they're far apart).

### 1.2 — Find the strongest water–water attraction

Move and rotate molecule B so that **one of its hydrogens (blue end) points straight at the oxygen (red end) of molecule A**, and bring them close together. You've just formed a **hydrogen bond** — the single most important intermolecular force in all of biology.

- **Most negative Total Energy you can reach:** __________ kJ/mol
- The distance between the two oxygen atoms when you do it: about __________ Å

### 1.3 — Find the strongest water–water repulsion

Now rotate molecule B so that **its hydrogens point at molecule A's hydrogens** (both blue ends touching) and bring them close.

- **Most positive Total Energy you reach:** __________ kJ/mol
- Is it harder or easier to push molecule B into this position than into the attractive position above? (circle)   **harder   /   easier**

### 1.4 — Pull molecule B far away

Drag molecule B out to about 10 Å from molecule A (you can read the distance in the panel).

- **Total Energy at ~10 Å:** __________ kJ/mol
- Is it closer to zero than either of the numbers in 1.2 or 1.3?   **yes   /   no**

### 1.5 — Reflect on water–water

In one or two sentences, explain to a classmate what the interaction energy tells you about how two molecules "feel" each other:

______________________________________________________________________

______________________________________________________________________

### 1.6 — Swap in a chloride ion

In the **Molecule B** dropdown, pick **Cl⁻ (Chloride Ion)** — it's near the bottom of the list. Molecule B becomes a single chloride ion instead of a water molecule.

Chloride has a **permanent −1 charge**. It's electron-rich everywhere.

Drag the Cl⁻ around molecule A (water).

- What orientation of the water makes the strongest attraction between the Cl⁻ and the water?
  ______________________________________________________________________

  *(Hint: what part of water is positively charged?)*

- **Most negative Total Energy you can reach between water and Cl⁻:** __________ kJ/mol
- **Total Energy at ~10 Å separation:** __________ kJ/mol

### 1.7 — Compare

Compare your strongest water–water interaction (from 1.2) with your strongest water–Cl⁻ interaction (from 1.6).

- Water–water (strongest attraction): __________ kJ/mol
- Water–Cl⁻ (strongest attraction):   __________ kJ/mol

**Question.** Which is stronger, and roughly by how many times?

______________________________________________________________________

**Question.** Why would you expect an ion with −1 charge to attract water's hydrogens *more* strongly than another water molecule does?

______________________________________________________________________

______________________________________________________________________

---

## Part 2 — Many molecules and the three states of matter (≈ 15 min)

Switch the mode dropdown from **"Two-Molecule Interaction"** to **"Many-Molecule Box"**. The scene changes to a 3D box with a whole drop of water inside.

### 2.1 — What's a liquid?

Use the **Temperature** slider. Set the temperature to **300 K** (room temperature). Press Play.

- Look at the molecules closely. Are they:
  - **Packed together and barely moving**, like a crystal? (Solid)
  - **Packed together but mobile, constantly jostling past neighbors**? (Liquid)
  - **Flying around freely, hardly touching**? (Gas)

  Circle:   **solid   /   liquid   /   gas**

- What does this tell you about room-temperature water?

  ______________________________________________________________________

### 2.2 — Watch water boil

In the **Experiments** dropdown, choose **"Boiling Water"**. This loads a box of ~64 water molecules at 300 K with the **Barostat** turned on — that means the box can expand or contract to stay at normal atmospheric pressure, the same way real air above a real puddle does.

- Let it run for ~15 seconds at 300 K. The drop stays together — liquid.
- Now drag the **Temperature** slider up to **400 K**. Give it ~30 seconds.
- Keep pushing it up to **500 K**. Watch both the molecules *and* the box size readout in the stats panel.

- What happens to the size of the box as you raise the temperature?

  ______________________________________________________________________

- What are individual water molecules doing at 500 K that they weren't doing at 300 K?

  ______________________________________________________________________

- At 500 K, are the molecules still in a compact drop, or have they spread out to fill the box? What state is this?

  ______________________________________________________________________

> **Concept check.** In ChemSim, temperature is literally the average kinetic energy per molecule. Hotter molecules move faster. **Boiling** is what you just saw: once the molecules are moving fast enough, their kinetic energy exceeds the attractive energy pulling them together (from Part 1!), so they break free from their neighbors and fly apart — liquid becomes gas.

### 2.3 — Make ice

Click the **Experiments** dropdown and pick **"Freezing Water"**. This loads a special setup:

- The water model switches to **TIP4P/Ice** (a version of water that freezes near 270 K, close to real ice's 273 K).
- A small **ice crystal seed** (colored pale blue) is placed at the center of the water drop.
- The temperature is set to 240 K (below freezing).

Let it run. Observe the simulation for **1–2 minutes**.

- Are the blue-tinted waters (the seed) moving?

  ______________________________________________________________________

- What's happening to the liquid waters *near* the seed? Are some of them starting to look more ordered, or turning blue themselves?

  ______________________________________________________________________

- Open the graph (click **Show Graph** if it's hidden). Watch the blue "Liquid |ω|" line — that's the average rotational speed of the non-frozen waters. What does it do over time?

  ______________________________________________________________________

### 2.4 — Save a "before salt" snapshot

- Click **💾 Save Results**. A new tab opens with a report of the simulation so far.
- In that tab, click **Download CSV** and **Download Snapshot**. Rename the files `before_salt_data.csv` and `before_salt_snapshot.png`. You'll submit these at the end.

### 2.5 — Add salt

Back in the simulation tab, click **Add Salt Crystal**. A small crystal of Na⁺ and Cl⁻ ions appears.

Watch carefully — ideally for at least 30 seconds — as the ions drift into the ice.

- What happens when a Na⁺ or Cl⁻ ion touches the edge of the blue ice seed?

  ______________________________________________________________________

- Does the ice seed stay the same size, or does it shrink near where the salt is?

  ______________________________________________________________________

### 2.6 — Save an "after salt" snapshot

- Click **💾 Save Results** again.
- Download and rename as `after_salt_data.csv` and `after_salt_snapshot.png`.

---

## Part 3 — Putting it all together (≈ 10 min)

Connect what you saw in Part 1 to what you saw in Part 2.

### 3.1 — Why does ice melt when it's warmed?

Thinking about Part 2.2 and 2.3 together, write one sentence explaining what happens to the molecules when ice melts into liquid water.

______________________________________________________________________

______________________________________________________________________

### 3.2 — Why does salt make ice melt at a lower temperature?

This is the big question. In Part 1 you saw that Cl⁻ **attracts water hydrogens more strongly** than another water molecule does. In Part 2 you saw that salt ions touching the ice caused the ice to lose molecules locally.

**Put those two ideas together.** When a salt crystal touches ice at, say, 260 K:

1. What do the Na⁺ and Cl⁻ ions "want" to do with the water molecules in the ice lattice?

   ______________________________________________________________________

2. When a water molecule leaves the ice lattice to be near an ion, does that make the ice lattice more stable or less stable?

   ______________________________________________________________________

3. "Salt lowers the melting point of water" is a rule you've probably heard. In **your own words**, explain what that actually means on a molecular level:

   ______________________________________________________________________

   ______________________________________________________________________

   ______________________________________________________________________

### 3.3 — Apply it

You've just figured out why we salt roads in winter.

- If the outside temperature is 270 K (slightly below freezing for pure water), would salted roads stay icy or stay liquid?

  ______________________________________________________________________

- Would it still work if it got cold enough? (Real answer: rock salt stops being effective around 260 K. Why might that be?)

  ______________________________________________________________________

  ______________________________________________________________________

---

## What to submit

Upload or attach the following to your assignment:

1. **This worksheet**, fully filled in (as a Word doc or PDF — whatever your instructor prefers).
2. **`before_salt_data.csv`** and **`before_salt_snapshot.png`** from Part 2.4.
3. **`after_salt_data.csv`** and **`after_salt_snapshot.png`** from Part 2.6.

## Feedback (helps us improve ChemSim)

One or two sentences on each:

- What part confused you the most?

  ______________________________________________________________________

- What part felt the clearest once you understood it?

  ______________________________________________________________________

- What part of the simulation didn't work the way you expected?

  ______________________________________________________________________

---

*ChemSim Lab 1 · Dr. Fountain Farrell, Cheyney University of Pennsylvania*
