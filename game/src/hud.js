// Velmora Bay — the HUD. Health, cash, wanted stars, the in-game clock,
// speed, the mission objective card, interaction prompts, toast messages,
// the live canvas minimap, and the start / pause / busted / wasted /
// chapter-complete screens. All DOM, drawn over the WebGL canvas.

import { money, clockText, clamp } from './util.js';

const STAR_ON = '★';
const STAR_OFF = '☆';

export class Hud {
  constructor(G) {
    this.G = G;
    const $ = (id) => document.getElementById(id);
    this.el = {
      healthFill: $('health-fill'),
      healthText: $('health-text'),
      cash: $('cash'),
      stars: $('stars'),
      clock: $('clock'),
      day: $('day'),
      speed: $('speed'),
      objectiveTitle: $('obj-title'),
      objectiveText: $('obj-text'),
      objectiveMeta: $('obj-meta'),
      prompt: $('prompt'),
      toast: $('toast'),
      crosshair: $('crosshair'),
      ammo: $('ammo'),
      minimap: $('minimap'),
      startScreen: $('start-screen'),
      pauseScreen: $('pause-screen'),
      bustedScreen: $('busted-screen'),
      wastedScreen: $('wasted-screen'),
      completeScreen: $('complete-screen'),
      startBtn: $('start-btn'),
      continueBtn: $('continue-btn'),
      resumeBtn: $('resume-btn'),
      saveBtn: $('save-btn'),
      restartBtn: $('restart-btn'),
      menuHint: $('menu-hint'),
      hurtFlash: $('hurt-flash'),
      saveState: $('save-state'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastTimer = null;
    this.mapTimer = 0;
    this.lastObjective = '';
  }

  // ---------------------------------------------------------- state

  setHealth(h, max) {
    const pct = clamp((h / max) * 100, 0, 100);
    this.el.healthFill.style.width = pct + '%';
    this.el.healthFill.style.background = pct > 50 ? '#58c96b' : pct > 25 ? '#e8a13a' : '#d64545';
    this.el.healthText.textContent = Math.ceil(h);
  }

  setCash(cash) {
    this.el.cash.textContent = money(cash);
  }

  setAmmo(ammo) {
    this.el.ammo.textContent = 'AMMO ' + ammo;
  }

  setWanted(stars) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < stars ? STAR_ON : STAR_OFF;
    this.el.stars.textContent = s;
    this.el.stars.classList.toggle('hot', stars >= 3);
  }

  setClock(minutes, day) {
    this.el.clock.textContent = clockText(minutes);
    this.el.day.textContent = 'DAY ' + day;
  }

  setSpeed(kmh, inCar) {
    this.el.speed.textContent = inCar ? Math.round(kmh) + ' km/h' : '';
  }

  setObjective(title, text, meta = '', seconds = 0) {
    const key = title + '|' + text;
    this.el.objectiveTitle.textContent = title;
    this.el.objectiveText.textContent = text;
    let metaText = meta;
    if (seconds > 0) metaText = (metaText ? metaText + '  •  ' : '') + '⏱ ' + seconds + 's';
    this.el.objectiveMeta.textContent = metaText;
    if (key !== this.lastObjective) {
      this.lastObjective = key;
      this.el.objectiveTitle.parentElement.classList.remove('pop');
      void this.el.objectiveTitle.parentElement.offsetWidth;
      this.el.objectiveTitle.parentElement.classList.add('pop');
    }
  }

  setPrompt(text) {
    this.el.prompt.textContent = text;
    this.el.prompt.style.display = text ? 'block' : 'none';
  }

  toast(text, seconds = 4) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.style.opacity = '0';
    }, seconds * 1000);
  }

  flashHurt() {
    const f = this.el.hurtFlash;
    f.style.opacity = '0.45';
    setTimeout(() => { f.style.opacity = '0'; }, 140);
  }

  // ---------------------------------------------------------- screens

  showStart(hasSave) {
    this.el.startScreen.style.display = 'flex';
    this.el.continueBtn.style.display = hasSave ? 'inline-block' : 'none';
    this.el.pauseScreen.style.display = 'none';
    this.el.bustedScreen.style.display = 'none';
    this.el.wastedScreen.style.display = 'none';
    this.el.completeScreen.style.display = 'none';
  }

  hideScreens() {
    for (const key of ['startScreen', 'pauseScreen', 'bustedScreen', 'wastedScreen', 'completeScreen']) {
      this.el[key].style.display = 'none';
    }
  }

  showPause() {
    this.el.pauseScreen.style.display = 'flex';
  }

  hidePause() {
    this.el.pauseScreen.style.display = 'none';
  }

  showBusted(cashLost) {
    this.el.bustedScreen.style.display = 'flex';
    document.getElementById('busted-detail').textContent =
      'The Velmora PD took you in. Bail cost you ' + money(cashLost) + '.';
  }

  showWasted(cashLost) {
    this.el.wastedScreen.style.display = 'flex';
    document.getElementById('wasted-detail').textContent =
      'You woke up at Velmora General, ' + money(cashLost) + ' lighter.';
  }

  showComplete(cash) {
    this.el.completeScreen.style.display = 'flex';
    document.getElementById('complete-detail').textContent =
      'All three Kade jobs done. Rook walks away with ' + money(cash) + ' — and the whole bay ahead of him.';
  }

  setSaveState(text) {
    this.el.saveState.textContent = text;
  }

  // ---------------------------------------------------------- minimap

  /** Draw the live minimap: roads, buildings, water, cars, cops, marker. */
  drawMinimap(G) {
    const ctx = this.mapCtx;
    const S = 220;
    const WORLD = 560; // -280..+280
    const toMap = (v) => ((v + WORLD / 2) / WORLD) * S;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(16, 22, 26, 0.88)';
    ctx.fillRect(0, 0, S, S);

    // Bay water along the south edge.
    ctx.fillStyle = '#1d5f86';
    ctx.fillRect(0, toMap(280), S, S - toMap(280));
    ctx.fillStyle = '#d9c48f';
    ctx.fillRect(0, toMap(274), S, toMap(280) - toMap(274));

    // Roads.
    ctx.strokeStyle = '#5a6068';
    ctx.lineWidth = 5;
    for (const L of G.city.lines) {
      ctx.beginPath();
      ctx.moveTo(toMap(L), 0);
      ctx.lineTo(toMap(L), S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, toMap(L));
      ctx.lineTo(S, toMap(L));
      ctx.stroke();
    }

    // Buildings.
    ctx.fillStyle = '#2c343c';
    for (const b of G.city.buildings) {
      ctx.fillRect(toMap(b.minX), toMap(b.minZ), toMap(b.maxX) - toMap(b.minX), toMap(b.maxZ) - toMap(b.minZ));
    }

    // Mission marker: a pulsing yellow diamond.
    const m = G.mission;
    if (m.active && m.target) {
      const pulse = 5 + Math.sin(G.time.elapsed * 5) * 2;
      ctx.fillStyle = '#ffc233';
      const mx = toMap(m.target.x);
      const mz = toMap(m.target.z);
      ctx.beginPath();
      ctx.moveTo(mx, mz - pulse);
      ctx.lineTo(mx + pulse, mz);
      ctx.lineTo(mx, mz + pulse);
      ctx.lineTo(mx - pulse, mz);
      ctx.closePath();
      ctx.fill();
    }

    // Pedestrians: tiny grey dots.
    ctx.fillStyle = '#9aa0a6';
    for (const ped of G.peds) {
      ctx.fillRect(toMap(ped.x) - 1, toMap(ped.z) - 1, 2, 2);
    }
    // Traffic: yellow dots.
    ctx.fillStyle = '#ffd94a';
    for (const car of G.traffic) {
      ctx.beginPath();
      ctx.arc(toMap(car.x), toMap(car.z), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Police: flashing blue/red dots.
    const flashBlue = Math.sin(G.time.elapsed * 9) > 0;
    ctx.fillStyle = flashBlue ? '#3a86ff' : '#ff3a3a';
    for (const car of G.policeCars) {
      ctx.beginPath();
      ctx.arc(toMap(car.x), toMap(car.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player: a white arrow pointing along their heading.
    const px = toMap(G.player.x);
    const pz = toMap(G.player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-G.player.heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North tick.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', S - 14, 14);
  }

  /** Called every frame; the minimap itself refreshes at ~12 Hz. */
  update(G, dt) {
    this.mapTimer += dt;
    if (this.mapTimer > 0.08) {
      this.mapTimer = 0;
      this.drawMinimap(G);
    }
    const kmh = Math.abs(G.player.speed) * 3.2;
    this.setSpeed(kmh, G.player.inCar);
    this.setHealth(G.player.health, G.player.maxHealth);
    this.el.crosshair.style.display = (!G.player.inCar && G.state === 'playing') ? 'block' : 'none';
  }
}
