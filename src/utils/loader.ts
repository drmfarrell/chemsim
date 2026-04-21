export interface AtomData {
  element: string;
  x: number;
  y: number;
  z: number;
  charge: number;
  vdw_radius: number;
  epsilon?: number;  // Optional molecule-specific LJ epsilon
  sigma?: number;    // Optional molecule-specific LJ sigma
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

export interface VirtualSiteData {
  charge: number;
  ref_atoms: number[];  // Indices of atoms used to compute position
  site_type: string;    // e.g., "tip4p"
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
  virtual_sites?: VirtualSiteData[];  // Optional virtual sites (e.g., TIP4P M site)
}

const moleculeCache = new Map<string, MoleculeData>();

// Vite-processed dynamic-import map: every JSON under src/data/molecules/
// becomes a lazy loader. In dev Vite resolves these against the source
// filesystem; in production (what the ./launch.sh --preview build serves)
// the JSONs are bundled as hashed static assets in dist/assets/. Either
// way the same map lookup + await works — no raw `/src/...` fetches that
// would 404 in a production build.
const moleculeLoaders = import.meta.glob<MoleculeData>(
  '/src/data/molecules/*.json',
  { import: 'default' },
);

export async function loadMolecule(name: string): Promise<MoleculeData> {
  const cached = moleculeCache.get(name);
  if (cached) return cached;

  const key = `/src/data/molecules/${name}.json`;
  const loader = moleculeLoaders[key];
  if (!loader) {
    throw new Error(`Molecule not found: ${name} (expected ${key})`);
  }

  const data = await loader();
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
    'ethanol',
    'tetrafluoromethane',
    'ammonia',
    'urea',
    'sodium_ion',
    'chloride_ion',
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
  { id: 'ethanol', formula: 'C\u2082H\u2085OH', name: 'Ethanol' },
  { id: 'tetrafluoromethane', formula: 'CF\u2084', name: 'Tetrafluoromethane' },
  { id: 'ammonia', formula: 'NH\u2083', name: 'Ammonia' },
  { id: 'urea', formula: 'CH\u2084N\u2082O', name: 'Urea' },
  { id: 'sodium_ion', formula: 'Na\u207A', name: 'Sodium Ion' },
  { id: 'chloride_ion', formula: 'Cl\u207B', name: 'Chloride Ion' },
];
