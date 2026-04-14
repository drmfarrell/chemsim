import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MOLECULES_DIR = join(__dirname, '../../src/data/molecules');

const EXPECTED_MOLECULES = [
  'water', 'hydrogen_sulfide', 'carbon_dioxide', 'methane',
  'carbon_tetrachloride', 'chloroform', 'methanol',
  'tetrafluoromethane', 'ammonia', 'urea',
];

describe('Molecule JSON data files', () => {
  it('all expected molecule files exist', () => {
    const files = readdirSync(MOLECULES_DIR).filter(f => f.endsWith('.json'));
    for (const name of EXPECTED_MOLECULES) {
      expect(files).toContain(`${name}.json`);
    }
  });

  for (const name of EXPECTED_MOLECULES) {
    describe(`${name}.json`, () => {
      let data: any;

      try {
        const raw = readFileSync(join(MOLECULES_DIR, `${name}.json`), 'utf-8');
        data = JSON.parse(raw);
      } catch {
        // Will fail in the test below
      }

      it('parses as valid JSON with required fields', () => {
        expect(data).toBeDefined();
        expect(data.name).toBeTruthy();
        expect(data.formula).toBeTruthy();
        expect(data.atoms).toBeInstanceOf(Array);
        expect(data.atoms.length).toBeGreaterThan(0);
        expect(data.bonds).toBeInstanceOf(Array);
        expect(data.cloud_mesh).toBeDefined();
        expect(typeof data.polarizability).toBe('number');
        expect(typeof data.dipole_moment).toBe('number');
        expect(typeof data.molecular_weight).toBe('number');
      });

      it('atoms have required fields', () => {
        if (!data) return;
        for (const atom of data.atoms) {
          expect(typeof atom.element).toBe('string');
          expect(typeof atom.x).toBe('number');
          expect(typeof atom.y).toBe('number');
          expect(typeof atom.z).toBe('number');
          expect(typeof atom.charge).toBe('number');
          expect(typeof atom.vdw_radius).toBe('number');
          expect(atom.vdw_radius).toBeGreaterThan(0);
        }
      });

      it('bonds reference valid atom indices', () => {
        if (!data) return;
        for (const bond of data.bonds) {
          expect(bond.from).toBeGreaterThanOrEqual(0);
          expect(bond.from).toBeLessThan(data.atoms.length);
          expect(bond.to).toBeGreaterThanOrEqual(0);
          expect(bond.to).toBeLessThan(data.atoms.length);
          expect(bond.order).toBeGreaterThanOrEqual(1);
        }
      });

      it('cloud mesh has matching vertex and potential counts', () => {
        if (!data) return;
        const mesh = data.cloud_mesh;
        expect(mesh.vertices).toBeInstanceOf(Array);
        expect(mesh.faces).toBeInstanceOf(Array);
        expect(mesh.potentials).toBeInstanceOf(Array);
        expect(mesh.vertices.length).toBe(mesh.potentials.length);
        expect(mesh.vertices.length).toBeGreaterThan(50);
      });

      it('cloud mesh vertices are 3D coordinates', () => {
        if (!data) return;
        for (const v of data.cloud_mesh.vertices) {
          expect(v).toHaveLength(3);
          expect(typeof v[0]).toBe('number');
          expect(typeof v[1]).toBe('number');
          expect(typeof v[2]).toBe('number');
        }
      });

      it('cloud mesh faces reference valid vertex indices', () => {
        if (!data) return;
        const nVerts = data.cloud_mesh.vertices.length;
        for (const f of data.cloud_mesh.faces) {
          expect(f).toHaveLength(3);
          expect(f[0]).toBeGreaterThanOrEqual(0);
          expect(f[0]).toBeLessThan(nVerts);
          expect(f[1]).toBeGreaterThanOrEqual(0);
          expect(f[1]).toBeLessThan(nVerts);
          expect(f[2]).toBeGreaterThanOrEqual(0);
          expect(f[2]).toBeLessThan(nVerts);
        }
      });

      it('partial charges are in reasonable range', () => {
        if (!data) return;
        let totalCharge = 0;
        for (const atom of data.atoms) {
          expect(atom.charge).toBeGreaterThanOrEqual(-2.0);
          expect(atom.charge).toBeLessThanOrEqual(2.0);
          totalCharge += atom.charge;
        }
        // Neutral molecule: total charge should be near zero
        expect(Math.abs(totalCharge)).toBeLessThan(0.1);
      });
    });
  }
});
