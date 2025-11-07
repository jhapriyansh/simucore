import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import "./OrbitalVisualizer.css";

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

  const [orbital, setOrbital] = useState({ n: 1, l: 0, m: 0 });
  const [numParticles, setNumParticles] = useState(50000);
  const [isRotating, setIsRotating] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

  const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

  const associatedLegendre = (l, m, x) => {
    const a = Math.abs(m);
    if (l === 0) return 1;
    if (l === 1) return a === 0 ? x : -Math.sqrt(1 - x * x);
    if (l === 2) {
      if (a === 0) return 0.5 * (3 * x * x - 1);
      if (a === 1) return -3 * x * Math.sqrt(1 - x * x);
      if (a === 2) return 3 * (1 - x * x);
    }
    if (l === 3) {
      if (a === 0) return 0.5 * x * (5 * x * x - 3);
      if (a === 1) return -1.5 * (5 * x * x - 1) * Math.sqrt(1 - x * x);
      if (a === 2) return 15 * x * (1 - x * x);
      if (a === 3) return -15 * Math.pow(1 - x * x, 1.5);
    }
    return 1;
  };

  // ✅ Time-evolving spherical harmonic (rotation)
  const sphericalHarmonic = (l, m, theta, phi, t) => {
    const absM = Math.abs(m);

    // Apply time evolution: φ → φ + m * ω * t
    const omega = 0.8; // rotation speed
    phi += m * omega * t;

    const norm = Math.sqrt(
      ((2 * l + 1) * factorial(l - absM)) / (4 * Math.PI * factorial(l + absM))
    );
    const P = associatedLegendre(l, absM, Math.cos(theta));

    const phase =
      m > 0 ? Math.cos(absM * phi) : m < 0 ? Math.sin(absM * phi) : 1;

    return norm * P * (absM === 0 ? phase : phase * Math.sqrt(2));
  };

  const laguerre = (p, a, x) => {
    if (p === 0) return 1;
    if (p === 1) return 1 + a - x;
    let L0 = 1,
      L1 = 1 + a - x,
      Ln;
    for (let k = 2; k <= p; k++) {
      Ln = ((2 * k - 1 + a - x) * L1 - (k - 1 + a) * L0) / k;
      L0 = L1;
      L1 = Ln;
    }
    return Ln;
  };

  const radial = (n, l, r) =>
    Math.sqrt(
      (Math.pow(2 / n, 3) * factorial(n - l - 1)) / (2 * n * factorial(n + l))
    ) *
    Math.exp(-r / n) *
    Math.pow((2 * r) / n, l) *
    laguerre(n - l - 1, 2 * l + 1, (2 * r) / n);

  const wave = (n, l, m, r, t, p, time) => {
    const psi = radial(n, l, r) * sphericalHarmonic(l, m, t, p, time);
    return { prob: r * r * psi * psi, sign: psi >= 0 ? 1 : -1 };
  };

  const generateParticles = (n, l, m, count) => {
    const pos = [],
      col = [];
    const Rmax = n * n * 3;
    const maxProb = 0.002;
    const time = timeRef.current;

    while (pos.length < count * 3) {
      const r = Math.random() * Rmax;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      const { prob, sign } = wave(n, l, m, r, theta, phi, time);

      if (Math.random() < prob / maxProb) {
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.sin(theta) * Math.sin(phi);
        const z = r * Math.cos(theta);
        pos.push(x, y, z);
        col.push(sign > 0 ? 0.3 : 1.0, 0.2, sign > 0 ? 1.0 : 0.3);
      }
    }

    return {
      positions: new Float32Array(pos),
      colors: new Float32Array(col),
    };
  };

  // ✅ Scene setup once
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
  }, []);

  // ✅ Recompute particle cloud on orbital or count change
  useEffect(() => {
    if (!sceneRef.current) return;
    if (particlesRef.current) sceneRef.current.remove(particlesRef.current);

    const { positions, colors } = generateParticles(
      orbital.n,
      orbital.l,
      orbital.m,
      numParticles
    );

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

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
  }, [orbital, numParticles]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = isRotating;
  }, [isRotating]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  // ✅ Now including full f-orbitals
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
        <h1>Hydrogen Orbital Visualizer</h1>

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
