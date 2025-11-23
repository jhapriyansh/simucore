# simucore — orbitals_threads.c (WASM · pthreads)

🔗 **Live Demo:** https://simucore.netlify.app  
(Requires browser support for SharedArrayBuffer + WASM threads)

This README documents the `extras/orbitals_threads.c` module in this repository.
It focuses on the threaded WebAssembly particle generator (Emscripten PThreads) used
by the React/Three.js visualizer. Other C sources in `extras/` are part of a
different branch/variant and are intentionally not covered here.

## Purpose

`orbitals_threads.c` samples the probability density of hydrogen-like orbitals
(ψ = R*{nl}(r) · Y*{lm}(θ,φ)) and writes 3D particle positions and RGB colors
into pre-allocated buffers. It's optimized for Emscripten + PThreads so the
sampling work can be distributed across logical CPU cores in the browser.

The produced buffers are consumed by the JavaScript/Three.js front-end to render
particle clouds that visualize orbitals (s, p, d, f, ...).

## Exported API (used from JS)

These symbols are intended to be exported from the compiled WASM module and
called from JavaScript via Emscripten's `ccall`/`cwrap` interface:

- `void seed_rng(uint32_t s)`

  - Seed the global RNG (call from JS with something like `Date.now() & 0xffffffff`).

- `int generate_particles_threads(int n, int l, int m, int total, double t, float *pos, float *col)`

  - Generate up to `total` particles for orbital `(n,l,m)` at time `t`.
  - `pos` and `col` are pointers (in WASM heap) to float arrays of length >= 3*total.
  - Returns the number of particles written.

- `void *wasm_malloc(size_t n)` and `void wasm_free(void *p)`
  - Helpers to allocate/free buffers in the WASM heap from JS.

Refer to `src/components/OrbitalVisualizer.jsx` for a working example of calling these via `Module.ccall`.

## How it works (high level)

- The code divides the requested `total` elements among `cores = emscripten_num_logical_cores()` pthreads.
- Each worker performs importance sampling: pick (r,θ,φ), compute ψ = R·Y and acceptance probability ∝ r² ψ² / maxProb.
- Accepted samples are written atomically into the shared buffers, with an atomic counter coordinating write slots.

## Defaults & visual tuning

- `Rmax` (sampling radius): default `n * n * 3.0` — scales with n² which matches the typical orbital spread.
- `maxProb` (importance-sampling ceiling): default `0.0010` in the threaded variant. Lower values → denser clouds.
- Colors:
  - Positive ψ → (83, 69, 141) (bluish)
  - Negative ψ → (147, 74, 96) (reddish)
  - Colors are converted to 0..1 floats and multiplied by a gentle boost (~1.15) to improve visibility.

Typical interactive particle counts: 20k–300k (adjust depending on CPU and GPU performance).

## Recommended Emscripten build command

Include the following C-style comment block (exact build command and notes) in your documentation or run it directly from the project root. Make sure `emcc` is installed and that `src/wasm/` exists before running.


```bash
emcc extras/orbitals_threads.c -O3 -pthread -s USE_PTHREADS=1 \
  -msimd128 \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web \
  -s EXPORTED_FUNCTIONS='["_generate_particles_threads","_seed_rng","_wasm_malloc","_wasm_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","HEAPF32"]' \
  -s PTHREAD_POOL_SIZE=8 \
  -o src/wasm/orbitals.js
```


## Notes:
- The generated `src/wasm/orbitals.js` (and associated `.wasm`) are
  consumed by the frontend loader (see `src/components/OrbitalVisualizer.jsx`).
- If your environment doesn't support threads, use the single-threaded
  variant in `extras/orbitals.c` (different branch/usage).

## Browser / server considerations

- WebAssembly threads require `SharedArrayBuffer` and cross-origin isolation; configure your dev/prod server accordingly (Vite can be configured to add the headers).
- The `.wasm` and worker files must be served from the same origin and with correct MIME types.

## Tuning tips

- If the cloud is too sparse: decrease `maxProb` or increase `total`.
- If orbital lobes are clipped: increase `Rmax` (passed via C logic based on `n`).
- If parallelism is excessive or you need to limit threads: control `PTHREAD_POOL_SIZE` at build time, or limit logical cores in runtime environments.
