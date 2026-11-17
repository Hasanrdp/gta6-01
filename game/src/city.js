// Velmora Bay — the city itself. A fixed-seed grid of blocks, roads and
// buildings, drawn once at load: a painted ground texture for the whole
// street network, box buildings with lit-window facades, streetlights,
// trees, and the bay water with a pier along the south edge.
//
// Layout: GRID x GRID blocks. Each block is BLOCK wide with ROAD-wide
// streets between them. Road centre lines sit at block boundaries, so
// traffic and pedestrians can navigate by centre-line coordinates alone.

import * as THREE from 'three';
import { Rng, canvasTexture } from './util.js';

export const GRID = 7;
export const BLOCK = 56;
export const ROAD = 16;
export const PITCH = BLOCK + ROAD;
export const CITY_MIN = (-GRID * PITCH) / 2; // -252
export const CITY_MAX = GRID * PITCH / 2; // +252
export const WATER_Z = 300; // the bay starts beyond this line

/** Road centre-line coordinates, one per street in each direction. */
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= GRID; i++) lines.push(CITY_MIN - ROAD / 2 + i * PITCH);
  return lines; // -260, -188, -116, -44, 28, 100, 172, 244
}

/** Centre of block (bx, bz), each 0..GRID-1. */
export function blockCenter(bx, bz) {
  return {
    x: CITY_MIN + bx * PITCH + BLOCK / 2,
    z: CITY_MIN + bz * PITCH + BLOCK / 2,
  };
}

/** Paint the whole street network onto one canvas texture. */
function paintGround(THREE, rng) {
  const SIZE = 1024;
  const WORLD = 640; // texture covers -320..+320 in both axes
  const toPx = (v) => ((v + WORLD / 2) / WORLD) * SIZE;
  return canvasTexture(THREE, SIZE, SIZE, (ctx) => {
    // Dry grass base.
    ctx.fillStyle = '#7d8f57';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // A few grass patches for variety.
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rng.chance(0.5) ? '#74854e' : '#879863';
      const x = rng.range(0, SIZE);
      const y = rng.range(0, SIZE);
      ctx.fillRect(x, y, rng.range(8, 42), rng.range(8, 42));
    }
    // Sand strip and bay water along the south edge (high +z).
    const sandTop = toPx(WATER_Z - 26);
    ctx.fillStyle = '#d9c48f';
    ctx.fillRect(0, sandTop, SIZE, toPx(WATER_Z) - sandTop);
    const waterTop = toPx(WATER_Z);
    const grad = ctx.createLinearGradient(0, waterTop, 0, SIZE);
    grad.addColorStop(0, '#2e7fa8');
    grad.addColorStop(1, '#1d5f86');
    ctx.fillStyle = grad;
    ctx.fillRect(0, waterTop, SIZE, SIZE - waterTop);
    // Sidewalks: pale slabs around every block.
    ctx.fillStyle = '#b9b3a4';
    for (let bx = 0; bx < GRID; bx++) {
      for (let bz = 0; bz < GRID; bz++) {
        const c = blockCenter(bx, bz);
        const x0 = toPx(c.x - BLOCK / 2 - 3);
        const z0 = toPx(c.z - BLOCK / 2 - 3);
        const w = ((BLOCK + 6) / WORLD) * SIZE;
        ctx.fillRect(x0, z0, w, w);
      }
    }
    // Asphalt: every street, both directions, plus the ring road.
    ctx.fillStyle = '#3a3d42';
    const lines = roadLines();
    for (const L of lines) {
      const x = toPx(L - ROAD / 2);
      const w = (ROAD / WORLD) * SIZE;
      ctx.fillRect(x, 0, w, SIZE);
      const z = toPx(L - ROAD / 2);
      ctx.fillRect(0, z, SIZE, w);
    }
    // Lane dashes down the middle of each street.
    ctx.fillStyle = '#e8e4d2';
    const dash = (6 / WORLD) * SIZE;
    const gap = (14 / WORLD) * SIZE;
    for (const L of lines) {
      for (let d = 0; d < SIZE; d += dash + gap) {
        ctx.fillRect(toPx(L) - 1, d, 2, dash);
        ctx.fillRect(d, toPx(L) - 1, dash, 2);
      }
    }
    // Crosswalk stripes at every intersection.
    ctx.fillStyle = '#d8d4c4';
    for (const lx of lines) {
      for (const lz of lines) {
        for (let s = -3; s <= 3; s++) {
          const w = (1.6 / WORLD) * SIZE;
          const len = (5 / WORLD) * SIZE;
          ctx.fillRect(toPx(lx + s * 2.4) - w / 2, toPx(lz - ROAD / 2 + 1), w, len);
          ctx.fillRect(toPx(lx + s * 2.4) - w / 2, toPx(lz + ROAD / 2 - 6), w, len);
          ctx.fillRect(toPx(lx - ROAD / 2 + 1), toPx(lz + s * 2.4) - w / 2, len, w);
          ctx.fillRect(toPx(lx + ROAD / 2 - 6), toPx(lz + s * 2.4) - w / 2, len, w);
        }
      }
    }
  });
}

/** A building facade: windows in a grid, some lit warm, some dark. */
function facadeTexture(THREE, rng, base, litRatio) {
  return canvasTexture(THREE, 128, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Subtle vertical shading so towers read as slabs, not flat cards.
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, 8, h);
    ctx.fillRect(w - 8, 0, 8, h);
    const cols = 6;
    const rows = 12;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rng.float() < litRatio;
        ctx.fillStyle = lit ? '#ffd98a' : (rng.chance(0.5) ? '#20262e' : '#2e3844');
        ctx.fillRect(c * cw + 3, r * ch + 4, cw - 6, ch - 8);
      }
    }
  });
}

const PALETTE = ['#c9a37e', '#b98d6e', '#9fb2c1', '#c1b49a', '#8fa3b5', '#d0b48f', '#a89a86', '#7e9aa8'];

/**
 * Build the city into the scene. Returns the data the rest of the game
 * needs: building colliders, road lines, named places and spawn points.
 */
export function buildCity(scene, seed) {
  const rng = new Rng(seed);
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(640, 640),
    new THREE.MeshLambertMaterial({ map: paintGround(THREE, rng) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const buildings = [];
  const facadeCache = new Map();
  const facadeFor = (base) => {
    if (!facadeCache.has(base)) facadeCache.set(base, facadeTexture(THREE, rng, base, 0.35));
    return facadeCache.get(base);
  };

  // One to four buildings per block, set back from the sidewalk edge.
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const c = blockCenter(bx, bz);
      const n = rng.int(1, 3);
      // Corner plots sit 15 out from the block centre, and a building is
      // at most 22 wide, so every block keeps a clear plaza at its heart.
      const spots = [
        { dx: -15, dz: -15 }, { dx: 15, dz: -15 },
        { dx: -15, dz: 15 }, { dx: 15, dz: 15 },
      ];
      // Shuffle the corner spots deterministically.
      for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(rng.float() * (i + 1));
        [spots[i], spots[j]] = [spots[j], spots[i]];
      }
      for (let s = 0; s < n; s++) {
        const spot = spots[s];
        const w = rng.range(14, 22);
        const d = rng.range(14, 22);
        const h = rng.range(12, 58);
        const base = rng.pick(PALETTE);
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshLambertMaterial({ map: facadeFor(base) });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c.x + spot.dx, h / 2, c.z + spot.dz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        // A rooftop box so the skyline is not a flat slab.
        if (rng.chance(0.6)) {
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.3, 2.5, d * 0.3),
            new THREE.MeshLambertMaterial({ color: '#5c564c' }),
          );
          roof.position.set(c.x + spot.dx, h + 1.2, c.z + spot.dz);
          roof.castShadow = true;
          group.add(roof);
        }
        buildings.push({
          minX: c.x + spot.dx - w / 2, maxX: c.x + spot.dx + w / 2,
          minZ: c.z + spot.dz - d / 2, maxZ: c.z + spot.dz + d / 2,
          h, x: c.x + spot.dx, z: c.z + spot.dz,
        });
      }
    }
  }

  // Streetlights along the roads, alternating sides.
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6.5, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#2f3336' });
  const lampGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffe9a8' });
  const lines = roadLines();
  for (const L of lines) {
    for (let d = -CITY_MAX; d <= CITY_MAX; d += 44) {
      const side = (Math.round(d / 44) % 2 === 0) ? 1 : -1;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(L + side * (ROAD / 2 + 1.5), 3.25, d);
      pole.castShadow = true;
      group.add(pole);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(L + side * (ROAD / 2 + 0.4), 6.6, d);
      group.add(lamp);
      const pole2 = new THREE.Mesh(poleGeo, poleMat);
      pole2.position.set(d, 3.25, L + side * (ROAD / 2 + 1.5));
      pole2.castShadow = true;
      group.add(pole2);
      const lamp2 = new THREE.Mesh(lampGeo, lampMat);
      lamp2.position.set(d, 6.6, L + side * (ROAD / 2 + 0.4));
      group.add(lamp2);
    }
  }

  // Trees on the sidewalk corners of each block.
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
  const leafGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const leafMat = new THREE.MeshLambertMaterial({ color: '#4d7a35' });
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      if (!rng.chance(0.7)) continue;
      const c = blockCenter(bx, bz);
      const tx = c.x + rng.pick([-1, 1]) * (BLOCK / 2 - 2);
      const tz = c.z + rng.pick([-1, 1]) * (BLOCK / 2 - 2);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(tx, 1.3, tz);
      trunk.castShadow = true;
      group.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.set(tx, 4.2, tz);
      leaves.castShadow = true;
      group.add(leaves);
    }
  }

  // Pelican Pier: a wooden walkway reaching out over the bay.
  const pierMat = new THREE.MeshLambertMaterial({ color: '#8a6b48' });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 34), pierMat);
  pier.position.set(100, 0.5, WATER_Z + 12);
  pier.castShadow = true;
  pier.receiveShadow = true;
  group.add(pier);
  for (let i = 0; i < 4; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 6), pierMat);
    post.position.set(100 + (i % 2 === 0 ? -4.5 : 4.5), 1, WATER_Z + 2 + Math.floor(i / 2) * 22);
    group.add(post);
  }

  // Named places the missions and the HUD refer to.
  const market = blockCenter(2, 3); // Marlin Market plaza
  const hideout = blockCenter(5, 1); // the Kade hideout
  const safehouse = blockCenter(1, 5); // Rook's safehouse
  const hospital = blockCenter(3, 2); // Velmora General

  return {
    group,
    buildings,
    lines,
    places: {
      market: { x: market.x, z: market.z },
      hideout: { x: hideout.x, z: hideout.z },
      pier: { x: 100, z: 290 }, // the contact waits at the foot of the pier
      safehouse: { x: safehouse.x, z: safehouse.z },
      hospital: { x: hospital.x, z: hospital.z },
      plaza: { x: 0, z: 0 },
    },
    spawn: { x: safehouse.x, z: safehouse.z, heading: Math.PI * 0.75 },
  };
}

/** Push a circle (x, z, radius) out of every building it overlaps. */
export function collideBuildings(buildings, x, z, radius) {
  let px = x;
  let pz = z;
  let hit = false;
  for (const b of buildings) {
    const cx = Math.max(b.minX, Math.min(px, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
    const dx = px - cx;
    const dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        px = cx + (dx / d) * radius;
        pz = cz + (dz / d) * radius;
      } else {
        // Dead centre of a building: shove out along the shortest side.
        const l = px - b.minX;
        const r = b.maxX - px;
        const t = pz - b.minZ;
        const bo = b.maxZ - pz;
        const m = Math.min(l, r, t, bo);
        if (m === l) px = b.minX - radius;
        else if (m === r) px = b.maxX + radius;
        else if (m === t) pz = b.minZ - radius;
        else pz = b.maxZ + radius;
      }
    }
  }
  return { x: px, z: pz, hit };
}

/** True when the point is inside any building (used for spawns). */
export function insideBuilding(buildings, x, z) {
  for (const b of buildings) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  return false;
}

/** True when the point is on a road (within half a street of a centre line). */
export function onRoad(lines, x, z) {
  for (const L of lines) {
    if (Math.abs(x - L) < ROAD / 2 + 0.5) return true;
    if (Math.abs(z - L) < ROAD / 2 + 0.5) return true;
  }
  return false;
}
