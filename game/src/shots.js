// Deterministic screenshot scenes (?shot=start|drive|chase|mission with
// &seed=N). Each one plays the real rules forward from a fresh world for a
// fixed number of steps, steered by a scripted driver, so the frame is what
// real gameplay looks like and the same seed always gives the same frame.
import { HALF, STEP } from './config.js';
import { clamp } from './math.js';
import { createRandom } from './random.js';
import { roadLines } from './world.js';

function idleInput() {
  return {
    move: () => ({ x: 0, y: 0 }),
    sprint: () => false,
    handbrake: () => false,
    takeActions: () => 0,
    takeCamYaw: () => 0,
  };
}

/** Drive the player's car along the roads, intersection to intersection. */
function driveInput(world) {
  const lines = roadLines();
  const rng = createRandom(99);
  // Start on the road z = 29 heading east; target the next intersection.
  let ti = 5;
  let tj = 4;
  let stuck = 0;
  let brake = false;
  return {
    move: () => {
      const car = world.state.player.inCar;
      if (!car) return { x: 0, y: 0 };
      const tx = lines[ti];
      const tz = lines[tj];
      const dx = tx - car.x;
      const dz = tz - car.z;
      if (Math.hypot(dx, dz) < 9) {
        // At the intersection: pick a neighbouring one (not back the way we came).
        const opts = [];
        if (ti > 0) opts.push([ti - 1, tj]);
        if (ti < lines.length - 1) opts.push([ti + 1, tj]);
        if (tj > 0) opts.push([ti, tj - 1]);
        if (tj < lines.length - 1) opts.push([ti, tj + 1]);
        const pick = opts[Math.floor(rng.next() * opts.length)];
        ti = pick[0];
        tj = pick[1];
        brake = false;
        return { x: 0, y: 1 };
      }
      const want = Math.atan2(dx, dz);
      let diff = want - car.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(car.speed) < 0.5) stuck += 1;
      else stuck = 0;
      if (stuck > 120) {
        brake = false;
        return { x: 0, y: -1 }; // back out of a jam
      }
      // Slow for corners: ease off and handbrake-turn when the turn is sharp.
      const adiff = Math.abs(diff);
      const near = Math.hypot(dx, dz) < 22;
      brake = adiff > 0.8 && Math.abs(car.speed) > 9;
      const throttle = adiff > 0.9 ? 0 : adiff > 0.45 || near ? 0.45 : 1;
      return { x: clamp(diff * 1.6, -1, 1), y: throttle };
    },
    sprint: () => false,
    handbrake: () => brake,
    takeActions: () => 0,
    takeCamYaw: () => 0,
  };
}

/** Walk toward a point (used for the on-foot mission shot). */
function walkInput(world, tx, tz, stopDist = 9) {
  return {
    move: () => {
      const p = world.state.player;
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) < stopDist) return { x: 0, y: 0 };
      // Camera-relative: the camera sits behind the player, so "forward" is
      // toward the target when the camera yaw matches the player angle.
      const want = Math.atan2(dx, dz);
      let diff = want - world.state.cameraYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const fwd = Math.cos(diff);
      const strafe = Math.sin(diff);
      return { x: clamp(strafe * 2, -1, 1), y: clamp(fwd * 2, -1, 1) };
    },
    sprint: () => false,
    handbrake: () => false,
    takeActions: () => 0,
    takeCamYaw: () => 0,
  };
}

function runSteps(world, input, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) world.step(STEP, input, 0);
}

export function stageShot(name, world) {
  const s = world.state;
  if (name === 'start') {
    // Cinematic vista: high over the bay, looking back at the sunset city.
    s.camOverride = { x: -180, y: 38, z: 240, lookX: 0, lookY: 15, lookZ: -20 };
    runSteps(world, idleInput(), 6);
    return { screen: 'title' };
  }
  if (name === 'drive') {
    s.missionIndex = 99; // free roam for the shot
    s.player.inCar = s.playerCar;
    s.playerCar.parked = false;
    s.playerCar.x = 0;
    s.playerCar.z = 29;
    s.playerCar.angle = Math.PI / 2;
    s.player.x = 0;
    s.player.z = 29;
    runSteps(world, driveInput(world), 14);
    return { screen: 'play' };
  }
  if (name === 'chase') {
    s.missionIndex = 99;
    s.player.inCar = s.playerCar;
    s.playerCar.parked = false;
    s.playerCar.x = 0;
    s.playerCar.z = 29;
    s.playerCar.angle = Math.PI / 2;
    s.player.x = 0;
    s.player.z = 29;
    s.player.wanted = 3;
    runSteps(world, driveInput(world), 11);
    return { screen: 'play' };
  }
  if (name === 'mission') {
    // On foot at the showroom lot, about to steal the Comet GT (Job 4). The
    // player approaches from the east so the camera looks back into the city.
    world.startMission(3);
    const tx = HALF - 30;
    const tz = HALF - 110;
    s.player.x = tx + 18;
    s.player.z = tz;
    s.player.angle = Math.atan2(tx - s.player.x, tz - s.player.z);
    s.cameraYaw = s.player.angle;
    s.camX = s.player.x + Math.sin(s.player.angle + Math.PI) * 8.5;
    s.camZ = s.player.z + Math.cos(s.player.angle + Math.PI) * 8.5;
    s.camY = 4.6;
    runSteps(world, walkInput(world, tx, tz, 5), 4);
    return { screen: 'play' };
  }
  // Unknown shot: just the title.
  s.camOverride = { x: -180, y: 38, z: 240, lookX: 0, lookY: 15, lookZ: -20 };
  runSteps(world, idleInput(), 3);
  return { screen: 'title' };
}
