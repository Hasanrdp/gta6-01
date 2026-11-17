// Velmora Bay — combat. A punch for close quarters (F) and a pistol
// (mouse click) with a muzzle flash, tracer particles and simple hits.
// Hitting a pedestrian is a crime; the Velmora PD notices gunfire.

import * as THREE from 'three';
import { dist2D, forwardOf } from './util.js';
import { pedKnockDown, scarePeds } from './pedestrians.js';

export const combat = {
  /** Swing a fist at whatever is right in front of the player. */
  punch(G) {
    const p = G.player;
    if (p.inCar || p.punchCooldown > 0 || G.state !== 'playing') return;
    p.punchCooldown = 0.45;
    G.audio.punch();
    const f = forwardOf(p.heading);
    let hitAny = false;
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      const dx = ped.x - p.x;
      const dz = ped.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4 && (dx * f.x + dz * f.z) > 0.4) {
        pedKnockDown(G, ped);
        G.police.addWanted(G, 1, 'punching a pedestrian');
        hitAny = true;
      }
    }
    // A punch can also dent a nearby car.
    for (const car of G.cars) {
      if (car === p.car) continue;
      const d = dist2D(p.x, p.z, car.x, car.z);
      if (d < 3) {
        G.effects.burst(car.x, 1, car.z, 0xcccccc, 6);
        hitAny = true;
      }
    }
    if (hitAny) G.hud.toast('That\'s assault, Rook.');
    // Arm swing: a quick dip of the view so the punch reads on screen.
    G.player.punchAnim = 0.18;
  },

  /** Fire the pistol toward the centre of the screen. */
  shoot(G) {
    const p = G.player;
    if (p.inCar || G.state !== 'playing') return;
    if (p.shootCooldown > 0) return;
    if (p.ammo <= 0) {
      G.audio.blip(160, 0.08);
      G.hud.toast('Out of ammo — find a new piece (jobs pay in bullets)');
      p.shootCooldown = 0.3;
      return;
    }
    p.shootCooldown = 0.28;
    p.ammo--;
    G.audio.gunshot();
    G.hud.setAmmo(p.ammo);

    // Muzzle flash at the camera, tracer out along the aim ray.
    const cam = G.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const start = origin.clone().add(dir.clone().multiplyScalar(1.2));
    G.effects.muzzle(start, dir);
    G.effects.tracer(start, dir, 46);

    // Hit test: pedestrians and cars in a narrow cone along the ray.
    let hit = false;
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      const toPed = new THREE.Vector3(ped.x - start.x, 1.2 - start.y, ped.z - start.z);
      const along = toPed.dot(dir);
      if (along < 2 || along > 46) continue;
      const closest = start.clone().add(dir.clone().multiplyScalar(along));
      if (closest.distanceTo(new THREE.Vector3(ped.x, 1.2, ped.z)) < 1.6) {
        pedKnockDown(G, ped);
        G.police.addWanted(G, 1, 'shooting in public');
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const car of G.cars) {
        const toCar = new THREE.Vector3(car.x - start.x, 1 - start.y, car.z - start.z);
        const along = toCar.dot(dir);
        if (along < 2 || along > 46) continue;
        const closest = start.clone().add(dir.clone().multiplyScalar(along));
        if (closest.distanceTo(new THREE.Vector3(car.x, 1, car.z)) < 2.4) {
          G.effects.burst(car.x, 1.2, car.z, 0xffaa33, 12);
          G.audio.thud(0.4);
          if (car.police) G.police.addWanted(G, 1, 'shooting in public');
          hit = true;
          break;
        }
      }
    }
    if (!hit) {
      // A miss still kicks up dust where the round lands.
      const end = start.clone().add(dir.clone().multiplyScalar(40));
      G.effects.burst(end.x, 0.3, end.z, 0xbbbbbb, 4);
    }
    scarePeds(G, p.x, p.z, 30);
  },

  /** Cooldowns tick down every frame. */
  update(G, dt) {
    const p = G.player;
    p.punchCooldown = Math.max(0, p.punchCooldown - dt);
    p.shootCooldown = Math.max(0, p.shootCooldown - dt);
    p.punchAnim = Math.max(0, (p.punchAnim ?? 0) - dt);
  },
};
