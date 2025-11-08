import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import "./OrbitalVisualizer.css";

import createOrbitalsModule from "../wasm/orbitals.js";

const OrbitalVisualizer = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const controlsRef = useRef(null);
  const axesRef = useRef(null);
  const particlesRef = useRef(null);
  const timeRef = useRef(0);

  const wasmRef = useRef(null);
  const genRef = useRef(null);

  const [orbital, setOrbital] = useState({ n: 1, l: 0, m: 0 });
  const [numParticles, setNumParticles] = useState(40000);
  const [isRotating, setIsRotating] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

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

  // Load WASM
  useEffect(() => {
    let cancel = false;

    (async () => {
      const mod = await createOrbitalsModule({
        locateFile: (file) => new URL(`../wasm/${file}`, import.meta.url).href,
      });
      if (cancel) return;

      wasmRef.current = mod;

      genRef.current = mod.cwrap("generate_particles", "number", [
        "number", // pos ptr
        "number", // col ptr
        "number", // count
        "number", // n
        "number", // l
        "number", // m
        "number", // time
        "number", // maxProb
        "number", // rMax
      ]);

      console.log("✅ WASM SIMD Ready");

      if (sceneRef.current) buildCloud();
    })();

    return () => {
      cancel = true;
    };
  }, []);

  // Scene setup
  useEffect(() => {
    if (!mountRef.current || sceneRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);
    sceneRef.current = scene;

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

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new UnrealBloomPass(new THREE.Vector3(1, 1, 1), 1.2, 0.4, 0.85)
    );
    composerRef.current = composer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = isRotating;
    controls.autoRotateSpeed = 0.9;
    controlsRef.current = controls;

    const axes = new THREE.AxesHelper(8);
    scene.add(axes);
    axesRef.current = axes;

    const animate = () => {
      timeRef.current += 0.01;
      controls.update();
      composer.render();
      requestAnimationFrame(animate);
    };
    animate();

    if (wasmRef.current) buildCloud();
  }, []);

  // Rebuild when params change
  useEffect(() => buildCloud(), [orbital, numParticles]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = isRotating;
  }, [isRotating]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  const generateParticlesWASM = () => {
    if (!wasmRef.current || !genRef.current) return null;

    const mod = wasmRef.current;
    const count = numParticles;
    const floats = count * 3;
    const bytes = floats * 4;

    const posPtr = mod._malloc(bytes);
    const colPtr = mod._malloc(bytes);

    const written = genRef.current(
      posPtr,
      colPtr,
      count,
      orbital.n,
      orbital.l,
      orbital.m,
      timeRef.current,
      0.0008,
      orbital.n * orbital.n * 3
    );

    const posView = new Float32Array(mod.HEAPF32.buffer, posPtr, written * 3);
    const colView = new Float32Array(mod.HEAPF32.buffer, colPtr, written * 3);

    const positions = new Float32Array(posView);
    const colors = new Float32Array(colView);

    mod._free(posPtr);
    mod._free(colPtr);

    return { positions, colors };
  };

  const buildCloud = () => {
    if (!sceneRef.current) return;

    if (particlesRef.current) {
      sceneRef.current.remove(particlesRef.current);
      particlesRef.current.geometry.dispose();
      particlesRef.current.material.dispose();
      particlesRef.current = null;
    }

    const result = generateParticlesWASM();
    if (!result) return;
    const { positions, colors } = result;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const pts = new THREE.Points(geo, mat);
    sceneRef.current.add(pts);
    particlesRef.current = pts;
  };

  return (
    <div className="visualizer-container">
      <div className="controls-panel">
        <h1>Hydrogen Orbital Visualizer (WASM + SIMD)</h1>

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
          onChange={(e) => setNumParticles(Number(e.target.value))}
        />

        <label>
          <input
            type="checkbox"
            checked={isRotating}
            onChange={(e) => setIsRotating(e.target.checked)}
          />{" "}
          Auto Rotate
        </label>
        <label>
          <input
            type="checkbox"
            checked={showAxes}
            onChange={(e) => setShowAxes(e.target.checked)}
          />{" "}
          Show Axes
        </label>
      </div>

      <div ref={mountRef} className="canvas-container" />
    </div>
  );
};

export default OrbitalVisualizer;
