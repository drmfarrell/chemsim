export interface AtomData {
  element: string;
  x: number;
  y: number;
  z: number;
  charge: number;
  vdw_radius: number;
}

export interface BondData {
  from: number;
  to: number;
  order: number;
}

export interface CloudMeshData {
  vertices: [number, number, number][];
  faces: [number, number, number][];
  potentials: number[];
}

export interface MoleculeData {
  name: string;
  formula: string;
  atoms: AtomData[];
  bonds: BondData[];
  cloud_mesh: CloudMeshData;
  polarizability: number;
  dipole_moment: number;
  molecular_weight: number;
}

const moleculeCache = new Map<string, MoleculeData>();

export async function loadMolecule(name: string): Promise<MoleculeData> {
  const cached = moleculeCache.get(name);
  if (cached) return cached;

  const response = await fetch(`/src/data/molecules/${name}.json`);
  if (!response.ok) {
    throw new Error(`Failed to load molecule data: ${name} (${response.status})`);
  }

  const data: MoleculeData = await response.json();
  moleculeCache.set(name, data);
  return data;
}

export async function loadAllMolecules(): Promise<Map<string, MoleculeData>> {
  const names = [
    'water',
    'hydrogen_sulfide',
    'carbon_dioxide',
    'methane',
    'carbon_tetrachloride',
    'chloroform',
    'methanol',
    'tetrafluoromethane',
    'ammonia',
    'urea',
  ];

  const results = await Promise.all(names.map(loadMolecule));
  const map = new Map<string, MoleculeData>();
  for (let i = 0; i < names.length; i++) {
    map.set(names[i], results[i]);
  }
  return map;
}

export function getMoleculeDisplayName(data: MoleculeData): string {
  return `${data.formula} (${data.name})`;
}

// Available molecule list for UI population
export const MOLECULE_LIST = [
  { id: 'water', formula: 'H\u2082O', name: 'Water' },
  { id: 'hydrogen_sulfide', formula: 'H\u2082S', name: 'Hydrogen Sulfide' },
  { id: 'carbon_dioxide', formula: 'CO\u2082', name: 'Carbon Dioxide' },
  { id: 'methane', formula: 'CH\u2084', name: 'Methane' },
  { id: 'carbon_tetrachloride', formula: 'CCl\u2084', name: 'Carbon Tetrachloride' },
  { id: 'chloroform', formula: 'CHCl\u2083', name: 'Chloroform' },
  { id: 'methanol', formula: 'CH\u2083OH', name: 'Methanol' },
  { id: 'tetrafluoromethane', formula: 'CF\u2084', name: 'Tetrafluoromethane' },
  { id: 'ammonia', formula: 'NH\u2083', name: 'Ammonia' },
  { id: 'urea', formula: 'CH\u2084N\u2082O', name: 'Urea' },
];
