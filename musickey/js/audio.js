// MusicKey PRO Studio v2.0 — motor de áudio: mixer, roteamento, saídas e retornos
export const CHANNELS = [
  { id: 'playback', name: 'Playback' }, { id: 'drums', name: 'Bateria' }, { id: 'bass', name: 'Baixo' },
  { id: 'keys', name: 'Teclado' }, { id: 'pad', name: 'Pad' }, { id: 'click', name: 'Click' }, { id: 'voice', name: 'Voz guia' }
];
export const BUSES = [ { id: 'main', name: 'Principal (público)' }, { id: 'r1', name: 'Retorno 1' }, { id: 'r2', name: 'Retorno 2' } ];
// padrão: click e voz guia NÃO vão ao público
const DEFAULT_ROUTE = {
  playback: { main: 1, r1: 1, r2: 1 }, drums: { main: 1, r1: 1, r2: 1 }, bass: { main: 1, r1: 1, r2: 1 }, keys: { main: 1, r1: 1, r2: 1 },
  pad: { main: 1, r1: 1, r2: 0 }, click: { main: 0, r1: 1, r2: 1 }, voice: { main: 0, r1: 1, r2: 1 }
};

export class AudioEngine {
  constructor() { this.ctx = null; this.ch = {}; this.bus = {}; this.state = null; }
  get ready() { return !!this.ctx; }
  async init(saved) {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return this.ctx; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    // master principal com limitador (proteção contra clipping)
    const mk = () => { const g = ctx.createGain(); const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
      const an = ctx.createAnalyser(); an.fftSize = 512; g.connect(lim); lim.connect(an); return { g, lim, an }; };
    this.bus.main = mk(); this.bus.main.an.connect(ctx.destination);
    for (const id of ['r1', 'r2']) {
      const b = this.bus[id] = mk(); b.dest = ctx.createMediaStreamDestination(); b.an.connect(b.dest);
      b.el = new Audio(); b.el.srcObject = b.dest.stream; b.el.autoplay = true; b.sink = ''; b.enabled = false;
    }
    this.state = Object.assign({ vol: {}, pan: {}, mute: {}, solo: {}, route: JSON.parse(JSON.stringify(DEFAULT_ROUTE)), busVol: { main: 0.9, r1: 0.9, r2: 0.9 } }, saved || {});
    for (const c of CHANNELS) {
      const input = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(), an = ctx.createAnalyser(); an.fftSize = 512;
      input.connect(pan); pan.connect(an);
      const sends = {}; for (const b of BUSES) { const s = ctx.createGain(); an.connect(s); s.connect(this.bus[b.id].g); sends[b.id] = s; }
      this.ch[c.id] = { input, pan, an, sends };
    }
    this.apply();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }
  input(id) { return this.ch[id].input; }
  apply() {
    const S = this.state, anySolo = CHANNELS.some(c => S.solo[c.id]);
    for (const c of CHANNELS) {
      const n = this.ch[c.id]; if (!n) continue;
      const audible = !S.mute[c.id] && (!anySolo || S.solo[c.id]);
      n.input.gain.setTargetAtTime(audible ? (S.vol[c.id] ?? 0.8) : 0, this.ctx.currentTime, 0.02);
      if (n.pan.pan) n.pan.pan.value = S.pan[c.id] ?? 0;
      for (const b of BUSES) n.sends[b.id].gain.setTargetAtTime(S.route[c.id]?.[b.id] ? 1 : 0, this.ctx.currentTime, 0.02);
    }
    for (const b of BUSES) this.bus[b.id].g.gain.setTargetAtTime(S.busVol[b.id] ?? 0.9, this.ctx.currentTime, 0.02);
  }
  set(kind, ch, v) { this.state[kind][ch] = v; this.apply(); }
  setRoute(ch, bus, on) { this.state.route[ch] = this.state.route[ch] || {}; this.state.route[ch][bus] = on ? 1 : 0; this.apply(); }
  level(id) {
    const an = id in this.ch ? this.ch[id].an : this.bus[id]?.an; if (!an) return 0;
    const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b); let p = 0; for (const x of b) p = Math.max(p, Math.abs(x)); return p;
  }
  static async outputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
  }
  get canRoute() { return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype; }
  async setOutput(busId, deviceId) {
    if (busId === 'main') {
      if (!this.ctx.setSinkId) throw new Error('Este navegador não permite escolher a saída principal.');
      await this.ctx.setSinkId(deviceId || ''); return;
    }
    const b = this.bus[busId]; if (!b.el.setSinkId) throw new Error('Este navegador não permite escolher saídas de retorno (use Chrome ou Edge no PC).');
    await b.el.setSinkId(deviceId || ''); b.sink = deviceId; b.enabled = !!deviceId;
    if (b.enabled) await b.el.play().catch(() => {}); else b.el.pause();
  }
}

// ruído compartilhado
let NOISE = null;
export function noiseBuffer(ctx) {
  if (NOISE && NOISE.sampleRate === ctx.sampleRate) return NOISE;
  NOISE = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate); const d = NOISE.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return NOISE;
}
