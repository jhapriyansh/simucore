import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import "./OrbitalVisualizer.css";

const OrbitalVisualizer = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const particlesRef = useRef(null);
  const nucleusRef = useRef(null);
  const axesRef = useRef(null);
  const animationIdRef = useRef(null);

  const [orbital, setOrbital] = useState({ n: 1, l: 0, m: 0 });
  const [numParticles, setNumParticles] = useState(50000);
  const [isRotating, setIsRotating] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

  // Factorial function
  const factorial = (n) => {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
  };

  // Associated Legendre polynomial
  const associatedLegendre = (l, m, x) => {
    const absM = Math.abs(m);
    if (l === 0) return 1;
    if (l === 1) {
      if (absM === 0) return x;
      if (absM === 1) return -Math.sqrt(1 - x * x);
    }
    if (l === 2) {
      if (absM === 0) return 0.5 * (3 * x * x - 1);
      if (absM === 1) return -3 * x * Math.sqrt(1 - x * x);
      if (absM === 2) return 3 * (1 - x * x);
    }
    if (l === 3) {
      if (absM === 0) return 0.5 * x * (5 * x * x - 3);
      if (absM === 1) return -1.5 * (5 * x * x - 1) * Math.sqrt(1 - x * x);
      if (absM === 2) return 15 * x * (1 - x * x);
      if (absM === 3) return -15 * Math.pow(1 - x * x, 1.5);
    }
    return 1;
  };

  // Spherical harmonic
  const sphericalHarmonic = (l, m, theta, phi) => {
    const absM = Math.abs(m);
    const normalization = Math.sqrt(
      ((2 * l + 1) * factorial(l - absM)) / (4 * Math.PI * factorial(l + absM))
    );
    const legendre = associatedLegendre(l, absM, Math.cos(theta));

    // For real spherical harmonics:
    // m > 0: use cos(m*phi)
    // m < 0: use sin(|m|*phi)
    // m = 0: no phi dependence
    let angularPart;
    if (m > 0) {
      angularPart = Math.sqrt(2) * Math.cos(m * phi);
    } else if (m < 0) {
      angularPart = Math.sqrt(2) * Math.sin(absM * phi);
    } else {
      angularPart = 1;
    }

    return normalization * legendre * angularPart;
  };

  // Generalized Laguerre polynomial - IMPROVED
  const generalizedLaguerre = (n, alpha, x) => {
    if (n === 0) return 1;
    if (n === 1) return 1 + alpha - x;

    let L0 = 1;
    let L1 = 1 + alpha - x;
    let Ln = 0;

    for (let k = 2; k <= n; k++) {
      Ln = ((2 * k - 1 + alpha - x) * L1 - (k - 1 + alpha) * L0) / k;
      L0 = L1;
      L1 = Ln;
    }
    return Ln;
  };

  // Radial wave function for hydrogen - IMPROVED
  const radialWavefunction = (n, l, r) => {
    const a0 = 1; // Bohr radius (normalized to 1)
    const rho = (2 * r) / (n * a0);

    // Avoid numerical issues
    if (rho > 50) return 0;

    const normalization = Math.sqrt(
      (Math.pow(2 / (n * a0), 3) * factorial(n - l - 1)) /
        (2 * n * factorial(n + l))
    );

    const laguerre = generalizedLaguerre(n - l - 1, 2 * l + 1, rho);
    const exponential = Math.exp(-rho / 2);
    const polynomial = Math.pow(rho, l);

    return normalization * exponential * polynomial * laguerre;
  };

  // Calculate probability density at a point - IMPROVED
  const probabilityDensity = (n, l, m, r, theta, phi) => {
    // Avoid singularity at r=0 for l>0
    if (r < 0.001 && l > 0) return 0;

    const R = radialWavefunction(n, l, r);
    const Y = sphericalHarmonic(l, m, theta, phi);
    const psi = R * Y;

    // Include r^2 for volume element and take absolute value
    return r * r * Math.abs(psi * psi);
  };

  // Generate particles based on probability density
  const generateParticles = (n, l, m, count) => {
    const positions = [];
    const maxRadius = n * n * 3; // Scale with quantum number

    // Rejection sampling
    let attempts = 0;
    const maxAttempts = count * 100;

    while (positions.length < count * 3 && attempts < maxAttempts) {
      attempts++;

      // Sample random point in spherical coordinates
      const r = Math.random() * maxRadius;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * 2 * Math.PI;

      // Calculate probability density
      const prob = probabilityDensity(n, l, m, r, theta, phi);
      const weight = prob * 500; // scale sampling yield
      if (Math.random() < weight) {
        // Convert to Cartesian coordinates
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.sin(theta) * Math.sin(phi);
        const z = r * Math.cos(theta);

        positions.push(x, y, z);
      }
    }

    return new Float32Array(positions);
  };

  useEffect(() => {
    if (!mountRef.current || sceneRef.current) return; // Prevent multiple scene setups

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(15, 15, 15);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(
      mountRef.current.clientWidth,
      mountRef.current.clientHeight
    );
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add nucleus (small bright sphere)
    const nucleusGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const nucleusMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      transparent: true,
      opacity: 0.9,
    });
    const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
    scene.add(nucleus);
    nucleusRef.current = nucleus;

    // Add axes - SINGLE SET ONLY
    const axesGroup = new THREE.Group();
    const axisLength = 20;

    // X axis - Red
    const xAxis = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      axisLength,
      0xff0000,
      2,
      1
    );
    axesGroup.add(xAxis);

    // Y axis - Green
    const yAxis = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      axisLength,
      0x00ff00,
      2,
      1
    );
    axesGroup.add(yAxis);

    // Z axis - Blue
    const zAxis = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      axisLength,
      0x0000ff,
      2,
      1
    );
    axesGroup.add(zAxis);

    scene.add(axesGroup);
    axesRef.current = axesGroup;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Mouse controls for rotation
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const onMouseDown = (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        camera.position.applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          deltaX * 0.01
        );

        const axis = new THREE.Vector3(1, 0, 0);
        axis.applyQuaternion(camera.quaternion);
        camera.position.applyAxisAngle(axis, deltaY * 0.01);

        camera.lookAt(0, 0, 0);
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseup", onMouseUp);

    // Mouse wheel for zoom
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9;
      camera.position.multiplyScalar(delta);
    };
    renderer.domElement.addEventListener("wheel", onWheel);

    // Animation loop setup only
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect =
        mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(
        mountRef.current.clientWidth,
        mountRef.current.clientHeight
      );
    };
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      if (sceneRef.current) {
        // Clean up all objects in the scene
        while (sceneRef.current.children.length > 0) {
          const object = sceneRef.current.children[0];
          sceneRef.current.remove(object);
          if (object.geometry) object.geometry.dispose();
          if (object.material) object.material.dispose();
        }
      }
      renderer.dispose();
      // Clear all refs
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      particlesRef.current = null;
      nucleusRef.current = null;
      axesRef.current = null;
    };
  }, []); // Only run once on mount

  // Update particles when orbital changes
  useEffect(() => {
    if (!sceneRef.current) return;

    // Remove old particles
    if (particlesRef.current) {
      sceneRef.current.remove(particlesRef.current);
      particlesRef.current.geometry.dispose();
      particlesRef.current.material.dispose();
    }

    // Generate new particles
    console.log("Generating particles for orbital:", orbital);
    const positions = generateParticles(
      orbital.n,
      orbital.l,
      orbital.m,
      numParticles
    );
    console.log("Generated", positions.length / 3, "particles");

    // Create particle system
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x4488ff,
      size: 0.05,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    sceneRef.current.add(particles);
    particlesRef.current = particles;
  }, [orbital, numParticles]);

  // Handle rotation separately
  useEffect(() => {
    if (!particlesRef.current) return;

    const animate = () => {
      if (isRotating) {
        particlesRef.current.rotation.y += 0.002;
      }
    };

    const animationFrame = setInterval(animate, 16); // roughly 60fps

    return () => clearInterval(animationFrame);
  }, [isRotating]);

  // Update axes visibility
  useEffect(() => {
    if (axesRef.current) {
      axesRef.current.visible = showAxes;
    }
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
  ];

  return (
    <div className="visualizer-container">
      <div className="controls-panel">
        <h1>Hydrogen Orbital Visualizer</h1>

        <div className="controls-grid">
          <div className="control-group">
            <label className="control-label">Orbital Selection</label>
            <select
              value={JSON.stringify(orbital)}
              onChange={(e) => setOrbital(JSON.parse(e.target.value))}
            >
              {orbitalConfigs.map((config) => (
                <option
                  key={`${config.n}-${config.l}-${config.m}`}
                  value={JSON.stringify(config)}
                >
                  {config.name}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label className="control-label">
              Particles: {numParticles.toLocaleString()}
            </label>
            <input
              type="range"
              min="10000"
              max="100000"
              step="10000"
              value={numParticles}
              onChange={(e) => setNumParticles(Number(e.target.value))}
              className="control-range"
            />
          </div>

          <div className="control-group">
            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={isRotating}
                onChange={(e) => setIsRotating(e.target.checked)}
              />
              <span>Auto-rotate</span>
            </label>
          </div>

          <div className="control-group">
            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={showAxes}
                onChange={(e) => setShowAxes(e.target.checked)}
              />
              <span>Show axes</span>
            </label>
          </div>
        </div>

        <div className="info-panel">
          <p>
            <strong>Quantum Numbers:</strong> n={orbital.n}, l={orbital.l}, m=
            {orbital.m}
          </p>
          <p className="info-small">
            Red sphere: Nucleus | Blue dots: Electron probability density
          </p>
          <p className="info-small">
            Axes: Red=X, Green=Y, Blue=Z | Drag to rotate | Scroll to zoom
          </p>
        </div>
      </div>

      <div ref={mountRef} className="canvas-container" />
    </div>
  );
};

export default OrbitalVisualizer;
