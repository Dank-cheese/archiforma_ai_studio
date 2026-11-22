/**
 * 3D MODEL OF A BLOCK (built here so the 3D view's render cache can reuse it).
 *
 * Local frame (three.js): x = block width (centred), y = up from the block's floor, z = plan +y.
 * The caller positions / rotates the returned group.
 *   - library components (libKind)  → parametric models in library3d.ts
 *   - starter kinds (bed, sofa, …)  → simple parametric furniture below
 *   - custom blocks                 → rectangles / circles of the 2D symbol as full-height solids
 */
import * as THREE from 'three';
import type { BlockDefinition } from '../types/model';
import { buildLibrary3D } from './library3d';

export interface Block3DOptions {
  selected?: boolean;
  shadows?: boolean;
  chimneyTop?: number;
  ceiling?: number;
}

export function buildBlock3D(
  blockDef: BlockDefinition | undefined,
  w: number,
  d: number,
  h: number,
  color: string,
  opts: Block3DOptions = {},
): { group: THREE.Group; meshes: THREE.Mesh[] } {
  const o = { selected: !!opts.selected, shadows: !!opts.shadows, chimneyTop: opts.chimneyTop, ceiling: opts.ceiling };
  const isSelected = o.selected;
  const kind = blockDef?.kind ?? 'custom';
  const localMeshes: THREE.Mesh[] = [];
  const baseColor = new THREE.Color(
    isSelected ? '#f59e0b' : color || '#0d9488'
  );
  const primaryMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.55,
    metalness: 0.08,
  });
  const lightAccentMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xfde68a : 0xf5f5f4,
    roughness: 0.65,
    metalness: 0.05,
  });
  const darkAccentMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xb45309 : 0x334155,
    roughness: 0.4,
    metalness: 0.35,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xd97706 : 0x78350f,
    roughness: 0.65,
    metalness: 0.05,
  });

  const compGroup = new THREE.Group();

  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    px: number,
    py: number,
    pz: number
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    mesh.castShadow = o.shadows;
    mesh.receiveShadow = true;
    compGroup.add(mesh);
    localMeshes.push(mesh);
    return mesh;
  };

  if (blockDef?.libKind) {
    const built = buildLibrary3D(blockDef.libKind, w, d, h, color || blockDef.color, { selected: isSelected, shadows: o.shadows, chimneyTop: o.chimneyTop, ceiling: o.ceiling });
    compGroup.add(built.group);
    localMeshes.push(...built.meshes);
  } else if (kind === 'bed') {
    addPart(
      new THREE.BoxGeometry(w, h * 0.32, d),
      woodMat,
      0,
      h * 0.16,
      0
    );
    addPart(
      new THREE.BoxGeometry(w, h, Math.max(3, d * 0.07)),
      woodMat,
      0,
      h * 0.5,
      -d * 0.465
    );
    addPart(
      new THREE.BoxGeometry(w * 0.94, h * 0.28, d * 0.88),
      lightAccentMat,
      0,
      h * 0.44,
      d * 0.03
    );
    addPart(
      new THREE.BoxGeometry(w * 0.95, h * 0.29, d * 0.56),
      primaryMat,
      0,
      h * 0.45,
      d * 0.19
    );
    addPart(
      new THREE.BoxGeometry(w * 0.36, h * 0.12, d * 0.18),
      lightAccentMat,
      -w * 0.22,
      h * 0.62,
      -d * 0.28
    );
    addPart(
      new THREE.BoxGeometry(w * 0.36, h * 0.12, d * 0.18),
      lightAccentMat,
      w * 0.22,
      h * 0.62,
      -d * 0.28
    );
  } else if (kind === 'sofa') {
    addPart(
      new THREE.BoxGeometry(w, h * 0.42, d),
      primaryMat,
      0,
      h * 0.21,
      0
    );
    addPart(
      new THREE.BoxGeometry(w, h * 0.58, d * 0.24),
      primaryMat,
      0,
      h * 0.71,
      -d * 0.38
    );
    addPart(
      new THREE.BoxGeometry(w * 0.11, h * 0.34, d),
      primaryMat,
      -w * 0.445,
      h * 0.59,
      0
    );
    addPart(
      new THREE.BoxGeometry(w * 0.11, h * 0.34, d),
      primaryMat,
      w * 0.445,
      h * 0.59,
      0
    );
  } else if (kind === 'table-chairs') {
    const tw = w * 0.68;
    const td = d * 0.58;
    addPart(
      new THREE.BoxGeometry(tw, h * 0.08, td),
      primaryMat,
      0,
      h * 0.96,
      0
    );
    const legW = Math.max(1.5, w * 0.03);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addPart(
          new THREE.BoxGeometry(legW, h * 0.92, legW),
          woodMat,
          sx * (tw * 0.44),
          h * 0.46,
          sz * (td * 0.42)
        );
      }
    }
    const chairSeatH = h * 0.55;
    for (const sz of [-1, 1]) {
      addPart(
        new THREE.BoxGeometry(w * 0.22, h * 0.06, d * 0.16),
        woodMat,
        0,
        chairSeatH,
        sz * (d * 0.41)
      );
      addPart(
        new THREE.BoxGeometry(w * 0.22, h * 0.45, d * 0.04),
        woodMat,
        0,
        chairSeatH + h * 0.22,
        sz * (d * 0.48)
      );
    }
    for (const sx of [-1, 1]) {
      addPart(
        new THREE.BoxGeometry(w * 0.16, h * 0.06, d * 0.22),
        woodMat,
        sx * (w * 0.41),
        chairSeatH,
        0
      );
      addPart(
        new THREE.BoxGeometry(w * 0.04, h * 0.45, d * 0.22),
        woodMat,
        sx * (w * 0.48),
        chairSeatH + h * 0.22,
        0
      );
    }
  } else if (kind === 'toilet') {
    addPart(
      new THREE.BoxGeometry(w * 0.92, h * 0.58, d * 0.32),
      primaryMat,
      0,
      h * 0.71,
      -d * 0.34
    );
    addPart(
      new THREE.BoxGeometry(w * 0.65, h * 0.48, d * 0.75),
      primaryMat,
      0,
      h * 0.24,
      -d * 0.05
    );
    addPart(
      new THREE.CylinderGeometry(w * 0.42, w * 0.34, h * 0.52, 16),
      lightAccentMat,
      0,
      h * 0.26,
      d * 0.14
    );
  } else if (kind === 'sink') {
    addPart(
      new THREE.BoxGeometry(w, h * 0.88, d),
      primaryMat,
      0,
      h * 0.44,
      0
    );
    addPart(
      new THREE.BoxGeometry(w * 1.03, h * 0.12, d * 1.03),
      lightAccentMat,
      0,
      h * 0.94,
      0
    );
    addPart(
      new THREE.CylinderGeometry(
        Math.min(w, d) * 0.3,
        Math.min(w, d) * 0.25,
        2,
        16
      ),
      darkAccentMat,
      0,
      h + 0.5,
      d * 0.05
    );
    addPart(
      new THREE.BoxGeometry(1.5, 5, 4),
      darkAccentMat,
      0,
      h + 2.5,
      -d * 0.28
    );
  } else if (kind === 'bathtub') {
    addPart(
      new THREE.BoxGeometry(w, h, d),
      primaryMat,
      0,
      h * 0.5,
      0
    );
    addPart(
      new THREE.BoxGeometry(w * 0.86, h * 0.08, d * 0.78),
      lightAccentMat,
      0,
      h * 0.98,
      0
    );
    addPart(
      new THREE.BoxGeometry(3, 5, 3),
      darkAccentMat,
      -w * 0.42,
      h + 2.5,
      0
    );
  } else if (kind === 'kitchen-counter') {
    addPart(
      new THREE.BoxGeometry(w, h * 0.9, d),
      primaryMat,
      0,
      h * 0.45,
      0
    );
    addPart(
      new THREE.BoxGeometry(w * 1.02, h * 0.1, d * 1.04),
      lightAccentMat,
      0,
      h * 0.95,
      0
    );
    addPart(
      new THREE.BoxGeometry(w * 0.24, 1.5, d * 0.58),
      darkAccentMat,
      -w * 0.14,
      h + 0.4,
      0.04 * d
    );
    addPart(
      new THREE.BoxGeometry(w * 0.24, 1.5, d * 0.58),
      darkAccentMat,
      w * 0.14,
      h + 0.4,
      0.04 * d
    );
  } else if (kind === 'fridge') {
    addPart(
      new THREE.BoxGeometry(w, h, d * 0.92),
      primaryMat,
      0,
      h * 0.5,
      -d * 0.04
    );
    addPart(
      new THREE.BoxGeometry(w * 0.48, h * 0.96, d * 0.08),
      lightAccentMat,
      -w * 0.25,
      h * 0.5,
      d * 0.46
    );
    addPart(
      new THREE.BoxGeometry(w * 0.48, h * 0.96, d * 0.08),
      lightAccentMat,
      w * 0.25,
      h * 0.5,
      d * 0.46
    );
  } else if (kind === 'stove') {
    addPart(
      new THREE.BoxGeometry(w, h * 0.92, d),
      primaryMat,
      0,
      h * 0.46,
      0
    );
    addPart(
      new THREE.BoxGeometry(w, h * 0.18, d * 0.14),
      darkAccentMat,
      0,
      h * 1.01,
      -d * 0.43
    );
    const br = Math.min(w, d) * 0.13;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addPart(
          new THREE.CylinderGeometry(br, br, 1.2, 16),
          darkAccentMat,
          sx * (w * 0.26),
          h * 0.93,
          sz * (d * 0.22)
        );
      }
    }
  } else if (kind === 'stairs') {
    const steps = 10;
    const treadD = d / steps;
    const stepH = h / steps;
    for (let s = 0; s < steps; s++) {
      const curH = stepH * (s + 1);
      const zCenter = d / 2 - treadD * (s + 0.5);
      addPart(
        new THREE.BoxGeometry(w * 0.92, curH, treadD * 0.98),
        primaryMat,
        0,
        curH / 2,
        zCenter
      );
    }
    addPart(
      new THREE.BoxGeometry(w * 0.04, h, d),
      woodMat,
      -w * 0.48,
      h * 0.5,
      0
    );
    addPart(
      new THREE.BoxGeometry(w * 0.04, h, d),
      woodMat,
      w * 0.48,
      h * 0.5,
      0
    );
  } else if (kind === 'tree') {
    const trunkR = Math.max(3, Math.min(w, d) * 0.08);
    const canopyR = Math.min(w, d) * 0.42;
    addPart(
      new THREE.CylinderGeometry(trunkR * 0.75, trunkR, h * 0.45, 12),
      woodMat,
      0,
      h * 0.225,
      0
    );
    addPart(
      new THREE.SphereGeometry(canopyR, 16, 14),
      primaryMat,
      0,
      h * 0.68,
      0
    );
    addPart(
      new THREE.SphereGeometry(canopyR * 0.72, 14, 12),
      primaryMat,
      -canopyR * 0.45,
      h * 0.58,
      canopyR * 0.25
    );
    addPart(
      new THREE.SphereGeometry(canopyR * 0.72, 14, 12),
      primaryMat,
      canopyR * 0.45,
      h * 0.6,
      -canopyR * 0.25
    );
  } else {
    // custom blocks: each rectangle → full-height box, each circle → full-height cylinder
    let addedAny = false;
    if (blockDef && blockDef.entities.length > 0) {
      const sx = w / Math.max(1, blockDef.width);
      const sy = d / Math.max(1, blockDef.depth);
      for (const subEnt of blockDef.entities) {
        if (subEnt.type === 'rectangle') {
          const rw = Math.abs(subEnt.p2.x - subEnt.p1.x) * sx;
          const rd = Math.abs(subEnt.p2.y - subEnt.p1.y) * sy;
          const cx = ((subEnt.p1.x + subEnt.p2.x) / 2) * sx;
          const cz = ((subEnt.p1.y + subEnt.p2.y) / 2) * sy;
          if (rw > 0.5 && rd > 0.5) {
            addPart(new THREE.BoxGeometry(rw, h, rd), primaryMat, cx, h / 2, cz);
            addedAny = true;
          }
        } else if (subEnt.type === 'circle') {
          const cr = subEnt.radius * ((sx + sy) / 2);
          const cx = subEnt.center.x * sx;
          const cz = subEnt.center.y * sy;
          if (cr > 0.5) {
            addPart(new THREE.CylinderGeometry(cr, cr, h, 20), primaryMat, cx, h / 2, cz);
            addedAny = true;
          }
        }
      }
    }
    if (!addedAny) addPart(new THREE.BoxGeometry(w, h, d), primaryMat, 0, h / 2, 0);
  }
  return { group: compGroup, meshes: localMeshes };
}

/** Short fingerprint of everything that affects a block's 3D model (for render caches). */
export function hashBlock(def: BlockDefinition): string {
  const str = JSON.stringify([def.kind, def.libKind, def.width, def.depth, def.height, def.color, def.entities]);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `${str.length.toString(36)}${(h1 >>> 0).toString(36)}`;
}
