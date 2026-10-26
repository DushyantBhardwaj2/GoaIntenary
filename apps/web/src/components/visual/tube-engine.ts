import * as THREE from 'three';

export interface TubeScene {
  resize(width: number, height: number): void;
  setActive(active: boolean): void;
  point(x: number, y: number): void;
  release(): void;
  cycle(): void;
  dispose(): void;
}

/** Original coastal tube geometry. Loaded only after visibility/motion checks. */
export function createTubeScene(canvas: HTMLCanvasElement, colors: readonly string[], onFailure: () => void): TubeScene | null {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!context) return null;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: false, powerPreference: 'low-power' }); }
  catch { context.getExtension('WEBGL_lose_context')?.loseContext(); return null; }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
  camera.position.set(0, 0, 9);
  scene.add(new THREE.HemisphereLight('#fff5dd', '#173f35', 3.2));
  const light = new THREE.DirectionalLight('#fff5df', 4);
  light.position.set(-3, 5, 7);
  scene.add(light);
  const rim = new THREE.DirectionalLight('#de6c4e', 2.8);
  rim.position.set(5, -2, 4);
  scene.add(rim);

  const rings = 48, sides = 8;
  const tubes = Array.from({ length: 4 }, (_, tubeIndex) => {
    const points = Array.from({ length: rings + 1 }, (_, index) => new THREE.Vector3(
      3 - index * 0.13, Math.sin(index * 0.11 + tubeIndex) * 1.1, Math.cos(index * 0.13 + tubeIndex) * 0.55,
    ));
    const positions = new Float32Array((rings + 1) * (sides + 1) * 3);
    const normals = new Float32Array(positions.length);
    const indices: number[] = [];
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
      const a = ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({ color: colors[tubeIndex % colors.length], metalness: 0.38, roughness: 0.35 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { points, geometry, material, positions, normals, radius: 0.095 + tubeIndex * 0.018 };
  });
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();
  const target = new THREE.Vector3(), guide = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  let aspect = 1, pointerX = 0, pointerY = 0, pointing = false, disposed = false, active = false;
  let frame = 0, previous = 0, paletteOffset = 0;

  function updateGeometry(tube: typeof tubes[number]) {
    for (let ring = 0; ring <= rings; ring++) {
      const center = tube.points[ring];
      tangent.subVectors(tube.points[Math.min(rings, ring + 1)], tube.points[Math.max(0, ring - 1)]);
      if (tangent.lengthSq() < 0.000001) tangent.set(1, 0, 0);
      tangent.normalize();
      up.set(0, Math.abs(tangent.z) > 0.95 ? 1 : 0, Math.abs(tangent.z) > 0.95 ? 0 : 1);
      normal.crossVectors(tangent, up).normalize();
      binormal.crossVectors(tangent, normal).normalize();
      const radius = tube.radius * Math.pow(Math.sin(Math.PI * ring / rings), 0.45);
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
        const nx = c * normal.x + s * binormal.x, ny = c * normal.y + s * binormal.y, nz = c * normal.z + s * binormal.z;
        const index = (ring * (sides + 1) + side) * 3;
        tube.positions[index] = center.x + nx * radius;
        tube.positions[index + 1] = center.y + ny * radius;
        tube.positions[index + 2] = center.z + nz * radius;
        tube.normals[index] = nx; tube.normals[index + 1] = ny; tube.normals[index + 2] = nz;
      }
    }
    tube.geometry.attributes.position.needsUpdate = true;
    tube.geometry.attributes.normal.needsUpdate = true;
  }

  function tick(now: number) {
    if (!active || disposed) return;
    frame = requestAnimationFrame(tick);
    if (now - previous < 1000 / 30) return;
    const dt = Math.min((now - (previous || now - 33)) / 1000, 0.06);
    previous = now;
    const elapsed = now / 1000;
    target.set(pointing ? pointerX * aspect * 3.2 : Math.sin(elapsed * 0.18) * aspect * 2.2,
      pointing ? pointerY * 3 : Math.cos(elapsed * 0.23) * 1.3, 0);
    for (let index = 0; index < tubes.length; index++) {
      const tube = tubes[index];
      guide.copy(target);
      guide.x += Math.sin(elapsed * 0.5 + index * 1.7) * 0.45;
      guide.y += Math.cos(elapsed * 0.4 + index) * 0.42;
      guide.z = Math.sin(elapsed * 0.35 + index) * 0.7;
      tube.points[0].lerp(guide, 1 - Math.exp(-dt * 4.5));
      for (let ring = 1; ring <= rings; ring++) tube.points[ring].lerp(tube.points[ring - 1], 1 - Math.exp(-dt * (12 - index)));
      updateGeometry(tube);
    }
    try { renderer.render(scene, camera); }
    catch { api.dispose(); onFailure(); }
  }

  const api: TubeScene = {
    resize(width, height) {
      if (disposed || width <= 0 || height <= 0) return;
      aspect = width / height;
      camera.aspect = aspect; camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
    },
    setActive(value) {
      if (disposed || value === active) return;
      active = value;
      if (active) { previous = 0; frame = requestAnimationFrame(tick); }
      else { cancelAnimationFrame(frame); frame = 0; }
    },
    point(x, y) { pointerX = x; pointerY = y; pointing = true; },
    release() { pointing = false; },
    cycle() {
      paletteOffset = (paletteOffset + 1) % colors.length;
      tubes.forEach((tube, index) => tube.material.color.set(colors[(index + paletteOffset) % colors.length]));
    },
    dispose() {
      if (disposed) return;
      disposed = true; active = false; cancelAnimationFrame(frame);
      for (const tube of tubes) { tube.geometry.dispose(); tube.material.dispose(); }
      scene.clear(); renderer.dispose();
      if (!context.isContextLost()) renderer.forceContextLoss();
    },
  };
  return api;
}
