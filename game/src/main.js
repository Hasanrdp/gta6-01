// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. Screens: title,
// play, paused, game over, story complete.
//
// ?seed=N fixes the city. ?shot=start|drive|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { createAudio } from './audio.js';
import {
  ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE,
  ACTION_PUNCH, ACTION_RADIO, ACTION_SHOOT, createInput,
} from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_STORY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const status = document.getElementById('status');
const hud = {
  cash: document.getElementById('hud-cash'),
  health: document.getElementById('hud-health'),
  stars: document.getElementById('hud-stars'),
  mission: document.getElementById('hud-mission'),
  objective: document.getElementById('hud-objective'),
  speed: document.getElementById('hud-speed'),
  armed: document.getElementById('hud-armed'),
  banner: document.getElementById('hud-banner'),
  flash: document.getElementById('hud-flash'),
  screen: document.getElementById('hud-screen'),
  radio: document.getElementById('hud-radio'),
  title: document.getElementById('hud-title'),
};

const world = createWorld(seed);
const renderer = createRenderer(canvas, minimap, hud);
renderer.bind(world.state);
const audio = createAudio();

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    const p = world.state.player;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      missionIndex: world.state.missionIndex,
      cash: p.cash,
      health: p.health,
      armed: p.armed,
    }));
  } catch {
    // Storage can be off: the run then lasts this visit only.
  }
}

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Ignore.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  const mission = world.currentMission();
  const objective = world.currentObjective();
  if (scene.screen === 'title') hud.title.style.display = 'block';
  let painted = 0;
  function paint() {
    renderer.draw(world.state, objective, scene.screen, mission, 0);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, () => audio.unlock());
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let titleAngle = 0;
  let radioOn = false;

  function announce(message) {
    status.textContent = message;
  }

  function startGame(fromSave) {
    const save = fromSave ? readSave() : null;
    world.reset();
    if (save) {
      world.state.player.cash = save.cash || 0;
      world.state.player.health = save.health || 100;
      world.state.player.armed = !!save.armed;
      world.startMission(Math.min(save.missionIndex || 0, 4));
    } else {
      world.startMission(0);
    }
    world.state.camOverride = null;
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Follow the yellow marker.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.player.cash > best) {
      best = world.state.player.cash;
      saveBest(best);
    }
    announce(`Wasted. Cash $${world.state.player.cash}. Best $${best}.`);
  }

  function stepAudio() {
    const p = world.state.player;
    const driving = !!p.inCar;
    if (driving && !radioOn) {
      audio.startRadio();
      radioOn = true;
    } else if (!driving && radioOn) {
      audio.stopRadio();
      radioOn = false;
    }
    audio.setEngine(p.inCar ? Math.abs(p.inCar.speed) / 30 : 0, driving);
    audio.setSiren(p.wanted > 0);
    hud.radio.textContent = driving ? `♪ ${audio.stationName()}` : '';
  }

  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      world.state.muted = !world.state.muted;
      audio.setMuted(world.state.muted);
      return;
    }
    if (actions & ACTION_RADIO) {
      audio.setStation(world.state.radioStation + 1);
      world.state.radioStation += 1;
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame(!!readSave());
      return;
    }
    if (screen === SCREEN_OVER || screen === SCREEN_STORY) {
      if (actions & ACTION_CONFIRM) startGame(false);
      return;
    }
    if (actions & ACTION_PAUSE) {
      screen = screen === SCREEN_PLAY ? SCREEN_PAUSED : SCREEN_PLAY;
      announce(screen === SCREEN_PAUSED ? 'Paused.' : 'Playing.');
    }
  }

  function step(actions) {
    if (screen === SCREEN_TITLE) {
      // Slow orbit around the sunset city behind the title.
      titleAngle += STEP * 0.05;
      const r = 320;
      world.state.camOverride = {
        x: Math.sin(titleAngle) * r,
        y: 90,
        z: Math.cos(titleAngle) * r,
        lookX: 0, lookY: 20, lookZ: 0,
      };
      world.step(STEP, input, 0);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    if (input.takeClick() && world.state.player.armed && !world.state.player.inCar) {
      actions |= ACTION_SHOOT;
    }
    const result = world.step(STEP, input, actions);
    if (result.events.shoot) audio.shoot();
    if (result.events.punch) audio.punch();
    if (result.events.crash) audio.crash();
    if (result.events.mission) {
      audio.mission();
      writeSave();
    } else if (result.events.objective) {
      audio.pickup();
    }
    if (result.flags & 4) endGame(); // EVENT_DEAD
    else if (result.flags & 8) {
      screen = SCREEN_STORY;
      writeSave();
      announce('Story complete. Velmora Bay is yours.');
    }
    stepAudio();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    handleActions(actions);
    // Camera orbit from mouse drag.
    world.state.cameraYaw += input.takeCamYaw() * 0.4;
    // Edge actions fire on the first fixed step only, never twice in a frame.
    let first = true;
    while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
      step(first ? actions : 0);
      first = false;
      accumulator -= STEP;
    }
    if (screen !== SCREEN_TITLE && screen !== SCREEN_PLAY) accumulator = 0;
    const mission = world.currentMission();
    const objective = world.currentObjective();
    renderer.draw(world.state, objective, screen, mission, 0);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  hud.title.style.display = 'block';
  announce('Velmora Bay 3D. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
