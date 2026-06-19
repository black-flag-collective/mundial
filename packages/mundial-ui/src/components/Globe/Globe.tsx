import './Globe.css';
import * as THREE from 'three';
import { useEffect, useRef } from 'react';

export interface GlobeNation {
  code: string;
  lat: number;
  lon: number;
  /** Marker color (hex string, e.g. confederation color). */
  color: string;
}

export interface GlobeArc {
  /** Endpoint team codes. */
  a: string;
  b: string;
  /** Brightened to full when true; others dim. */
  highlighted?: boolean;
}

export interface GlobeProps {
  /** Nations to place on the globe. */
  nations: GlobeNation[];
  /** Center + highlight a single nation. */
  focusCode?: string | null;
  /** Center + highlight a set of nations (e.g. a standings group). */
  focusCodes?: string[];
  /** Connecting arcs to draw between nations. */
  arcs?: GlobeArc[];
  /** Idle auto-rotation when nothing is focused. Default true. */
  autoRotate?: boolean;
  /** Equirectangular earth texture URL. */
  textureUrl?: string;
  /** Base camera distance. Default 439. */
  zoom?: number;
  /** Fires with the nearest nation code as the cursor moves over the globe (or null). */
  onHoverNation?: (code: string | null) => void;
  className?: string;
}

const DEFAULT_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const R = 100;

function latLonToVec(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}
function faceVec(dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(dir.clone().normalize(), new THREE.Vector3(0, 0, 1));
}
function faceQuat(lat: number, lon: number): THREE.Quaternion {
  return faceVec(latLonToVec(lat, lon, 1));
}

interface Marker { grp: THREE.Group; dot: THREE.Mesh; ring: THREE.Mesh; code: string }

/**
 * Interactive 3D globe of the World Cup nations. Markers are placed by real
 * lat/lon and colored per nation; the cursor raycasts to the nearest nation
 * (`onHoverNation`), `focusCode`/`focusCodes` rotate it to center + highlight,
 * and `arcs` draws connecting lines between fixtures. Idles with a slow spin.
 */
export function Globe({
  nations, focusCode, focusCodes, arcs, autoRotate = true,
  textureUrl = DEFAULT_TEXTURE, zoom = 439, onHoverNation, className
}: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Latest props the RAF loop reads without re-subscribing.
  const live = useRef({ focusCode, focusCodes, arcs, autoRotate, zoom, onHoverNation, nations });
  live.current = { focusCode, focusCodes, arcs, autoRotate, zoom, onHoverNation, nations };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 600;
    const h = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 2000);
    camera.position.set(0, 0, zoom);

    const globe = new THREE.Group();
    globe.rotation.order = 'YXZ';
    scene.add(globe);

    const mat = new THREE.MeshPhongMaterial({ color: 0x16344f, emissive: 0x081826, shininess: 6, specular: 0x0a1a28 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), mat);
    globe.add(sphere);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(textureUrl, (t) => {
      mat.map = t;
      mat.color.set(0xffffff);
      mat.emissive.set(0x0a1422);
      mat.emissiveIntensity = 0.35;
      mat.needsUpdate = true;
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(-1.2, 0.9, 1.8);
    scene.add(dir);

    const arcGroup = new THREE.Group();
    globe.add(arcGroup);

    const markers: Marker[] = [];
    const hitMeshes: THREE.Mesh[] = [];
    nations.forEach((c) => {
      const v = latLonToVec(c.lat, c.lon, R * 1.01);
      const color = new THREE.Color(c.color);
      const grp = new THREE.Group();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 14), new THREE.MeshBasicMaterial({ color }));
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(3.0, 16, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26 })
      );
      grp.add(dot, ring);
      grp.position.copy(v);
      globe.add(grp);

      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(6.5, 10, 10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.position.copy(v);
      hit.userData.code = c.code;
      globe.add(hit);
      hitMeshes.push(hit);
      markers.push({ grp, dot, ring, code: c.code });
    });

    const raycaster = new THREE.Raycaster();
    const codeVec = (code: string) => {
      const n = live.current.nations.find((x) => x.code === code);
      return n ? latLonToVec(n.lat, n.lon, 1) : null;
    };

    // ---- hover (picked on mouse move, not per-frame) ----
    const mouse = { x: -1, y: -1, has: false };
    let hoverCode: string | null = null;
    const pickHover = () => {
      if (!live.current.onHoverNation) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || !mouse.has) return;
      const nx = ((mouse.x - rect.left) / rect.width) * 2 - 1;
      const ny = -((mouse.y - rect.top) / rect.height) * 2 + 1;
      let next: string | null = null;
      if (nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1) {
        globe.updateMatrixWorld();
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const hit = raycaster.intersectObject(sphere, false)[0];
        if (hit) {
          const wp = new THREE.Vector3();
          let bestD = Infinity;
          for (const hm of hitMeshes) {
            hm.getWorldPosition(wp);
            const d = wp.distanceTo(hit.point);
            if (d < bestD) { bestD = d; next = hm.userData.code as string; }
          }
        }
      }
      if (next !== hoverCode) { hoverCode = next; live.current.onHoverNation?.(next); }
    };
    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; pickHover(); };
    const onLeave = () => { mouse.has = false; if (hoverCode !== null) { hoverCode = null; live.current.onHoverNation?.(null); } };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    // ---- arcs ----
    let arcsKey = '';
    const rebuildArcs = () => {
      while (arcGroup.children.length) {
        const c = arcGroup.children.pop() as THREE.Mesh;
        arcGroup.remove(c);
        c.geometry?.dispose();
        (c.material as THREE.Material)?.dispose();
      }
      const list = live.current.arcs ?? [];
      list.forEach((arc, i) => {
        const p1 = codeVec(arc.a)?.multiplyScalar(R * 1.02);
        const p2 = codeVec(arc.b)?.multiplyScalar(R * 1.02);
        if (!p1 || !p2) return;
        const span = p1.distanceTo(p2);
        const mid = p1.clone().add(p2).multiplyScalar(0.5).normalize().multiplyScalar(R * 1.02 + span * 0.45 + 6);
        const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
        const geo = new THREE.TubeGeometry(curve, 44, arc.highlighted ? 1.1 : 0.75, 8, false);
        const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd0a8, transparent: true, opacity: 0.55 }));
        line.userData.i = i;
        arcGroup.add(line);
      });
    };

    // ---- render loop ----
    let idleLon = -70;
    let camZ = zoom;
    let raf = 0;
    globe.quaternion.copy(faceQuat(6, idleLon));

    const loop = () => {
      // resize
      const cw = mount.clientWidth, ch = mount.clientHeight;
      if (cw && ch && (Math.abs(cw - renderer.domElement.clientWidth) > 1 || Math.abs(ch - renderer.domElement.clientHeight) > 1)) {
        renderer.setSize(cw, ch);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
      }

      const lp = live.current;
      const key = JSON.stringify(lp.arcs ?? []);
      if (key !== arcsKey) { arcsKey = key; rebuildArcs(); }
      arcGroup.visible = (lp.arcs?.length ?? 0) > 0;

      const t = performance.now() * 0.003;
      const focus = hoverCode ? [hoverCode] : (lp.focusCode ? [lp.focusCode] : (lp.focusCodes ?? []));
      const base = lp.zoom ?? 439;

      let targetQ: THREE.Quaternion;
      let targetZ = base;
      if (focus.length) {
        const vecs = focus.map(codeVec).filter(Boolean) as THREE.Vector3[];
        let mid = vecs.reduce((a, v) => a.add(v), new THREE.Vector3());
        if (mid.length() < 1e-4) mid = vecs[0]?.clone() ?? new THREE.Vector3(0, 0, 1);
        targetQ = faceVec(mid);
        targetZ = vecs.length >= 2
          ? Math.max(base, Math.min(base + 108, base + vecs[0].angleTo(vecs[1]) * 110))
          : base - 50;
      } else {
        if (lp.autoRotate !== false) idleLon += 0.12;
        targetQ = faceQuat(6, idleLon);
      }
      globe.quaternion.slerp(targetQ, 0.08);
      camZ += (targetZ - camZ) * 0.08;
      camera.position.z = camZ;

      const focusSet = new Set(focus);
      for (const m of markers) {
        const on = focusSet.has(m.code);
        const pulse = 1 + Math.sin(t) * 0.12;
        m.ring.scale.setScalar((on ? 2.3 : 1) * pulse);
        (m.ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.6 : (focusSet.size ? 0.06 : 0.24);
        m.dot.scale.setScalar(on ? 1.9 : 1);
      }
      arcGroup.children.forEach((ln) => {
        const arc = (lp.arcs ?? [])[(ln as THREE.Mesh).userData.i as number];
        const anyHi = (lp.arcs ?? []).some((a) => a.highlighted);
        ((ln as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = anyHi ? (arc?.highlighted ? 0.95 : 0.06) : 0.5;
      });

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.dispose();
      mat.map?.dispose();
      mat.dispose();
      sphere.geometry.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // Build once; prop changes flow through the `live` ref + per-frame reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className={['mun-globe', className].filter(Boolean).join(' ')} />;
}
