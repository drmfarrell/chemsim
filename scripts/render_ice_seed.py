#!/usr/bin/env python3
"""Render the dumped ice-seed atoms as a 3D matplotlib scatter.

Oxygens in red, hydrogens in white, O-H bonds in light grey. Draws a
dashed red line for every H-H pair under 1.5 A so we can see clash
locations at a glance. Saves to test-results/ice-seed.png.
"""
import json
import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401

IN = "test-results/ice-seed-atoms.json"
OUT = "test-results/ice-seed.png"

with open(IN) as f:
    data = json.load(f)

atoms = data["atoms"]
waters = {}
for a in atoms:
    waters.setdefault(a["molIdx"], []).append(a)

oxy = [a for a in atoms if a["el"] == "O"]
hyd = [a for a in atoms if a["el"] == "H"]

fig = plt.figure(figsize=(11, 9))
ax = fig.add_subplot(111, projection="3d")
ax.set_title(f"Ice seed — {len(waters)} waters (2×2×2 supercell)")

# Oxygens — red spheres.
ax.scatter([a["x"] for a in oxy], [a["y"] for a in oxy], [a["z"] for a in oxy],
           c="crimson", s=140, alpha=0.95, label=f"O ({len(oxy)})")

# Hydrogens — white with black outline.
ax.scatter([a["x"] for a in hyd], [a["y"] for a in hyd], [a["z"] for a in hyd],
           c="white", s=60, alpha=0.95, edgecolors="black", linewidths=0.5,
           label=f"H ({len(hyd)})")

# Intramolecular O-H bonds (grey).
for mol_idx, ats in waters.items():
    o = next(a for a in ats if a["el"] == "O")
    for h in (a for a in ats if a["el"] == "H"):
        ax.plot([o["x"], h["x"]], [o["y"], h["y"]], [o["z"], h["z"]],
                c="lightgrey", lw=1)

# H-bonds: grey thin dashed for H...O under 2.2 A and >1.0 A.
hbond_count = 0
for o in oxy:
    for h in hyd:
        if h["molIdx"] == o["molIdx"]:
            continue
        d = math.sqrt((o["x"] - h["x"])**2 + (o["y"] - h["y"])**2 + (o["z"] - h["z"])**2)
        if 1.2 < d < 2.2:
            ax.plot([o["x"], h["x"]], [o["y"], h["y"]], [o["z"], h["z"]],
                    c="skyblue", lw=0.7, ls="--", alpha=0.7)
            hbond_count += 1

# H-H clashes — thick red dashed.
clash_count = 0
clashes = []
for i, h1 in enumerate(hyd):
    for j in range(i + 1, len(hyd)):
        h2 = hyd[j]
        d = math.sqrt((h1["x"] - h2["x"])**2 + (h1["y"] - h2["y"])**2 + (h1["z"] - h2["z"])**2)
        if d < 1.5:
            ax.plot([h1["x"], h2["x"]], [h1["y"], h2["y"]], [h1["z"], h2["z"]],
                    c="red", lw=2.5)
            clash_count += 1
            clashes.append((i, j, d, h1, h2))

ax.set_xlabel("x (Å)")
ax.set_ylabel("y (Å)")
ax.set_zlabel("z (Å)")
ax.legend(loc="upper right")

# Box the view on the seed.
span = 12
ax.set_xlim(-span, span); ax.set_ylim(-span, span); ax.set_zlim(-span, span)
ax.set_box_aspect([1, 1, 1])

plt.tight_layout()
plt.savefig(OUT, dpi=120)
print(f"Wrote {OUT}")
print(f"  H-bond lines drawn: {hbond_count}")
print(f"  H-H clashes drawn (red): {clash_count}")
for (i, j, d, h1, h2) in sorted(clashes, key=lambda x: x[2])[:5]:
    print(f"    clash d={d:.3f} A  mol {h1['molIdx']}←→mol {h2['molIdx']}")
