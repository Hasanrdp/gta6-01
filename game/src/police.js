// Velmora Bay — the wanted system and the Velmora PD. Crimes raise the
// wanted level (0–5 stars); patrol cars spawn to match it, chase and ram
// the player, and can bust them on foot. Hide long enough out of sight
// and the heat cools off, one star at a time.

import { clamp, dist2D, forwardOf } from './util.js';
import { createCar } from './vehicles.js';
import { roadLines } from './city.js';

const MAX_WANTED = 5;
/** Per-crime cooldowns so one crash does not stack five stars at once. */
const CRIME_COOLDOWN = {
  'stealing a car': 20,
  'hitting a pedestrian': 5,
  'ramming a patrol car': 8,
  'shooting in public': 8,
  'punching a pedestrian': 6,
  'running over a cop': 10,
};

export const police = {
  /** Raise the wanted level, with a per-crime cooldown. */
  addWanted(G, stars, reason) {
    if (G.state !== 'playing') return;
    const now = G.time.elapsed;
    const last = G.player.crimeAt[reason] ?? -1e9;
    if (now - last < (CRIME_COOLDOWN[reason] ?? 5)) return;
    G.player.crimeAt[reason] = now;
    const before = G.player.wanted;
    G.player.wanted = clamp(G.player.wanted + stars, 0, MAX_WANTED);
    if (G.player.wanted > before) {
      G.hud.setWanted(G.player.wanted);
      if (G.player.wanted >= 3) G.hud.toast('WANTED — Velmora PD is closing in');
      G.audio.sirenStart();
      G.stats.crimes++;
    }
    G.player.hiddenTimer = 0;
  },

  /** Keep the number of patrol cars equal to the wanted level. */
  maintain(G) {
    const wanted = G.player.wanted;
    while (G.policeCars.length < wanted) spawnPatrolCar(G);
    while (G.policeCars.length > wanted) {
      const car = G.policeCars.pop();
      G.scene.remove(car.mesh);
      G.cars.splice(G.cars.indexOf(car), 1);
    }
  },

  /** Patrol cars chase the player, ram, and bust them when cornered. */
  update(G, dt) {
    this.maintain(G);
    const px = G.player.x;
    const pz = G.player.z;
    const playerSpeed = Math.abs(G.player.speed);

    for (const car of G.policeCars) {
      car.ramCooldown = Math.max(0, car.ramCooldown - dt);
      const dx = px - car.x;
      const dz = pz - car.z;
      const d = Math.hypot(dx, dz);
      const targetHeading = Math.atan2(dx, dz);

      // Steer toward the player, with a limited turn rate.
      let diff = targetHeading - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = clamp(diff, -2.4 * dt, 2.4 * dt);
      car.heading += turn;

      // Patrol cars are quick but a touch slower than a getaway car. On a
      // suspect on foot they pull up and stop beside them instead of
      // circling at full speed, so a cornered player can actually be busted.
      let targetSpeed;
      if (!G.player.inCar && d < 25) {
        targetSpeed = clamp(d * 1.2, 0, 14);
      } else {
        targetSpeed = d > 90 ? 34 : 30;
      }
      car.speed += (targetSpeed - car.speed) * Math.min(1, 1.4 * dt);
      const f = forwardOf(car.heading);
      let nx = car.x + f.x * car.speed * dt;
      let nz = car.z + f.z * car.speed * dt;
      nx = clamp(nx, -300, 300);
      nz = clamp(nz, -300, 292);
      car.x = nx;
      car.z = nz;
      car.mesh.position.set(nx, 0, nz);
      car.mesh.rotation.y = car.heading;
      const spin = (car.speed * dt) / 0.38;
      for (const w of car.wheels) w.rotation.x += spin;

      // Flashing light bar.
      car.sirenPhase += dt * 9;
      const on = Math.sin(car.sirenPhase) > 0;
      car.lightBar.red.color.setHex(on ? 0xff2222 : 0x551111);
      car.lightBar.blue.color.setHex(on ? 0x2266ff : 0x111155);

      // Ramming the player's car hurts and shoves it.
      if (G.player.inCar && d < 3.6 && car.ramCooldown <= 0) {
        car.ramCooldown = 1.2;
        const pcar = G.player.car;
        pcar.speed *= 0.82;
        pcar.x += f.x * 1.6;
        pcar.z += f.z * 1.6;
        G.audio.thud(0.8);
        G.effects.burst(px, 1, pz, 0xffcc66, 10);
        G.main.damagePlayer(G, 6 + Math.min(8, car.speed * 0.2));
      }

      // On foot and cornered: the bust timer runs while a cop is close.
      if (!G.player.inCar && d < 4.2 && playerSpeed < 0.8) {
        G.player.bustTimer += dt;
        if (G.player.bustTimer > 0.4) {
          G.hud.setPrompt('BUSTED — stay still…');
        }
        if (G.player.bustTimer > 2.5) {
          G.main.busted(G);
          return;
        }
      } else {
        G.player.bustTimer = Math.max(0, G.player.bustTimer - dt * 2);
      }
    }

    // Heat cools off when no patrol car can see the player.
    let nearest = 1e9;
    for (const car of G.policeCars) nearest = Math.min(nearest, dist2D(car.x, car.z, px, pz));
    if (G.player.wanted > 0 && nearest > 60) {
      G.player.hiddenTimer += dt;
      if (G.player.hiddenTimer > 10) {
        G.player.wanted -= 1;
        G.player.hiddenTimer = 0;
        G.hud.setWanted(G.player.wanted);
        G.hud.toast(G.player.wanted === 0 ? 'You lost them — heat is off' : 'Heat cooling off…');
        if (G.player.wanted === 0) G.audio.sirenStop();
      }
    } else {
      G.player.hiddenTimer = 0;
    }

    // Siren volume follows the nearest patrol car.
    G.audio.sirenLevel(nearest);
  },

  /** Clear every patrol car (mission reset, respawn, save load). */
  clear(G) {
    for (const car of G.policeCars) {
      G.scene.remove(car.mesh);
      G.cars.splice(G.cars.indexOf(car), 1);
    }
    G.policeCars.length = 0;
    G.player.wanted = 0;
    G.hud.setWanted(0);
    G.audio.sirenStop();
  },
};

function spawnPatrolCar(G) {
  const rng = G.rng;
  const lines = roadLines();
  // Spawn on a road 60–110 units away, preferably ahead of the player.
  let x = 0;
  let z = 0;
  for (let tries = 0; tries < 20; tries++) {
    const L = rng.pick(lines);
    const along = rng.range(-240, 240);
    const horizontal = rng.chance(0.5);
    x = horizontal ? along : L + (rng.chance(0.5) ? 4 : -4);
    z = horizontal ? L + (rng.chance(0.5) ? 4 : -4) : along;
    if (dist2D(x, z, G.player.x, G.player.z) > 55) break;
  }
  const heading = Math.atan2(G.player.x - x, G.player.z - z);
  const car = createCar(G, {
    x, z, heading,
    color: 0x14161a,
    kind: 'police',
    police: true,
    maxSpeed: 34,
  });
  car.speed = 20;
  G.effects.burst(x, 1, z, 0x6688ff, 6);
  return car;
}
