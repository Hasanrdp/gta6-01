# Velmora Bay 3D

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Hasanrdp/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Hasanrdp/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An open-world crime game in the spirit of GTA 6, built for the
[make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01). It runs offline in
a desktop browser from static files — a raw WebGL2 engine, no library, no
network request. Everything in it is original: the city, the characters, the
vehicles, the story, the art, the sound and the music.

## The game

You are **Rico Vale**, a driver for hire in **Velmora Bay**, a sunset island
city. Your fixer **Mara** has five jobs for you — and the whole city, its
traffic, its pedestrians and its police, is in the way.

- **A living city**: a seeded 7×7 grid of blocks with hundreds of buildings,
  roads, lamps, trees, a beach and a pier over the bay.
- **On foot and by car**: walk the sidewalks, steal any car on the street,
  drive with arcade handling, handbrake turns and traffic to dodge.
- **Wanted system and police**: commit crimes and the stars climb; police cars
  chase and ram you, foot cops run you down. Lay low and the heat cools off.
- **Five story missions**: a pickup at the docks, a casino getaway, a quiet
  three-bag drop, stealing a Comet GT from the showroom lot, and the big bank
  job that ends at the boat on the pier.
- **Combat**: fists from the start, a pistol after Job 1.
- **HUD and minimap**: cash, health, wanted stars, objective tracker, speed,
  a circular minimap with traffic, police and the mission marker.
- **Radio**: three procedural stations (synthwave, lo-fi, electro) plus engine
  hum, sirens, gunshots and crashes — all synthesized with WebAudio.
- **Save**: progress, cash and health persist in local storage.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

Controls: **WASD** move / drive, **Shift** sprint, **E** enter car / interact,
**F** punch, **click** shoot (once armed), **Space** handbrake, **R** radio,
**M** mute, **P** pause, drag the mouse to look around.

## How it is built

- `game/index.html` — the page, HUD and minimap.
- `game/src/main.js` — boot, fixed-step loop, screens, save/load, screenshots.
- `game/src/config.js` — world tuning, story missions, radio stations.
- `game/src/world.js` — the seeded city, traffic, pedestrians, police,
  player physics, combat and missions.
- `game/src/render.js` — the WebGL2 scene, HUD and minimap.
- `game/src/gl.js` — the WebGL2 core: shaders, box mesh, static batches.
- `game/src/math.js` — matrices and vectors. `game/src/random.js` — seeded RNG.
- `game/src/audio.js` — procedural radio and sound effects.
- `game/src/input.js` — keyboard and mouse. `game/src/shots.js` — the four
  deterministic screenshot scenes.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json`. `serve.ts` — the local static server.

Screenshots are deterministic: `?shot=start|drive|chase|mission&seed=1337`
stages a fixed scene from a fixed seed. The entry ships four 1280×720 shots.

## License

MIT. See [LICENSE](LICENSE).
