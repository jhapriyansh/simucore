// src/components/OrbitalVisualizer.jsx
// React component that initializes a Three.js scene and uses a WebAssembly
// numeric kernel to generate particle clouds representing hydrogen orbitals.
//
// High-level contract:
// - Inputs: orbital parameters (n, l, m), particle count, time (internal).
// - Outputs: a Three.js Points cloud displayed in the scene.
// - Errors: logs to console; gracefully returns empty buffers if WASM not ready.
//
// Tweakable knobs (what to change for different behavior):
// - `numParticles`: increases sampling density (higher = slower but denser visuals).
// - `timeRef` increment: changes how fast orbitals evolve over time.
// - Bloom (strength/radius/threshold) in the composer to change glow intensity.
// - `PointsMaterial.size` to change apparent particle size.

import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import "./OrbitalVisualizer.css";

// WASM module loader: compiled output from `extras/orbitals.c` (see README).
// The module exports numeric routines and a linear memory; we call `cwrap` to
// obtain a JS callable wrapper for `generate_particles` and use `_malloc`/`_free`.
import createWasmModule from "../wasm/orbitals.js";

const OrbitalVisualizer = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const particlesRef = useRef(null);
  const axesRef = useRef(null);
  const controlsRef = useRef(null);
  const timeRef = useRef(0);
  const wasmRef = useRef(null);

  const [orbital, setOrbital] = useState({ n: 1, l: 0, m: 0 });
  const [numParticles, setNumParticles] = useState(50000);
  const [isRotating, setIsRotating] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [wasmReady, setWasmReady] = useState(false);

  useEffect(() => {
    (async () => {
      wasmRef.current = await createWasmModule();
      // Mark the module as ready so dependent effects (particle generation)
      // don't attempt to call into WASM before initialization completes.
      console.log("WASM Loaded");
      setWasmReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!mountRef.current || sceneRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);
    sceneRef.current = scene;

    // Camera: 60° FOV gives a natural perspective. The near/far values are
    // conservative for this visualization; avoid extreme ranges to keep depth precision.
    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      200
    );
    camera.position.set(18, 18, 18);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(
      mountRef.current.clientWidth,
      mountRef.current.clientHeight
    );
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-processing: RenderPass then an UnrealBloomPass for glow. Tweak
    // the strength (1.2), radius (0.4), and threshold (0.85) to adjust bloom.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new UnrealBloomPass(new THREE.Vector3(1, 1, 1), 1.2, 0.4, 0.85)
    );
    composerRef.current = composer;

    // OrbitControls: enable damping for smoother camera motion. autoRotate
    // is driven by the `isRotating` state and can be toggled from the UI.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = isRotating;
    controls.autoRotateSpeed = 0.9; // change to speed up/down automatic rotation
    controlsRef.current = controls;

    // Axes helper for orientation; visible flag is controlled by UI state.
    const axes = new THREE.AxesHelper(8);
    scene.add(axes);
    axesRef.current = axes;

    // Animation loop: advances an internal time counter and renders via the composer.
    // The time increment (0.01) affects how fast the WASM-generated orbital phases evolve.
    const animate = () => {
      timeRef.current += 0.01;
      controls.update();
      composer.render();
      requestAnimationFrame(animate);
    };

    animate();
  }, []);

  const generateParticlesWASM = (n, l, m, count) => {
    const mod = wasmRef.current;
    if (!mod)
      // If the WASM module isn't available yet, return empty typed arrays.
      return { positions: new Float32Array(0), colors: new Float32Array(0) };

    // Allocate space for positions and colors on the WASM heap. Each particle
    // is 3 floats (x,y,z) so we multiply by 3. `_malloc` returns a byte offset
    // into the linear memory where we write floats (4 bytes each).
    const floatCount = count * 3;
    const posPtr = mod._malloc(floatCount * 4);
    const colPtr = mod._malloc(floatCount * 4);

    // Wrap the exported C function so we can call it from JS. The function
    // returns the number of particles actually written (<= count).
    const gen = mod.cwrap("generate_particles", "number", [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]);

    const written = gen(n, l, m, count, timeRef.current, posPtr, colPtr);

    // Read back the computed floats from the WASM heap. We create a Float32Array
    // view into the module's memory at the pointer offsets and slice to copy the
    // data into JS-managed arrays. Free the WASM buffers afterwards.
    const positions = new Float32Array(
      mod.HEAPF32.buffer,
      posPtr,
      written * 3
    ).slice();
    const colors = new Float32Array(
      mod.HEAPF32.buffer,
      colPtr,
      written * 3
    ).slice();

    mod._free(posPtr);
    mod._free(colPtr);

    return { positions, colors };
  };

  useEffect(() => {
    if (!sceneRef.current || !wasmReady) return;
    if (particlesRef.current) sceneRef.current.remove(particlesRef.current);

    const result = generateParticlesWASM(
      orbital.n,
      orbital.l,
      orbital.m,
      numParticles
    );
    if (!result) return;

    const { positions, colors } = result;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // PointsMaterial: tune size, opacity and blending to achieve the desired
    // visual effect. Additive blending and bloom work well together on dark
    // backgrounds for a glowing particle appearance.
    const mat = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });

    const pts = new THREE.Points(geo, mat);
    sceneRef.current.add(pts);
    particlesRef.current = pts;
  }, [orbital, numParticles, wasmReady]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = isRotating;
  }, [isRotating]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  // Preset orbital configurations available in the UI select box.
  // Each config is an object {n,l,m,name} that maps to quantum numbers.
  const orbitalConfigs = [
    { n: 1, l: 0, m: 0, name: "1s" },
    { n: 2, l: 0, m: 0, name: "2s" },
    { n: 2, l: 1, m: -1, name: "2p (m=-1)" },
    { n: 2, l: 1, m: 0, name: "2p (m=0)" },
    { n: 2, l: 1, m: 1, name: "2p (m=1)" },
    { n: 3, l: 0, m: 0, name: "3s" },
    { n: 3, l: 1, m: 0, name: "3p" },
    { n: 3, l: 2, m: -2, name: "3d (m=-2)" },
    { n: 3, l: 2, m: -1, name: "3d (m=-1)" },
    { n: 3, l: 2, m: 0, name: "3d (m=0)" },
    { n: 3, l: 2, m: 1, name: "3d (m=1)" },
    { n: 3, l: 2, m: 2, name: "3d (m=2)" },
    { n: 4, l: 3, m: -3, name: "4f (m=-3)" },
    { n: 4, l: 3, m: -2, name: "4f (m=-2)" },
    { n: 4, l: 3, m: -1, name: "4f (m=-1)" },
    { n: 4, l: 3, m: 0, name: "4f (m=0)" },
    { n: 4, l: 3, m: 1, name: "4f (m=1)" },
    { n: 4, l: 3, m: 2, name: "4f (m=2)" },
    { n: 4, l: 3, m: 3, name: "4f (m=3)" },
  ];

  return (
    <div className="visualizer-container">
      <div className="controls-panel">
        <h1>Hydrogen Orbital Visualizer (WASM Accelerated)</h1>

        <select
          value={JSON.stringify(orbital)}
          onChange={(e) => setOrbital(JSON.parse(e.target.value))}
        >
          {orbitalConfigs.map((c) => (
            <option key={c.name} value={JSON.stringify(c)}>
              {c.name}
            </option>
          ))}
        </select>

        <label>Particles: {numParticles}</label>
        <input
          type="range"
          min="10000"
          max="100000"
          step="10000"
          value={numParticles}
          onChange={(e) => setNumParticles(+e.target.value)}
        />

        <label>
          <input
            type="checkbox"
            checked={isRotating}
            onChange={(e) => setIsRotating(e.target.checked)}
          />
          Auto Rotate
        </label>

        <label>
          <input
            type="checkbox"
            checked={showAxes}
            onChange={(e) => setShowAxes(e.target.checked)}
          />
          Show Axes
        </label>
      </div>

      <div ref={mountRef} className="canvas-container" />
    </div>
  );
};

export default OrbitalVisualizer;
