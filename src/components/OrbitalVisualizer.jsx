import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import createModule from "../wasm/orbitals.js";
import "./OrbitalVisualizer.css";

const OrbitalVisualizer = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const cameraRef = useRef(null);
  const particlesRef = useRef(null);
  const controlsRef = useRef(null);
  const axesRef = useRef(null);

  const wasmRef = useRef(null);
  const timeRef = useRef(0);

  const [orbital, setOrbital] = useState({ n: 1, l: 0, m: 0 });
  const [numParticles, setNumParticles] = useState(120000);
  const [isRotating, setIsRotating] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

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

  const generateWASMParticles = () => {
    const Module = wasmRef.current;
    if (!Module) return null;

    const count = numParticles;
    const floats = count * 3;
    const bytes = floats * 4;

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

  const generateCloud = () => {
    if (!sceneRef.current || !wasmRef.current) return;

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
        <h1>Hydrogen Orbital Visualizer (WASM · SIMD · Threads)</h1>

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

        <label>Particles: {numParticles.toLocaleString()}</label>
        <input
          type="range"
          min="20000"
          max="300000"
          step="20000"
          value={numParticles}
          onChange={(e) => setNumParticles(Number(e.target.value))}
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
