/*
 * Quantum Orbital Visualizer Component
 *
 * This component provides an interactive 3D visualization of hydrogen atomic orbitals
 * using WebAssembly for computation and Three.js for rendering. It supports:
 * - Multiple orbital configurations (s, p, d, f orbitals)
 * - Real-time particle generation with SIMD optimization
 * - Interactive camera controls and auto-rotation
 * - Adjustable particle count for performance/quality balance
 * - Bloom post-processing for enhanced visual appeal
 */

import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import createModule from "../wasm/orbitals.js";
import "./OrbitalVisualizer.css";

const OrbitalVisualizer = () => {
  // Three.js scene references
  const mountRef = useRef(null); // Container div for the canvas
  const sceneRef = useRef(null); // Main Three.js scene
  const rendererRef = useRef(null); // WebGL renderer
  const composerRef = useRef(null); // Post-processing composer for bloom effect
  const cameraRef = useRef(null); // Perspective camera
  const particlesRef = useRef(null); // Particle system for orbital visualization
  const controlsRef = useRef(null); // Orbit controls for camera movement
  const axesRef = useRef(null); // Coordinate axes helper

  // WebAssembly module reference and animation time
  const wasmRef = useRef(null); // WASM module instance
  const timeRef = useRef(0); // Animation time parameter

  // Component state
  const [orbital, setOrbital] = useState({ n: 1, l: 0, m: 0 }); // Current orbital configuration
  const [numParticles, setNumParticles] = useState(120000); // Number of particles to render
  const [isRotating, setIsRotating] = useState(true); // Auto-rotation enabled
  const [showAxes, setShowAxes] = useState(true); // Coordinate axes visibility

  // Load WASM with thread support
  useEffect(() => {
    let canceled = false;

    createModule({
      locateFile: (file) => `/src/wasm/${file}`,
    }).then((Module) => {
      if (canceled) return;
      wasmRef.current = Module;
      Module.ccall("seed_rng", null, ["number"], [Date.now() & 0xffffffff]);
      console.log("✅ WASM (threads) Loaded");
      generateCloud();
    });

    return () => {
      canceled = true;
    };
  }, []);

  // Setup scene
  useEffect(() => {
    if (!mountRef.current || sceneRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      300
    );
    camera.position.set(20, 18, 20);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(
      mountRef.current.clientWidth,
      mountRef.current.clientHeight
    );
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Slightly increased brightness bloom profile
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.9)
    );
    composerRef.current = composer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controlsRef.current = controls;

    const axes = new THREE.AxesHelper(8);
    scene.add(axes);
    axesRef.current = axes;

    const onResize = () => {
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const animate = () => {
      timeRef.current += 0.01;
      controls.update();
      composer.render();
      requestAnimationFrame(animate);
    };

    animate();

    return () => window.removeEventListener("resize", onResize);
  }, []);

  /**
   * Generates particle data using WebAssembly
   * This function:
   * 1. Allocates memory for position and color data
   * 2. Calls WASM function to generate particles based on orbital parameters
   * 3. Copies data back to JavaScript
   * 4. Frees allocated WASM memory
   *
   * Returns: { positions, colors } arrays for Three.js particle system
   */
  const generateWASMParticles = () => {
    const Module = wasmRef.current;
    if (!Module) return null;

    const count = numParticles;
    const floats = count * 3; // XYZ components per particle
    const bytes = floats * 4; // 4 bytes per float

    const posPtr = Module.ccall("wasm_malloc", "number", ["number"], [bytes]);
    const colPtr = Module.ccall("wasm_malloc", "number", ["number"], [bytes]);

    const written = Module.ccall(
      "generate_particles_threads",
      "number",
      ["number", "number", "number", "number", "number", "number", "number"],
      [orbital.n, orbital.l, orbital.m, count, timeRef.current, posPtr, colPtr]
    );

    // Normalize draw count = exactly the amount user requested
    const finalWritten = Math.min(written, count);

    const positions = new Float32Array(
      Module.HEAPF32.buffer,
      posPtr,
      finalWritten * 3
    ).slice();
    const colors = new Float32Array(
      Module.HEAPF32.buffer,
      colPtr,
      finalWritten * 3
    ).slice();

    Module.ccall("wasm_free", null, ["number"], [posPtr]);
    Module.ccall("wasm_free", null, ["number"], [colPtr]);

    return { positions, colors };
  };

  /**
   * Creates or updates the particle cloud visualization
   * This function:
   * 1. Cleans up existing particle system if present
   * 2. Generates new particle data using WASM
   * 3. Creates Three.js geometry and material
   * 4. Sets up particle system with proper blending and size
   */
  const generateCloud = () => {
    if (!sceneRef.current || !wasmRef.current) return;

    // Cleanup existing particle system
    if (particlesRef.current) {
      sceneRef.current.remove(particlesRef.current);
      particlesRef.current.geometry.dispose();
      particlesRef.current.material.dispose();
      particlesRef.current = null;
    }

    const result = generateWASMParticles();
    if (!result) return;
    const { positions, colors } = result;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: true,
    });

    const pts = new THREE.Points(geo, mat);
    sceneRef.current.add(pts);
    particlesRef.current = pts;
  };

  useEffect(() => generateCloud(), [orbital, numParticles]);
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = isRotating;
  }, [isRotating]);
  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  /**
   * Available orbital configurations
   * Format: { n, l, m, name }
   * - n: Principal quantum number (energy level)
   * - l: Angular momentum quantum number (orbital shape)
   * - m: Magnetic quantum number (orientation)
   *
   * Configurations include:
   * - s orbitals: spherical (l=0)
   * - p orbitals: dumbbell shaped (l=1)
   * - d orbitals: complex lobed shapes (l=2)
   * - f orbitals: most complex shapes (l=3)
   */
  const orbitalConfigs = [
    { n: 1, l: 0, m: 0, name: "1s" }, // Ground state
    { n: 2, l: 0, m: 0, name: "2s" }, // First excited s orbital
    { n: 2, l: 1, m: -1, name: "2p (m=-1)" }, // 2p orbitals with different
    { n: 2, l: 1, m: 0, name: "2p (m=0)" }, // magnetic quantum numbers
    { n: 2, l: 1, m: 1, name: "2p (m=1)" }, // controlling orientation
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
      {/* Control Panel for Orbital Parameters */}
      <div className="controls-panel">
        <h1>Hydrogen Orbital Visualizer (WASM · SIMD · Threads)</h1>

        {/* Orbital Configuration Selector */}
        <select
          value={JSON.stringify(orbital)}
          onChange={(e) => setOrbital(JSON.parse(e.target.value))}
          title="Select quantum orbital configuration (n,l,m)"
        >
          {orbitalConfigs.map((c) => (
            <option key={c.name} value={JSON.stringify(c)}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Particle Count Slider
            - More particles = Higher quality visualization but lower performance
            - Range: 20k to 300k particles
            - Step size: 20k particles
        */}
        <label>Particles: {numParticles.toLocaleString()}</label>
        <input
          type="range"
          min="20000"
          max="300000"
          step="20000"
          value={numParticles}
          onChange={(e) => setNumParticles(Number(e.target.value))}
          title="Adjust number of particles (higher = better quality but slower)"
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
