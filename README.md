# simucore — Hydrogen Orbital Visualizer (React + WASM)

This project demonstrates a WebAssembly-accelerated hydrogen orbital visualizer built with React and Vite. The heavy numeric work (particle sampling, positions and colors) is implemented in C (`extras/orbitals.c`) and compiled to a WebAssembly module that the React UI loads at runtime.

Features

- Interactive 3D visualization using Three.js.
- WASM numeric core for generating particle clouds representing atomic orbitals.
- Post-processing (bloom) and configurable particle count for visual tuning.

Table of contents

- Requirements
- Quick start (dev)
- Build the WASM module (from `extras`)
- Build & production
- Notes & troubleshooting

## Requirements

- Node.js and npm (or yarn). Vite powers the dev server and build.
- Emscripten SDK (emsdk) to compile `extras/orbitals.c` into an ES module that exports a runtime for the browser.

On macOS you can manage Emscripten via the official emsdk: https://emscripten.org/docs/getting_started/downloads.html

Important repository layout note

- The JS code expects a folder at `src/wasm` containing the generated `orbitals.js` module. Before running the WASM build from `extras` create that folder if it doesn't exist:

```bash
# from project root
mkdir -p src/wasm
```

## Quick start (development)

1. Install dependencies

```bash
npm install
```

2. Start the dev server (Vite)

```bash
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`) to see the visualizer.

## Build the WASM module (from `extras`)

The numeric core for particle generation lives in `extras/orbitals.c`. Use Emscripten to compile this into a small ES module suitable for browser import. Run the build command from the `extras` folder (the command writes the output to `../src/wasm/orbitals.js`):

1. Ensure `src/wasm` exists (see above).
2. Change into the `extras` folder and run the Emscripten command (zsh / bash):

```bash
cd extras
emcc orbitals.c -O3 \
	-s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s EXPORTED_FUNCTIONS='["_generate_particles","_malloc","_free"]' \
	-s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","HEAPF32"]' \
	-o ../src/wasm/orbitals.js
```

Explanation of key flags

- `-O3`: high optimization level for numeric code.
- `-s MODULARIZE=1`: wrap the generated runtime as a factory function (so it doesn't pollute global scope).
- `-s EXPORT_ES6=1`: emit an ES module compatible output so it can be imported using `import` in modern toolchains.
- `-s ENVIRONMENT=web`: target the browser environment.
- `-s EXPORTED_FUNCTIONS='["_generate_particles","_malloc","_free"]'`: make the C functions available to JS.
- `-s EXPORTED_RUNTIME_METHODS='["cwrap","ccall"]'`: allow JS wrappers like `cwrap`/`ccall` to call into C.
- `-o ../src/wasm/orbitals.js`: output path relative to `extras`, placing the module into `src/wasm`.

After compiling, your project should contain `src/wasm/orbitals.js` and associated WASM data; the React app lazily loads this module at runtime.

## Build & production

To build the web app for production with Vite:

```bash
npm run build
# (optionally) preview the production build locally
npm run preview
```

## Notes & troubleshooting

- If `emcc` is not found, install and activate the Emscripten SDK (emsdk). Follow the official steps at https://emscripten.org/docs/getting_started/downloads.html. On macOS you typically run the emsdk installer and `source ./emsdk_env.sh` in your shell.
- Make sure `src/wasm` exists and is writable before running the Emscripten command. The build writes `orbitals.js` relative to the `extras` folder to `../src/wasm/orbitals.js`.
- If your browser refuses to load the module due to MIME type or module specifier issues, ensure Vite is serving the `src/wasm` file and you're using `EXPORT_ES6=1` as above.
- Lower the `Particles` slider in the UI if your GPU struggles — higher particle counts increase CPU/WASM work and GPU upload/render cost.

## Where to look in the repo

- `src/components/OrbitalVisualizer.jsx` — React component that sets up Three.js, loads the WASM module, and drives particle generation and UI controls.
- `extras/orbitals.c` — C source for the particle generator (compile this to WASM as shown above).
- `src/wasm/orbitals.js` — generated WASM JS wrapper (created by the `emcc` command).

If you want, I can also add a small npm script to automate the WASM build (e.g., `npm run build:wasm`) — tell me your preferred approach and I can add it.

---

Happy visualizing — tweak bloom, particle size and count, and the auto-rotate speed to find the best look for your machine.
