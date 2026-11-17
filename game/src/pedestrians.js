// Velmora Bay — pedestrians. Low-poly walkers who stroll the sidewalks,
// turn at intersections, and flee (or fall) when the player makes trouble.

import * as THREE from 'three';
import { Rng, dist2D, angleLerp } from './util.js';
import { roadLines, ROAD } from './city.js';

const SHIRTS = [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x6d6875, 0x3d5a80, 0xee964b, 0x90be6d, 0xe56b6f];
const PANTS = [0x2b3a55, 0x3a3a3a, 0x5a4a3a, 0x243b2e];

function makePedMesh(rng) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: rng.pick(SHIRTS) });
  const pants = new THREE.MeshLambertMaterial({ color: rng.pick(PANTS) });
  const skin = new THREE.MeshLambertMaterial({ color: rng.pick([0xc98d64, 0x8a5a3b, 0xe8b98a, 0x6e4423]) });
  const hair = new THREE.MeshLambertMaterial({ color: rng.pick([0x1c1410, 0x3a2a18, 0x777777, 0x8a6a2a]) });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.3), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.28), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.3), hair);
  cap.position.y = 1.86;
  g.add(cap);

  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  legGeo.translate(0, -0.36, 0);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.14, 0.8, 0);
  g.add(legL);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.14, 0.8, 0);
  g.add(legR);

  const armGeo = new THREE.BoxGeometry(0.15, 0.56, 0.17);
  armGeo.translate(0, -0.28, 0);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.37, 1.42, 0);
  g.add(armL);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.37, 1.42, 0);
  g.add(armR);

  return { group: g, legL, legR, armL, armR };
}

/** One pedestrian: sidewalk stroller, with flee and fall states. */
function createPed(G, x, z) {
  const rng = G.rng;
  const parts = makePedMesh(rng);
  parts.group.position.set(x, 0, z);
  G.scene.add(parts.group);
  const lines = G.city.lines;
  const axis = rng.chance(0.5) ? 'x' : 'z';
  const laneLine = rng.pick(lines);
  const lane = laneLine + (rng.chance(0.5) ? 1 : -1) * (ROAD / 2 + 2.5);
  const ped = {
    mesh: parts.group,
    parts,
    x, z,
    heading: rng.range(0, Math.PI * 2),
    speed: rng.range(1.1, 2.1),
    axis,
    lane,
    dir: rng.chance(0.5) ? 1 : -1,
    state: 'walk', // 'walk' | 'flee' | 'down'
    stateTimer: 0,
    phase: rng.range(0, Math.PI * 2),
    fleeX: 0,
    fleeZ: 0,
  };
  G.peds.push(ped);
  return ped;
}

/** Scatter pedestrians on the sidewalks around the player. */
export function spawnPeds(G, count) {
  const rng = new Rng(G.seed + 55);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < 600) {
    const x = rng.range(-240, 240);
    const z = rng.range(-240, 240);
    if (dist2D(x, z, G.player.x, G.player.z) < 18) continue;
    if (dist2D(x, z, G.player.x, G.player.z) > 170) continue;
    createPed(G, x, z);
    placed++;
  }
}

/** Scare every pedestrian near a point (gunshot, crash, siren wail). */
export function scarePeds(G, x, z, radius) {
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    if (dist2D(ped.x, ped.z, x, z) < radius) {
      ped.state = 'flee';
      ped.stateTimer = 3 + G.rng.float() * 3;
      ped.fleeX = x;
      ped.fleeZ = z;
    }
  }
}

/** A pedestrian gets knocked down: lies flat, then gets up and runs. */
export function pedKnockDown(G, ped) {
  ped.state = 'down';
  ped.stateTimer = 4;
  ped.mesh.rotation.x = Math.PI / 2 - 0.08;
  ped.mesh.position.y = 0.35;
  G.effects.burst(ped.x, 0.8, ped.z, 0xdddddd, 8);
  scarePeds(G, ped.x, ped.z, 26);
}

export function updatePeds(G, dt) {
  const lines = G.city.lines;
  const px = G.player.x;
  const pz = G.player.z;

  for (const ped of G.peds) {
    ped.stateTimer -= dt;
    if (ped.state === 'down') {
      if (ped.stateTimer <= 0) {
        ped.state = 'flee';
        ped.stateTimer = 5;
        ped.fleeX = px;
        ped.fleeZ = pz;
        ped.mesh.rotation.x = 0;
        ped.mesh.position.y = 0;
      }
      continue;
    }

    let speed = ped.speed;
    let targetHeading = ped.heading;

    if (ped.state === 'flee') {
      speed = 5.2;
      const dx = ped.x - ped.fleeX;
      const dz = ped.z - ped.fleeZ;
      targetHeading = Math.atan2(dx, dz);
      if (ped.stateTimer <= 0) ped.state = 'walk';
    } else {
      // Stroll along the sidewalk line; turn at intersections.
      const along = ped.axis === 'x' ? ped.x : ped.z;
      let nearestD = 1e9;
      for (const L of lines) {
        const d = Math.abs(along - L);
        if (d < nearestD) nearestD = d;
      }
      if (nearestD < 3 && G.rng.float() < 0.35 * dt) {
        ped.axis = ped.axis === 'x' ? 'z' : 'x';
        ped.dir = G.rng.chance(0.5) ? 1 : -1;
        const cross = ped.axis === 'x' ? ped.z : ped.x;
        ped.lane = cross + (G.rng.chance(0.5) ? 1 : -1) * (ROAD / 2 + 2.5);
      }
      targetHeading = ped.axis === 'x'
        ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (ped.dir > 0 ? 0 : Math.PI);
      // A fast car bearing down makes them step aside (sometimes too late).
      if (G.player.inCar && Math.abs(G.player.speed) > 10) {
        const d = dist2D(ped.x, ped.z, px, pz);
        if (d < 16) {
          ped.state = 'flee';
          ped.stateTimer = 2.5;
          ped.fleeX = px;
          ped.fleeZ = pz;
        }
      }
    }

    ped.heading = angleLerp(ped.heading, targetHeading, Math.min(1, 6 * dt));
    const fx = Math.sin(ped.heading);
    const fz = Math.cos(ped.heading);
    ped.x += fx * speed * dt;
    ped.z += fz * speed * dt;
    if (ped.axis === 'x') ped.z += (ped.lane - ped.z) * Math.min(1, 3 * dt);
    else ped.x += (ped.lane - ped.x) * Math.min(1, 3 * dt);
    ped.x = Math.max(-262, Math.min(262, ped.x));
    ped.z = Math.max(-262, Math.min(262, ped.z));

    ped.mesh.position.set(ped.x, 0, ped.z);
    ped.mesh.rotation.y = ped.heading;
    ped.phase += dt * (ped.state === 'flee' ? 13 : 7);
    const s = Math.sin(ped.phase);
    ped.parts.legL.rotation.x = s * 0.6;
    ped.parts.legR.rotation.x = -s * 0.6;
    ped.parts.armL.rotation.x = -s * 0.45;
    ped.parts.armR.rotation.x = s * 0.45;

    // Far pedestrians wander back near the player.
    if (dist2D(ped.x, ped.z, px, pz) > 200) {
      const a = G.rng.range(0, Math.PI * 2);
      const r = G.rng.range(40, 120);
      ped.x = px + Math.sin(a) * r;
      ped.z = pz + Math.cos(a) * r;
      ped.state = 'walk';
    }
  }
}
