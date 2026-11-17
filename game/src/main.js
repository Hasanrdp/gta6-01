// Velmora Bay — an open-world crime game in the spirit of GTA 6, built
// from scratch for the make.fun gta6-01 bounty. Three.js renders a
// sun-soaked coastal city; the player walks and drives through it,
// steals cars, dodges the Velmora PD, and runs three jobs for the Kade
// crew. Everything is original: the city, the names, the story, the art
// and the synthesised sound.
//
// This file is the bootstrap: renderer, lights, game state, input, the
// main loop, save/load, the busted / wasted / chapter-complete flows,
// and the ?scene= setups the screenshots use.

import * as THREE from 'three';
import { Rng, clamp } from './util.js';
import { buildCity } from './city.js';
import { makePlayerMesh, updatePlayerOnFoot, updateCamera } from './player.js';
import { createCar, spawnParkedCars, spawnTraffic, updatePlayerCar, updateTraffic, nearestStealableCar, enterCar, exitCar, PLAYER_CAR_COLORS } from './vehicles.js';
import { police } from './police.js';
import { spawnPeds, updatePeds } from './pedestrians.js';
import { missions, MISSION_DEFS } from './missions.js';
import { combat } from './combat.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { Hud } from './hud.js';

export const SAVE_KEY = 'velmora-bay-save-v1';
const CITY_SEED = 20261117;

const params = new URLSearchParams(location.search);
const SCENE = params.get('scene') || '';
const SEED = Number(params.get('seed')) || CITY_SEED;

/** The whole game state, shared by every system. */
const G = {
  seed: SEED,
  rng: new Rng(SEED),
  state: 'menu', // menu | playing | paused | busted | wasted | complete
  scene: null,
  camera: null,
  renderer: null,
  city: null,
  input: {
    keys: new Set(),
    camYaw: Math.PI * 0.75,
    camPitch: 0.32,
    dragging: false,
    pointerLocked: false,
  },
  player: {
    mesh: null,
    parts: null,
    x: 0, y: 0, z: 0,
    heading: 0,
    speed: 0,
    walkPhase: 0,
    health: 100,
    maxHealth: 100,
    cash: 250,
    ammo: 24,
    wanted: 0,
    inCar: false,
    car: null,
    punchCooldown: 0,
    shootCooldown: 0,
    punchAnim: 0,
    crimeAt: {},
    bustTimer: 0,
    hiddenTimer: 0,
    lastHurtAt: -1e9,
    godTimer: 0,
  },
  cars: [],
  traffic: [],
  policeCars: [],
  peds: [],
  mission: {
    index: 0, step: 0, def: null, timer: 0,
    active: false, failed: false, inRange: false,
    target: null, beacon: null, pending: null, nextAt: 0,
  },
  time: { elapsed: 0, minutes: 8 * 60, day: 1 },
  stats: { crimes: 0, carsStolen: 0, pedsHit: 0, missionsDone: 0 },
  audio: new GameAudio(),
  effects: null,
  hud: null,
  sun: null,
  hemi: null,
  police,
  main: null, // filled below, after the flow functions exist
};

// ------------------------------------------------------------------ flow

function damagePlayer(g, amount) {
  const p = g.player;
  if (g.state !== 'playing' || p.godTimer > 0) return;
  p.health -= amount;
  p.lastHurtAt = g.time.elapsed;
  g.hud.flashHurt();
  if (p.health <= 0) {
    p.health = 0;
    wasted(g);
  }
}

function busted(g) {
  if (g.state !== 'playing') return;
  g.state = 'busted';
  const lost = Math.floor(g.player.cash * 0.25);
  g.player.cash -= lost;
  police.clear(g);
  g.audio.sirenStop();
  g.audio.engineStop();
  g.hud.setCash(g.player.cash);
  g.hud.showBusted(lost);
  document.exitPointerLock?.();
  saveGame(g);
}

function wasted(g) {
  if (g.state !== 'playing') return;
  g.state = 'wasted';
  const lost = Math.floor(g.player.cash * 0.25);
  g.player.cash -= lost;
  police.clear(g);
  g.audio.sirenStop();
  g.audio.engineStop();
  g.hud.setCash(g.player.cash);
  g.hud.showWasted(lost);
  document.exitPointerLock?.();
  saveGame(g);
}

function chapterComplete(g) {
  g.state = 'complete';
  g.hud.showComplete(g.player.cash);
  g.audio.musicStop();
  document.exitPointerLock?.();
  saveGame(g);
}

/** Respawn after busted / wasted, at Velmora General. */
function respawn(g) {
  const h = g.city.places.hospital;
  if (g.player.inCar) exitCar(g);
  g.player.x = h.x + 4;
  g.player.z = h.z + 4;
  g.player.heading = 0;
  g.player.health = g.player.maxHealth;
  g.player.wanted = 0;
  g.player.bustTimer = 0;
  g.player.godTimer = 4;
  g.player.mesh.position.set(g.player.x, 0, g.player.z);
  g.player.mesh.visible = true;
  g.hud.setHealth(g.player.health, g.player.maxHealth);
  g.hud.setWanted(0);
  g.hud.hideScreens();
  g.state = 'playing';
  updateCamera(g, 0, true);
}

function saveGame(g) {
  try {
    const data = {
      cash: g.player.cash,
      health: g.player.health,
      ammo: g.player.ammo,
      missionIndex: g.mission.active ? g.mission.index : (g.mission.pending ?? g.mission.index),
      x: g.player.x,
      z: g.player.z,
      heading: g.player.heading,
      minutes: g.time.minutes,
      day: g.time.day,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    g.hud.setSaveState('Saved just now');
  } catch {
    g.hud.setSaveState('Save failed — storage unavailable');
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

G.main = { damagePlayer, busted, wasted, chapterComplete, saveGame, respawn };

// ------------------------------------------------------------------ setup

function initRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // Software rendering (headless SwiftShader, llvmpipe) cannot afford a
  // big soft shadow map: use a smaller map and cheaper filtering there.
  // The adaptive step-down in the main loop covers slow hardware too.
  let softwareGL = false;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    softwareGL = /swiftshader|llvmpipe|software/i.test(name);
  } catch { /* the label is a nicety, not a requirement */ }
  G.softwareGL = softwareGL;
  renderer.shadowMap.type = softwareGL ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  document.getElementById('game').replaceWith(renderer.domElement);
  renderer.domElement.id = 'game';
  G.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc8e8);
  scene.fog = new THREE.Fog(0xbfd9e8, 240, 560);
  G.scene = scene;

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, 6, -12);
  G.camera = camera;

  // Afternoon sun over the bay, warm and high.
  const sun = new THREE.DirectionalLight(0xffe7bf, 2.4);
  sun.castShadow = true;
  const shadowSize = G.softwareGL ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  G.sun = sun;

  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x8a7a5a, 1.1);
  scene.add(hemi);
  G.hemi = hemi;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function initWorld() {
  G.city = buildCity(G.scene, G.seed);
  G.effects = new Effects(G.scene);
  missions.init(G);

  // The player starts at the safehouse.
  const spawn = G.city.spawn;
  const parts = makePlayerMesh();
  G.scene.add(parts.group);
  G.player.parts = parts;
  G.player.mesh = parts.group;
  G.player.x = spawn.x;
  G.player.z = spawn.z;
  G.player.heading = spawn.heading;
  G.input.camYaw = spawn.heading;
  parts.group.position.set(spawn.x, 0, spawn.z);
  parts.group.rotation.y = spawn.heading;

  // Rook's own car, parked on the road east of the safehouse.
  const roadEast = G.city.lines.find((L) => L > G.city.places.safehouse.x);
  const ownCar = createCar(G, {
    x: roadEast + 4, z: G.city.places.safehouse.z, heading: 0,
    color: PLAYER_CAR_COLORS[0], kind: 'player', maxSpeed: 40,
  });
  G.player.ownCar = ownCar;

  applySceneSetup();

  spawnParkedCars(G);
  spawnTraffic(G, 14);
  spawnPeds(G, 22);
}

/** ?scene=cover|street|chase|mission places the player for a screenshot. */
function applySceneSetup() {
  const places = G.city.places;
  const putInCar = (x, z, heading, speed) => {
    const car = createCar(G, {
      x, z, heading, color: PLAYER_CAR_COLORS[1], kind: 'player', maxSpeed: 40,
    });
    car.speed = speed;
    G.player.car = car;
    G.player.inCar = true;
    G.player.mesh.visible = false;
    G.player.x = x;
    G.player.z = z;
    G.player.heading = heading;
    G.player.speed = speed;
    G.input.camYaw = heading;
  };
  const putOnFoot = (x, z, heading) => {
    G.player.x = x;
    G.player.z = z;
    G.player.heading = heading;
    G.player.mesh.position.set(x, 0, z);
    G.player.mesh.rotation.y = heading;
    G.input.camYaw = heading;
  };

  if (SCENE === 'cover') {
    // Driving south down the boulevard, two stars, getaway in progress.
    putInCar(28, -190, 0, 24);
    G.player.wanted = 2;
    missions.start(G, 1);
    G.mission.timer = 88;
  } else if (SCENE === 'street') {
    // On foot in the middle of an intersection, looking south down the
    // boulevard so the traffic, the pedestrians and the city all read in
    // one frame (no trees in the camera's way here).
    putOnFoot(-44, -44, 0);
    missions.start(G, 0);
  } else if (SCENE === 'chase') {
    // Three patrol cars on the player's tail.
    putInCar(-44, -120, 0, 30);
    G.player.wanted = 3;
    missions.start(G, 1);
    G.mission.timer = 74;
  } else if (SCENE === 'mission') {
    // On foot on the road east of Marlin Market, the beacon ahead.
    putOnFoot(-44, -8, -Math.PI / 2);
    missions.start(G, 0);
  }
  if (SCENE) {
    G.hud.setWanted(G.player.wanted);
    G.hud.setCash(G.player.cash);
    G.hud.setHealth(G.player.health, G.player.maxHealth);
    G.hud.setAmmo(G.player.ammo);
  }
}

/** Spawn extra patrol cars for chase screenshots: beside the player, in
 * the next lane, so their light bars read inside the chase camera's frame. */
function applyScenePolice() {
  if (SCENE !== 'cover' && SCENE !== 'chase') return;
  const n = SCENE === 'cover' ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -7 : 7;
    const behind = 6 + i * 6;
    const car = createCar(G, {
      x: G.player.x + side,
      z: G.player.z - behind,
      heading: G.player.heading,
      color: 0x14161a, kind: 'police', police: true, maxSpeed: 34,
    });
    car.speed = G.player.speed;
  }
  G.audio.sirenStart();
}

// ------------------------------------------------------------------ input

function initInput() {
  addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    G.input.keys.add(e.code);

    if (G.state === 'playing') {
      if (e.code === 'KeyE') onInteract();
      if (e.code === 'KeyF') combat.punch(G);
      if (e.code === 'KeyR' && G.mission.failed) missions.retry(G);
      if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
      if (e.code === 'KeyM') G.audio.setMuted(!G.audio.muted);
    } else if (G.state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) {
      resumeGame();
    }
  });
  addEventListener('keyup', (e) => G.input.keys.delete(e.code));
  addEventListener('blur', () => G.input.keys.clear());

  const canvas = () => G.renderer.domElement;
  document.addEventListener('pointerlockchange', () => {
    G.input.pointerLocked = document.pointerLockElement === canvas();
  });
  document.addEventListener('mousemove', (e) => {
    if (G.input.pointerLocked) {
      G.input.camYaw -= e.movementX * 0.0028;
      G.input.camPitch = clamp(G.input.camPitch + e.movementY * 0.0022, -0.15, 0.55);
    } else if (G.input.dragging) {
      G.input.camYaw -= e.movementX * 0.005;
      G.input.camPitch = clamp(G.input.camPitch + e.movementY * 0.004, -0.15, 0.55);
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing') return;
    if (e.target === canvas()) {
      G.input.dragging = true;
      if (!G.input.pointerLocked) {
        try { canvas().requestPointerLock(); } catch { /* headless: ignore */ }
      }
      combat.shoot(G);
    }
  });
  document.addEventListener('mouseup', () => { G.input.dragging = false; });

  // HUD buttons.
  const hud = G.hud.el;
  hud.startBtn.addEventListener('click', () => startGame(false));
  hud.continueBtn.addEventListener('click', () => startGame(true));
  hud.resumeBtn.addEventListener('click', resumeGame);
  hud.saveBtn.addEventListener('click', () => saveGame(G));
  hud.restartBtn.addEventListener('click', () => location.reload());
  document.getElementById('busted-btn').addEventListener('click', () => respawn(G));
  document.getElementById('wasted-btn').addEventListener('click', () => respawn(G));
  document.getElementById('complete-btn').addEventListener('click', () => {
    G.hud.hideScreens();
    G.state = 'playing';
  });
  document.getElementById('mute-btn').addEventListener('click', () => {
    G.audio.setMuted(!G.audio.muted);
    document.getElementById('mute-btn').textContent = G.audio.muted ? '🔇 Sound off' : '🔊 Sound on';
  });
}

function onInteract() {
  const G_ = G;
  if (G_.mission.inRange && missions.interact(G_)) return;
  if (G_.player.inCar) {
    exitCar(G_);
    return;
  }
  const car = nearestStealableCar(G_);
  if (car) enterCar(G_, car);
}

function startGame(fromSave) {
  G.audio.ensure();
  G.audio.musicStart();
  G.hud.hideScreens();
  if (fromSave) {
    const save = loadSave();
    if (save) {
      G.player.cash = save.cash;
      G.player.health = save.health;
      G.player.ammo = save.ammo;
      G.player.x = save.x;
      G.player.z = save.z;
      G.player.heading = save.heading;
      G.time.minutes = save.minutes;
      G.time.day = save.day;
      G.player.mesh.position.set(save.x, 0, save.z);
      G.player.mesh.rotation.y = save.heading;
      G.input.camYaw = save.heading;
      G.hud.setCash(save.cash);
      G.hud.setHealth(save.health, save.maxHealth);
      G.hud.setAmmo(save.ammo);
      if (save.missionIndex < MISSION_DEFS.length) missions.start(G, save.missionIndex);
      G.hud.toast('Save loaded — welcome back to Velmora Bay');
    }
  } else if (!G.mission.active && !SCENE) {
    missions.start(G, 0);
  }
  G.state = 'playing';
  updateCamera(G, 0, true);
  try { G.renderer.domElement.requestPointerLock(); } catch { /* headless */ }
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  G.hud.showPause();
  document.exitPointerLock?.();
}

function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = 'playing';
  G.hud.hidePause();
}

// ------------------------------------------------------------------ loop

let lastT = performance.now();
let firstFrame = true;
const perf = { emaMs: 16, slowFrames: 0, level: 0 };

function tick(now) {
  requestAnimationFrame(tick);
  const rawDt = (now - lastT) / 1000 || 0.016;
  const dt = Math.min(0.05, rawDt);
  lastT = now;

  // Adaptive quality: if frames stay slow, shrink the render scale, then
  // drop shadows entirely. Real GPUs never trip this; software rendering
  // and old laptops stay playable instead of freezing.
  perf.emaMs = perf.emaMs * 0.95 + Math.min(rawDt * 1000, 200) * 0.05;
  if (perf.emaMs > 50) perf.slowFrames++;
  else perf.slowFrames = 0;
  if (perf.slowFrames > 90 && perf.level === 0) {
    perf.level = 1;
    perf.slowFrames = 0;
    G.renderer.setPixelRatio(0.66);
    G.renderer.setSize(innerWidth, innerHeight);
  } else if (perf.slowFrames > 90 && perf.level === 1) {
    perf.level = 2;
    perf.slowFrames = 0;
    G.sun.castShadow = false;
  }

  if (G.state === 'playing') {
    G.time.elapsed += dt;
    // One in-game minute per real second.
    G.time.minutes += dt;
    if (G.time.minutes >= 24 * 60) {
      G.time.minutes -= 24 * 60;
      G.time.day++;
    }
    G.player.godTimer = Math.max(0, G.player.godTimer - dt);

    // Health creeps back after a quiet spell.
    if (G.time.elapsed - G.player.lastHurtAt > 6 && G.player.health < G.player.maxHealth) {
      G.player.health = Math.min(G.player.maxHealth, G.player.health + 2.5 * dt);
    }

    // The next job calls in a few seconds after the last one ends.
    if (G.mission.pending !== null && G.time.elapsed >= G.mission.nextAt) {
      const next = G.mission.pending;
      G.mission.pending = null;
      missions.start(G, next);
    }

    if (G.player.inCar && G.player.car) updatePlayerCar(G, dt);
    else updatePlayerOnFoot(G, dt);
    updateTraffic(G, dt);
    updatePeds(G, dt);
    police.update(G, dt);
    missions.update(G, dt);
    combat.update(G, dt);
    G.effects.update(dt);
    if (G.player.inCar) G.audio.engineSpeed(G.player.speed);
    G.hud.update(G, dt);
    G.hud.setClock(G.time.minutes, G.time.day);

    // The interaction prompt: steal a car, or nothing.
    if (!G.player.inCar && !G.mission.inRange) {
      const car = nearestStealableCar(G);
      G.hud.setPrompt(car ? 'Press E — steal the ' + (car.police ? 'patrol car' : 'car') : '');
    }
  }

  // The sun follows the player so shadows stay crisp nearby.
  G.sun.position.set(G.player.x + 120, 190, G.player.z - 80);
  G.sun.target.position.set(G.player.x, 0, G.player.z);
  G.sun.target.updateMatrixWorld();

  updateCamera(G, dt, firstFrame);
  G.renderer.render(G.scene, G.camera);

  if (firstFrame) {
    firstFrame = false;
    window.__velmoraReady = true;
  }
}

// ------------------------------------------------------------------ boot

function boot() {
  initRenderer();
  G.hud = new Hud(G);
  initWorld();
  initInput();
  applyScenePolice();

  // Scene screenshots skip the menu entirely.
  if (SCENE) {
    G.audio.ensure();
    G.hud.hideScreens();
    G.state = 'playing';
    updateCamera(G, 0, true);
  } else {
    G.hud.showStart(!!loadSave());
    G.hud.setCash(G.player.cash);
    G.hud.setHealth(G.player.health, G.player.maxHealth);
    G.hud.setAmmo(G.player.ammo);
    G.hud.setWanted(0);
    G.hud.setClock(G.time.minutes, G.time.day);
    G.hud.setObjective('VELMORA BAY', 'Press START and meet Vera Kade.', '');
  }

  // Test hooks: the play-test script reads the live state through these.
  window.__velmora = {
    G,
    state: () => ({
      gameState: G.state,
      wanted: G.player.wanted,
      health: Math.round(G.player.health),
      cash: G.player.cash,
      ammo: G.player.ammo,
      missionIndex: G.mission.index,
      missionActive: G.mission.active,
      missionFailed: G.mission.failed,
      missionStep: G.mission.step,
      missionTimer: Math.round(G.mission.timer),
      player: {
        x: +G.player.x.toFixed(1), z: +G.player.z.toFixed(1),
        inCar: G.player.inCar, speed: +G.player.speed.toFixed(1),
      },
      police: G.policeCars.length,
      traffic: G.traffic.length,
      peds: G.peds.length,
      clock: G.time.minutes,
    }),
  };

  requestAnimationFrame(tick);
}

boot();
