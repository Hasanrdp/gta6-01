// Velmora Bay — the player on foot. A low-poly walker with a swing
// animation, WASD movement relative to the camera, and a third-person
// camera that orbits with the mouse (pointer lock) or the arrow keys.

import * as THREE from 'three';
import { clamp, angleLerp } from './util.js';
import { collideBuildings } from './city.js';

/** Build Rook Marlow: teal jacket, dark jeans, boots. Faces +Z. */
export function makePlayerMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const jacket = new THREE.MeshLambertMaterial({ color: 0x2a9d8f });
  const jeans = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1c1410 });
  const boots = new THREE.MeshLambertMaterial({ color: 0x2a2018 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), jacket);
  torso.position.y = 1.22;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  g.add(head);
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), hair);
  hairTop.position.y = 1.98;
  g.add(hairTop);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.26), jeans);
  legL.position.set(-0.16, 0.47, 0);
  legL.geometry.translate(0, -0.39, 0);
  legL.position.y = 0.86;
  legL.castShadow = true;
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), jacket);
  armL.position.set(-0.42, 1.5, 0);
  armL.geometry.translate(0, -0.31, 0);
  armL.castShadow = true;
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.42;
  g.add(armR);

  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), boots);
  bootL.position.set(0, -0.78, 0.04);
  legL.add(bootL);
  const bootR = bootL.clone();
  legR.add(bootR);

  return { group: g, legL, legR, armL, armR };
}

/** Walk / run on foot, relative to where the camera looks. */
export function updatePlayerOnFoot(G, dt) {
  const keys = G.input.keys;
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = running ? 8.5 : 4.6;

  // Camera yaw defines "forward" for the walker.
  const cy = G.input.camYaw;
  const fx = Math.sin(cy);
  const fz = Math.cos(cy);
  const rx = Math.cos(cy);
  const rz = -Math.sin(cy);

  let mx = fx * fwd + rx * strafe;
  let mz = fz * fwd + rz * strafe;
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    mx /= len;
    mz /= len;
    const targetHeading = Math.atan2(mx, mz);
    G.player.heading = angleLerp(G.player.heading, targetHeading, Math.min(1, 12 * dt));
  }

  const moving = len > 0.01;
  const step = moving ? speed * dt : 0;
  let nx = G.player.x + mx * step;
  let nz = G.player.z + mz * step;
  const pushed = collideBuildings(G.city.buildings, nx, nz, 0.55);
  nx = clamp(pushed.x, -300, 300);
  nz = clamp(pushed.z, -300, 292);
  G.player.x = nx;
  G.player.z = nz;
  G.player.speed = moving ? speed : 0;

  const mesh = G.player.mesh;
  mesh.position.set(nx, 0, nz);
  mesh.rotation.y = G.player.heading;

  // Walk cycle: legs and arms swing opposite, faster when running.
  const parts = G.player.parts;
  if (moving) {
    G.player.walkPhase += dt * (running ? 11 : 8);
    const s = Math.sin(G.player.walkPhase);
    parts.legL.rotation.x = s * 0.7;
    parts.legR.rotation.x = -s * 0.7;
    parts.armL.rotation.x = -s * 0.55;
    parts.armR.rotation.x = s * 0.55;
  } else {
    parts.legL.rotation.x *= 0.8;
    parts.legR.rotation.x *= 0.8;
    parts.armL.rotation.x *= 0.8;
    parts.armR.rotation.x *= 0.8;
  }
}

/**
 * Chase camera: behind the player on foot, or behind the car when
 * driving. Mouse drag / pointer lock orbits; it snaps on scene setup.
 */
export function updateCamera(G, dt, snap = false) {
  const cam = G.camera;
  const input = G.input;
  let tx, tz, ty, lookX, lookZ, lookY, dist, height;

  if (G.player.inCar && G.player.car) {
    const car = G.player.car;
    // The driving camera follows the car's heading, not the mouse.
    const back = Math.PI + car.heading;
    dist = 10.5;
    height = 4.2;
    tx = car.x + Math.sin(back) * dist;
    tz = car.z + Math.cos(back) * dist;
    ty = height;
    const f = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
    lookX = car.x + f.x * 8;
    lookZ = car.z + f.z * 8;
    lookY = 1.4;
    // Keep the camera yaw in sync so getting out feels continuous.
    input.camYaw = car.heading;
  } else {
    dist = 7.5;
    height = 3.4;
    const cy = input.camYaw;
    const pitch = clamp(input.camPitch, -0.15, 0.55);
    const backX = -Math.sin(cy) * Math.cos(pitch);
    const backZ = -Math.cos(cy) * Math.cos(pitch);
    tx = G.player.x + backX * dist;
    tz = G.player.z + backZ * dist;
    ty = G.player.y + 1.6 + Math.sin(pitch) * dist;
    lookX = G.player.x + Math.sin(cy) * 4;
    lookZ = G.player.z + Math.cos(cy) * 4;
    lookY = 1.5;
  }

  // Never let the camera clip inside a building: pull it up and in.
  const pushed = collideBuildings(G.city.buildings, tx, tz, 1.2);
  if (pushed.hit) {
    tx = pushed.x;
    tz = pushed.z;
    ty = Math.max(ty, 6);
  }

  if (snap) {
    cam.position.set(tx, ty, tz);
  } else {
    const k = Math.min(1, 9 * dt);
    cam.position.x += (tx - cam.position.x) * k;
    cam.position.y += (ty - cam.position.y) * k;
    cam.position.z += (tz - cam.position.z) * k;
  }
  cam.lookAt(lookX, lookY, lookZ);
}
