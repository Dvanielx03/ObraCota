import * as T from "three";

/**
 * Full-screen look-around of a 2:1 equirectangular picture («Panorama 360° con IA»): the image lines the inside
 * of a sphere, a drag turns the view, the wheel narrows or widens the field of view and the arrow keys turn too.
 * It is a separate renderer, so the model's viewer keeps its own state underneath.
 */
export function panoramaSphere(container: HTMLElement, url: string, onReady: () => void, onError: () => void) {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Panorama 360°. Arrastra o usa las flechas para mirar alrededor y la rueda para acercar.");
  container.appendChild(canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(75, 1, .1, 1100);
  const geometry = new T.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1);
  const material = new T.MeshBasicMaterial({ color: 0x222222 });
  scene.add(new T.Mesh(geometry, material));
  let lon = 0, lat = 0, disposed = false, frame = 0;
  let pointer: { id: number; x: number; y: number } | null = null;
  const target = new T.Vector3();
  function draw() {
    if (disposed) return;
    lat = T.MathUtils.clamp(lat, -85, 85);
    const phi = T.MathUtils.degToRad(90 - lat), theta = T.MathUtils.degToRad(lon);
    target.setFromSphericalCoords(1, phi, theta);
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }
  function resize() {
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    schedule();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  new T.TextureLoader().load(url, (texture) => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = T.SRGBColorSpace;
    material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
    container.dataset.loaded = "";
    schedule(); onReady();
  }, undefined, () => { if (!disposed) onError(); });
  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    canvas.focus(); canvas.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function move(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    const k = camera.fov / Math.max(container.clientHeight, 1);
    lon -= (event.clientX - pointer.x) * k; lat += (event.clientY - pointer.y) * k;
    pointer.x = event.clientX; pointer.y = event.clientY;
    schedule();
  }
  function up(event: PointerEvent) { if (pointer?.id === event.pointerId) pointer = null; }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    camera.fov = T.MathUtils.clamp(camera.fov + Math.sign(event.deltaY) * 4, 30, 100);
    camera.updateProjectionMatrix(); schedule();
  }
  function key(event: KeyboardEvent) {
    const turn: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
    const step = turn[event.key];
    if (!step) return;
    event.preventDefault();
    lon += step[0]; lat += step[1]; schedule();
  }
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("keydown", key);
  resize();
  return {
    canvas,
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("keydown", key);
      material.map?.dispose(); material.dispose(); geometry.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}
