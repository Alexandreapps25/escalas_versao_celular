// MusicKey PRO Studio v2.0 — banda virtual: bateria, pads, baixo, teclado, metrônomo, voz guia
// Agendamento pelo relógio do AudioContext (lookahead), sem depender do setTimeout para o ritmo.
import { noiseBuffer } from './audio.js';
import { chordNotes, parseChord, midiToFreq } from './music.js';

export const METERS = { '4/4': { beats: 4, spb: 4 }, '3/4': { beats: 3, spb: 4 }, '2/4': { beats: 2, spb: 4 }, '6/8': { beats: 2, spb: 6 } };
export const STYLES = {
  worship:   { name: 'Worship',   K: 'x.......x.x.....', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.', O: '..............x.' },
  gospel:    { name: 'Gospel',    K: 'x.....x...x..x..', S: '....x..x....x...', H: 'x.xxx.xxx.xxx.xx', O: '................' },
  pop:       { name: 'Pop',       K: 'x.....x.x.......', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.', O: '................' },
  rock:      { name: 'Rock',      K: 'x.......x.x.....', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.', O: '..............x.' },
  balada:    { name: 'Balada',    K: 'x.........x.....', S: '....x.......x...', H: 'x...x...x...x...', O: '................' },
  acustico:  { name: 'Acústico',  K: 'x.......x.......', S: '....x.......x...', H: 'xxxxxxxxxxxxxxxx', O: '................' },
  sertanejo: { name: 'Sertanejo', K: 'x...x...x...x...', S: '..x...x...x...x.', H: 'x.x.x.x.x.x.x.x.', O: '................' },
  reggae:    { name: 'Reggae',    K: '........x.......', S: '........x.......', H: '..x...x...x...x.', O: '................' }
};
export const SECTIONS = ['intro', 'estrofe', 'pre', 'refrao', 'ponte', 'final'];
export const SECTION_NAMES = { intro: 'Introdução', estrofe: 'Estrofe', pre: 'Pré-refrão', refrao: 'Refrão', ponte: 'Ponte', final: 'Final' };
export const PAD_TIMBRES = { ambient: 'Ambient Worship', warm: 'Warm Pad', strings: 'Strings', atmosphere: 'Atmosphere', piano: 'Soft Piano', organ: 'Organ' };
export const VOICE_CMDS = [
  ['count', 'Um, dois, três, quatro'], ['intro', 'Introdução, preparar'], ['estrofe', 'Primeira estrofe'],
  ['refrao', 'Refrão em quatro tempos'], ['ponte', 'Preparar a ponte'], ['subir', 'Subir um tom'], ['final', 'Último refrão, finalizar']
];

// padrão de 4/4 (16 passos) → adapta ao compasso
export function patternFor(styleId, meter, custom) {
  const m = METERS[meter] || METERS['4/4'], steps = m.beats * m.spb;
  const src = custom || STYLES[styleId] || STYLES.worship;
  const conv = s => {
    if (meter === '4/4') return s.split('').map(c => c === 'x');
    const a = new Array(steps).fill(false);
    if (meter === '6/8') { // 6/8 = 2 tempos de 6 semicolcheias
      const map = { K: [0, 9], S: [6], H: [0,2,4,6,8,10], O: [] }; return a.map((_, i) => (map[s] || []).includes(i));
    }
    for (let i = 0; i < steps; i++) a[i] = s[i % 16] === 'x';
    if (meter === '3/4') { a.fill(false); }
    return a;
  };
  const p = { K: conv(src.K), S: conv(src.S), H: conv(src.H), O: conv(src.O || '') };
  if (meter === '6/8') { p.K = Array.from({ length: steps }, (_, i) => i === 0 || i === 9); p.S = Array.from({ length: steps }, (_, i) => i === 6); p.H = Array.from({ length: steps }, (_, i) => i % 2 === 0); p.O = new Array(steps).fill(false); }
  if (meter === '3/4') { p.K = Array.from({ length: steps }, (_, i) => i === 0); p.S = Array.from({ length: steps }, (_, i) => i === 4 || i === 8); p.H = Array.from({ length: steps }, (_, i) => i % 2 === 0); p.O = new Array(steps).fill(false); }
  if (meter === '2/4') { p.K = Array.from({ length: steps }, (_, i) => i === 0); p.S = Array.from({ length: steps }, (_, i) => i === 4); p.H = Array.from({ length: steps }, (_, i) => i % 2 === 0); p.O = new Array(steps).fill(false); }
  return p;
}

export class Band {
  constructor(engine) {
    this.E = engine; this.playing = false; this.timer = 0;
    this.cfg = { bpm: 76, meter: '4/4', style: 'worship', intensity: 0.7, humanize: 0.3, section: 'estrofe',
      drums: true, pad: true, padTimbre: 'ambient', padMode: 'chord', padThird: true, bass: false, keys: false,
      click: false, clickSub: 1, countIn: true, voice: true, key: 7, minor: false, custom: null };
    this.getChord = () => null; // fornecido pelo app: (bar, beat) → "G"
    this.onBeat = null; this.onBar = null; this.onStop = null;
    this.padVoices = []; this.padChord = null; this.fillNext = false; this.endNext = false;
    this.voiceBuffers = {}; this.queue = [];
  }
  set(p) { Object.assign(this.cfg, p); if ('padTimbre' in p || 'pad' in p || 'key' in p || 'padMode' in p || 'padThird' in p || 'minor' in p) this.refreshPad(true); }
  get m() { return METERS[this.cfg.meter] || METERS['4/4']; }
  get stepDur() { return 60 / this.cfg.bpm / this.m.spb; }

  async start() {
    const ctx = await this.E.init(); if (this.playing) return;
    this.playing = true; this.step = 0; this.bar = 0; this.pattern = patternFor(this.cfg.style, this.cfg.meter, this.cfg.custom);
    this.counting = this.cfg.countIn ? this.m.beats * this.m.spb : 0;
    this.next = ctx.currentTime + 0.12; this.padChord = null; this.endNext = false;
    if (this.counting && this.cfg.voice) this.cueVoice('count', 0);
    this.tick();
  }
  stop(soft) {
    this.playing = false; clearTimeout(this.timer);
    this.releasePad(soft ? 1.5 : 0.3); this.onStop?.();
  }
  // termina com virada + prato
  finish() { this.endNext = true; this.fillNext = true; }
  fill() { this.fillNext = true; }
  tick() {
    if (!this.playing) return;
    const ctx = this.E.ctx, ahead = 0.15;
    while (this.next < ctx.currentTime + ahead) { this.schedule(this.next); this.advance(); }
    this.timer = setTimeout(() => this.tick(), 25);
  }
  advance() { this.next += this.stepDur; }
  schedule(t) {
    const m = this.m, steps = m.beats * m.spb;
    if (this.counting > 0) { // contagem inicial: um compasso de click
      const i = steps - this.counting;
      if (i % m.spb === 0) { this.clickAt(t, i === 0, 'click'); this.uiBeat(t, -1, i / m.spb); }
      this.counting--; return;
    }
    const s = this.step % steps, beat = Math.floor(s / m.spb);
    if (s === 0) { this.bar = Math.floor(this.step / steps); this.uiBar(t); }
    if (s % m.spb === 0) this.uiBeat(t, this.bar, beat);
    const h = this.cfg.humanize, jitter = () => (Math.random() - 0.5) * 0.016 * h, vel = (v) => v * (1 - h * 0.25 * Math.random()) * (0.55 + 0.45 * this.cfg.intensity);
    const lastBarFill = this.fillNext && s >= steps - m.spb; // virada no último tempo do compasso
    const sec = this.cfg.section;
    // ---- bateria ----
    if (this.cfg.drums) {
      const p = this.pattern, I = this.cfg.intensity;
      if (lastBarFill) {
        if (s % 2 === 0 || I > 0.6) this.tom(t + jitter(), 120 + (steps - s) * 18, vel(0.7));
      } else {
        const lite = sec === 'intro' || sec === 'final' && !this.endNext;
        if (p.K[s] && !(lite && s !== 0)) this.kick(t + jitter(), vel(1));
        if (p.S[s] && !lite) this.snare(t + jitter(), vel(sec === 'estrofe' ? 0.7 : 0.9), sec === 'balada' || I < 0.35);
        if (p.H[s] && (I > 0.25 || s % (m.spb) === 0)) this.hat(t + jitter(), vel(s % m.spb === 0 ? 0.5 : 0.32), false);
        if (p.O[s] && (sec === 'refrao' || I > 0.75)) this.hat(t + jitter(), vel(0.4), true);
        if (sec === 'ponte' && s === steps - m.spb) this.tom(t, 160, vel(0.5));
        if (s === 0 && (this.crashNext || (sec === 'refrao' && this.bar % 4 === 0))) { this.crash(t, vel(0.6)); this.crashNext = false; }
      }
    }
    // ---- click ----
    if (this.cfg.click) {
      const sub = Math.max(1, this.cfg.clickSub), every = Math.max(1, Math.round(m.spb / sub));
      if (s % every === 0) this.clickAt(t, s === 0, 'click', s % m.spb !== 0);
    }
    // ---- harmonia: troca de acorde no início de cada tempo, se mudar ----
    if (s % m.spb === 0) {
      const ch = this.getChord(this.bar, beat) || this.keyChord();
      if (this.cfg.pad && ch !== this.padChord) this.playPad(t, ch);
      if (this.cfg.bass) { const pat = this.cfg.style === 'reggae' ? [2] : this.cfg.style === 'sertanejo' ? [0,1,2,3] : [0, 2]; if (pat.includes(beat) || this.m.beats < 4 && beat === 0) this.bassNote(t, ch, beat); }
      if (this.cfg.keys && (beat === 0 || (beat === 2 && this.cfg.intensity > 0.6))) this.keysChord(t, ch);
    }
    this.step++;
    if (s === steps - 1 && this.fillNext) {
      this.fillNext = false; this.crashNext = true;
      if (this.endNext) { const endT = t + this.stepDur; this.crash(endT, 0.8); this.kick(endT, 1); this.playing = false; clearTimeout(this.timer); setTimeout(() => this.stop(true), (endT - this.E.ctx.currentTime) * 1000 + 50); }
    }
  }
  keyChord() { return (['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][this.cfg.key]) + (this.cfg.minor ? 'm' : ''); }
  uiBeat(t, bar, beat) { const d = Math.max(0, (t - this.E.ctx.currentTime) * 1000); setTimeout(() => this.onBeat?.(bar, beat), d); }
  uiBar(t) { const d = Math.max(0, (t - this.E.ctx.currentTime) * 1000), bar = this.bar; setTimeout(() => this.onBar?.(bar), d); }

  // ---- instrumentos (síntese própria, sem licença) ----
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  out(id) { return this.E.input(id); }
  kick(t, v) { const c = this.E.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); this.env(g, t, 0.002, 0.9 * v, 0.35); o.connect(g).connect(this.out('drums')); o.start(t); o.stop(t + 0.45); }
  snare(t, v, rim) {
    const c = this.E.ctx;
    if (rim) { const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = 1700; this.env(g, t, 0.001, 0.35 * v, 0.04); o.connect(g).connect(this.out('drums')); o.start(t); o.stop(t + 0.08); return; }
    const n = c.createBufferSource(); n.buffer = noiseBuffer(c); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    const g = c.createGain(); this.env(g, t, 0.001, 0.55 * v, 0.18); n.connect(f).connect(g).connect(this.out('drums')); n.start(t, Math.random() * 0.5); n.stop(t + 0.25);
    const o = c.createOscillator(), g2 = c.createGain(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08); this.env(g2, t, 0.001, 0.35 * v, 0.1); o.connect(g2).connect(this.out('drums')); o.start(t); o.stop(t + 0.15);
  }
  hat(t, v, open) { const c = this.E.ctx, n = c.createBufferSource(); n.buffer = noiseBuffer(c); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500; const g = c.createGain(); this.env(g, t, 0.001, 0.32 * v, open ? 0.3 : 0.045); n.connect(f).connect(g).connect(this.out('drums')); n.start(t, Math.random() * 0.5); n.stop(t + (open ? 0.35 : 0.08)); }
  crash(t, v) { const c = this.E.ctx, n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4500; const g = c.createGain(); this.env(g, t, 0.003, 0.35 * v, 1.6); n.connect(f).connect(g).connect(this.out('drums')); n.start(t); n.stop(t + 1.8); }
  tom(t, freq, v) { const c = this.E.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.2); this.env(g, t, 0.002, 0.6 * v, 0.28); o.connect(g).connect(this.out('drums')); o.start(t); o.stop(t + 0.35); }
  clickAt(t, accent, ch, weak) { const c = this.E.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = accent ? 1500 : weak ? 700 : 1000; this.env(g, t, 0.001, accent ? 0.35 : weak ? 0.12 : 0.22, 0.03); o.connect(g).connect(this.out(ch)); o.start(t); o.stop(t + 0.06); }

  // ---- pad (envelopes suaves, sem estalos) ----
  padNotes(ch) {
    if (this.cfg.padMode === 'fixed') { const r = this.cfg.key; const third = this.cfg.minor ? 3 : 4; return [48 + r, 55 + r, 60 + r].concat(this.cfg.padThird ? [52 + r + (third - 4)] : []); }
    const c = parseChord(ch); if (!c) return [];
    const ns = chordNotes(c).slice(0, 4).map(pc => 48 + ((pc - 0 + 12) % 12)); // 3ª oitava
    return [36 + c.root].concat(ns.map(n => n < 52 ? n + 12 : n));
  }
  playPad(t, ch) { this.releasePad(1.2, t); this.padChord = ch; const notes = this.padNotes(ch); this.padVoices = notes.map(n => this.padVoice(t, n)); }
  refreshPad(now) { if (!this.playing || !this.E.ctx) { if (!this.cfg.pad) this.releasePad(0.5); return; } if (!this.cfg.pad) { this.releasePad(0.8); this.padChord = null; return; } if (now) this.playPad(this.E.ctx.currentTime + 0.02, this.padChord || this.keyChord()); }
  releasePad(rel, at) {
    const c = this.E.ctx; if (!c) return; const t = at || c.currentTime;
    for (const v of this.padVoices) { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value || 0.0001, t); v.g.gain.setTargetAtTime(0.0001, t, rel / 4); v.oscs.forEach(o => o.stop(t + rel + 0.1)); } catch {} }
    this.padVoices = [];
  }
  padVoice(t, midi) {
    const c = this.E.ctx, T = this.cfg.padTimbre, f = midiToFreq(midi), g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    const oscs = []; const add = (type, mult, det, lvl) => { const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f * mult; o.detune.value = det; og.gain.value = lvl; o.connect(og).connect(lp); o.start(t); oscs.push(o); };
    const lvl = 0.05 * (0.5 + this.cfg.intensity * 0.5);
    let attack = 1.2;
    if (T === 'ambient') { add('sawtooth', 1, -7, 0.5); add('sawtooth', 1, 7, 0.5); add('sine', 2, 0, 0.3); lp.frequency.value = 900; attack = 1.5; }
    else if (T === 'warm') { add('triangle', 1, -4, 0.7); add('sine', 1, 4, 0.6); lp.frequency.value = 1400; attack = 0.9; }
    else if (T === 'strings') { for (const d of [-12, -4, 5, 11]) add('sawtooth', 1, d, 0.28); lp.frequency.value = 2200; attack = 0.7; }
    else if (T === 'atmosphere') { add('sine', 1, 0, 0.7); add('sine', 2, 3, 0.25); add('sine', 4, -3, 0.12); lp.frequency.value = 5000; attack = 2.2; }
    else if (T === 'organ') { add('sine', 1, 0, 0.6); add('sine', 2, 0, 0.4); add('sine', 3, 0, 0.25); add('sine', 4, 0, 0.15); lp.frequency.value = 6000; attack = 0.05; }
    else { add('triangle', 1, 0, 0.7); add('sine', 2, 0, 0.25); lp.frequency.value = 3000; attack = 0.01; } // soft piano
    lp.connect(g).connect(this.out('pad'));
    g.gain.setValueAtTime(0.0001, t);
    if (T === 'piano') { g.gain.exponentialRampToValueAtTime(lvl * 1.6, t + 0.01); g.gain.setTargetAtTime(lvl * 0.25, t + 0.02, 1.2); }
    else g.gain.setTargetAtTime(lvl, t, attack / 3);
    // LFO lento no filtro (movimento)
    if (T === 'ambient' || T === 'atmosphere') { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.15; lg.gain.value = 300; l.connect(lg).connect(lp.frequency); l.start(t); oscs.push(l); }
    return { g, oscs };
  }
  bassNote(t, ch, beat) {
    const c = parseChord(ch); if (!c) return; const ctx = this.E.ctx;
    const pc = c.bass >= 0 ? c.bass : (beat === 2 && this.cfg.style === 'gospel' ? (c.root + 7) % 12 : c.root);
    const f = midiToFreq(28 + ((pc - 4 + 12) % 12)), o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 600; lp.frequency.setTargetAtTime(250, t, 0.08);
    const dur = 60 / this.cfg.bpm * (beat === 0 ? 1.8 : 0.9); this.env(g, t, 0.006, 0.35 * (0.5 + this.cfg.intensity * 0.5), dur);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.out('bass')); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
  keysChord(t, ch) {
    const notes = chordNotes(ch); if (!notes.length) return; const ctx = this.E.ctx;
    for (const pc of notes.slice(0, 4)) {
      const m = 60 + ((pc - 0) % 12) - (pc > 7 ? 12 : 0), f = midiToFreq(m), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2; const g2 = ctx.createGain(); g2.gain.value = 0.3;
      this.env(g, t + Math.random() * 0.012, 0.004, 0.09 * (0.5 + this.cfg.intensity * 0.5), 1.6);
      o.connect(g); o2.connect(g2).connect(g); g.connect(this.out('keys')); o.start(t); o2.start(t); o.stop(t + 1.8); o2.stop(t + 1.8);
    }
  }

  // ---- voz guia: gravação própria (roteável) ou voz do sistema (sai na saída padrão) ----
  async setVoiceBlob(id, blob) { if (!blob) { delete this.voiceBuffers[id]; return; } const ctx = await this.E.init(); this.voiceBuffers[id] = await ctx.decodeAudioData(await blob.arrayBuffer()); }
  cueVoice(id, delaySec = 0, text) {
    const buf = this.voiceBuffers[id];
    if (buf && this.E.ctx) { const s = this.E.ctx.createBufferSource(); s.buffer = buf; s.connect(this.out('voice')); s.start(this.E.ctx.currentTime + delaySec); return 'gravada'; }
    const phrase = text || (VOICE_CMDS.find(c => c[0] === id) || [, id])[1];
    if (!('speechSynthesis' in window)) return 'indisponível';
    setTimeout(() => {
      if (id === 'count') { const beat = 60 / this.cfg.bpm * 1000; ['Um', 'dois', 'três', 'quatro'].slice(0, this.m.beats * (this.cfg.meter === '6/8' ? 1 : 1)).forEach((w, i) => setTimeout(() => this.say(w, 1.4), i * beat)); }
      else this.say(phrase, 1.1);
    }, delaySec * 1000);
    return 'sistema';
  }
  say(text, rate = 1) { try { const u = new SpeechSynthesisUtterance(text); u.lang = 'pt-BR'; u.rate = rate; const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('pt')); if (v) u.voice = v; speechSynthesis.speak(u); } catch {} }
  // anuncia comando N tempos antes do próximo compasso
  cueBeforeBar(id, beatsAhead = 4) {
    if (!this.playing) return this.cueVoice(id, 0);
    const spb = 60 / this.cfg.bpm, steps = this.m.beats * this.m.spb, toBar = (steps - (this.step % steps)) * this.stepDur;
    const lead = Math.max(0, toBar - beatsAhead * spb + (toBar < beatsAhead * spb ? steps * this.stepDur : 0));
    return this.cueVoice(id, lead);
  }
}

// TAP BPM
export class Tap { constructor() { this.t = []; } tap() { const n = performance.now(); this.t = this.t.filter(x => n - x < 3000); this.t.push(n); if (this.t.length < 2) return null; const d = (this.t[this.t.length - 1] - this.t[0]) / (this.t.length - 1); return Math.round(60000 / d); } }
