// MusicKey PRO Studio v2.0 — detector de voz (motor do Detector de Tom v4.2, sem alterações), afinador e acordes ao vivo

  // Perfis Albrecht & Shanahan (2013) — melhores para melodia que Krumhansl
  export const PROF_MAJ = [0.238,0.006,0.111,0.006,0.137,0.094,0.016,0.214,0.009,0.080,0.008,0.081];
  const PROF_MIN = [0.220,0.006,0.104,0.123,0.019,0.103,0.012,0.214,0.062,0.022,0.061,0.052];
  const MAJ_STEPS = [0,2,4,5,7,9,11];

  export const CFG = {
    clarityMin: 0.85,     // MPM: rejeita som sem nota definida
    mpmK: 0.9,            // MPM: primeiro pico >= 90% do maior (anti erro de oitava)
    fMin: 75, fMax: 1050, // extensão vocal
    stableMs: 150,        // nota precisa durar isso para contar
    phraseGapMs: 220,     // silêncio que fecha uma frase (respiração)
    secPerPhrase: 3.5,    // canto emendado: cada 3,5 s de voz conta como 1 frase
    phraseBonus: 1.5,     // peso extra (em segundos) da última nota da frase
    minPhrases: 2,        // mostra o tom após 2 frases...
    minSeconds: 6,        // ...ou 6 s de voz firme
    beta: 28,             // calibração: confiança mostrada = acerto medido
    confirmConf: 88,      // confiança para confirmar e travar o tom (testado)
    gateFactor: 2,        // gate = piso de ruído × fator (testado: 2 = melhor)
    gateFloorMin: 0.004
  };

  function pearson(x, y) {
    let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
    for (let i=0;i<12;i++){ sx+=x[i]; sy+=y[i]; sxy+=x[i]*y[i]; sx2+=x[i]*x[i]; sy2+=y[i]*y[i]; }
    const den = Math.sqrt((12*sx2-sx*sx)*(12*sy2-sy*sy));
    return den === 0 ? 0 : (12*sxy - sx*sy) / den;
  }

  export function rmsOf(buf) {
    let s=0; for (let i=0;i<buf.length;i++) s+=buf[i]*buf[i];
    return Math.sqrt(s/buf.length);
  }

  // McLeod Pitch Method → {freq, clarity} ou null
  export function mpm(buf, sr) {
    const n = buf.length >> 1;
    const tauMax = Math.min(n - 2, Math.ceil(sr / (CFG.fMin - 5)));
    const nsdf = new Float32Array(tauMax + 2);
    for (let tau = 0; tau <= tauMax + 1; tau++) {
      let acf = 0, div = 0;
      for (let i = 0; i < n; i++) {
        const a = buf[i], b = buf[i + tau];
        acf += a * b; div += a * a + b * b;
      }
      nsdf[tau] = div > 0 ? 2 * acf / div : 0;
    }
    const peaks = [];
    let past = false, m = -1, mt = -1;
    for (let t = 1; t <= tauMax; t++) {
      if (!past) { if (nsdf[t] < 0) past = true; continue; }
      if (nsdf[t] > 0) {
        if (nsdf[t] > nsdf[t-1] && nsdf[t] >= nsdf[t+1] && nsdf[t] > m) { m = nsdf[t]; mt = t; }
      } else if (mt > 0) { peaks.push([mt, m]); m = -1; mt = -1; }
    }
    if (mt > 0) peaks.push([mt, m]);
    if (!peaks.length) return null;
    let hi = 0; for (const p of peaks) if (p[1] > hi) hi = p[1];
    if (hi < CFG.clarityMin) return null;
    const t = peaks.find(p => p[1] >= CFG.mpmK * hi)[0];
    const x1 = nsdf[t-1], x2 = nsdf[t], x3 = nsdf[t+1];
    const d = 2 * (2*x2 - x1 - x3);
    const freq = sr / (d !== 0 ? t + (x3 - x1) / d : t);
    if (freq < CFG.fMin || freq > CFG.fMax) return null;
    return { freq, clarity: nsdf[t] };
  }

  export class KeyEngine {
    constructor() { this.reset(); this.noise = null; }
    reset() {
      this.hist = new Array(12).fill(0);
      this.midiWin = [];
      this.cur = -1; this.curStart = 0; this.curCounted = false;
      this.lastPc = -1; this.silenceStart = 0; this.phraseClosed = true;
      this.notes = 0; this.seconds = 0; this.lastT = 0; this.phrases = 0; this.phraseNotes = 0;
      this.key = null; this.lock = null;
    }
    effPhrases() { return Math.max(this.phrases, Math.floor(this.seconds / CFG.secPerPhrase)); }
    // atualiza piso de ruído (segue o mínimo; sobe devagar, desce rápido)
    trackNoise(rms) {
      if (this.noise === null) { this.noise = Math.max(rms, CFG.gateFloorMin); return; }
      if (rms < this.noise) this.noise = this.noise * 0.85 + rms * 0.15;
      else this.noise *= 1.0006;
      this.noise = Math.max(this.noise, CFG.gateFloorMin * 0.5);
    }
    gate() { return Math.max(CFG.gateFloorMin, (this.noise || 0) * CFG.gateFactor); }

    // um quadro de áudio → estado
    frame(buf, sr, now) {
      const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
      this.lastT = now;
      const rms = rmsOf(buf);
      const gate = this.gate();
      let p = null;
      if (rms >= gate) p = mpm(buf, sr);
      if (!p) this.trackNoise(rms);
      return { rms, gate, ...this.pitch(p, dt, now) };
    }

    pitch(p, dt, now) {
      if (!p) {
        this.midiWin.length = 0;
        if (this.cur !== -1) { this.silenceStart = now; this.cur = -1; this.phraseClosed = false; }
        if (!this.phraseClosed && this.lastPc >= 0 && now - this.silenceStart >= CFG.phraseGapMs) {
          this.hist[this.lastPc] += CFG.phraseBonus; // última nota da frase costuma ser a tônica
          this.phraseClosed = true;
          if (this.phraseNotes >= 3) this.phrases++;
          this.phraseNotes = 0;
          this.updateKey();
        }
        return { note: null };
      }
      const mf = 12 * Math.log2(p.freq / 440) + 69;
      this.midiWin.push(mf); if (this.midiWin.length > 5) this.midiWin.shift();
      const med = [...this.midiWin].sort((a,b)=>a-b)[this.midiWin.length >> 1];
      const midi = Math.round(med);
      const pc = ((midi % 12) + 12) % 12;
      const cents = (med - midi) * 100;

      if (pc !== this.cur) { this.cur = pc; this.curStart = now; this.curCounted = false; }
      else if (now - this.curStart >= CFG.stableMs) {
        if (!this.curCounted) { this.notes++; this.phraseNotes++; this.curCounted = true; }
        const w = dt * (0.5 + p.clarity * 0.5);
        this.hist[pc] += w; this.seconds += dt;
        this.lastPc = pc;
        this.updateKey();
      }
      return { note: { pc, midi, cents, freq: p.freq } };
    }

    // v4.1 — método híbrido (escala diatônica + perfil + tríade da tônica), testado em 5.000 melodias
    updateKey() {
      const total = this.hist.reduce((a,b)=>a+b,0);
      const phr = this.effPhrases();
      if (total <= 0 || (phr < CFG.minPhrases && this.seconds < CFG.minSeconds)) { this.key = null; return; }
      const hh = this.hist.map(x => Math.pow(x, 0.75));
      const tot = hh.reduce((a,b)=>a+b,0);
      const res = [];
      for (let r = 0; r < 12; r++) {
        const v = Array.from({length:12}, (_,i) => hh[(r + i) % 12]);
        for (const minor of [false, true]) {
          const scale = minor ? (r + 3) % 12 : r;           // escala = raiz do relativo maior
          let inScale = 0; for (const d of MAJ_STEPS) inScale += hh[(scale + d) % 12];
          const triad = (minor ? [0,3,7] : [0,4,7]).reduce((s,d) => s + hh[(r + d) % 12], 0);
          const corr = pearson(v, minor ? PROF_MIN : PROF_MAJ);
          res.push({ root: r, minor, scale, s: inScale / tot + 0.25 * corr + 0.2 * triad / tot });
        }
      }
      res.sort((a,b) => b.s - a.s);
      let best = res[0];
      // confiança calibrada = probabilidade de os ACORDES estarem certos (relativos têm os mesmos acordes)
      const ps = new Array(12).fill(0); let Z = 0;
      for (const k of res) { const e = Math.exp(CFG.beta * (k.s - best.s)); ps[k.scale] += e; Z += e; }
      const confOf = sc => Math.min(99, Math.round(100 * ps[sc] / Z));
      // trava: depois de confirmado, só troca com evidência forte e 2 frases a mais
      if (this.lock) {
        const lk = res.find(k => k.root === this.lock.root && k.minor === this.lock.minor);
        if (best.scale !== this.lock.scale && confOf(best.scale) >= 92 && phr >= this.lock.phrases + 2) this.lock = null;
        else best = lk;
      }
      const conf = confOf(best.scale);
      if (!this.lock && conf >= CFG.confirmConf && phr >= CFG.minPhrases) this.lock = { root: best.root, minor: best.minor, scale: best.scale, phrases: phr };
      const rel = res.find(k => k.scale === best.scale && k.minor !== best.minor);
      const alt = res.find(k => k.scale !== best.scale);
      this.key = { root: best.root, minor: best.minor, conf, alt, rel, locked: !!this.lock,
                   relGap: rel ? best.s - rel.s : 1, notes: this.notes, seconds: this.seconds, phrases: phr };
    }
  }


// ---------- microfone compartilhado ----------
export class Mic {
  constructor() { this.ctx = null; this.stream = null; this.an = null; this.buf = null; this.raf = 0; this.mode = null; this.handlers = {}; this.deviceId = ''; this.starting = false; }
  get on() { return !!this.stream; }
  async start(mode, opts = {}) {
    if (this.starting) return; // impede cliques duplos
    if (this.stream && this.mode === mode) return;
    this.starting = true;
    try {
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Abra o app por https:// (ou localhost) para usar o microfone.');
      if (!this.stream) {
        const clean = mode === 'voice';
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          echoCancellation: clean, noiseSuppression: clean, autoGainControl: false, channelCount: 1 } });
        this.stream.getAudioTracks()[0].addEventListener('ended', () => { this.stop(); this.emit('error', new Error('Microfone desconectado.')); });
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        const src = this.ctx.createMediaStreamSource(this.stream);
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = mode === 'chords' ? 40 : 70;
        this.an = this.ctx.createAnalyser(); this.an.fftSize = mode === 'chords' ? 8192 : 2048; this.an.smoothingTimeConstant = 0;
        src.connect(hp); hp.connect(this.an);
        this.buf = new Float32Array(this.an.fftSize);
      }
      this.mode = mode; this.opts = opts;
      cancelAnimationFrame(this.raf); this.loop();
    } catch (e) {
      this.stop();
      const msg = e.name === 'NotAllowedError' ? 'Permissão do microfone negada. Libere nas configurações do navegador.' :
                  e.name === 'NotFoundError' ? 'Nenhum microfone encontrado.' : e.name === 'NotReadableError' ? 'Microfone ocupado por outro app.' : e.message;
      throw new Error(msg);
    } finally { this.starting = false; }
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = this.ctx = this.an = null; this.mode = null;
  }
  on_(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, d) { this.handlers[ev]?.(d); }
  loop() {
    if (!this.an) return;
    this.an.getFloatTimeDomainData(this.buf);
    this.emit('frame', { buf: this.buf, sr: this.ctx.sampleRate, now: performance.now() });
    this.raf = requestAnimationFrame(() => this.loop());
  }
}

// ---------- afinador ----------
export const TUNINGS = {
  'Violão / guitarra (padrão)': [40,45,50,55,59,64],
  'Violão meio tom abaixo': [39,44,49,54,58,63],
  'Drop D': [38,45,50,55,59,64],
  'Baixo 4 cordas': [28,33,38,43],
  'Baixo 5 cordas': [23,28,33,38,43],
  'Ukulele': [67,60,64,69],
  'Cavaquinho': [62,67,71,74],
  'Cromático (qualquer nota)': []
};
export function tune(freq, a4 = 440, strings = []) {
  const mf = 69 + 12 * Math.log2(freq / a4);
  let target = Math.round(mf);
  if (strings.length) { target = strings.reduce((b, s) => Math.abs(s - mf) < Math.abs(b - mf) ? s : b, strings[0]); }
  return { midi: target, cents: (mf - target) * 100, freq, targetFreq: a4 * Math.pow(2, (target - 69) / 12), string: strings.indexOf(target) };
}

// ---------- acordes ao vivo (sem prever acordes futuros) ----------
export class LiveChords {
  constructor() { this.reset(); }
  reset() { this.avg = null; this.bassAvg = null; this.last = null; this.cand = null; this.candN = 0; this.history = []; this.t0 = performance.now(); this.lastT = 0; this.map = null; }
  frame(buf, sr, now) {
    if (now - this.lastT < 90) return null; this.lastT = now;
    const CC = self.ChordCore; const N = buf.length;
    if (!this.map || this.mapN !== N || this.mapSr !== sr) { this.map = CC.chromaMap(N, sr, 0, 80, 2000); this.mapB = CC.chromaMap(N, sr, 0, 38, 140); this.mapN = N; this.mapSr = sr; }
    let rms = 0; for (let i = 0; i < N; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / N);
    if (rms < 0.006) { this.cand = null; this.candN = 0; return { chord: this.last, silent: true, rms }; }
    const mag = CC.spectrum(buf, 0, N);
    const c = CC.chromaFrom(mag, this.map, 100), b = CC.chromaFrom(mag, this.mapB, 100);
    if (!this.avg) { this.avg = c; this.bassAvg = b; } else for (let i = 0; i < 12; i++) { this.avg[i] = this.avg[i] * 0.55 + c[i] * 0.45; this.bassAvg[i] = this.bassAvg[i] * 0.55 + b[i] * 0.45; }
    const best = CC.bestChord(this.avg, this.bassAvg);
    const conf = Math.round(100 * Math.min(1, best.margin * 3 + 0.45));
    if (best.name === this.cand) this.candN++; else { this.cand = best.name; this.candN = 1; }
    if (this.candN >= 3 && best.name !== this.last && conf >= 55) {
      this.last = best.name;
      this.history.push({ t: +((now - this.t0) / 1000).toFixed(2), chord: best.name, conf });
    }
    return { chord: this.last, candidate: best.name, conf, rms };
  }
}
