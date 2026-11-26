// MusicKey PRO Studio v2.0 — núcleo de análise: FFT, chroma, acordes, tom, batidas
// Script clássico: usado na página (window.ChordCore) e no Worker (importScripts).
(function (G) {
  const NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const PROF_MAJ = [0.238,0.006,0.111,0.006,0.137,0.094,0.016,0.214,0.009,0.080,0.008,0.081];
  const PROF_MIN = [0.220,0.006,0.104,0.123,0.019,0.103,0.012,0.214,0.062,0.022,0.061,0.052];
  const MAJ_STEPS = [0,2,4,5,7,9,11];
  // qualidades reconhecidas: [nome, intervalos, prior]
  const CHORD_Q = [
    ['', [0,4,7], 1.0], ['m', [0,3,7], 1.0], ['7', [0,4,7,10], 0.88], ['maj7', [0,4,7,11], 0.84],
    ['m7', [0,3,7,10], 0.86], ['sus4', [0,5,7], 0.82], ['sus2', [0,2,7], 0.8], ['dim', [0,3,6], 0.78], ['aug', [0,4,8], 0.72]
  ];
  const CFG = { K: 40, stay: 0.8 };
  const SHOW = { '':'', m:'m', '7':'7', maj7:'7M', m7:'m7', sus4:'sus4', sus2:'sus2', dim:'°', aug:'+' };

  // ---------- FFT radix-2 ----------
  const fftCache = {};
  function fftPlan(n) {
    if (fftCache[n]) return fftCache[n];
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
    const win = new Float64Array(n); for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return (fftCache[n] = { rev, cos, sin, win, re: new Float64Array(n), im: new Float64Array(n) });
  }
  // magnitude do espectro de buf[off..off+n) com janela de Hann
  function spectrum(buf, off, n, out) {
    const p = fftPlan(n), re = p.re, im = p.im;
    for (let i = 0; i < n; i++) { const v = buf[off + i] || 0; re[p.rev[i]] = v * p.win[i]; im[p.rev[i]] = 0; }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0; j < half; j++) {
        const k = j * step, a = i + j, b = a + half;
        const tr = re[b] * p.cos[k] - im[b] * p.sin[k], ti = re[b] * p.sin[k] + im[b] * p.cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    out = out || new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }

  // mapa bin → classe de nota (com afinação)
  function chromaMap(n, sr, tuneCents, fLo, fHi) {
    const map = [];
    for (let k = 1; k < n / 2; k++) {
      const f = k * sr / n; if (f < fLo || f > fHi) continue;
      const midi = 69 + 12 * Math.log2(f / 440) - tuneCents / 100;
      const near = Math.round(midi), dev = Math.abs(midi - near);
      const w = Math.max(0, 1 - dev * 2.2); if (w <= 0) continue;
      map.push(k, ((near % 12) + 12) % 12, w);
    }
    return Float64Array.from(map);
  }
  // chroma com "branqueamento": log-magnitude menos a média local → só picos (notas), sem ruído de bateria
  const LBUF = {};
  function chromaFrom(mag, map, gamma) {
    const n = mag.length, L = LBUF[n] || (LBUF[n] = new Float64Array(n)), P = LBUF['p' + n] || (LBUF['p' + n] = new Float64Array(n + 1));
    for (let k = 0; k < n; k++) { L[k] = Math.log1p(gamma * mag[k]); P[k + 1] = P[k] + L[k]; }
    const W = 14, c = new Float64Array(12);
    for (let i = 0; i < map.length; i += 3) {
      const k = map[i], a = Math.max(0, k - W), b = Math.min(n, k + W + 1);
      const v = L[k] - (P[b] - P[a]) / (b - a);
      if (v > 0) c[map[i + 1]] += map[i + 2] * v;
    }
    return c;
  }
  const norm = v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Array.from(v, x => x / s); };

  // templates de acordes (12 × qualidades), com leve peso de harmônicos
  const TEMPLATES = [];
  for (let r = 0; r < 12; r++) for (const [q, iv, prior] of CHORD_Q) {
    // template com harmônicos (1ª..6ª): reduz confusão C × Em, G × Bm etc.
    const t = new Float64Array(12);
    iv.forEach((s, i) => { const n = (r + s) % 12; [[0,1],[0,.6],[7,.36],[0,.22],[4,.13],[7,.08]].forEach(([o, w]) => { t[(n + o) % 12] += w * (i === 0 ? 1.1 : 1); }); });
    TEMPLATES.push({ root: r, q, notes: iv.map(s => (r + s) % 12), prior, t: norm(t), name: NAMES[r] + SHOW[q] });
  }
  function chordScores(chroma) {
    const c = norm(chroma);
    return TEMPLATES.map(T => { let s = 0; for (let i = 0; i < 12; i++) s += c[i] * T.t[i]; return s * T.prior; });
  }
  // acorde a partir de um chroma (ao vivo)
  function bestChord(chroma, bass) {
    const sc = chordScores(chroma); let bi = 0;
    for (let i = 1; i < sc.length; i++) if (sc[i] > sc[bi]) bi = i;
    const sorted = [...sc].sort((a, b) => b - a);
    const T = TEMPLATES[bi];
    return { name: withBass(T, bass), score: sc[bi], margin: sorted[0] - sorted[1], idx: bi };
  }
  function withBass(T, bass) {
    if (!bass) return T.name;
    let bi = 0; for (let i = 1; i < 12; i++) if (bass[i] > bass[bi]) bi = i;
    const tot = bass.reduce((a, b) => a + b, 0) || 1;
    if (bi !== T.root && T.notes.includes(bi) && bass[bi] / tot > 0.28 && bass[bi] > 1.4 * bass[T.root]) return T.name + '/' + NAMES[bi];
    return T.name;
  }

  // ---------- tom (método híbrido do Detector v4.2) ----------
  function pearson(x, y) {
    let sx=0,sy=0,sxy=0,sx2=0,sy2=0; for (let i=0;i<12;i++){ sx+=x[i]; sy+=y[i]; sxy+=x[i]*y[i]; sx2+=x[i]*x[i]; sy2+=y[i]*y[i]; }
    const d = Math.sqrt((12*sx2-sx*sx)*(12*sy2-sy*sy)); return d ? (12*sxy-sx*sy)/d : 0;
  }
  function keyFromHist(hist, beta = 28) {
    const hh = hist.map(x => Math.pow(Math.max(0, x), 0.75)); const tot = hh.reduce((a, b) => a + b, 0) || 1;
    const res = [];
    for (let r = 0; r < 12; r++) {
      const v = Array.from({ length: 12 }, (_, i) => hh[(r + i) % 12]);
      for (const minor of [false, true]) {
        const scale = minor ? (r + 3) % 12 : r; let inS = 0; for (const d of MAJ_STEPS) inS += hh[(scale + d) % 12];
        const triad = (minor ? [0,3,7] : [0,4,7]).reduce((s, d) => s + hh[(r + d) % 12], 0);
        res.push({ root: r, minor, scale, s: inS / tot + 0.25 * pearson(v, minor ? PROF_MIN : PROF_MAJ) + 0.2 * triad / tot });
      }
    }
    res.sort((a, b) => b.s - a.s);
    const ps = new Array(12).fill(0); let Z = 0;
    for (const k of res) { const e = Math.exp(beta * (k.s - res[0].s)); ps[k.scale] += e; Z += e; }
    return { root: res[0].root, minor: res[0].minor, scale: res[0].scale, conf: Math.min(99, Math.round(100 * ps[res[0].scale] / Z)), ranked: res };
  }

  // ---------- batidas (envelope de ataque + programação dinâmica) ----------
  function tempoFromOnset(onset, fps) {
    const lo = Math.round(fps * 60 / 190), hi = Math.round(fps * 60 / 55);
    let best = 0, bl = lo; const ac = [];
    for (let l = lo; l <= hi; l++) {
      let s = 0; for (let i = l; i < onset.length; i++) s += onset[i] * onset[i - l];
      const bpm = 60 * fps / l, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 0.9, 2));
      ac.push([l, s]); if (s * w > best) { best = s * w; bl = l; }
    }
    // refina com interpolação
    const i = ac.findIndex(a => a[0] === bl);
    let lag = bl;
    if (i > 0 && i < ac.length - 1) { const [a, b, c] = [ac[i-1][1], ac[i][1], ac[i+1][1]]; const d = a - 2*b + c; if (d) lag = bl + 0.5 * (a - c) / d; }
    return 60 * fps / lag;
  }
  function trackBeats(onset, fps, bpm) {
    const P = 60 * fps / bpm, n = onset.length, alpha = 100;
    const mean = onset.reduce((a, b) => a + b, 0) / n || 1; const o = onset.map(x => x / mean);
    const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      let best = -Infinity, bi = -1;
      for (let p = Math.max(0, Math.round(t - 2 * P)); p <= t - Math.round(P / 2); p++) {
        const v = score[p] - alpha * Math.pow(Math.log((t - p) / P), 2); if (v > best) { best = v; bi = p; }
      }
      score[t] = o[t] + (bi >= 0 ? best : 0); back[t] = bi;
    }
    let t = 0; for (let i = Math.max(0, n - Math.round(P)); i < n; i++) if (score[i] > score[t]) t = i;
    const beats = []; while (t >= 0) { beats.push(t); t = back[t]; }
    return beats.reverse();
  }
  function meterFromBeats(beatStrength) {
    const ac = l => { let s = 0; for (let i = l; i < beatStrength.length; i++) s += beatStrength[i] * beatStrength[i - l]; return s / Math.max(1, beatStrength.length - l); };
    const m = beatStrength.reduce((a, b) => a + b, 0) / (beatStrength.length || 1);
    const s3 = ac(3) - m * m, s4 = ac(4) - m * m;
    return s3 > s4 * 1.25 ? '3/4' : '4/4';
  }

  // ---------- análise completa de um arquivo ----------
  function analyze(input, srIn, progress, isCancelled) {
    const SR = 11025, ratio = srIn / SR;
    // reamostra com média em caixa (anti-aliasing simples)
    const len = Math.floor(input.length / ratio), x = new Float32Array(len), half = Math.max(1, Math.floor(ratio / 2));
    for (let i = 0; i < len; i++) {
      const c = Math.floor(i * ratio); let s = 0, k = 0;
      for (let j = c - half; j <= c + half; j++) if (j >= 0 && j < input.length) { s += input[j]; k++; }
      x[i] = k ? s / k : 0;
    }
    const N = 4096, HOP = 1024, fps = SR / HOP, frames = Math.max(1, Math.floor((len - N) / HOP) + 1);
    const mags = [];
    // 1ª passada: espectro, energia, afinação
    let tuneSin = 0, tuneCos = 0;
    const prev = new Float64Array(N / 2); const onset = new Float64Array(frames); const energy = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      if (isCancelled && isCancelled()) throw new Error('cancelado');
      const mag = spectrum(x, f * HOP, N); const lm = new Float32Array(N / 2);
      let flux = 0, en = 0;
      for (let k = 1; k < N / 2; k++) {
        const v = Math.log1p(100 * mag[k]); lm[k] = mag[k]; en += mag[k] * mag[k];
        const d = v - prev[k]; if (d > 0 && k * SR / N < 4000) flux += d; prev[k] = v;
        // afinação: picos entre 100 e 1000 Hz
        if (k > 1 && k < N/2 - 1 && mag[k] > mag[k-1] && mag[k] >= mag[k+1] && k * SR / N > 100 && k * SR / N < 1000) {
          const a = mag[k-1], b = mag[k], c = mag[k+1], dd = a - 2*b + c; const kk = k + (dd ? 0.5 * (a - c) / dd : 0);
          const midi = 69 + 12 * Math.log2(kk * SR / N / 440), ph = 2 * Math.PI * (midi - Math.round(midi));
          tuneSin += b * Math.sin(ph); tuneCos += b * Math.cos(ph);
        }
      }
      mags.push(lm); onset[f] = flux; energy[f] = Math.sqrt(en);
      if (progress && f % 50 === 0) progress(0.5 * f / frames, 'Lendo o áudio');
    }
    const tuneCents = Math.round(100 * Math.atan2(tuneSin, tuneCos) / (2 * Math.PI));
    const mapT = chromaMap(N, SR, tuneCents, 80, 2000), mapB = chromaMap(N, SR, tuneCents, 38, 140);
    const chroma = [], bassC = []; const hist = new Array(12).fill(0);
    for (let f = 0; f < frames; f++) {
      const c = chromaFrom(mags[f], mapT, 100), b = chromaFrom(mags[f], mapB, 100);
      chroma.push(c); bassC.push(b); for (let i = 0; i < 12; i++) hist[i] += c[i];
      if (progress && f % 100 === 0) progress(0.5 + 0.2 * f / frames, 'Calculando notas');
    }
    // remove fundo constante do envelope de ataque
    const on = Array.from(onset); for (let i = 0; i < on.length; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - 8); j <= Math.min(on.length - 1, i + 8); j++) { s += onset[j]; k++; } on[i] = Math.max(0, onset[i] - s / k); }
    const bpm = tempoFromOnset(on, fps);
    let beats = trackBeats(on, fps, bpm);
    if (beats.length < 4) beats = Array.from({ length: Math.floor(frames / (fps * 60 / bpm)) }, (_, i) => Math.round(i * fps * 60 / bpm));
    if (progress) progress(0.75, 'Encontrando o ritmo');
    // tom global
    const key = keyFromHist(hist);
    const diat = new Set(MAJ_STEPS.map(d => (key.scale + d) % 12));
    // chroma por batida
    const maxE = Math.max(...energy) || 1;
    const bounds = beats.concat([frames]);
    const beatData = [];
    for (let i = 0; i < beats.length; i++) {
      const a = bounds[i], b = Math.max(a + 1, bounds[i + 1]);
      const c = new Float64Array(12), bb = new Float64Array(12); let e = 0;
      // o ataque aparece ~3/4 de janela depois do início do quadro: corrige tempo e quadros
      for (let f = a + 1; f < b + 1 && f < frames; f++) { for (let k = 0; k < 12; k++) { c[k] += chroma[f][k]; bb[k] += bassC[f][k]; } e += energy[f]; }
      beatData.push({ t: (a * HOP + 0.75 * N) / SR, c, b: bb, e: e / (b - a) / maxE, strength: on[a] || 0 });
    }
    // emissões com prior do tom (acordes do campo harmônico favorecidos)
    const S = TEMPLATES.length + 1, NIDX = TEMPLATES.length;
    const keyPrior = TEMPLATES.map(T => T.notes.every(n => diat.has(n)) ? 1.0 : T.notes.filter(n => diat.has(n)).length >= T.notes.length - 1 ? 0.93 : 0.86);
    const emis = beatData.map(bd => {
      const bn = norm(bd.b); const bt = bd.b.reduce((a, b) => a + b, 0);
      const sc = chordScores(bd.c).map((s, i) => s * keyPrior[i] + (bt > 0 ? 0.12 * bn[TEMPLATES[i].root] : 0));
      sc.push(bd.e < 0.08 ? 1.2 : 0.3); // "sem acorde" em silêncio
      return sc;
    });
    // Viterbi (log): emissão relativa ao melhor da batida; permanecer é mais provável que trocar
    const K = CFG.K, stay = Math.log(CFG.stay), move = Math.log((1 - CFG.stay) / (S - 1));
    const lem = emis.map(sc => { const m = Math.max(...sc); return sc.map(v => K * (v - m)); });
    let dp = lem[0].slice(); const bp = [];
    for (let i = 1; i < emis.length; i++) {
      let bestPrev = 0; for (let j = 1; j < S; j++) if (dp[j] > dp[bestPrev]) bestPrev = j;
      const nd = new Array(S), nb = new Int32Array(S);
      for (let j = 0; j < S; j++) {
        const viaStay = dp[j] + stay, viaMove = dp[bestPrev] + move;
        if (viaStay >= viaMove) { nd[j] = viaStay + lem[i][j]; nb[j] = j; } else { nd[j] = viaMove + lem[i][j]; nb[j] = bestPrev; }
      }
      dp = nd; bp.push(nb);
      if (progress && i % 200 === 0) progress(0.8 + 0.15 * i / emis.length, 'Reconhecendo acordes');
    }
    G.ChordCore && (G.ChordCore._dbg = { beatData, emis });
    let st = 0; for (let j = 1; j < S; j++) if (dp[j] > dp[st]) st = j;
    const path = new Array(emis.length); path[emis.length - 1] = st;
    for (let i = emis.length - 2; i >= 0; i--) path[i] = bp[i][path[i + 1]];
    // junta batidas iguais em trechos
    const duration = input.length / srIn, segs = [];
    for (let i = 0; i < path.length; i++) {
      const s = path[i]; const end = i + 1 < beatData.length ? beatData[i + 1].t : duration;
      const sc = emis[i]; const sorted = [...sc].sort((a, b) => b - a); const conf = Math.max(0, Math.min(1, (sc[s] - sorted[1]) * 3 + 0.45));
      const last = segs[segs.length - 1];
      if (last && last.s === s) { last.d = end - last.t; last.cs.push(conf); last.bass.forEach((v, k) => last.bass[k] = v + beatData[i].b[k]); }
      else segs.push({ s, t: beatData[i].t, d: end - beatData[i].t, cs: [conf], bass: Array.from(beatData[i].b) });
    }
    if (segs.length) segs[0].t = Math.min(segs[0].t, 0) || 0;
    if (segs.length && segs[0].t > 0.05) segs.unshift({ s: NIDX, t: 0, d: segs[0].t, cs: [1], bass: new Array(12).fill(0) });
    const segments = segs.map(g => ({
      t: +g.t.toFixed(2), d: +g.d.toFixed(2),
      chord: g.s === NIDX ? 'N' : withBass(TEMPLATES[g.s], g.bass),
      conf: Math.round(100 * g.cs.reduce((a, b) => a + b, 0) / g.cs.length)
    }));
    // mudanças de tom: janelas de 32 batidas
    const keyChanges = []; const W = 32;
    if (beatData.length > W * 2) {
      let curScale = key.scale;
      for (let i = 0; i + W <= beatData.length; i += 8) {
        const h = new Array(12).fill(0); for (let j = i; j < i + W; j++) for (let k = 0; k < 12; k++) h[k] += beatData[j].c[k];
        const k2 = keyFromHist(h);
        if (k2.scale !== curScale && k2.conf >= 80) { keyChanges.push({ t: +beatData[i + W / 2].t.toFixed(1), root: k2.root, minor: k2.minor, conf: k2.conf }); curScale = k2.scale; }
      }
    }
    const meter = meterFromBeats(beatData.map(b => b.strength));
    if (progress) progress(1, 'Pronto');
    return { duration: +duration.toFixed(2), bpm: Math.round(bpm), meter, tuneCents, key: { root: key.root, minor: key.minor, conf: key.conf },
             keyChanges, beats: beatData.map(b => +b.t.toFixed(3)), segments };
  }

  G.ChordCore = { CFG, NAMES, spectrum, chromaMap, chromaFrom, chordScores, bestChord, keyFromHist, analyze, TEMPLATES, tempoFromOnset, trackBeats };

  // modo Worker
  if (typeof WorkerGlobalScope !== 'undefined' && G instanceof WorkerGlobalScope) {
    let cancel = false;
    G.onmessage = e => {
      if (e.data.cmd === 'cancel') { cancel = true; return; }
      if (e.data.cmd === 'analyze') {
        cancel = false;
        try {
          const r = analyze(e.data.samples, e.data.sr, (p, msg) => G.postMessage({ type: 'progress', p, msg }), () => cancel);
          G.postMessage({ type: 'done', result: r });
        } catch (err) { G.postMessage({ type: 'error', message: err.message }); }
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
