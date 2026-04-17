# ChemSim: Interactive Molecular Interaction Simulator

A browser-based, WebXR-compatible interactive molecular simulation for chemistry education. Students can place molecules near each other and watch their electrostatic surfaces deform in response, fill a box with molecules and observe emergent behavior, adjust temperature and watch phase transitions, and interact in VR or on a flat screen.

## Features

- **Two-Molecule Mode**: Drag molecules around each other, rotate them, and see real-time energy readouts with electrostatic cloud deformation
- **Many-Molecule Box Mode**: Simulate 10-200 molecules with periodic boundaries, temperature control, and phase transition visualization
- **VR Support**: WebXR integration for Meta Quest 3 and other headsets
- **10 Molecule Library**: Water, ammonia, methane, CO2, CCl4, chloroform, methanol, CF4, H2S, urea
- **Pre-set Experiments**: Guided investigations for classroom use
- **Offline Support**: Works offline once loaded (PWA)

## Quick Start

```bash
# Install dependencies
npm install

# Build the WASM physics engine
npm run build:wasm

# Start development server
npm run dev
```

Open **https://localhost:3000** in your browser (note the HTTPS — the
dev server uses a self-signed cert; click "Advanced → Proceed" on the
first visit).

> ⚠️ Accessing the server from another machine over its IP address
> (e.g. `https://10.0.0.5:3000`) works, but the browser will show a
> cert warning. Plain `http://` over an IP will silently disable
> wasm threading — the page needs a secure context for
> `SharedArrayBuffer`. See `docs/PERFORMANCE.md` if something seems
> to run single-threaded.

First build requires Rust nightly (pinned automatically by
`src/physics/rust-toolchain.toml`). `rustup install nightly` once,
then `npm run build:wasm` handles the rest.

### Pointers for maintainers

- `docs/PERFORMANCE.md` — how the physics loop is fast, what dials
  exist, what was tried and rejected.
- `CLAUDE.md` — invariants, common failure modes, and patterns for
  coding-agent handoffs.

## Build for Production

```bash
npm run build
npm run preview
```

## Testing

```bash
# Unit tests (molecule data validation)
npm run test:unit

# End-to-end tests (Playwright)
npm run test:e2e

# Rust physics engine tests
cd src/physics && cargo test
```

## Technology Stack

- **Three.js**: 3D rendering, WebXR
- **Rust -> WebAssembly**: Physics engine (Coulomb, Lennard-Jones, Velocity Verlet)
- **Vite**: Build system
- **Playwright + Vitest**: Testing

## Documentation

- [Student Guide](docs/STUDENT_GUIDE.md)
- [Instructor Guide](docs/INSTRUCTOR_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Prior Art Report](docs/PRIOR_ART_REPORT.md)
- [Grant Mechanisms Report](docs/GRANT_MECHANISMS_REPORT.md)
- [Technical Feasibility Report](docs/TECHNICAL_FEASIBILITY_REPORT.md)

## Author

Dr. Fountain Farrell, Cheyney University of Pennsylvania

## License

MIT
