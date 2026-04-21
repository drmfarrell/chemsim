/**
 * Export results of a Mode-2 simulation so students can analyze it
 * outside the app.
 *
 * Two pieces:
 *   - ResultsRecorder: streams a sampled time-series of physics
 *     observables into an in-memory array while the sim runs. Called
 *     every animation frame; internal throttle samples at most once
 *     per AUTO_SAMPLE_INTERVAL_PS of sim time.
 *   - buildReport(): when the student clicks Save Results, captures a
 *     PNG snapshot of the 3D view, packs it with the recorded CSV and
 *     a data-dictionary document into a single self-contained HTML
 *     page, and opens that page in a new tab. Student uses the
 *     browser's File → Print → Save as PDF to archive, or
 *     File → Save Page As to keep an editable copy. No runtime
 *     libraries required.
 */

export interface SampleContext {
  /** Integer step count at the time of sampling. */
  step: number;
  timePs: number;
  timestepFs: number;
  targetTempK: number;
  observedTempK: number;
  keKJMol: number;
  peKJMol: number;
  nnDistA: number;
  meanOmegaRadPs: number;
  pressureBar: number;
  boxSizeA: number;
  moleculeCount: number;
  frozenCount: number;
}

export interface ReportMetadata {
  primarySpecies: string;
  waterModel?: string;
  experimentId?: string | null;
  experimentTitle?: string | null;
  exportedAt: Date;
}

const AUTO_SAMPLE_INTERVAL_PS = 0.5;

export class ResultsRecorder {
  private samples: SampleContext[] = [];
  private lastSampledTimePs: number = -Infinity;

  /** Push a sample if enough sim time has elapsed since the previous one.
   *  Caller provides current sim state; recorder decides whether to
   *  actually capture it. */
  maybeRecord(s: SampleContext): void {
    if (s.timePs - this.lastSampledTimePs < AUTO_SAMPLE_INTERVAL_PS) return;
    this.samples.push({ ...s });
    this.lastSampledTimePs = s.timePs;
  }

  /** Wipe all samples. Called on mode/experiment/species reset. */
  reset(): void {
    this.samples.length = 0;
    this.lastSampledTimePs = -Infinity;
  }

  get count(): number { return this.samples.length; }
  get latest(): SampleContext | undefined { return this.samples[this.samples.length - 1]; }

  /** Emit the recorded time-series as a CSV string with a `#`-commented
   *  config header. */
  buildCsv(meta: ReportMetadata): string {
    const lines: string[] = [];
    const iso = meta.exportedAt.toISOString();
    lines.push(`# ChemSim simulation data`);
    lines.push(`# Exported: ${iso}`);
    lines.push(`# Primary species: ${meta.primarySpecies}`);
    if (meta.waterModel) lines.push(`# Water model: ${meta.waterModel}`);
    if (meta.experimentTitle) lines.push(`# Experiment: ${meta.experimentTitle}`);
    if (this.samples.length > 0) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      lines.push(`# Sampling interval: ${AUTO_SAMPLE_INTERVAL_PS} ps`);
      lines.push(`# Start time: ${first.timePs.toFixed(3)} ps`);
      lines.push(`# End time: ${last.timePs.toFixed(3)} ps`);
      lines.push(`# Duration: ${(last.timePs - first.timePs).toFixed(3)} ps`);
      lines.push(`# Samples: ${this.samples.length}`);
    }
    lines.push(`# See chemsim_data_dictionary (in the HTML report) for column definitions.`);
    lines.push(
      'step,time_ps,timestep_fs,temperature_target_K,temperature_observed_K,' +
      'kinetic_energy_kJ_mol,potential_energy_kJ_mol,nn_distance_A,' +
      'mean_omega_liquid_rad_ps,pressure_bar,box_size_A,molecule_count,frozen_count',
    );
    for (const s of this.samples) {
      lines.push([
        s.step,
        s.timePs.toFixed(4),
        s.timestepFs.toFixed(2),
        s.targetTempK.toFixed(2),
        s.observedTempK.toFixed(2),
        s.keKJMol.toFixed(3),
        s.peKJMol.toFixed(3),
        s.nnDistA.toFixed(4),
        s.meanOmegaRadPs.toFixed(4),
        s.pressureBar.toFixed(3),
        s.boxSizeA.toFixed(3),
        s.moleculeCount,
        s.frozenCount,
      ].join(','));
    }
    return lines.join('\n');
  }

  /** JSON-serializable array of samples, for debugging / optional raw export. */
  getSamples(): readonly SampleContext[] { return this.samples; }
}

/** Data-dictionary rows for the HTML report. Single source of truth so
 *  the columns in buildCsv and the glossary in the report can't drift. */
const DICTIONARY: Array<{ col: string; units: string; description: string }> = [
  { col: 'step', units: 'integer', description: 'Velocity-Verlet step number since the sim started. Increments by the number of sub-steps per frame each visible frame.' },
  { col: 'time_ps', units: 'picoseconds (ps)', description: 'Elapsed simulation time = step × timestep. Not wall-clock time. 1 ps = 10⁻¹² s.' },
  { col: 'timestep_fs', units: 'femtoseconds (fs)', description: 'Integration timestep. Default 3 fs for rigid-body TIP4P/2005 water.' },
  { col: 'temperature_target_K', units: 'kelvin (K)', description: 'Thermostat target temperature — whatever the temperature slider is set to.' },
  { col: 'temperature_observed_K', units: 'kelvin (K)', description: 'Instantaneous kinetic temperature from T = (2/3) ⟨KE⟩ / (N·kB). Should equilibrate toward the target; small oscillations are normal.' },
  { col: 'kinetic_energy_kJ_mol', units: 'kJ/mol', description: 'Translational kinetic energy summed over all molecules. Rotational kinetic energy is NOT included here (separate degrees of freedom).' },
  { col: 'potential_energy_kJ_mol', units: 'kJ/mol', description: 'Total intermolecular potential energy = Σ(Coulomb + Lennard-Jones) over all molecule pairs. Below zero means attractive/cohesive. Expensive to compute so sampled coarsely.' },
  { col: 'nn_distance_A', units: 'Å', description: 'Average nearest-neighbor distance between molecule centers. Tracks density and structure. For liquid water ~2.8–3.1 Å; for ice ~2.76 Å.' },
  { col: 'mean_omega_liquid_rad_ps', units: 'rad/ps', description: 'Mean angular speed of non-frozen molecules. A freezing order parameter: drops as the H-bond network locks in.' },
  { col: 'pressure_bar', units: 'bar', description: 'Instantaneous virial pressure. 1 atm ≈ 1.013 bar. Very noisy for small systems — plot and average over many frames.' },
  { col: 'box_size_A', units: 'Å', description: 'Current box edge length. Fixed unless the barostat is on, in which case it expands or contracts to target pressure.' },
  { col: 'molecule_count', units: 'integer', description: 'Total number of molecules in the box at this step.' },
  { col: 'frozen_count', units: 'integer', description: 'Number of molecules marked is_frozen (ice seed + any auto-promoted by the growth rule). Always 0 unless the freezing demo is active.' },
];

const ANALYSIS_QUESTIONS = [
  'Plot temperature_observed_K vs time_ps. How long does the system take to equilibrate to the target temperature? What\'s the RMS noise around equilibrium?',
  'Plot potential_energy_kJ_mol vs time_ps. Does the total intermolecular energy settle to a steady value? How does it change if you re-run at a different temperature?',
  'Plot nn_distance_A vs time_ps. Can you see phase transitions (liquid → solid changes NN distance subtly; vapor escapes increase it)?',
  'If you ran the freezing demo, plot frozen_count vs time_ps. What\'s the crystal-growth rate (molecules frozen per ps)? How does it change with temperature?',
  'If you ran a mixing demo, use the snapshot to describe the initial condition, then compare to the final state (visual inspection of interleaving).',
  'Compute the heat capacity C_v ≈ d⟨KE⟩/dT by re-running at two temperatures and taking the difference.',
];

/** Build the self-contained HTML report and return its Blob. Caller is
 *  responsible for navigating the browser to the resulting object URL. */
export async function buildReport(
  recorder: ResultsRecorder,
  snapshotBlob: Blob,
  meta: ReportMetadata,
): Promise<Blob> {
  // Convert the PNG snapshot to a data URI so it embeds cleanly into a
  // standalone HTML file.
  const snapshotDataUri = await blobToDataUri(snapshotBlob);

  const csv = recorder.buildCsv(meta);
  const csvDataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  const pngDataUri = snapshotDataUri;

  const samples = recorder.getSamples();
  const preview = samples.slice(0, 20);
  const late = samples.length > 40 ? samples.slice(-10) : [];

  const dictionaryRows = DICTIONARY.map(d => `
    <tr>
      <th>${escapeHtml(d.col)}</th>
      <td><code>${escapeHtml(d.units)}</code></td>
      <td>${escapeHtml(d.description)}</td>
    </tr>
  `).join('');

  const analysisList = ANALYSIS_QUESTIONS.map(q => `<li>${escapeHtml(q)}</li>`).join('');

  const metaRows: Array<[string, string]> = [
    ['Primary species', meta.primarySpecies],
    ['Water model', meta.waterModel ?? '—'],
    ['Experiment', meta.experimentTitle ?? '(ad-hoc session, no preset experiment)'],
    ['Exported', meta.exportedAt.toISOString()],
    ['Samples recorded', String(samples.length)],
    ['Sampling interval', `${AUTO_SAMPLE_INTERVAL_PS} ps`],
  ];
  if (samples.length > 0) {
    const first = samples[0], last = samples[samples.length - 1];
    metaRows.push(['Duration', `${(last.timePs - first.timePs).toFixed(2)} ps`]);
  }
  const metaBlock = metaRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');

  const tableRow = (s: SampleContext) => `
    <tr>
      <td>${s.step}</td>
      <td>${s.timePs.toFixed(2)}</td>
      <td>${s.targetTempK.toFixed(0)}</td>
      <td>${s.observedTempK.toFixed(1)}</td>
      <td>${s.keKJMol.toFixed(1)}</td>
      <td>${s.peKJMol.toFixed(1)}</td>
      <td>${s.nnDistA.toFixed(2)}</td>
      <td>${s.meanOmegaRadPs.toFixed(2)}</td>
      <td>${s.pressureBar.toFixed(1)}</td>
      <td>${s.boxSizeA.toFixed(1)}</td>
      <td>${s.moleculeCount}</td>
      <td>${s.frozenCount}</td>
    </tr>
  `;

  const previewTable = `
    <table class="data">
      <thead>
        <tr>
          <th>step</th><th>t (ps)</th><th>T_tgt (K)</th><th>T_obs (K)</th>
          <th>KE (kJ/mol)</th><th>PE (kJ/mol)</th><th>NN (Å)</th>
          <th>|ω| (rad/ps)</th><th>P (bar)</th><th>Box (Å)</th>
          <th>N</th><th>N_frozen</th>
        </tr>
      </thead>
      <tbody>
        ${preview.map(tableRow).join('')}
        ${late.length > 0 ? `<tr><td colspan="12" style="text-align:center; color:#888; font-style:italic;">… ${samples.length - preview.length - late.length} samples omitted …</td></tr>` : ''}
        ${late.map(tableRow).join('')}
      </tbody>
    </table>
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ChemSim Results — ${escapeHtml(meta.primarySpecies)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 900px; margin: 2em auto; padding: 0 1.5em; color: #222; line-height: 1.55; }
  h1 { font-size: 22px; margin-bottom: 0; }
  h2 { font-size: 18px; margin-top: 1.8em; border-bottom: 2px solid #eee; padding-bottom: 4px; }
  h3 { font-size: 15px; margin-top: 1.4em; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 5px 9px; text-align: left; vertical-align: top; }
  th { background: #f4f6fa; font-weight: 600; }
  table.data td { text-align: right; font-variant-numeric: tabular-nums; }
  table.data th { text-align: center; white-space: nowrap; }
  table.meta th { width: 170px; color: #555; font-weight: 500; }
  code { background: #f5f5f7; padding: 1px 5px; border-radius: 3px; font-size: 90%; }
  .downloads { display: flex; gap: 10px; margin: 10px 0 24px 0; flex-wrap: wrap; }
  .downloads a, .downloads button { display: inline-block; padding: 8px 14px;
    background: #2a6ff0; color: white; text-decoration: none;
    border-radius: 6px; font-size: 14px; border: none; cursor: pointer; }
  .downloads a:hover, .downloads button:hover { background: #1b5cc4; }
  .snapshot { text-align: center; margin: 0.5em 0; }
  .snapshot img { max-width: 100%; border: 1px solid #ccc; border-radius: 6px; }
  .note { font-size: 13px; color: #666; font-style: italic; }
  ol li { margin-bottom: 0.5em; }
  @media print {
    .downloads { display: none; }
    body { max-width: none; margin: 0; }
  }
</style>
</head>
<body>

<h1>ChemSim Simulation Report</h1>
<div class="note">Exported ${escapeHtml(meta.exportedAt.toLocaleString())}. This page is self-contained — print to PDF, save the full HTML, or grab the CSV/PNG below.</div>

<div class="downloads">
  <a href="${csvDataUri}" download="chemsim_data.csv">⬇ Download CSV</a>
  <a href="${pngDataUri}" download="chemsim_snapshot.png">⬇ Download Snapshot</a>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
</div>

<h2>Simulation configuration</h2>
<table class="meta"><tbody>${metaBlock}</tbody></table>

<h2>Snapshot at time of export</h2>
<div class="snapshot">
  <img src="${pngDataUri}" alt="ChemSim 3D view at time of export">
</div>

<h2>Data dictionary</h2>
<p>Each row of the CSV is a sample taken every ${AUTO_SAMPLE_INTERVAL_PS} ps of simulation time.</p>
<table>
  <thead><tr><th>Column</th><th>Units</th><th>Description</th></tr></thead>
  <tbody>${dictionaryRows}</tbody>
</table>

<h2>Data preview</h2>
<p>First ${preview.length} samples${late.length > 0 ? ` plus last ${late.length}` : ''} (${samples.length} total). Full data in the CSV download above.</p>
${previewTable}

<h2>Suggested analysis</h2>
<ol>${analysisList}</ol>

<h2>About this simulation</h2>
<p>ChemSim is a browser-based classical molecular dynamics engine:
rigid-body molecules, Coulomb + Lennard-Jones pair interactions,
Velocity-Verlet integration, Berendsen thermostat, optional barostat.
It does not simulate bond breaking, electron transfer, or quantum effects
— all behaviour in this data comes from the classical force field
(TIP3P / TIP4P-family water, OPLS-AA / TraPPE for everything else).</p>

</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

/** Snapshot the Three.js canvas. Renders once before capture so WebGL's
 *  drawing buffer isn't empty at the time of capture. */
export function captureSnapshot(renderFn: () => void, canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    renderFn();
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}
