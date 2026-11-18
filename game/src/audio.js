// Sound: everything is synthesized with WebAudio, no audio files. Three
// procedural radio stations (a sequencer plays a bass line, a lead melody and
// a hat), plus engine hum, sirens, gunshots, crashes and UI chimes. Audio
// only starts after the first user gesture (browser policy); the game runs
// fine silent, and screenshots never need it.
import { RADIO_STATIONS } from './config.js';

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let radioGain = null;
  let sfxGain = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOscA = null;
  let sirenOscB = null;
  let sirenGain = null;
  let station = 0;
  let radioTimer = null;
  let step = 0;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      radioGain = ctx.createGain();
      radioGain.gain.value = 0.16;
      radioGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.5;
      sfxGain.connect(master);
      // Engine: two detuned saws through a lowpass, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      const engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 50.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(lp);
      engineOsc2.connect(lp);
      lp.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      // Siren: alternating two tones.
      sirenOscA = ctx.createOscillator();
      sirenOscA.type = 'triangle';
      sirenOscA.frequency.value = 660;
      sirenOscB = ctx.createOscillator();
      sirenOscB.type = 'triangle';
      sirenOscB.frequency.value = 880;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOscA.connect(sirenGain);
      sirenOscB.connect(sirenGain);
      sirenGain.connect(master);
      sirenOscA.start();
      sirenOscB.start();
      return true;
    } catch {
      return false;
    }
  }

  function note(freq, time, dur, type, gain, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    g.connect(dest);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  function hat(time, gain) {
    const len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(hp);
    hp.connect(g);
    g.connect(radioGain);
    src.start(time);
  }

  // One 8th-note step of the current station's loop: bass on 1 & 3, lead
  // walks the scale, hats on the off-beats. Deterministic per step index.
  function radioStep() {
    if (!ctx || muted) return;
    const st = RADIO_STATIONS[station];
    const spb = 60 / st.bpm / 2;
    const t = ctx.currentTime + 0.02;
    const bar = Math.floor(step / 8) % 4;
    const beat = step % 8;
    const root = st.root + [0, 0, -4, 5][bar];
    if (beat === 0 || beat === 4) note(midiToFreq(root), t, spb * 1.8, 'sine', 0.5, radioGain);
    if (beat === 2 || beat === 6) note(midiToFreq(root + 7), t, spb * 1.4, 'sine', 0.3, radioGain);
    const seq = [0, 2, 1, 3, 2, 4, 3, 5];
    const deg = st.scale[seq[step % 8] % st.scale.length] + 12 * (seq[step % 8] >= st.scale.length ? 1 : 0);
    if (beat % 2 === 0) note(midiToFreq(root + 12 + deg), t, spb * 0.9, st.wave, 0.14, radioGain);
    if (beat % 2 === 1) hat(t, 0.1);
    step += 1;
    const next = Math.max(0.03, spb - (ctx.currentTime - t + 0.02));
    radioTimer = window.setTimeout(radioStep, next * 1000);
  }

  function startRadio() {
    if (!ensure() || radioTimer !== null) return;
    step = 0;
    radioStep();
  }

  function stopRadio() {
    if (radioTimer !== null) {
      window.clearTimeout(radioTimer);
      radioTimer = null;
    }
  }

  function blip(freq, dur, type, gain) {
    if (!ensure()) return;
    note(freq, ctx.currentTime, dur, type, gain, sfxGain);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setStation(i) {
      station = ((i % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
      step = 0;
    },
    stationName() {
      return RADIO_STATIONS[station].name;
    },
    startRadio,
    stopRadio,
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
      if (m) stopRadio();
      else startRadio();
    },
    setEngine(speed01, on) {
      if (!ctx || !engineOsc) return;
      const f = 46 + speed01 * 130;
      engineOsc.frequency.setTargetAtTime(f, ctx.currentTime, 0.06);
      engineGain.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.05 : 0, ctx.currentTime, 0.1);
    },
    setSiren(on) {
      if (!ctx || !sirenGain) return;
      sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, ctx.currentTime, 0.2);
      if (on) {
        const t = ctx.currentTime;
        sirenOscA.frequency.setValueAtTime(660, t);
        sirenOscA.frequency.setValueAtTime(880, t + 0.4);
        sirenOscA.frequency.setValueAtTime(660, t + 0.8);
        sirenOscB.frequency.setValueAtTime(880, t);
        sirenOscB.frequency.setValueAtTime(660, t + 0.4);
        sirenOscB.frequency.setValueAtTime(880, t + 0.8);
      }
    },
    pickup() { blip(880, 0.12, 'sine', 0.4); window.setTimeout(() => blip(1320, 0.15, 'sine', 0.35), 70); },
    mission() {
      blip(523, 0.12, 'triangle', 0.4);
      window.setTimeout(() => blip(659, 0.12, 'triangle', 0.4), 110);
      window.setTimeout(() => blip(784, 0.2, 'triangle', 0.45), 220);
      window.setTimeout(() => blip(1047, 0.3, 'triangle', 0.4), 330);
    },
    crash() {
      if (!ensure()) return;
      const len = Math.floor(ctx.sampleRate * 0.18);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      src.connect(lp);
      lp.connect(g);
      g.connect(sfxGain);
      src.start();
    },
    shoot() {
      if (!ensure()) return;
      const len = Math.floor(ctx.sampleRate * 0.08);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.4;
      src.connect(g);
      g.connect(sfxGain);
      src.start();
    },
    punch() { blip(140, 0.08, 'square', 0.3); },
  };
}
