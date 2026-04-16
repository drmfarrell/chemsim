/**
 * Pre-set experiments for guided investigations.
 */

export interface Experiment {
  id: string;
  title: string;
  description: string;
  mode: 'mode1' | 'mode2';
  moleculeA: string;
  moleculeB?: string;
  temperature?: number;
  moleculeCount?: number;
  barostat?: boolean;  // Whether barostat should be enabled (for freezing/boiling demos)
  prompt: string;
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'water-hbond',
    title: 'Hydrogen Bonding in Water',
    description: 'Discover why water forms hydrogen bonds',
    mode: 'mode1',
    moleculeA: 'water',
    moleculeB: 'water',
    prompt: 'Drag one water molecule toward the other. Rotate it so the hydrogen (<span class="glossary" title="Blue on the electrostatic map indicates a region where electrons are scarce and the nucleus charge shows through, making the area slightly positive.">blue/positive region</span>) on one molecule faces the oxygen (<span class="glossary" title="Red indicates an electron-rich region where the local charge is strongly negative, typically near a lone pair or a highly electronegative atom like oxygen.">red/negative region</span>) on the other. Notice how the energy drops significantly. This is a <span class="glossary" title="A special, directional attraction between a hydrogen attached to an electronegative atom (O, N, or F) and a lone pair on another electronegative atom. Hydrogen bonds are much stronger than ordinary dipole-dipole attractions.">hydrogen bond</span>, the reason water is liquid at room temperature.',
  },
  {
    id: 'water-vs-methane',
    title: 'Water vs Methane: Why is one liquid?',
    description: 'Compare polar and nonpolar interactions',
    mode: 'mode1',
    moleculeA: 'water',
    moleculeB: 'methane',
    prompt: 'Compare the interaction energy when you bring water toward methane vs. water toward water. Notice how much weaker the water-methane interaction is. Methane has a nearly uniform (white/neutral) <span class="glossary" title="A map of the electric potential around a molecule, color-coded red (negative/electron-rich) to blue (positive/electron-poor). Uniform color means the charge is spread evenly and the molecule has no strong polar side.">electrostatic surface</span>, so it cannot form strong <span class="glossary" title="Attractions that depend on how two molecules are oriented relative to each other. Hydrogen bonds and dipole-dipole attractions are directional; London dispersion forces are not.">directional interactions</span>. This is why methane is a gas at room temperature while water is a liquid.',
  },
  {
    id: 'ccl4-uniform',
    title: 'CCl4: A Symmetric Molecule',
    description: 'Explore orientation-independent interactions',
    mode: 'mode1',
    moleculeA: 'carbon_tetrachloride',
    moleculeB: 'carbon_tetrachloride',
    prompt: 'Bring two CCl4 molecules together and rotate one around the other. Notice that the energy hardly changes with orientation. CCl4 is <span class="glossary" title="All four C-Cl bonds point to the corners of a regular tetrahedron, so their individual dipoles cancel out exactly and the molecule as a whole has no net dipole.">symmetric</span> and <span class="glossary" title="No net separation of charge across the molecule. Nonpolar molecules only interact through weak London dispersion forces, which do not depend on orientation.">nonpolar</span>, so its interactions are weak and not directional. This is why CCl4 has a low <span class="glossary" title="The temperature at which liquid turns into gas. Weaker intermolecular attractions mean molecules break free more easily, giving a lower boiling point.">boiling point</span>.',
  },
  {
    id: 'ammonia-dipole',
    title: 'Ammonia: Dipole-Dipole Interactions',
    description: 'See how molecular shape affects polarity',
    mode: 'mode1',
    moleculeA: 'ammonia',
    moleculeB: 'ammonia',
    prompt: 'Ammonia (NH3) has a <span class="glossary" title="A shape like a tripod: the nitrogen sits at the apex with the three hydrogens fanned out below. The lone pair of electrons on the nitrogen sticks out the top, giving the molecule an up/down asymmetry.">pyramidal</span> shape that gives it a strong <span class="glossary" title="A separation of charge across the molecule: one end is slightly negative, the other slightly positive. The bigger the dipole moment, the more strongly two molecules can attract each other by aligning their charges.">dipole moment</span>. Bring two ammonia molecules together and find the <span class="glossary" title="The orientation that makes the interaction energy most negative (the deepest well). For two dipoles, this is usually head-to-tail: the positive end of one lined up with the negative end of the other. Shift+drag or right-drag to rotate molecule B and watch the energy change.">most favorable orientation</span>. Compare with methane (<span class="glossary" title="Four bonds arranged symmetrically around a central atom, like a regular tetrahedron. Because the bonds all cancel out, methane has no net dipole moment even though each C-H bond is slightly polar.">tetrahedral</span>, <span class="glossary" title="No net separation of charge. A nonpolar molecule cannot form strong directional attractions with its neighbors, so it interacts only through weak, orientation-independent forces.">nonpolar</span>). Why does ammonia have a higher boiling point than methane?',
  },
  {
    id: 'water-liquid',
    title: 'Water at Room Temperature',
    description: 'Watch 64 water molecules behave as a liquid',
    mode: 'mode2',
    moleculeA: 'water',
    temperature: 300,
    moleculeCount: 64,
    barostat: false,
    prompt: 'Watch the water molecules. They cluster together, forming <span class="glossary" title="Short-lived groups of molecules that form and break apart on a timescale of picoseconds. In a liquid, molecules are close enough to interact strongly but have enough thermal energy to keep shuffling partners.">transient groups</span> that constantly rearrange. This is <span class="glossary" title="Molecules stay in contact but flow past each other. There is enough thermal motion to break any single attraction but not enough to escape all attractions at once.">liquid behavior</span>, driven by <span class="glossary" title="A special, directional attraction between a hydrogen attached to an electronegative atom (O, N, or F) and a lone pair on another electronegative atom. Hydrogen bonds are much stronger than ordinary dipole-dipole attractions.">hydrogen bonding</span>. Turn on the "Network" toggle to see which molecules are currently attracting each other.',
  },
  {
    id: 'methane-gas',
    title: 'Methane at Room Temperature',
    description: 'Watch 64 methane molecules behave as a gas',
    mode: 'mode2',
    moleculeA: 'methane',
    temperature: 300,
    moleculeCount: 64,
    barostat: false,
    prompt: 'Compare with the water simulation. Methane molecules barely interact, filling the whole box and moving freely. This is <span class="glossary" title="Molecules move independently with enough kinetic energy to overcome any attractions between them. They spread out to fill the available volume.">gas behavior</span>. The weak <span class="glossary" title="Momentary, fluctuation-driven attractions between all molecules, caused by briefly uneven electron distributions. They are the only attraction nonpolar molecules experience, and they grow with molecular size.">London dispersion forces</span> between methane molecules are not strong enough to form a liquid at 300K.',
  },
  {
    id: 'water-boiling',
    title: 'Boiling Water',
    description: 'Watch water transition from liquid to gas',
    mode: 'mode2',
    moleculeA: 'water',
    temperature: 300,
    moleculeCount: 64,  // 4³ - good performance with barostat
    barostat: true,  // Barostat enabled to show box expansion during boiling
    prompt: 'Start at 300K and slowly increase the temperature using the slider. Around 373K (100 C), the clusters begin to break apart as molecules gain enough <span class="glossary" title="The energy of motion: faster molecules have more kinetic energy. Temperature is a measure of the average kinetic energy, so heating a substance gives its molecules more speed.">kinetic energy</span> to overcome <span class="glossary" title="A special, directional attraction between a hydrogen attached to an electronegative atom (O, N, or F) and a lone pair on another electronegative atom. Hydrogen bonds are what hold liquid water together.">hydrogen bonding</span>. This is <span class="glossary" title="The temperature at which a liquid turns into a gas. It happens when the average kinetic energy of molecules is high enough to break the attractions holding them together.">boiling</span>. Watch molecules break free from clusters as temperature rises!',
  },
  {
    id: 'water-freezing',
    title: 'Freezing Water',
    description: 'Watch water molecules slow down and cluster',
    mode: 'mode2',
    moleculeA: 'water',
    temperature: 270,
    moleculeCount: 64,  // 4³ - good performance with barostat
    barostat: false,  // Barostat disabled due to runaway expansion issue
    prompt: 'Start at 270K and lower the temperature further. As the molecules lose <span class="glossary" title="The energy of motion. Cooling a substance takes kinetic energy away from its molecules, slowing them down until attractions dominate over motion.">kinetic energy</span>, they settle into more stable arrangements. Below 273K (0 C), the molecules begin to lock into fixed positions. This is the onset of <span class="glossary" title="The temperature at which a liquid turns into a solid. The molecules no longer have enough kinetic energy to break free of their neighbors, so they lock into a fixed arrangement.">freezing</span>.',
  },
];

export function getExperimentById(id: string): Experiment | undefined {
  return EXPERIMENTS.find(e => e.id === id);
}
