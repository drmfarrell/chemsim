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
    prompt: 'Drag one water molecule toward the other. Rotate it so the hydrogen (blue/positive region) on one molecule faces the oxygen (red/negative region) on the other. Notice how the energy drops significantly. This is a hydrogen bond, the reason water is liquid at room temperature.',
  },
  {
    id: 'water-vs-methane',
    title: 'Water vs Methane: Why is one liquid?',
    description: 'Compare polar and nonpolar interactions',
    mode: 'mode1',
    moleculeA: 'water',
    moleculeB: 'methane',
    prompt: 'Compare the interaction energy when you bring water toward methane vs. water toward water. Notice how much weaker the water-methane interaction is. Methane has a nearly uniform (white/neutral) electrostatic surface, so it cannot form strong directional interactions. This is why methane is a gas at room temperature while water is a liquid.',
  },
  {
    id: 'ccl4-uniform',
    title: 'CCl4: A Symmetric Molecule',
    description: 'Explore orientation-independent interactions',
    mode: 'mode1',
    moleculeA: 'carbon_tetrachloride',
    moleculeB: 'carbon_tetrachloride',
    prompt: 'Bring two CCl4 molecules together and rotate one around the other. Notice that the energy hardly changes with orientation. CCl4 is symmetric and nonpolar, so its interactions are weak and not directional. This is why CCl4 has a low boiling point.',
  },
  {
    id: 'ammonia-dipole',
    title: 'Ammonia: Dipole-Dipole Interactions',
    description: 'See how molecular shape affects polarity',
    mode: 'mode1',
    moleculeA: 'ammonia',
    moleculeB: 'ammonia',
    prompt: 'Ammonia (NH3) has a pyramidal shape that gives it a strong dipole moment. Bring two ammonia molecules together and find the most favorable orientation. Compare with methane (tetrahedral, nonpolar). Why does ammonia have a higher boiling point than methane?',
  },
  {
    id: 'water-liquid',
    title: 'Water at Room Temperature',
    description: 'Watch 50 water molecules behave as a liquid',
    mode: 'mode2',
    moleculeA: 'water',
    temperature: 300,
    moleculeCount: 50,
    prompt: 'Watch the water molecules. They cluster together, forming transient groups that constantly rearrange. This is liquid behavior, driven by hydrogen bonding. Turn on the "Network" toggle to see which molecules are currently attracting each other.',
  },
  {
    id: 'methane-gas',
    title: 'Methane at Room Temperature',
    description: 'Watch 50 methane molecules behave as a gas',
    mode: 'mode2',
    moleculeA: 'methane',
    temperature: 300,
    moleculeCount: 50,
    prompt: 'Compare with the water simulation. Methane molecules barely interact, filling the whole box and moving freely. This is gas behavior. The weak London dispersion forces between methane molecules are not strong enough to form a liquid at 300K.',
  },
  {
    id: 'water-boiling',
    title: 'Boiling Water',
    description: 'Watch water transition from liquid to gas',
    mode: 'mode2',
    moleculeA: 'water',
    temperature: 300,
    moleculeCount: 50,
    prompt: 'Start at 300K and slowly increase the temperature using the slider. Around 373K (100 C), the clusters begin to break apart as molecules gain enough kinetic energy to overcome hydrogen bonding. This is boiling.',
  },
  {
    id: 'water-freezing',
    title: 'Freezing Water',
    description: 'Watch water molecules slow down and cluster',
    mode: 'mode2',
    moleculeA: 'water',
    temperature: 200,
    moleculeCount: 50,
    prompt: 'Start at 200K and lower the temperature further. As the molecules lose kinetic energy, they settle into more stable arrangements. Below 273K (0 C), the molecules begin to lock into fixed positions. This is the onset of freezing.',
  },
];

export function getExperimentById(id: string): Experiment | undefined {
  return EXPERIMENTS.find(e => e.id === id);
}
