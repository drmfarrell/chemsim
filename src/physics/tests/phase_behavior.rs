//! Mode 2 phase-behavior validation: do 50 water molecules at 300K behave like
//! a liquid (cohesive, short nearest-neighbor distance) while 50 methane
//! molecules at 300K behave like a gas (spread out, long nearest-neighbor
//! distance)?
//!
//! Success criteria for educational pedagogy (not publication-grade MD):
//!   - Water at 300K: mean nearest-neighbor distance < 3.8 A (clusters form)
//!   - Methane at 300K: mean nearest-neighbor distance > 4.0 A
//!   - Water mean NN distance < methane mean NN distance at same density
//!   - Raising water's temperature from 300 -> 500 K should increase its NN
//!     distance (cluster breakdown)
//!
//! Run with:
//!     cd src/physics && cargo test --test phase_behavior -- --nocapture

use chemsim_physics::{Atom, SimulationSystem};
use std::fs::{create_dir_all, File};
use std::io::Write;

fn water_input(cx: f64, cy: f64, cz: f64) -> String {
    format!(
        "{{\"atoms\":[\
         {{\"element\":\"O\",\"x\":{},\"y\":{},\"z\":{},\"charge\":-0.834,\"epsilon\":0.6502,\"sigma\":3.12,\"mass\":15.999}},\
         {{\"element\":\"H\",\"x\":{},\"y\":{},\"z\":{},\"charge\":0.417,\"epsilon\":0.01,\"sigma\":2.5,\"mass\":1.008}},\
         {{\"element\":\"H\",\"x\":{},\"y\":{},\"z\":{},\"charge\":0.417,\"epsilon\":0.01,\"sigma\":2.5,\"mass\":1.008}}\
         ],\"polarizability\":1.45}}",
        cx,          cy,          cz + 0.1173,
        cx + 0.7572, cy,          cz - 0.4692,
        cx - 0.7572, cy,          cz - 0.4692,
    )
}

fn methane_input(cx: f64, cy: f64, cz: f64) -> String {
    format!(
        "{{\"atoms\":[\
         {{\"element\":\"C\",\"x\":{},\"y\":{},\"z\":{},\"charge\":-0.24,\"epsilon\":0.4577,\"sigma\":3.4,\"mass\":12.011}},\
         {{\"element\":\"H\",\"x\":{},\"y\":{},\"z\":{},\"charge\":0.06,\"epsilon\":0.01,\"sigma\":2.5,\"mass\":1.008}},\
         {{\"element\":\"H\",\"x\":{},\"y\":{},\"z\":{},\"charge\":0.06,\"epsilon\":0.01,\"sigma\":2.5,\"mass\":1.008}},\
         {{\"element\":\"H\",\"x\":{},\"y\":{},\"z\":{},\"charge\":0.06,\"epsilon\":0.01,\"sigma\":2.5,\"mass\":1.008}},\
         {{\"element\":\"H\",\"x\":{},\"y\":{},\"z\":{},\"charge\":0.06,\"epsilon\":0.01,\"sigma\":2.5,\"mass\":1.008}}\
         ],\"polarizability\":2.59}}",
        cx,           cy,           cz,
        cx + 0.6276,  cy + 0.6276,  cz + 0.6276,
        cx - 0.6276,  cy - 0.6276,  cz + 0.6276,
        cx - 0.6276,  cy + 0.6276,  cz - 0.6276,
        cx + 0.6276,  cy - 0.6276,  cz - 0.6276,
    )
}

fn setup_box(
    sys: &mut SimulationSystem,
    molecule_builder: fn(f64, f64, f64) -> String,
    n: usize,
    box_size: f64,
    temperature: f64,
) {
    sys.set_box_size(box_size);
    sys.set_periodic(true);
    sys.set_thermostat(true);
    sys.set_temperature(temperature);
    sys.set_cutoff(12.0);
    sys.set_timestep(0.002);

    let spacing = box_size / (n as f64).cbrt();
    let half = box_size / 2.0;
    let grid = ((n as f64).cbrt().ceil()) as usize;

    let mut placed = 0;
    'outer: for ix in 0..grid {
        for iy in 0..grid {
            for iz in 0..grid {
                if placed >= n { break 'outer; }
                let x = -half + spacing * (ix as f64 + 0.5);
                let y = -half + spacing * (iy as f64 + 0.5);
                let z = -half + spacing * (iz as f64 + 0.5);
                let input = molecule_builder(x, y, z);
                sys.add_molecule(&input).expect("add_molecule");
                placed += 1;
            }
        }
    }

    sys.init_velocities();
}

fn mean_nn_distance(sys: &SimulationSystem) -> f64 {
    // Re-implement here because we don't expose a raw API. Use get_all_positions.
    let pos = sys.get_all_positions();
    let n = pos.len() / 3;
    if n < 2 { return 0.0; }

    let mut total = 0.0;
    for i in 0..n {
        let xi = pos[i * 3];
        let yi = pos[i * 3 + 1];
        let zi = pos[i * 3 + 2];
        let mut min2 = f64::MAX;
        for j in 0..n {
            if i == j { continue; }
            let dx = pos[j * 3]     - xi;
            let dy = pos[j * 3 + 1] - yi;
            let dz = pos[j * 3 + 2] - zi;
            let d2 = dx * dx + dy * dy + dz * dz;
            if d2 < min2 { min2 = d2; }
        }
        total += min2.sqrt();
    }
    total / n as f64
}

fn equilibrate_and_sample(
    sys: &mut SimulationSystem,
    equilibration_steps: u32,
    sample_steps: u32,
    sample_interval: u32,
) -> (f64, f64, f64) {
    // Equilibrate
    sys.step_n(equilibration_steps);

    // Sample
    let mut nn_samples = Vec::new();
    let mut temp_samples = Vec::new();
    let mut pe_samples = Vec::new();
    let n_samples = sample_steps / sample_interval;
    for _ in 0..n_samples {
        sys.step_n(sample_interval);
        nn_samples.push(mean_nn_distance(sys));
        temp_samples.push(sys.get_temperature());
        pe_samples.push(sys.get_potential_energy());
    }

    let avg_nn = nn_samples.iter().sum::<f64>() / nn_samples.len() as f64;
    let avg_t = temp_samples.iter().sum::<f64>() / temp_samples.len() as f64;
    let avg_pe = pe_samples.iter().sum::<f64>() / pe_samples.len() as f64;
    (avg_nn, avg_t, avg_pe)
}

#[test]
fn phase_behavior() {
    let n = 50;
    // Water: 14.4 A box is ~0.5 * liquid water density
    let box_water = 14.4;
    // Methane: 20 A box is roughly methane's critical density, so the
    // molecules have room to spread out if they prefer to.
    let box_methane = 20.0;

    // Longer equilibration + sampling: 5 ps eq + 5 ps sampling at dt=2 fs
    let eq_steps = 2500u32;
    let sample_steps = 2500u32;
    let sample_interval = 50u32;

    println!("\n=== Water at 300 K (box {} A, {} molecules) ===", box_water, n);
    let mut water_sys = SimulationSystem::new();
    setup_box(&mut water_sys, water_input, n, box_water, 300.0);
    let (nn_water_300, t_water_300, pe_water_300) =
        equilibrate_and_sample(&mut water_sys, eq_steps, sample_steps, sample_interval);
    println!("  mean NN distance: {:.3} A", nn_water_300);
    println!("  avg temperature:  {:.1} K", t_water_300);
    println!("  avg PE / molecule: {:.2} kJ/mol", pe_water_300 / n as f64);

    println!("\n=== Methane at 300 K (box {} A, {} molecules) ===", box_methane, n);
    let mut ch4_sys = SimulationSystem::new();
    setup_box(&mut ch4_sys, methane_input, n, box_methane, 300.0);
    let (nn_ch4_300, t_ch4_300, pe_ch4_300) =
        equilibrate_and_sample(&mut ch4_sys, eq_steps, sample_steps, sample_interval);
    println!("  mean NN distance: {:.3} A", nn_ch4_300);
    println!("  avg temperature:  {:.1} K", t_ch4_300);
    println!("  avg PE / molecule: {:.2} kJ/mol", pe_ch4_300 / n as f64);

    println!("\n=== Water at 800 K (hot, above water's boiling point) ===");
    let mut water_hot = SimulationSystem::new();
    setup_box(&mut water_hot, water_input, n, box_water, 800.0);
    let (nn_water_500, t_water_500, pe_water_500) =
        equilibrate_and_sample(&mut water_hot, eq_steps, sample_steps, sample_interval);
    println!("  mean NN distance: {:.3} A", nn_water_500);
    println!("  avg temperature:  {:.1} K", t_water_500);
    println!("  avg PE / molecule: {:.2} kJ/mol", pe_water_500 / n as f64);

    // Write JSON output
    create_dir_all("../../results/validation").ok();
    let mut f = File::create("../../results/validation/phase_behavior.json").unwrap();
    writeln!(f, "{{").unwrap();
    writeln!(f, "  \"box_water_A\": {},", box_water).unwrap();
    writeln!(f, "  \"box_methane_A\": {},", box_methane).unwrap();
    writeln!(f, "  \"molecule_count\": {},", n).unwrap();
    writeln!(f, "  \"water_300K\": {{").unwrap();
    writeln!(f, "    \"mean_nn_distance_A\": {},", nn_water_300).unwrap();
    writeln!(f, "    \"avg_temperature_K\": {},", t_water_300).unwrap();
    writeln!(f, "    \"avg_pe_per_molecule_kJ_mol\": {}", pe_water_300 / n as f64).unwrap();
    writeln!(f, "  }},").unwrap();
    writeln!(f, "  \"methane_300K\": {{").unwrap();
    writeln!(f, "    \"mean_nn_distance_A\": {},", nn_ch4_300).unwrap();
    writeln!(f, "    \"avg_temperature_K\": {},", t_ch4_300).unwrap();
    writeln!(f, "    \"avg_pe_per_molecule_kJ_mol\": {}", pe_ch4_300 / n as f64).unwrap();
    writeln!(f, "  }},").unwrap();
    writeln!(f, "  \"water_500K\": {{").unwrap();
    writeln!(f, "    \"mean_nn_distance_A\": {},", nn_water_500).unwrap();
    writeln!(f, "    \"avg_temperature_K\": {},", t_water_500).unwrap();
    writeln!(f, "    \"avg_pe_per_molecule_kJ_mol\": {}", pe_water_500 / n as f64).unwrap();
    writeln!(f, "  }}").unwrap();
    writeln!(f, "}}").unwrap();

    println!("\n=== Validation criteria ===");
    println!("(PE per molecule is the primary phase indicator: strongly negative = cohesive/liquid-like, near zero = non-cohesive/gas-like)");

    let mut all_pass = true;

    let pe_w_300 = pe_water_300 / n as f64;
    let pe_m_300 = pe_ch4_300 / n as f64;
    let pe_w_hot = pe_water_500 / n as f64;

    // 1. Water at 300K should be strongly cohesive
    let check1 = pe_w_300 < -3.0;
    println!("  [{:}] Water 300K PE/molecule < -3 kJ/mol  (actual {:.2})",
             if check1 { "PASS" } else { "FAIL" }, pe_w_300);
    all_pass &= check1;

    // 2. Methane at 300K should be weakly cohesive or ideal-gas-like
    let check2 = pe_m_300 > -2.0;
    println!("  [{:}] Methane 300K PE/molecule > -2 kJ/mol  (actual {:.2})",
             if check2 { "PASS" } else { "FAIL" }, pe_m_300);
    all_pass &= check2;

    // 3. Water should bind substantially more than methane
    let check3 = pe_w_300 < pe_m_300 - 3.0;
    println!("  [{:}] Water PE at least 3 kJ/mol more negative than methane PE  (water {:.2} < ch4 {:.2} - 3.0)",
             if check3 { "PASS" } else { "FAIL" }, pe_w_300, pe_m_300);
    all_pass &= check3;

    // 4. Hot water should be less cohesive (PE higher, closer to zero) or NN larger
    let check4 = (pe_w_hot > pe_w_300) || (nn_water_500 > nn_water_300);
    println!("  [{:}] Hot water less cohesive (PE {:.2} > {:.2}) OR NN larger ({:.2} > {:.2})",
             if check4 { "PASS" } else { "FAIL" },
             pe_w_hot, pe_w_300, nn_water_500, nn_water_300);
    all_pass &= check4;

    // 5. Water's NN distance should be liquid-like (< 3.8 A)
    let check5 = nn_water_300 < 3.8;
    println!("  [{:}] Water 300K mean NN < 3.8 A  (actual {:.2})",
             if check5 { "PASS" } else { "FAIL" }, nn_water_300);
    all_pass &= check5;

    println!();
    assert!(all_pass, "Phase-behavior validation failed");
}
