# Hydrogen Orbital Visualizer (WASM + SIMD)

A high-performance 3D visualization of hydrogen atomic orbitals using WebAssembly with SIMD optimizations and Three.js. This project demonstrates quantum mechanical wavefunctions through interactive real-time particle simulations.

## Features

- Real-time 3D visualization of hydrogen atomic orbitals
- SIMD-accelerated particle generation using WebAssembly
- Support for s, p, d, and f orbitals (up to n=4)
- Interactive orbital selection and parameter adjustment
- Configurable particle count for performance tuning
- Bloom post-processing effect for enhanced visualization
- Orbital auto-rotation and axis display controls

## Prerequisites

- Node.js (v16 or higher)
- Emscripten SDK (with SIMD support)
- Git

## Project Setup

1. Clone the repository:

```bash
git clone https://github.com/jhapriyansh/simucore.git
cd simucore
```

2. Install dependencies:

```bash
npm install
```

3. Compile the WebAssembly module:
   First, ensure you have the `/src/wasm` directory:

```bash
mkdir -p src/wasm
```

Then compile the C code with SIMD optimizations:

```bash
emcc extras/orbitals_simd.c -O3 -msimd128 \
 -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web \
 -s EXPORTED_FUNCTIONS='["_generate_particles","_malloc","_free","_seed_rng"]' \
 -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","HEAPF32","getValue","setValue"]' \
 -o src/wasm/orbitals.js
```

4. Start the development server:

```bash
npm run dev
```

## Usage

- Use the dropdown menu to select different orbital configurations
- Adjust the particle count slider to balance quality and performance
- Toggle auto-rotation and axis display using the checkboxes
- Click and drag to rotate the view manually
- Scroll to zoom in/out

## Performance Tuning

- Particle count: 10,000 to 100,000 (higher values provide better orbital definition but may impact performance)
- For slower devices, reduce particle count and disable bloom effects
- SIMD acceleration significantly improves particle generation performance

## Technology Stack

- React + Vite for the frontend
- Three.js for 3D graphics
- WebAssembly with SIMD for particle calculations
- C for core orbital computation logic
- Emscripten for C to WebAssembly compilation
