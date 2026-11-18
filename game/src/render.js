// Rendering: the 3D scene (one WebGL2 program, the city baked into static
// batches, dynamic boxes for cars, people and markers), the DOM HUD and the
// 2D minimap. Sunset look: warm fog, low sun, long colours.
import {
  BAY_Y, BLOCK, CAR_LENGTH, CAR_WIDTH, CITY, GRID, HALF, PLAYER_HEIGHT,
  PLAYER_RADIUS, ROAD,
} from './config.js';
import { createBatch, createGL, drawBatch, drawBox } from './gl.js';
import { mat4Box, mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective, mat4Translate } from './math.js';
import { roadLines } from './world.js';

const FOG_COLOR = [0.96, 0.58, 0.38];
const SUN_DIR = [-0.45, 0.62, 0.55];

function buildStatic(glCtx, world) {
  const b = createBatch(glCtx);
  const lines = roadLines();
  // Ground: asphalt everywhere under the city, sand at the bay.
  b.box(0, -0.15, 0, CITY + 80, 0.3, CITY + 80, [0.38, 0.38, 0.41]);
  b.box(0, -0.1, BAY_Y - 40, CITY + 80, 0.2, 90, [0.85, 0.75, 0.55]);
  // Water.
  b.box(0, -0.05, BAY_Y - 90, CITY + 400, 0.1, 120, [0.1, 0.35, 0.6]);
  // Sidewalk slabs per block.
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const x = -HALF + ROAD + bx * (BLOCK + ROAD) + BLOCK / 2;
      const z = -HALF + ROAD + bz * (BLOCK + ROAD) + BLOCK / 2;
      b.box(x, 0.05, z, BLOCK + 4, 0.1, BLOCK + 4, [0.48, 0.48, 0.5]);
    }
  }
  // Road centre dashes.
  for (let i = 0; i <= GRID; i++) {
    for (let k = -HALF; k < HALF; k += 8) {
      b.box(lines[i], 0.08, k + 4, 0.5, 0.04, 3.5, [0.85, 0.8, 0.4]);
      b.box(k + 4, 0.08, lines[i], 3.5, 0.04, 0.5, [0.85, 0.8, 0.4]);
    }
  }
  // Buildings + roofs.
  for (const bd of world.buildings) {
    b.box(bd.x, bd.h / 2, bd.z, bd.w, bd.h, bd.d, bd.color);
    b.box(bd.x, bd.h + 0.15, bd.z, bd.w + 0.6, 0.3, bd.d + 0.6, bd.roof);
    // Lit windows: a few bright strips on the facade.
    const rows = Math.max(1, Math.floor(bd.h / 7));
    for (let r = 0; r < rows; r++) {
      const y = 3 + r * 7;
      if (y > bd.h - 2) break;
      b.box(bd.x, y, bd.z + bd.d / 2 + 0.06, bd.w * 0.7, 1.1, 0.1, [1, 0.85, 0.45]);
    }
  }
  // Lamps: pole + head.
  for (const l of world.lamps) {
    b.box(l.x, 2.2, l.z, 0.25, 4.4, 0.25, [0.12, 0.12, 0.14]);
    b.box(l.x, 4.5, l.z, 1.1, 0.25, 0.4, [1, 0.9, 0.5]);
  }
  // Trees: trunk + canopy.
  for (const t of world.trees) {
    b.box(t.x, 0.9, t.z, 0.5, 1.8, 0.5, [0.35, 0.22, 0.12]);
    b.box(t.x, 2.6, t.z, 2.6, 2.4, 2.6, [0.15, 0.45, 0.2]);
  }
  // Pier.
  const pier = world.pier;
  b.box(pier.x, 0.6, pier.z, pier.w, 1.2, pier.d, [0.5, 0.38, 0.25]);
  for (let k = 0; k < 5; k++) {
    b.box(pier.x - 3.5, 1.6, pier.z - 18 + k * 9, 0.3, 2.2, 0.3, [0.3, 0.25, 0.2]);
    b.box(pier.x + 3.5, 1.6, pier.z - 18 + k * 9, 0.3, 2.2, 0.3, [0.3, 0.25, 0.2]);
  }
  return b.bake();
}

function carModel(car) {
  return { x: car.x, z: car.z, angle: car.angle, color: car.color };
}

export function createRenderer(canvas, minimap, hud) {
  const glCtx = createGL(canvas);
  const { gl } = glCtx;
  let staticBatch = null;
  let worldRef = null;
  const mctx = minimap.getContext('2d');

  function resize() {
    const w = canvas.clientWidth || 1280;
    const h = canvas.clientHeight || 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function drawCar(mvp, car, t) {
    const body = mat4Box(car.x, 0.75, car.z, car.angle, CAR_WIDTH, 0.85, CAR_LENGTH);
    drawBox(glCtx, mvp, body, car.color);
    const cabin = mat4Box(
      car.x - Math.sin(car.angle) * 0.3, 1.45, car.z - Math.cos(car.angle) * 0.3,
      car.angle, CAR_WIDTH * 0.85, 0.6, CAR_LENGTH * 0.45,
    );
    drawBox(glCtx, mvp, cabin, [0.1, 0.12, 0.18]);
    // Wheels.
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const c = Math.cos(car.angle);
      const s = Math.sin(car.angle);
      const x = car.x + wx * c + wz * s;
      const z = car.z - wx * s + wz * c;
      drawBox(glCtx, mvp, mat4Box(x, 0.35, z, car.angle, 0.3, 0.7, 0.7), [0.05, 0.05, 0.06]);
    }
    // Police light bar, alternating.
    if (car.kind === 'police') {
      const phase = Math.floor(t * 4) % 2 === 0;
      drawBox(glCtx, mvp, mat4Box(car.x, 1.95, car.z, car.angle, 0.5, 0.25, 0.5), phase ? [1, 0.1, 0.1] : [0.15, 0.3, 1], 2.2);
      drawBox(glCtx, mvp, mat4Box(car.x, 1.95, car.z, car.angle, 0.5, 0.25, 0.5), phase ? [0.15, 0.3, 1] : [1, 0.1, 0.1], 0.4);
    }
    // Blob shadow.
    drawBox(glCtx, mvp, mat4Box(car.x, 0.06, car.z, car.angle, CAR_WIDTH + 0.3, 0.06, CAR_LENGTH + 0.3), [0, 0, 0], 0.55);
  }

  function drawPerson(mvp, x, z, angle, color, down, t) {
    if (down > 0 && down < 900) {
      // Lying down.
      drawBox(glCtx, mvp, mat4Box(x, 0.35, z, angle, 0.6, 0.7, 1.9), color);
      return;
    }
    const bob = Math.sin(t * 8 + x) * 0.06;
    drawBox(glCtx, mvp, mat4Box(x, 0.95 + bob, z, angle, 0.7, 1.1, 0.4), color);
    drawBox(glCtx, mvp, mat4Box(x, 1.75 + bob, z, angle, 0.45, 0.45, 0.45), [0.85, 0.65, 0.5]);
    drawBox(glCtx, mvp, mat4Box(x, 0.35, z, angle, 0.6, 0.7, 0.4), [0.15, 0.15, 0.2]);
    drawBox(glCtx, mvp, mat4Box(x, 0.06, z, angle, 0.9, 0.06, 0.9), [0, 0, 0], 0.5);
  }

  function drawMinimap(world, objective) {
    const s = minimap.width;
    const scale = s / (CITY + 100);
    const ox = s / 2;
    const oz = s / 2;
    const X = (x) => ox + x * scale;
    const Z = (z) => oz + z * scale;
    mctx.fillStyle = '#101018';
    mctx.fillRect(0, 0, s, s);
    mctx.fillStyle = '#1d4e7a';
    mctx.fillRect(0, Z(BAY_Y - 90), s, 90 * scale + 20);
    mctx.fillStyle = '#3a3a40';
    for (let i = 0; i <= GRID; i++) {
      const l = roadLines()[i];
      mctx.fillRect(X(l) - 4, 0, 8, s);
      mctx.fillRect(0, Z(l) - 4, s, 8);
    }
    mctx.fillStyle = '#55555e';
    for (const bd of world.buildings) {
      if (bd.rooftop) continue;
      mctx.fillRect(X(bd.x - bd.w / 2), Z(bd.z - bd.d / 2), bd.w * scale, bd.d * scale);
    }
    const p = world.player;
    mctx.fillStyle = '#ffffff';
    for (const c of world.traffic) mctx.fillRect(X(c.x) - 1.5, Z(c.z) - 1.5, 3, 3);
    mctx.fillStyle = '#3b82f6';
    for (const c of world.police) {
      mctx.beginPath();
      mctx.arc(X(c.x), Z(c.z), 3, 0, Math.PI * 2);
      mctx.fill();
    }
    if (objective) {
      mctx.fillStyle = '#facc15';
      mctx.beginPath();
      mctx.arc(X(objective.x), Z(objective.z), 5, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#facc15';
      mctx.beginPath();
      mctx.arc(X(objective.x), Z(objective.z), 8 + Math.sin(world.time * 4) * 2, 0, Math.PI * 2);
      mctx.stroke();
    }
    // Player arrow.
    mctx.save();
    mctx.translate(X(p.x), Z(p.z));
    mctx.rotate(Math.atan2(Math.sin(p.angle), Math.cos(p.angle)) + Math.PI);
    mctx.fillStyle = '#22c55e';
    mctx.beginPath();
    mctx.moveTo(0, -7);
    mctx.lineTo(5, 6);
    mctx.lineTo(-5, 6);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }

  function drawHud(world, objective, screen, mission) {
    const p = world.player;
    hud.cash.textContent = `$${p.cash}`;
    hud.health.style.width = `${Math.max(0, p.health)}%`;
    hud.health.style.background = p.health > 50 ? '#22c55e' : p.health > 25 ? '#f59e0b' : '#ef4444';
    hud.stars.textContent = '★'.repeat(p.wanted) + '☆'.repeat(5 - p.wanted);
    hud.stars.style.color = p.wanted > 0 ? '#facc15' : '#666';
    hud.mission.textContent = mission ? `${mission.title} — $${mission.pay}` : 'Free roam';
    hud.objective.textContent = objective ? objective.label : 'No active objective';
    hud.speed.textContent = p.inCar ? `${Math.round(Math.abs(p.inCar.speed) * 3.6)} km/h` : '';
    hud.armed.textContent = p.armed ? 'PISTOL [click to shoot, F to punch]' : '[F to punch]';
    hud.banner.style.opacity = world.bannerT > 0 ? '1' : '0';
    hud.banner.textContent = world.banner;
    hud.flash.style.opacity = String(p.hurt * 0.55 + world.crimeFlash * 0.12);
    hud.screen.textContent =
      screen === 'title' ? 'VELMORA BAY 3D — press Space to start' :
      screen === 'over' ? 'WASTED — press Space to retry' :
      screen === 'story' ? 'STORY COMPLETE — press Space to free roam' : '';
  }

  return {
    bind(world) {
      worldRef = world;
      staticBatch = buildStatic(glCtx, world);
    },
    draw(world, objective, screen, mission, camYawOffset) {
      resize();
      const p = world.player;
      const t = world.time;
      const shake = world.shake * 0.35;
      // Deterministic jitter from time (no Math.random: screenshots must replay).
      const sx = Math.sin(t * 91.7) * shake * 0.5;
      const sy = Math.cos(t * 113.3) * shake * 0.5;
      const override = world.camOverride;
      const eye = override
        ? [override.x, override.y, override.z]
        : [world.camX + sx, world.camY + sy, world.camZ];
      const look = override
        ? [override.lookX, override.lookY, override.lookZ]
        : [p.x, 1.6, p.z];
      const view = mat4LookAt(eye, look, [0, 1, 0]);
      const proj = mat4Perspective((62 * Math.PI) / 180, canvas.width / canvas.height, 0.1, 900);
      const vp = mat4Multiply(proj, view);
      gl.uniform3fv(glCtx.loc.sun, SUN_DIR);
      gl.uniform3fv(glCtx.loc.fogColor, FOG_COLOR);
      gl.uniform1f(glCtx.loc.fogNear, 90);
      gl.uniform1f(glCtx.loc.fogFar, 420);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawBatch(glCtx, staticBatch, vp, mat4Identity());
      // Mission beacon: a tall glowing column + a bouncing marker.
      if (objective) {
        const bob = Math.sin(t * 3) * 0.6;
        drawBox(glCtx, vp, mat4Box(objective.x, 30, objective.z, 0, 1.2, 60, 1.2), [1, 0.8, 0.1], 1.6);
        drawBox(glCtx, vp, mat4Box(objective.x, 4 + bob, objective.z, t, 1.6, 1.6, 1.6), [1, 0.85, 0.15], 2);
      }
      // Cars.
      for (const c of world.traffic) drawCar(vp, c, t);
      drawCar(vp, world.playerCar, t);
      drawCar(vp, world.targetCar, t);
      for (const c of world.police) drawCar(vp, c, t);
      // People.
      for (const ped of world.peds) drawPerson(vp, ped.x, ped.z, ped.angle, ped.color, ped.down, t);
      for (const cop of world.cops) drawPerson(vp, cop.x, cop.z, cop.angle, cop.color, cop.down, t);
      // Player on foot.
      if (!p.inCar) {
        drawPerson(vp, p.x, p.z, p.angle, [0.9, 0.2, 0.15], 0, t);
      }
      drawMinimap(world, objective);
      drawHud(world, objective, screen, mission);
    },
  };
}

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_STORY = 'story';
