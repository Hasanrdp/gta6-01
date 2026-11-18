// Velmora Bay 3D — configuration: world layout, tuning, story missions, radio.
// Everything the game needs to know up front, in one place. All distances in
// metres, all speeds in m/s, all angles in radians. The city is a seeded grid;
// the same seed always builds the same city.
export const STEP = 1 / 60;
export const BEST_KEY = 'velmora-bay-3d-best';
export const SAVE_KEY = 'velmora-bay-3d-save';

// --- city ---------------------------------------------------------------
export const BLOCK = 44; // side of one city block, metres
export const ROAD = 14; // road width between blocks
export const GRID = 7; // blocks per side (7x7)
export const CITY = GRID * BLOCK + (GRID + 1) * ROAD; // full city span
export const HALF = CITY / 2;
export const BAY_Y = -HALF - 46; // waterline south of the city (bay)
export const MAX_BUILDING_H = 64;
export const MIN_BUILDING_H = 9;

// Sunset palette for the buildings (warm plaster, brick, glass).
export const BUILDING_COLORS = [
  [0.82, 0.62, 0.45], [0.72, 0.55, 0.42], [0.55, 0.48, 0.52],
  [0.45, 0.55, 0.62], [0.85, 0.72, 0.55], [0.62, 0.42, 0.38],
  [0.38, 0.48, 0.55], [0.78, 0.58, 0.62], [0.5, 0.58, 0.45],
];
export const ROOF_COLORS = [
  [0.32, 0.28, 0.26], [0.45, 0.35, 0.3], [0.25, 0.3, 0.35], [0.55, 0.45, 0.35],
];
export const CAR_COLORS = [
  [0.85, 0.15, 0.12], [0.12, 0.25, 0.85], [0.95, 0.8, 0.1], [0.1, 0.7, 0.25],
  [0.9, 0.9, 0.92], [0.15, 0.15, 0.18], [0.75, 0.35, 0.1], [0.55, 0.15, 0.6],
  [0.2, 0.75, 0.8], [0.95, 0.55, 0.1],
];

// --- player --------------------------------------------------------------
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 10.5;
export const PLAYER_RADIUS = 0.55;
export const PLAYER_HEIGHT = 1.8;
export const MAX_HEALTH = 100;

// --- cars -----------------------------------------------------------------
export const CAR_LENGTH = 4.4;
export const CAR_WIDTH = 1.9;
export const CAR_MAX_SPEED = 30;
export const CAR_ACCEL = 13;
export const CAR_BRAKE = 26;
export const CAR_TURN = 1.9;
export const TRAFFIC_COUNT = 14;
export const PED_COUNT = 26;

// --- police / wanted ------------------------------------------------------
export const WANTED_DECAY_SECONDS = 14; // quiet seconds to drop one star
export const POLICE_RAM_DAMAGE = 6;
export const MAX_WANTED = 5;

// --- camera ----------------------------------------------------------------
export const CAM_HEIGHT = 4.6;
export const CAM_DIST = 8.5;
export const CAM_CAR_HEIGHT = 5.2;
export const CAM_CAR_DIST = 10.5;

// --- radio ------------------------------------------------------------------
export const RADIO_STATIONS = [
  { name: 'BAY FM 98.2 — Synthwave', root: 55, scale: [0, 3, 5, 7, 10], bpm: 96, wave: 'sawtooth' },
  { name: 'VELMORA LO-FI 101.5', root: 48, scale: [0, 2, 3, 7, 9], bpm: 72, wave: 'triangle' },
  { name: 'PIER ELECTRO 104.7', root: 50, scale: [0, 2, 5, 7, 10], bpm: 122, wave: 'square' },
];

// --- story ------------------------------------------------------------------
// Rico Vale, driver for hire. Mara is the fixer. Each mission: a briefing, a
// chain of objectives (go here, do that), a cash reward. Objectives are
// { kind: 'goto'|'pickup'|'deliver'|'escape'|'collect'|'steal', x, z, radius, label }.
export const MISSIONS = [
  {
    id: 1, title: 'Job 1 — The Pickup', pay: 250,
    brief: 'Mara: "Rico, a package is waiting at the docks. Drive over, grab it, bring it to the motel. No cops, no problems."',
    objectives: [
      { kind: 'goto', x: -HALF + 30, z: HALF - 30, radius: 6, label: 'Reach the docks' },
      { kind: 'pickup', x: -HALF + 30, z: HALF - 30, radius: 4, label: 'Pick up the package (E)' },
      { kind: 'goto', x: HALF - 60, z: -HALF + 60, radius: 6, label: 'Deliver to the motel' },
    ],
  },
  {
    id: 2, title: 'Job 2 — Getaway Driver', pay: 600,
    brief: 'Mara: "The crew hit the casino. Pick me up at the plaza — and be ready to run. Cops will be on us."',
    objectives: [
      { kind: 'goto', x: 0, z: 0, radius: 6, label: 'Pick up Mara at the plaza' },
      { kind: 'pickup', x: 0, z: 0, radius: 4, label: 'Mara is in — GO (E)' },
      { kind: 'escape', x: HALF - 40, z: HALF - 40, radius: 10, label: 'Lose the heat — reach the safehouse' },
    ],
    wantedOnStart: 2,
  },
  {
    id: 3, title: 'Job 3 — The Drop', pay: 500,
    brief: 'Mara: "Three bags stashed around the north blocks. On foot, quiet. Patrols are out — don\'t get spotted."',
    objectives: [
      { kind: 'collect', x: -HALF + 90, z: -HALF + 40, radius: 4, label: 'Collect bag 1/3 (E)' },
      { kind: 'collect', x: -HALF + 40, z: -HALF + 130, radius: 4, label: 'Collect bag 2/3 (E)' },
      { kind: 'collect', x: HALF - 80, z: -HALF + 60, radius: 4, label: 'Collect bag 3/3 (E)' },
      { kind: 'goto', x: 0, z: HALF - 60, radius: 6, label: 'Return to the garage' },
    ],
    onFoot: true,
  },
  {
    id: 4, title: 'Job 4 — Hot Wheels', pay: 900,
    brief: 'Mara: "A Comet GT is sitting in the showroom lot. Take it. The alarm will bring cops — outrun them to the chop shop."',
    objectives: [
      { kind: 'steal', x: HALF - 30, z: HALF - 110, radius: 6, label: 'Steal the Comet GT (E)' },
      { kind: 'escape', x: -HALF + 50, z: -HALF + 50, radius: 10, label: 'Deliver the GT to the chop shop' },
    ],
    wantedOnStart: 3,
  },
  {
    id: 5, title: 'Job 5 — The Big One', pay: 2500,
    brief: 'Mara: "The bank. The boat. Everything we worked for. Drive the crew in, grab the loot, and get us to the pier. No stopping."',
    objectives: [
      { kind: 'goto', x: HALF - 90, z: 0, radius: 6, label: 'Pick up the crew at the bank' },
      { kind: 'pickup', x: HALF - 90, z: 0, radius: 4, label: 'Crew is in — GO (E)' },
      { kind: 'escape', x: -HALF + 20, z: HALF - 20, radius: 12, label: 'Escape to the boat at the pier' },
    ],
    wantedOnStart: 4,
  },
];

export const STORY_COMPLETE = 'Velmora Bay is yours, Rico. Mara is already counting the money.';
