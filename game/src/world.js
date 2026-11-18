// The world: a seeded grid city, traffic, pedestrians, police, the player,
// and the five story missions. The simulation runs in fixed 1/60 s steps and
// is fully deterministic for a seed: no wall clock, no Math.random.
import {
  BAY_Y, BLOCK, BUILDING_COLORS, CAR_ACCEL, CAR_BRAKE, CAR_COLORS, CAR_LENGTH,
  CAR_MAX_SPEED, CAR_TURN, CAR_WIDTH, CITY, GRID, HALF, MAX_BUILDING_H,
  MAX_HEALTH, MAX_WANTED, MIN_BUILDING_H, MISSIONS, PED_COUNT, PLAYER_HEIGHT,
  PLAYER_RADIUS, POLICE_RAM_DAMAGE, ROAD, ROOF_COLORS, SPRINT_SPEED,
  TRAFFIC_COUNT, WALK_SPEED, WANTED_DECAY_SECONDS,
} from './config.js';
import { createRandom } from './random.js';
import { angleLerp, clamp, dist2D, lerp } from './math.js';

export const EVENT_NONE = 0;
export const EVENT_MISSION = 1;
export const EVENT_OBJECTIVE = 2;
export const EVENT_DEAD = 4;
export const EVENT_STORY = 8;
export const EVENT_CRIME = 16;

// Road centrelines (GRID+1 each way).
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= GRID; i++) lines.push(-HALF + ROAD / 2 + i * (BLOCK + ROAD));
  return lines;
}

function circleVsBox(px, pz, r, b) {
  const cx = clamp(px, b.x - b.w / 2, b.x + b.w / 2);
  const cz = clamp(pz, b.z - b.d / 2, b.z + b.d / 2);
  const dx = px - cx;
  const dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 < 1e-9) return { x: r, z: 0 };
  const d = Math.sqrt(d2);
  return { x: (dx / d) * (r - d), z: (dz / d) * (r - d) };
}

export function createWorld(seed) {
  const rng = createRandom(seed);
  const lines = roadLines();

  // --- buildings: 1-3 per block, seeded footprint/height/colour ------------
  const buildings = [];
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const x0 = -HALF + ROAD + bx * (BLOCK + ROAD);
      const z0 = -HALF + ROAD + bz * (BLOCK + ROAD);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const w = rng.range(12, 22);
        const d = rng.range(12, 22);
        const x = x0 + rng.range(7 + w / 2, BLOCK - 7 - w / 2);
        const z = z0 + rng.range(7 + d / 2, BLOCK - 7 - d / 2);
        const h = rng.range(MIN_BUILDING_H, MAX_BUILDING_H);
        const color = rng.pick(BUILDING_COLORS);
        const roof = rng.pick(ROOF_COLORS);
        buildings.push({ x, z, w, d, h, color, roof });
        // Rooftop box so the skyline reads from above.
        if (rng.chance(0.5)) {
          buildings.push({ x: x + rng.range(-3, 3), z: z + rng.range(-3, 3), w: w * 0.4, d: d * 0.4, h: h + rng.range(2, 5), color: roof, roof, rooftop: true });
        }
      }
    }
  }
  // Keep mission spots, the spawn and the showroom lot clear of buildings.
  const clearZones = [{ x: 0, z: 29, r: 12 }];
  for (const m of MISSIONS) {
    for (const o of m.objectives) clearZones.push({ x: o.x, z: o.z, r: 14 });
  }
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    for (const zone of clearZones) {
      if (Math.hypot(b.x - zone.x, b.z - zone.z) < zone.r + Math.max(b.w, b.d) / 2) {
        buildings.splice(i, 1);
        break;
      }
    }
  }
  // Dock containers (low boxes, no window strips): the docks, the pier and
  // the motel lot read as places, not empty asphalt.
  const CONTAINER_COLORS = [[0.6, 0.25, 0.15], [0.15, 0.3, 0.55], [0.2, 0.45, 0.25], [0.65, 0.5, 0.15]];
  const containers = [
    { x: -168, z: 168, w: 10, d: 3, h: 2.8 },
    { x: -168, z: 176, w: 8, d: 3, h: 2.8 },
    { x: -196, z: 168, w: 8, d: 3, h: 2.8 },
    { x: -160, z: 196, w: 10, d: 3, h: 2.8 },
    { x: -178, z: -232, w: 10, d: 3, h: 2.8 },
    { x: -198, z: -232, w: 8, d: 3, h: 2.8 },
    { x: 138, z: -162, w: 10, d: 3, h: 2.8 },
    { x: 162, z: -138, w: 8, d: 3, h: 2.8 },
  ];
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    buildings.push({ x: c.x, z: c.z, w: c.w, d: c.d, h: c.h, color: CONTAINER_COLORS[i % CONTAINER_COLORS.length], roof: [0.3, 0.28, 0.26] });
  }

  // --- street props: lamps, trees, hydrants ---------------------------------
  const lamps = [];
  const trees = [];
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const x = lines[i];
      const z = lines[j];
      if (rng.chance(0.75)) lamps.push({ x: x + ROAD / 2 - 1.2, z: z + ROAD / 2 - 1.2 });
      if (rng.chance(0.4)) trees.push({ x: x + rng.range(-ROAD / 2 + 2, ROAD / 2 - 2), z: z + rng.range(-ROAD / 2 + 2, ROAD / 2 - 2) });
    }
  }

  // --- the pier + beach (south, over the bay) --------------------------------
  const pier = { x: -HALF + 20, z: BAY_Y + 18, w: 10, d: 46 };

  function collideCircle(x, z, r) {
    let px = x;
    let pz = z;
    for (const b of buildings) {
      const push = circleVsBox(px, pz, r, b);
      if (push) {
        px += push.x;
        pz += push.z;
      }
    }
    return { x: px, z: pz };
  }

  function inCity(x, z) {
    return Math.abs(x) < HALF + 30 && z > BAY_Y - 10 && z < HALF + 30;
  }

  // --- traffic on the road graph --------------------------------------------
  function nodePos(i, j) {
    return { x: lines[i], z: lines[j] };
  }
  function randomEdge(fromI, fromJ, avoidI, avoidJ) {
    const opts = [];
    if (fromI > 0) opts.push([fromI - 1, fromJ]);
    if (fromI < GRID) opts.push([fromI + 1, fromJ]);
    if (fromJ > 0) opts.push([fromI, fromJ - 1]);
    if (fromJ < GRID) opts.push([fromI, fromJ + 1]);
    const filtered = opts.filter(([i, j]) => !(i === avoidI && j === avoidJ));
    const pick = (filtered.length ? filtered : opts)[Math.floor(rng.next() * (filtered.length ? filtered.length : opts.length))];
    return pick;
  }

  function makeTrafficCar() {
    const i = rng.int(0, GRID);
    const j = rng.int(0, GRID);
    const [ni, nj] = randomEdge(i, j, -1, -1);
    const a = nodePos(i, j);
    const b = nodePos(ni, nj);
    return {
      kind: 'traffic',
      x: a.x, z: a.z,
      fromI: i, fromJ: j, toI: ni, toJ: nj,
      t: rng.next(),
      speed: rng.range(7, 11),
      color: rng.pick(CAR_COLORS),
      angle: Math.atan2(b.x - a.x, b.z - a.z),
      stopped: 0,
    };
  }

  const traffic = [];
  for (let i = 0; i < TRAFFIC_COUNT; i++) traffic.push(makeTrafficCar());

  function makePed() {
    const bx = rng.int(0, GRID - 1);
    const bz = rng.int(0, GRID - 1);
    const x0 = -HALF + ROAD + bx * (BLOCK + ROAD);
    const z0 = -HALF + ROAD + bz * (BLOCK + ROAD);
    return {
      x: x0 + rng.range(3, BLOCK - 3),
      z: z0 + rng.range(3, BLOCK - 3),
      tx: x0 + rng.range(3, BLOCK - 3),
      tz: z0 + rng.range(3, BLOCK - 3),
      speed: rng.range(1.1, 2.1),
      angle: 0,
      color: [rng.next() * 0.8 + 0.1, rng.next() * 0.8 + 0.1, rng.next() * 0.8 + 0.1],
      down: 0,
      flee: 0,
    };
  }
  const peds = [];
  for (let i = 0; i < PED_COUNT; i++) peds.push(makePed());

  // --- the player's own car + the mission target car -------------------------
  // Parked on the road (z = 29 is a road centreline), facing along it.
  const playerCar = {
    kind: 'player', x: 0, z: 29, angle: Math.PI / 2, speed: 0, color: [0.85, 0.15, 0.12], parked: true,
  };
  const targetCar = {
    kind: 'target', x: HALF - 30, z: HALF - 110, angle: Math.PI / 2, speed: 0,
    color: [0.95, 0.8, 0.1], parked: true, stolen: false,
  };

  const police = [];
  const cops = [];

  const state = {
    seed, time: 0,
    buildings, lamps, trees, pier,
    traffic, peds, police, cops,
    playerCar, targetCar,
    player: {
      x: 0, z: 34, angle: Math.PI, speed: 0,
      health: MAX_HEALTH, cash: 0, wanted: 0, quiet: 0,
      inCar: null, armed: false, hurt: 0, lastDamage: -99,
    },
    missionIndex: 0,
    objectiveIndex: 0,
    objectiveDone: false,
    storyDone: false,
    dead: false,
    cameraYaw: Math.PI,
    camX: 0, camZ: 38, camY: 6,
    shake: 0,
    banner: '',
    bannerT: 0,
    radioStation: 0,
    muted: false,
    crimeFlash: 0,
  };

  function currentMission() {
    return MISSIONS[state.missionIndex] ?? null;
  }
  function currentObjective() {
    const m = currentMission();
    return m ? m.objectives[state.objectiveIndex] ?? null : null;
  }

  function startMission(index) {
    state.missionIndex = index;
    state.objectiveIndex = 0;
    state.objectiveDone = false;
    const m = currentMission();
    if (!m) return;
    state.banner = m.title;
    state.bannerT = 4;
    if (m.wantedOnStart) state.player.wanted = m.wantedOnStart;
    if (m.onFoot && state.player.inCar) exitCar();
  }

  function addWanted(n) {
    state.player.wanted = clamp(state.player.wanted + n, 0, MAX_WANTED);
    state.player.quiet = 0;
    state.crimeFlash = 1;
  }

  function damagePlayer(amount) {
    const p = state.player;
    p.health -= amount;
    p.hurt = 1;
    p.lastDamage = state.time;
    state.shake = Math.min(1, state.shake + 0.4);
    if (p.health <= 0) {
      p.health = 0;
      state.dead = true;
    }
  }

  function exitCar() {
    const p = state.player;
    if (!p.inCar) return;
    const car = p.inCar;
    car.parked = true;
    car.speed = 0;
    const side = car.angle + Math.PI / 2;
    p.x = car.x + Math.sin(side) * 2.4;
    p.z = car.z + Math.cos(side) * 2.4;
    const fixed = collideCircle(p.x, p.z, PLAYER_RADIUS);
    p.x = fixed.x;
    p.z = fixed.z;
    p.angle = car.angle;
    p.inCar = null;
  }

  function enterCar(car) {
    const p = state.player;
    if (car.kind === 'traffic' && car !== state.playerCar) addWanted(1);
    if (car.kind === 'target' && !car.stolen) {
      car.stolen = true;
      addWanted(3);
      state.banner = 'Comet GT stolen — lose the cops!';
      state.bannerT = 3;
    }
    car.parked = false;
    p.inCar = car;
    p.angle = car.angle;
  }

  function nearestCar(maxDist) {
    const p = state.player;
    let best = null;
    let bestD = maxDist;
    const all = [...traffic, state.playerCar, state.targetCar, ...police];
    for (const c of all) {
      const d = dist2D(p.x, p.z, c.x, c.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function spawnPolice() {
    const p = state.player;
    const want = Math.min(p.wanted, 5);
    while (police.length < want) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(45, 70);
      const x = clamp(p.x + Math.sin(a) * d, -HALF + 10, HALF - 10);
      const z = clamp(p.z + Math.cos(a) * d, -HALF + 10, HALF - 10);
      police.push({
        kind: 'police', x, z, angle: 0, speed: 0,
        color: [0.08, 0.12, 0.2], parked: false, ramCd: 0,
      });
    }
    while (cops.length < (p.wanted >= 2 && !p.inCar ? Math.min(2, p.wanted - 1) : 0)) {
      const a = rng.range(0, Math.PI * 2);
      cops.push({
        x: p.x + Math.sin(a) * 25, z: p.z + Math.cos(a) * 25,
        angle: 0, speed: 0, punchCd: 0, down: 0,
        color: [0.08, 0.12, 0.25],
      });
    }
  }

  function stepTraffic(dt) {
    for (const c of traffic) {
      const a = nodePos(c.fromI, c.fromJ);
      const b = nodePos(c.toI, c.toJ);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      // Slow for a car ahead on the same edge.
      let blocked = false;
      for (const o of traffic) {
        if (o === c || o.fromI !== c.fromI || o.fromJ !== c.fromJ || o.toI !== c.toI || o.toJ !== c.toJ) continue;
        if (o.t > c.t && o.t - c.t < 0.06) blocked = true;
      }
      const target = blocked ? 0 : c.speed;
      c.t += (target * dt) / len;
      if (c.t >= 1) {
        const [ni, nj] = randomEdge(c.toI, c.toJ, c.fromI, c.fromJ);
        c.fromI = c.toI;
        c.fromJ = c.toJ;
        c.toI = ni;
        c.toJ = nj;
        c.t = 0;
        c.speed = rng.range(7, 11);
      }
      const na = nodePos(c.fromI, c.fromJ);
      const nb = nodePos(c.toI, c.toJ);
      // Right-hand lane offset.
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const L = Math.hypot(dx, dz) || 1;
      const ox = (-dz / L) * 3.2;
      const oz = (dx / L) * 3.2;
      c.x = na.x + dx * c.t + ox;
      c.z = na.z + dz * c.t + oz;
      c.angle = Math.atan2(dx, dz);
    }
  }

  function stepPeds(dt, events) {
    for (const ped of peds) {
      if (ped.down > 0) {
        ped.down -= dt;
        continue;
      }
      if (ped.flee > 0) {
        ped.flee -= dt;
        const away = Math.atan2(ped.x - state.player.x, ped.z - state.player.z);
        ped.x += Math.sin(away) * 4.5 * dt;
        ped.z += Math.cos(away) * 4.5 * dt;
        ped.angle = away;
        const fixed = collideCircle(ped.x, ped.z, 0.5);
        ped.x = fixed.x;
        ped.z = fixed.z;
        continue;
      }
      const dx = ped.tx - ped.x;
      const dz = ped.tz - ped.z;
      const d = Math.hypot(dx, dz);
      if (d < 1) {
        ped.tx = ped.x + rng.range(-50, 50);
        ped.tz = ped.z + rng.range(-50, 50);
        ped.tx = clamp(ped.tx, -HALF + 4, HALF - 4);
        ped.tz = clamp(ped.tz, -HALF + 4, HALF - 4);
        continue;
      }
      const want = Math.atan2(dx, dz);
      ped.angle = angleLerp(ped.angle, want, Math.min(1, dt * 6));
      ped.x += Math.sin(ped.angle) * ped.speed * dt;
      ped.z += Math.cos(ped.angle) * ped.speed * dt;
      const fixed = collideCircle(ped.x, ped.z, 0.5);
      ped.x = fixed.x;
      ped.z = fixed.z;
    }
  }

  function stepPolice(dt, events) {
    const p = state.player;
    spawnPolice();
    // Police cars: steer at the player, slide along walls on contact.
    for (const car of police) {
      car.ramCd -= dt;
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const d = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      car.angle = angleLerp(car.angle, want, Math.min(1, dt * 2.2));
      const targetSpeed = d > 6 ? 29 : 18;
      car.speed = lerp(car.speed, targetSpeed, Math.min(1, dt * 1.5));
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      const fixed = collideCircle(car.x, car.z, 2.3);
      car.x = fixed.x;
      car.z = fixed.z;
      if (d < 3.4 && car.ramCd <= 0) {
        car.ramCd = 2;
        car.speed = -6;
        if (p.inCar) {
          damagePlayer(3);
          events.crash = true;
        } else {
          damagePlayer(POLICE_RAM_DAMAGE + 4);
        }
      }
    }
    // On-foot cops chase and punch.
    for (const cop of cops) {
      if (cop.down > 0) {
        cop.down -= dt;
        continue;
      }
      cop.punchCd -= dt;
      const dx = p.x - cop.x;
      const dz = p.z - cop.z;
      const d = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      cop.angle = angleLerp(cop.angle, want, Math.min(1, dt * 5));
      if (d > 1.6) {
        cop.x += Math.sin(cop.angle) * 7 * dt;
        cop.z += Math.cos(cop.angle) * 7 * dt;
        const fixed = collideCircle(cop.x, cop.z, 0.5);
        cop.x = fixed.x;
        cop.z = fixed.z;
      } else if (cop.punchCd <= 0) {
        cop.punchCd = 1;
        damagePlayer(8);
      }
    }
    // Wanted decay when quiet and no police nearby.
    if (p.wanted > 0) {
      let near = false;
      for (const car of police) {
        if (dist2D(p.x, p.z, car.x, car.z) < 45) near = true;
      }
      if (!near) {
        p.quiet += dt;
        if (p.quiet > WANTED_DECAY_SECONDS) {
          p.wanted -= 1;
          p.quiet = 0;
        }
      } else {
        p.quiet = 0;
      }
    }
    if (p.wanted === 0) {
      police.length = 0;
      cops.length = 0;
    }
  }

  function stepPlayer(dt, input, actions, events) {
    const p = state.player;
    p.hurt = Math.max(0, p.hurt - dt * 1.5);
    state.crimeFlash = Math.max(0, state.crimeFlash - dt);
    state.shake = Math.max(0, state.shake - dt * 1.2);
    if (state.bannerT > 0) state.bannerT -= dt;
    if (p.health < MAX_HEALTH && p.wanted === 0 && state.time - p.lastDamage > 5) {
      p.health = Math.min(MAX_HEALTH, p.health + 2 * dt);
    }

    const move = input.move();
    if (p.inCar) {
      const car = p.inCar;
      const fwd = move.y;
      if (fwd > 0) car.speed = Math.min(CAR_MAX_SPEED, car.speed + CAR_ACCEL * dt);
      else if (fwd < 0) car.speed = Math.max(-10, car.speed - CAR_BRAKE * dt);
      else car.speed = lerp(car.speed, 0, Math.min(1, dt * 0.8));
      if (input.handbrake()) car.speed = lerp(car.speed, 0, Math.min(1, dt * 4));
      const steer = move.x * CAR_TURN * (car.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(car.speed) / 8);
      car.angle += steer * dt * (input.handbrake() ? 1.6 : 1);
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      const fixed = collideCircle(car.x, car.z, 2.3);
      if (fixed.x !== car.x || fixed.z !== car.z) {
        if (Math.abs(car.speed) > 12) {
          damagePlayer(4);
          events.crash = true;
        }
        car.speed *= 0.4;
        car.x = fixed.x;
        car.z = fixed.z;
      }
      if (!inCity(car.x, car.z)) {
        car.x = clamp(car.x, -HALF - 26, HALF + 26);
        car.z = clamp(car.z, BAY_Y - 6, HALF + 26);
        car.speed *= 0.5;
      }
      // Running over a pedestrian is a crime.
      for (const ped of peds) {
        if (ped.down > 0) continue;
        if (dist2D(car.x, car.z, ped.x, ped.z) < 2.4 && Math.abs(car.speed) > 3) {
          ped.down = 4;
          ped.flee = 6;
          addWanted(1);
          events.crime = true;
        }
      }
      // Bump traffic cars.
      for (const c of traffic) {
        const d = dist2D(car.x, car.z, c.x, c.z);
        if (d < 3.6 && d > 0.01) {
          const push = (3.6 - d) / 2;
          const nx = (car.x - c.x) / d;
          const nz = (car.z - c.z) / d;
          car.x += nx * push;
          car.z += nz * push;
          if (Math.abs(car.speed) > 10) {
            damagePlayer(3);
            events.crash = true;
          }
          car.speed *= 0.7;
        }
      }
      p.x = car.x;
      p.z = car.z;
      p.angle = car.angle;
      if (actions & 4) exitCar(); // E
    } else {
      const camA = state.cameraYaw;
      const speed = input.sprint() ? SPRINT_SPEED : WALK_SPEED;
      let mx = 0;
      let mz = 0;
      if (move.y !== 0 || move.x !== 0) {
        const fx = Math.sin(camA);
        const fz = Math.cos(camA);
        const rx = Math.sin(camA + Math.PI / 2);
        const rz = Math.cos(camA + Math.PI / 2);
        mx = fx * move.y + rx * move.x;
        mz = fz * move.y + rz * move.x;
        const L = Math.hypot(mx, mz) || 1;
        mx /= L;
        mz /= L;
        p.angle = angleLerp(p.angle, Math.atan2(mx, mz), Math.min(1, dt * 10));
      }
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      p.speed = (move.x !== 0 || move.y !== 0) ? speed : 0;
      const fixed = collideCircle(p.x, p.z, PLAYER_RADIUS);
      p.x = fixed.x;
      p.z = fixed.z;
      if (!inCity(p.x, p.z)) {
        p.x = clamp(p.x, -HALF - 26, HALF + 26);
        p.z = clamp(p.z, BAY_Y - 6, HALF + 26);
      }
      if (actions & 4) {
        // E: interact — enter a car, or advance a pickup/collect objective.
        const car = nearestCar(3.4);
        if (car) {
          enterCar(car);
        } else {
          events.interact = true;
        }
      }
      if (actions & 16) {
        // F: punch whatever is in front.
        events.punch = true;
        for (const ped of peds) {
          if (ped.down > 0) continue;
          const d = dist2D(p.x, p.z, ped.x, ped.z);
          const ang = Math.atan2(ped.x - p.x, ped.z - p.z);
          let diff = Math.abs(ang - p.angle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (d < 2 && diff < 1) {
            ped.down = 3;
            ped.flee = 5;
            addWanted(1);
            events.crime = true;
          }
        }
        for (const cop of cops) {
          if (cop.down > 0) continue;
          const d = dist2D(p.x, p.z, cop.x, cop.z);
          if (d < 2) {
            cop.down = 3;
            addWanted(1);
            events.crime = true;
          }
        }
      }
      if (actions & 32 && p.armed) {
        // Click: shoot toward the camera's forward.
        events.shoot = true;
        addWanted(1);
        for (const cop of cops) {
          if (cop.down > 0) continue;
          const d = dist2D(p.x, p.z, cop.x, cop.z);
          const ang = Math.atan2(cop.x - p.x, cop.z - p.z);
          let diff = Math.abs(ang - p.angle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (d < 26 && diff < 0.35) cop.down = 999;
        }
        for (const ped of peds) {
          if (ped.down > 0) continue;
          const d = dist2D(p.x, p.z, ped.x, ped.z);
          const ang = Math.atan2(ped.x - p.x, ped.z - p.z);
          let diff = Math.abs(ang - p.angle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (d < 26 && diff < 0.35) {
            ped.down = 999;
            ped.flee = 0;
          }
        }
      }
    }
  }

  function stepMissions(dt, events) {
    const m = currentMission();
    if (!m || state.storyDone) return 0;
    const o = currentObjective();
    if (!o) return 0;
    const p = state.player;
    const d = dist2D(p.x, p.z, o.x, o.z);
    let flags = 0;
    const advance = () => {
      state.objectiveIndex += 1;
      events.objective = true;
      if (state.objectiveIndex >= m.objectives.length) {
        p.cash += m.pay;
        events.mission = true;
        state.banner = `${m.title} — DONE. +$${m.pay}`;
        state.bannerT = 4;
        if (m.id === 1) p.armed = true;
        if (state.missionIndex + 1 >= MISSIONS.length) {
          state.storyDone = true;
          flags |= EVENT_STORY;
        } else {
          startMission(state.missionIndex + 1);
        }
      }
    };
    if (o.kind === 'goto' || o.kind === 'escape') {
      if (d < o.radius) {
        if (o.kind === 'escape' && p.wanted > 0) {
          // Reached the spot but still hot: the heat must cool first.
          p.quiet += dt * 2;
          if (p.quiet > 4) {
            p.wanted = 0;
            advance();
          }
        } else {
          advance();
        }
      }
    } else if ((o.kind === 'pickup' || o.kind === 'collect' || o.kind === 'steal') && events.interact && d < o.radius) {
      advance();
    } else if (o.kind === 'steal' && state.targetCar.stolen) {
      advance();
    }
    return flags;
  }

  function stepCamera(dt) {
    if (state.camOverride) {
      state.camX = state.camOverride.x;
      state.camY = state.camOverride.y;
      state.camZ = state.camOverride.z;
      return;
    }
    const p = state.player;
    const inCar = !!p.inCar;
    const dist = inCar ? 10.5 : 8.5;
    const height = inCar ? 5.2 : 4.6;
    const back = p.angle + Math.PI;
    const tx = p.x + Math.sin(back) * dist;
    const tz = p.z + Math.cos(back) * dist;
    state.camX = lerp(state.camX, tx, Math.min(1, dt * 4));
    state.camZ = lerp(state.camZ, tz, Math.min(1, dt * 4));
    state.camY = lerp(state.camY, height, Math.min(1, dt * 4));
    state.cameraYaw = angleLerp(state.cameraYaw, p.angle, Math.min(1, dt * 3));
  }

  return {
    state,
    currentMission,
    currentObjective,
    startMission,
    reset() {
      state.time = 0;
      state.player.health = MAX_HEALTH;
      state.player.cash = 0;
      state.player.wanted = 0;
      state.player.armed = false;
      state.player.x = 0;
      state.player.z = 34;
      state.player.angle = Math.PI;
      state.player.inCar = null;
      state.dead = false;
      state.storyDone = false;
      state.missionIndex = 0;
      state.objectiveIndex = 0;
      state.targetCar.stolen = false;
      state.playerCar.x = 0;
      state.playerCar.z = 29;
      state.playerCar.angle = Math.PI / 2;
      state.playerCar.speed = 0;
      state.police.length = 0;
      state.cops.length = 0;
      startMission(0);
    },
    respawn() {
      const p = state.player;
      p.health = MAX_HEALTH;
      p.cash = Math.max(0, p.cash - 150);
      p.wanted = 0;
      p.x = 0;
      p.z = 34;
      p.angle = Math.PI;
      p.inCar = null;
      state.dead = false;
      state.police.length = 0;
      state.cops.length = 0;
      state.banner = 'Patched up at the hospital. -$150.';
      state.bannerT = 3;
    },
    step(dt, input, actions) {
      const events = { interact: false, punch: false, shoot: false, crash: false, crime: false, objective: false, mission: false };
      state.time += dt;
      stepTraffic(dt);
      stepPeds(dt, events);
      stepPolice(dt, events);
      stepPlayer(dt, input, actions, events);
      const flags = stepMissions(dt, events);
      stepCamera(dt);
      let out = EVENT_NONE;
      if (events.objective) out |= EVENT_OBJECTIVE;
      if (events.mission) out |= EVENT_MISSION;
      if (flags & EVENT_STORY) out |= EVENT_STORY;
      if (state.dead) out |= EVENT_DEAD;
      if (events.crime) out |= EVENT_CRIME;
      return { flags: out, events };
    },
  };
}

export { PLAYER_HEIGHT };
