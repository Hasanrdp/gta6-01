# Velmora Bay — an open-world crime game

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/Hasanrdp/gta6-01/rank.svg)](https://make.fun/c/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/Hasanrdp/gta6-01/reward.svg)](https://make.fun/c/gta6-01)

**Velmora Bay** is a complete, original 3D open-world crime game that plays
offline in a desktop browser from static files — an entry for make.fun's
[gta6-01 "Make GTA 6"](https://make.fun/c/gta6-01) bounty. Rook Marlow came
back to the sun-soaked coastal city of Velmora Bay with $250, a borrowed
jacket and a debt to the Kade crew. Three jobs stand between him and a clean
slate — if the Velmora PD doesn't catch him first.

Everything in the game is original: the city, the characters, the vehicles,
the story, the art and the synthesised sound. Nothing comes from Rockstar
Games or any other commercial game.

## Play it

```sh
node serve.ts
# then open http://localhost:8080
```

No build step, no network request at runtime. Just Node 22 and a desktop
browser (Chrome works best). The game lives entirely under `game/`:
`index.html` plus ES modules under `game/src/`, with three.js vendored as
`game/vendor/three.min.js`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move on foot / drive |
| Mouse | Look around · Click to shoot the pistol |
| E | Enter a car · steal a car · grab / hand over a package |
| F | Punch |
| Shift | Run |
| P / Esc | Pause |
| R | Retry a failed job |
| M | Mute |

## Systems

- **The city** — a fixed-seed grid of blocks, streets, sidewalks, crosswalks,
  streetlights, trees and the bay itself, with Pelican Pier reaching out over
  the water. Buildings have lit-window facades; the afternoon sun casts real
  shadows.
- **On foot and by car** — a third-person walker with a mouse-orbit camera,
  and arcade driving with steering, brakes, reverse, collisions and skid
  marks. Press E near any parked or traffic car to steal it.
- **Traffic and pedestrians** — cars cruise the road grid and turn at
  intersections; pedestrians stroll the sidewalks and flee from gunfire and
  speeding cars.
- **Wanted level (0–5 stars)** — stealing cars, hitting pedestrians, shooting
  in public and ramming patrol cars raise the heat. Patrol cars spawn to match
  it, chase and ram you, and can bust you on foot if they corner you. Hide out
  of sight and the heat cools off, one star at a time. Get busted or wasted
  and you wake up at Velmora General, lighter in the pocket.
- **Missions and story** — three chained jobs for fixer Vera Kade: pick up a
  package at Marlin Market, a 90-second getaway drive to the Kade hideout
  with the cops on your tail, and a delivery to the contact at Pelican Pier
  before reaching the safehouse. On-screen objectives, a golden beacon over
  each target, a countdown timer, and fail / retry states.
- **Combat** — punch up close, or fire the pistol (mouse click) with a muzzle
  flash, tracers and hit feedback.
- **HUD** — health, cash, ammo, wanted stars, in-game clock, speed, mission
  objective card, and a live canvas minimap showing roads, buildings,
  traffic, police, pedestrians and the mission marker.
- **Start, pause and save** — a start screen with the story and controls, a
  pause menu, and save / load through localStorage (auto-saved on every
  finished job).
- **Sound** — everything is synthesised with WebAudio: an engine hum that
  follows your speed, a two-tone police siren, gunshots, punches, pickup
  chimes and a bass-and-pluck music loop. No audio files.

## Source layout

```
game/
  index.html            the page: HUD, menus, import map for three.js
  vendor/three.min.js   three.js r160, vendored
  src/
    main.js             bootstrap, game loop, save/load, busted/wasted
    city.js             the seeded city: ground, buildings, props, bay
    player.js           the on-foot walker and the chase camera
    vehicles.js         car meshes, driving physics, traffic AI, stealing
    police.js           wanted level, patrol-car pursuit, busting
    pedestrians.js      sidewalk walkers, fleeing, knock-downs
    missions.js         the three-job story chain and the beacon
    combat.js           punching and pistol fire
    hud.js              HUD, minimap, menus, toasts
    audio.js            WebAudio synth: engine, siren, shots, music
    effects.js          particles, skid marks, tracers, muzzle flash
    util.js             seeded RNG, math helpers, canvas textures
main.ts                 the entry program: copies game/ + screenshots/ and
                        writes dossier.json with vendor/makefun-game.ts
screenshots/           four real renders of the game
```

## License

MIT — see [LICENSE](LICENSE).
