// Velmora Bay — vehicles. Car meshes built from boxes and cylinders,
// arcade driving physics for the player's car, traffic that cruises the
// road grid and turns at intersections, parked cars to steal, and the
// enter / exit logic that moves the player between foot and car.

import * as THREE from 'three';
import { Rng, clamp, dist2D, forwardOf } from './util.js';
import { collideBuildings, roadLines, insideBuilding, CITY_MAX, ROAD } from './city.js';
import { pedKnockDown } from './pedestrians.js';

export const TRAFFIC_COLORS = [0xc0392b, 0x2e6fb0, 0xc0c4c8, 0xe6b800, 0x3d8b4f, 0xe8e4da, 0xd96a1e, 0x7a4a8f];
export const PLAYER_CAR_COLORS = [0x9b1c1c, 0x1c4d9b, 0x222222];

/** Build a low-poly car. Forward is +Z (rotation.y = heading). */
export function makeCarMesh(color, police = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a1d20 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc4d8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.72, 4.4), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 2.1), glass);
  cabin.position.set(0, 1.22, -0.25);
  cabin.castShadow = true;
  g.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.9), paint);
  roof.position.set(0, 1.56, -0.25);
  g.add(roof);

  // Bumpers, grille and a spoiler for the sportier paint jobs.
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 0.3), dark);
  bumperF.position.set(0, 0.38, 2.2);
  g.add(bumperF);
  const bumperB = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 0.3), dark);
  bumperB.position.set(0, 0.38, -2.2);
  g.add(bumperB);

  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const sx of [-0.7, 0.7]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), headMat);
    lamp.position.set(sx, 0.72, 2.22);
    g.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
  for (const sx of [-0.7, 0.7]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), tailMat);
    lamp.position.set(sx, 0.72, -2.22);
    g.add(lamp);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    wheel.castShadow = true;
    g.add(wheel);
    wheels.push(wheel);
  }

  let lightBar = null;
  if (police) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.x = -0.32;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.x = 0.32;
    bar.add(red, blue);
    bar.position.set(0, 1.66, -0.25);
    g.add(bar);
    lightBar = { red: red.material, blue: blue.material };
    // White doors read as a patrol car at a glance.
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.5, 1.6), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    door.position.set(0, 0.62, -0.1);
    g.add(door);
  }

  return { group: g, wheels, lightBar };
}

/** One car in the world: mesh, motion state and AI (if any). */
export function createCar(G, opts) {
  const { group, wheels, lightBar } = makeCarMesh(opts.color, opts.police);
  group.position.set(opts.x, 0, opts.z);
  group.rotation.y = opts.heading;
  G.scene.add(group);
  const car = {
    mesh: group,
    wheels,
    lightBar,
    x: opts.x,
    z: opts.z,
    heading: opts.heading,
    speed: 0,
    kind: opts.kind, // 'player' | 'traffic' | 'police' | 'parked'
    police: !!opts.police,
    maxSpeed: opts.maxSpeed ?? 12,
    cruise: opts.cruise ?? 10,
    steer: 0,
    // Traffic AI: which road it is on and which way it travels.
    axis: opts.axis ?? 'x',
    lane: opts.lane ?? 0,
    dir: opts.dir ?? 1,
    stuck: 0,
    ramCooldown: 0,
    sirenPhase: 0,
  };
  G.cars.push(car);
  if (car.kind === 'traffic') G.traffic.push(car);
  if (car.kind === 'police') G.policeCars.push(car);
  return car;
}

/** Drop parked cars along the roads so there is always one to steal. */
export function spawnParkedCars(G) {
  const rng = new Rng(G.seed + 77);
  const lines = roadLines();
  let placed = 0;
  let guard = 0;
  while (placed < 16 && guard++ < 400) {
    const L = rng.pick(lines);
    const along = rng.range(-CITY_MAX + 20, CITY_MAX - 20);
    const side = rng.chance(0.5) ? 1 : -1;
    const x = L + side * (ROAD / 2 - 2.4);
    const z = along;
    if (insideBuilding(G.city.buildings, x, z)) continue;
    if (dist2D(x, z, G.player.x, G.player.z) < 24) continue;
    // Keep parked cars clear of the mission markers.
    let nearMarker = false;
    for (const p of Object.values(G.city.places)) {
      if (dist2D(x, z, p.x, p.z) < 14) nearMarker = true;
    }
    if (nearMarker) continue;
    const heading = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
    createCar(G, { x, z, heading, color: rng.pick(TRAFFIC_COLORS), kind: 'parked', axis: 'z', lane: L });
    placed++;
  }
}

/** Seed the moving traffic on the road grid. */
export function spawnTraffic(G, count) {
  const rng = new Rng(G.seed + 31);
  const lines = roadLines();
  for (let i = 0; i < count; i++) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const lane = rng.pick(lines) + (rng.chance(0.5) ? 4 : -4);
    const along = rng.range(-CITY_MAX + 30, CITY_MAX - 30);
    const dir = rng.chance(0.5) ? 1 : -1;
    const x = axis === 'x' ? along : lane;
    const z = axis === 'x' ? lane : along;
    if (dist2D(x, z, G.player.x, G.player.z) < 30) continue;
    const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const car = createCar(G, {
      x, z, heading,
      color: rng.pick(TRAFFIC_COLORS),
      kind: 'traffic',
      axis, lane, dir,
      maxSpeed: rng.range(9, 13),
    });
    car.speed = car.cruise;
  }
}

/** Arcade driving for the player's car: throttle, steering, drag, bumps. */
export function updatePlayerCar(G, dt) {
  const car = G.player.car;
  const keys = G.input.keys;
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');

  const maxSpeed = 40;
  const maxReverse = 11;
  if (fwd) car.speed += 16 * dt;
  if (back) {
    if (car.speed > 0.5) car.speed -= 26 * dt; // brake
    else car.speed -= 9 * dt; // reverse
  }
  if (!fwd && !back) {
    // Engine braking and rolling drag.
    car.speed -= car.speed * 0.9 * dt;
    if (Math.abs(car.speed) < 0.15) car.speed = 0;
  }
  car.speed = clamp(car.speed, -maxReverse, maxSpeed);

  // Steering bites harder at low speed, less at high speed.
  const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);
  const steerRate = 1.9 / (1 + Math.abs(car.speed) * 0.045);
  car.steer += (steerTarget - car.steer) * Math.min(1, 8 * dt);
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.heading += car.steer * steerRate * dirSign * Math.min(1, Math.abs(car.speed) / 6) * dt;

  const f = forwardOf(car.heading);
  let nx = car.x + f.x * car.speed * dt;
  let nz = car.z + f.z * car.speed * dt;

  // Buildings: slide along them, lose speed on a hard hit.
  const before = { x: nx, z: nz };
  const pushed = collideBuildings(G.city.buildings, nx, nz, 1.7);
  nx = pushed.x;
  nz = pushed.z;
  if (pushed.hit) {
    const impact = Math.abs(car.speed);
    if (impact > 6) {
      G.audio.thud(Math.min(1, impact / 30));
      G.effects.burst(nx, 1, nz, 0xcccccc, 10);
      if (impact > 16) hurtPlayer(G, (impact - 16) * 0.6);
    }
    car.speed *= 0.55;
    if (Math.abs(before.x - nx) > 0.01 && Math.abs(before.z - nz) > 0.01) car.speed *= 0.8;
  }

  // Soft world edge: the bay and the city limits push back.
  nx = clamp(nx, -300, 300);
  nz = clamp(nz, -300, 292);

  // Bumping other cars: shove both apart, trade a little speed.
  for (const other of G.cars) {
    if (other === car) continue;
    const d = dist2D(nx, nz, other.x, other.z);
    if (d < 3.4 && d > 0.01) {
      const push = (3.4 - d) / 2;
      const ox = (nx - other.x) / d;
      const oz = (nz - other.z) / d;
      nx += ox * push;
      nz += oz * push;
      if (other.kind !== 'player') {
        other.x -= ox * push;
        other.z -= oz * push;
        other.speed *= 0.7;
      }
      if (Math.abs(car.speed) > 8) {
        G.audio.thud(0.5);
        G.effects.burst(nx, 1, nz, 0xffcc66, 8);
        if (other.police) G.police.addWanted(G, 1, 'ramming a patrol car');
      }
      car.speed *= 0.85;
    }
  }

  // Running a pedestrian over is a crime, and it slows the car.
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    const d = dist2D(nx, nz, ped.x, ped.z);
    if (d < 2.2 && Math.abs(car.speed) > 3) {
      pedKnockDown(G, ped);
      G.police.addWanted(G, 1, 'hitting a pedestrian');
      G.stats.pedsHit++;
      car.speed *= 0.8;
      G.audio.thud(0.7);
    }
  }

  car.x = nx;
  car.z = nz;
  car.mesh.position.set(nx, 0, nz);
  car.mesh.rotation.y = car.heading;

  // Wheels spin with speed; front wheels yaw with steering.
  const spin = (car.speed * dt) / 0.38;
  for (let i = 0; i < car.wheels.length; i++) {
    car.wheels[i].rotation.x += spin;
  }
  car.wheels[0].rotation.y = car.steer * 0.4;
  car.wheels[1].rotation.y = car.steer * 0.4;

  // Skid marks and smoke when turning hard at speed.
  if (Math.abs(car.steer) > 0.75 && Math.abs(car.speed) > 14) {
    const b = forwardOf(car.heading + Math.PI);
    G.effects.skid(car.x + b.x * 1.4, car.z + b.z * 1.4, car.heading);
    if (G.rng.float() < 0.3) G.effects.burst(car.x, 0.4, car.z, 0x999999, 2);
  }

  G.player.x = car.x;
  G.player.z = car.z;
  G.player.heading = car.heading;
  G.player.speed = car.speed;
}

/** Traffic cruises its road, turns at intersections, yields to the player. */
export function updateTraffic(G, dt) {
  const lines = G.city.lines;
  const px = G.player.x;
  const pz = G.player.z;
  for (const car of G.traffic) {
    // A car ahead of the player slows down instead of rear-ending them.
    let target = car.cruise;
    if (G.player.inCar) {
      const d = dist2D(car.x, car.z, px, pz);
      if (d < 14) {
        const f = forwardOf(car.heading);
        const toPlayerX = px - car.x;
        const toPlayerZ = pz - car.z;
        if (f.x * toPlayerX + f.z * toPlayerZ > 0) target = 0;
      }
    }
    car.speed += (target - car.speed) * Math.min(1, 2.5 * dt);

    // At an intersection, sometimes turn onto the crossing street.
    const along = car.axis === 'x' ? car.x : car.z;
    let nearestLine = null;
    let nearestD = 1e9;
    for (const L of lines) {
      const d = Math.abs(along - L);
      if (d < nearestD) { nearestD = d; nearestLine = L; }
    }
    if (nearestD < 2.5 && G.rng.float() < 0.5 * dt * 60 * 0.02 + 0.004) {
      const cross = car.axis === 'x' ? car.z : car.x;
      // Only turn if the crossing street is actually there (it always is).
      const newAxis = car.axis === 'x' ? 'z' : 'x';
      const newDir = G.rng.chance(0.5) ? 1 : -1;
      const newLane = nearestLine + (newDir > 0 ? -4 : 4);
      car.axis = newAxis;
      car.dir = newDir;
      car.lane = newLane;
      if (newAxis === 'x') {
        car.z = newLane;
        car.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.x = newLane;
        car.heading = newDir > 0 ? 0 : Math.PI;
      }
    }

    const step = car.speed * car.dir * dt;
    if (car.axis === 'x') {
      car.x += step;
      if (car.x > 268) { car.x = 268; car.dir = -1; car.heading = -Math.PI / 2; }
      if (car.x < -268) { car.x = -268; car.dir = 1; car.heading = Math.PI / 2; }
      car.z = car.lane;
    } else {
      car.z += step;
      if (car.z > 268) { car.z = 268; car.dir = -1; car.heading = Math.PI; }
      if (car.z < -268) { car.z = -268; car.dir = 1; car.heading = 0; }
      car.x = car.lane;
    }
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    const spin = (car.speed * dt) / 0.38;
    for (const w of car.wheels) w.rotation.x += spin;

    // Far-away traffic reappears near the player so the streets stay busy.
    if (dist2D(car.x, car.z, px, pz) > 240) {
      const axis = G.rng.chance(0.5) ? 'x' : 'z';
      const lane = G.rng.pick(lines) + (G.rng.chance(0.5) ? 4 : -4);
      const along2 = (G.rng.chance(0.5) ? 1 : -1) * G.rng.range(60, 160);
      car.axis = axis;
      car.dir = G.rng.chance(0.5) ? 1 : -1;
      car.lane = lane;
      if (axis === 'x') {
        car.x = px + along2;
        car.z = lane;
        car.heading = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.z = pz + along2;
        car.x = lane;
        car.heading = car.dir > 0 ? 0 : Math.PI;
      }
    }
  }
}

/** Nearest car the player could get into, within reach. */
export function nearestStealableCar(G) {
  let best = null;
  let bestD = 5.2;
  for (const car of G.cars) {
    if (car === G.player.car) continue;
    const d = dist2D(G.player.x, G.player.z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

/** Get in a car (stealing it if it is not the player's own). */
export function enterCar(G, car) {
  if (car.kind !== 'player') {
    G.police.addWanted(G, 1, 'stealing a car');
    G.stats.carsStolen++;
    G.hud.toast('Car stolen — the Velmora PD has been notified');
    G.audio.blip(660, 0.12);
    // A stolen car becomes the player's: pull it out of traffic / patrol.
    if (car.kind === 'traffic') {
      G.traffic.splice(G.traffic.indexOf(car), 1);
    }
    if (car.kind === 'police') {
      G.policeCars.splice(G.policeCars.indexOf(car), 1);
    }
    car.kind = 'player';
  }
  G.player.car = car;
  G.player.inCar = true;
  G.player.mesh.visible = false;
  car.speed = 0;
  G.audio.engineStart();
  G.hud.setPrompt('');
}

/** Step out of the car onto the street beside it. */
export function exitCar(G) {
  const car = G.player.car;
  if (!car) return;
  const f = forwardOf(car.heading);
  // Step out on the left side of the car.
  const sx = car.x - f.z * 2.4;
  const sz = car.z + f.x * 2.4;
  const pushed = collideBuildings(G.city.buildings, sx, sz, 0.8);
  G.player.x = pushed.x;
  G.player.z = pushed.z;
  G.player.heading = car.heading;
  G.player.speed = 0;
  G.player.inCar = false;
  G.player.car = null;
  G.player.mesh.visible = true;
  G.player.mesh.position.set(G.player.x, 0, G.player.z);
  G.audio.engineStop();
}

/** Damage the player, with a short hurt flash through the HUD. */
export function hurtPlayer(G, amount) {
  if (G.state !== 'playing' || G.player.godTimer > 0) return;
  G.player.health -= amount;
  G.player.lastHurtAt = G.time.elapsed;
  G.hud.flashHurt();
  if (G.player.health <= 0) {
    G.player.health = 0;
    G.main.wasted(G);
  }
}
