// Velmora Bay — missions and story. Three chained jobs for the Kade
// crew, each with on-screen objectives, a 3D beacon over the target, a
// distance readout and a fail / retry state. Rook Marlow, ex-wheelman,
// is trying to buy his way out of Velmora Bay one job at a time.

import * as THREE from 'three';
import { dist2D, money } from './util.js';

/**
 * The job chain. Each mission is a list of steps; a step completes when
 * the player reaches its target (or presses E there, for pickups).
 */
export const MISSION_DEFS = [
  {
    id: 'pickup',
    title: 'JOB 1 — THE PICKUP',
    briefing: 'Vera Kade: "Rook. A package is waiting at Marlin Market. Walk in, grab it, don\'t make a scene. The crew is counting on you."',
    steps: [
      { text: 'Pick up the package at Marlin Market', place: 'market', radius: 6, action: 'grab' },
    ],
    reward: 500,
  },
  {
    id: 'getaway',
    title: 'JOB 2 — THE GETAWAY',
    briefing: 'Vera Kade: "The package is hot — Velmora PD just lit up the market. Get it to the hideout. You have 90 seconds. Drive like you mean it."',
    steps: [
      { text: 'Drive the package to the Kade hideout', place: 'hideout', radius: 8, action: 'arrive' },
    ],
    reward: 800,
    timeLimit: 90,
    wantedOnStart: 2,
  },
  {
    id: 'drop',
    title: 'JOB 3 — THE DROP',
    briefing: 'Vera Kade: "Last leg. The buyer waits at Pelican Pier — hand the package to the contact, then get yourself to the safehouse. After this, you\'re square with us."',
    steps: [
      { text: 'Deliver the package to the contact at Pelican Pier', place: 'pier', radius: 6, action: 'grab' },
      { text: 'Get to the safehouse — you\'re done', place: 'safehouse', radius: 8, action: 'arrive' },
    ],
    reward: 1200,
  },
];

/** A tall beacon + floating marker over the current objective. */
function makeBeacon(THREE) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.4, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 30;
  group.add(beam);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.4, 0),
    new THREE.MeshBasicMaterial({ color: 0xffc233 }),
  );
  gem.position.y = 7;
  group.add(gem);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.18, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc233 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  group.add(ring);
  return { group, gem, ring, beam };
}

export const missions = {
  /** Start (or restart) mission number i. */
  start(G, i) {
    const def = MISSION_DEFS[i];
    if (!def) return;
    G.mission.index = i;
    G.mission.step = 0;
    G.mission.def = def;
    G.mission.timer = def.timeLimit ?? 0;
    G.mission.active = true;
    G.mission.failed = false;
    if (def.wantedOnStart && G.player.wanted < def.wantedOnStart) {
      G.player.wanted = def.wantedOnStart;
      G.hud.setWanted(G.player.wanted);
      G.audio.sirenStart();
    }
    this.placeBeacon(G);
    G.hud.setObjective(def.title, this.currentStep(G).text, '');
    G.hud.toast(def.briefing, 7);
    G.audio.blip(520, 0.15);
  },

  currentStep(G) {
    return G.mission.def.steps[G.mission.step];
  },

  /** Move the beacon to the current step's target. */
  placeBeacon(G) {
    const step = this.currentStep(G);
    const place = G.city.places[step.place];
    const beacon = G.mission.beacon;
    beacon.group.position.set(place.x, 0, place.z);
    beacon.group.visible = true;
    G.mission.target = { x: place.x, z: place.z, radius: step.radius };
  },

  /** Create the beacon meshes once at load. */
  init(G) {
    const beacon = makeBeacon(THREE);
    beacon.group.visible = false;
    G.scene.add(beacon.group);
    G.mission.beacon = beacon;
  },

  /** Per-frame: beacon spin, timer, arrival checks. */
  update(G, dt) {
    const m = G.mission;
    if (!m.active || m.failed) return;
    const beacon = m.beacon;
    beacon.gem.rotation.y += dt * 2;
    beacon.gem.position.y = 7 + Math.sin(G.time.elapsed * 2.2) * 0.6;
    beacon.ring.rotation.z += dt * 0.8;

    if (m.timer > 0) {
      m.timer -= dt;
      if (m.timer <= 0) {
        this.fail(G, 'Out of time — the crew moved on without you.');
        return;
      }
    }

    const step = this.currentStep(G);
    const d = dist2D(G.player.x, G.player.z, m.target.x, m.target.z);
    const distText = Math.round(d) + ' m';
    G.hud.setObjective(m.def.title, step.text, distText, m.timer > 0 ? Math.ceil(m.timer) : 0);

    if (d < m.target.radius) {
      if (step.action === 'arrive') {
        this.completeStep(G);
      } else {
        G.hud.setPrompt('Press E — ' + (m.def.id === 'pickup' ? 'grab the package' : 'hand over the package'));
        G.mission.inRange = true;
      }
    } else {
      G.mission.inRange = false;
    }
  },

  /** E was pressed inside the target radius for a pickup step. */
  interact(G) {
    const m = G.mission;
    if (!m.active || m.failed || !m.inRange) return false;
    this.completeStep(G);
    return true;
  },

  completeStep(G) {
    const m = G.mission;
    G.audio.pickup();
    G.effects.burst(m.target.x, 1.5, m.target.z, 0xffc233, 24);
    G.hud.setPrompt('');
    m.step++;
    if (m.step >= m.def.steps.length) {
      this.completeMission(G);
    } else {
      this.placeBeacon(G);
      G.hud.toast('Objective updated', 3);
    }
  },

  completeMission(G) {
    const m = G.mission;
    const def = m.def;
    G.player.cash += def.reward;
    G.player.ammo = Math.min(48, G.player.ammo + 12);
    G.hud.setAmmo(G.player.ammo);
    G.hud.setCash(G.player.cash);
    G.hud.toast('JOB DONE — +' + money(def.reward), 4);
    G.audio.missionComplete();
    m.beacon.group.visible = false;
    m.active = false;
    G.stats.missionsDone++;
    G.main.saveGame(G);
    const next = m.index + 1;
    if (next < MISSION_DEFS.length) {
      // A breath, then the next job calls in.
      m.nextAt = G.time.elapsed + 2.5;
      m.pending = next;
    } else {
      G.hud.setObjective('CHAPTER COMPLETE', 'Velmora Bay is yours — for now.', '');
      G.main.chapterComplete(G);
    }
  },

  fail(G, reason) {
    const m = G.mission;
    m.failed = true;
    m.beacon.group.visible = false;
    G.hud.toast('JOB FAILED — ' + reason, 5);
    G.hud.setObjective(m.def.title, 'Job failed — press R to retry', '');
    G.audio.blip(180, 0.4);
    G.player.wanted = Math.max(0, G.player.wanted - 1);
    G.hud.setWanted(G.player.wanted);
  },

  /** Retry the failed mission from its start. */
  retry(G) {
    if (!G.mission.failed) return;
    G.police.clear(G);
    this.start(G, G.mission.index);
  },
};
