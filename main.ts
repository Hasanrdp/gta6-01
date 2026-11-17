// Velmora Bay — the entry program for make.fun's gta6-01 bounty.
//
// What this program does, in three steps:
//   1. Copies this repository's game/ (the playable open-world game, plain
//      static files) into the output directory.
//   2. Copies screenshots/ (four real renders of the game) alongside it.
//   3. Writes dossier.json with buildDossier from vendor/makefun-game.ts,
//      the judge's summary of the game and its screenshots.
//
// It runs on Node 22 with the standard library only, writes nothing but
// the output directory, and is deterministic: two runs over the same
// repository produce byte-identical output.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// (In the grader, MAKEFUN_OUTPUT_DIR is unset and /output is used.)
// Play the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The gate's own caps, from the kit's reference/gate.json. */
const GATE_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

/** Copy a directory tree, refusing anything that is not a plain file or directory. */
function copyTree(src: string, dest: string): void {
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = lstatSync(from);
    if (st.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copyTree(from, to);
    } else if (st.isFile()) {
      cpSync(from, to);
    } else {
      throw new Error(`refusing to copy ${from}: not a plain file or directory`);
    }
  }
}

function handIn(repoDir: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });

  const gameSrc = join(repoDir, 'game');
  const gameDest = join(outDir, 'game');
  mkdirSync(gameDest, { recursive: true });
  copyTree(gameSrc, gameDest);

  const shotsSrc = join(repoDir, 'screenshots');
  const shotsDest = join(outDir, 'screenshots');
  mkdirSync(shotsDest, { recursive: true });
  if (existsSync(shotsSrc)) copyTree(shotsSrc, shotsDest);

  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, GATE_CAPS));
}

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
handIn(repoDir, outDir);
