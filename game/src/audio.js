// Velmora Bay — sound, all synthesised with WebAudio. No audio files,
// no network: an engine hum that follows the car's speed, a two-tone
// police siren, gunshots and punches from shaped noise, pickup blips,
// and a low-key bass-and-pluck music loop over a four-chord cycle.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engine = null;
    this.siren = null;
    this.sirenOn = false;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicOn = false;
  }

  /** Build the audio graph on the first user gesture. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  // ---------------------------------------------------------- engine

  engineStart() {
    if (!this.ensure() || this.engine) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 28;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc2.start();
    gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.3);
    this.engine = { osc, osc2, filter, gain };
  }

  engineStop() {
    if (!this.engine) return;
    const e = this.engine;
    this.engine = null;
    e.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
    setTimeout(() => {
      try { e.osc.stop(); e.osc2.stop(); } catch { /* already stopped */ }
    }, 300);
  }

  /** Engine pitch and growl follow the car's speed (0..40). */
  engineSpeed(speed) {
    if (!this.engine) return;
    const s = Math.abs(speed);
    this.engine.osc.frequency.value = 50 + s * 3.2;
    this.engine.osc2.frequency.value = 25 + s * 1.6;
    this.engine.filter.frequency.value = 320 + s * 22;
    this.engine.gain.gain.value = 0.045 + Math.min(0.05, s * 0.0012);
  }

  // ---------------------------------------------------------- siren

  sirenStart() {
    if (!this.ensure() || this.siren) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 720;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    this.siren = { osc, gain, high: false };
    this.sirenOn = true;
    // Two-tone wail, swapping every 0.42 seconds.
    this.siren.timer = setInterval(() => {
      if (!this.siren) return;
      this.siren.high = !this.siren.high;
      this.siren.osc.frequency.value = this.siren.high ? 980 : 720;
    }, 420);
  }

  sirenStop() {
    if (!this.siren) return;
    clearInterval(this.siren.timer);
    const s = this.siren;
    this.siren = null;
    this.sirenOn = false;
    try {
      s.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
      setTimeout(() => { try { s.osc.stop(); } catch { /* stopped */ } }, 300);
    } catch { /* no context */ }
  }

  /** Siren loudness by distance to the nearest patrol car. */
  sirenLevel(nearestDist) {
    if (!this.siren) return;
    const v = nearestDist > 120 ? 0 : 0.055 * (1 - nearestDist / 120);
    this.siren.gain.gain.value = this.muted ? 0 : v;
  }

  // ---------------------------------------------------------- one-shots

  /** Short sine blip, sliding up. */
  blip(freq = 880, dur = 0.1) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  /** Two-note pickup chime. */
  pickup() {
    if (!this.ensure()) return;
    this.blip(660, 0.1);
    setTimeout(() => this.blip(990, 0.16), 90);
  }

  /** A little four-note fanfare for a finished job. */
  missionComplete() {
    if (!this.ensure()) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.22), i * 110));
  }

  /** A dull impact thud. */
  thud(strength = 0.6) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3 * strength, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  /** A short filtered-noise punch. */
  punch() {
    if (!this.ensure()) return;
    this.noiseBurst(0.09, 900, 0.25);
  }

  /** A gunshot: a sharp noise crack plus a low thump. */
  gunshot() {
    if (!this.ensure()) return;
    this.noiseBurst(0.14, 2600, 0.5);
    this.thud(0.7);
  }

  /** White noise through a band-pass filter, fading fast. */
  noiseBurst(dur, freq, vol) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  // ---------------------------------------------------------- music

  /** A slow bass-and-pluck loop: Am – F – C – G, one bar each. */
  musicStart() {
    if (!this.ensure() || this.musicOn) return;
    this.musicOn = true;
    // Roots in Hz: A2, F2, C3, G2.
    const roots = [110, 87.31, 130.81, 98];
    const penta = [0, 3, 5, 7, 10, 12, 15];
    const stepDur = 60 / 96 / 2; // 96 BPM eighth notes
    let nextTime = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.musicOn) return;
      while (nextTime < this.ctx.currentTime + 0.15) {
        const step = this.musicStep;
        const bar = Math.floor(step / 8) % 4;
        const root = roots[bar];
        if (step % 2 === 0) this.note(root / 2, stepDur * 1.8, 'triangle', 0.11, nextTime);
        if (step % 8 === 6) this.note(root * 2, stepDur, 'sine', 0.05, nextTime);
        if (step % 4 === 2) {
          const degree = penta[(step * 7 + bar * 3) % penta.length];
          this.note(root * 2 * Math.pow(2, degree / 12), stepDur * 0.9, 'triangle', 0.045, nextTime);
        }
        this.musicStep++;
        nextTime += stepDur;
      }
      this.musicTimer = setTimeout(tick, 40);
    };
    tick();
  }

  musicStop() {
    this.musicOn = false;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  /** One scheduled synth note, at `when` (an AudioContext time). */
  note(freq, dur, type, vol, when) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
