// MusicKey PRO Studio v2.0 — biblioteca de acordes: violão/guitarra, ukulele, cavaquinho e teclado
import { parseChord, chordNotes, SHARP } from './music.js';

export const INSTRUMENTS = {
  violao: { name: 'Violão / guitarra', tuning: [40,45,50,55,59,64], frets: 12 },
  ukulele: { name: 'Ukulele', tuning: [67,60,64,69], frets: 12, reentrant: true },
  cavaco: { name: 'Cavaquinho', tuning: [62,67,71,74], frets: 12 }
};

// formas padrão de violão (primeira opção quando existem)
const STD = { C:'x32010', D:'xx0232', E:'022100', G:'320003', A:'x02220', F:'133211', B:'x24442', Bb:'x13331',
  Am:'x02210', Dm:'xx0231', Em:'022000', Bm:'x24432', 'F#m':'244222', Cm:'x35543', Gm:'355333', Fm:'133111', 'C#m':'x46654',
  E7:'020100', A7:'x02020', D7:'xx0212', G7:'320001', C7:'x32310', B7:'x21202', Am7:'x02010', Em7:'020000', Dm7:'xx0211',
  C7M:'x32000', F7M:'xx3210', G7M:'320002', D7M:'xx0222', A7M:'x02120', Asus4:'x02230', Dsus4:'xx0233', Esus4:'022200',
  Asus2:'x02200', Dsus2:'xx0230', 'C/E':'032010', 'G/B':'x20003', 'D/F#':'200232', 'Am/G':'302210' };
const toFrets = str => str.split('').map(ch => ch === 'x' ? -1 : parseInt(ch, 16));

// procura posições tocáveis: até 4 casas de abertura, todas as notas do acorde, baixo na fundamental quando possível
export function voicings(chord, instId = 'violao', max = 4) {
  const c = parseChord(chord); if (!c) return [];
  const std = instId === 'violao' ? STD[chord] || STD[chord.replace('maj7','7M')] : null;
  const inst = INSTRUMENTS[instId], need = new Set(chordNotes(c).slice(0, inst.tuning.length >= 6 ? 4 : 3));
  const tones = new Set(chordNotes(c)), bassPc = c.bass >= 0 ? c.bass : c.root, out = [], seen = new Set();
  for (let pos = 0; pos <= 9; pos++) {
    const opts = inst.tuning.map((open, si) => {
      const o = []; if (!inst.reentrant && si < 2) o.push(-1);
      for (const f of [0].concat([pos, pos + 1, pos + 2, pos + 3].filter(x => x > 0))) if (tones.has((open + f) % 12)) o.push(f);
      return [...new Set(o)];
    });
    const rec = (i, acc) => {
      if (i === opts.length) { evaluate(acc); return; }
      for (const f of opts[i]) { if (f === -1 && acc.some(x => x >= 0)) continue; acc.push(f); rec(i + 1, acc); acc.pop(); }
    };
    const evaluate = fr => {
      const played = fr.map((f, i) => f < 0 ? null : (inst.tuning[i] + f)).filter(x => x !== null);
      if (played.length < Math.min(3, inst.tuning.length)) return;
      const pcs = new Set(played.map(m => m % 12)); for (const n of need) if (!pcs.has(n)) return;
      const fretted = fr.filter(f => f > 0); const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0; if (span > 3) return;
      const low = inst.reentrant ? Math.min(...played) : played[0];
      let score = 0;
      if (low % 12 !== bassPc) score += inst.reentrant ? 1 : 6;
      score += fr.filter(f => f < 0).length * 1.5 + (fretted.length ? Math.min(...fretted) : 0) * 0.6 + span * 0.5;
      // pestana: muitos dedos na mesma casa conta como 1
      const minF = fretted.length ? Math.min(...fretted) : 0; const fingers = fretted.filter(f => f > minF).length + (fretted.some(f => f === minF) ? 1 : 0);
      if (fingers > 4) return; score += fingers * 0.3;
      if (minF >= 2) score += fr.filter(f => f === 0).length * 3; // corda solta longe da 1ª posição soa estranho
      const key = fr.join(','); if (seen.has(key)) return; seen.add(key);
      out.push({ frets: fr.slice(), score, base: Math.max(1, minF > 2 ? minF : 1) });
    };
    rec(0, []);
  }
  out.sort((a, b) => a.score - b.score);
  if (std) { const f = toFrets(std), k = f.join(','); const fr = f.filter(x => x > 0), mn = fr.length ? Math.min(...fr) : 1;
    return [{ frets: f, score: -1, base: mn > 2 ? mn : 1 }].concat(out.filter(v => v.frets.join(',') !== k)).slice(0, max); }
  return out.slice(0, max);
}

// diagrama SVG de braço
export function fretSVG(v, instId = 'violao', label = '') {
  const n = INSTRUMENTS[instId].tuning.length, W = 22 + n * 22, H = 150, x0 = 18, y0 = 34, sw = 22, fh = 22, base = v.base;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}" style="color:var(--text)">`;
  s += `<text x="${W/2}" y="14" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">${label}</text>`;
  if (base > 1) s += `<text x="2" y="${y0 + fh * 0.7}" font-size="10" fill="currentColor">${base}ª</text>`;
  for (let i = 0; i <= 4; i++) s += `<line x1="${x0}" x2="${x0 + (n - 1) * sw}" y1="${y0 + i * fh}" y2="${y0 + i * fh}" stroke="currentColor" stroke-width="${i === 0 && base === 1 ? 3 : 1}" opacity=".7"/>`;
  for (let j = 0; j < n; j++) s += `<line x1="${x0 + j * sw}" x2="${x0 + j * sw}" y1="${y0}" y2="${y0 + 4 * fh}" stroke="currentColor" opacity=".7"/>`;
  v.frets.forEach((f, j) => {
    const x = x0 + j * sw;
    if (f < 0) s += `<text x="${x}" y="${y0 - 6}" text-anchor="middle" font-size="11" fill="currentColor">×</text>`;
    else if (f === 0) s += `<circle cx="${x}" cy="${y0 - 10}" r="4" fill="none" stroke="currentColor"/>`;
    else { const r = f - base + 1; s += `<circle cx="${x}" cy="${y0 + (r - 0.5) * fh}" r="7" fill="var(--accent)"/>`; }
  });
  return s + '</svg>';
}

// teclado (2 oitavas), notas do acorde em destaque, baixo marcado
export function keyboardSVG(chord) {
  const c = parseChord(chord); if (!c) return '';
  const notes = chordNotes(c), bass = c.bass >= 0 ? c.bass : c.root;
  const whites = [0,2,4,5,7,9,11], blacks = [1,3,6,8,10], ww = 18, W = ww * 14, H = 80;
  let s = `<svg viewBox="0 0 ${W} ${H + 18}" width="${W}" height="${H + 18}" role="img" aria-label="Teclado ${chord}">`;
  for (let o = 0; o < 2; o++) whites.forEach((pc, i) => {
    const x = (o * 7 + i) * ww, on = notes.includes(pc);
    s += `<rect x="${x}" y="0" width="${ww - 1}" height="${H}" rx="2" fill="${on ? 'var(--accent)' : '#e8e8e4'}"/>`;
    if (on && o === 0 && pc === bass) s += `<circle cx="${x + ww / 2}" cy="${H - 10}" r="4" fill="#1a1205"/>`;
  });
  for (let o = 0; o < 2; o++) blacks.forEach(pc => {
    const i = [0.5,1.5,3.5,4.5,5.5][blacks.indexOf(pc)], x = (o * 7 + i) * ww + ww * 0.2, on = notes.includes(pc);
    s += `<rect x="${x}" y="0" width="${ww * 0.6}" height="${H * 0.6}" rx="2" fill="${on ? '#f5b544' : '#1b1e22'}" stroke="#000"/>`;
  });
  s += `<text x="${W/2}" y="${H + 14}" text-anchor="middle" font-size="11" fill="currentColor">${notes.map(n => SHARP[n]).join(' · ')}</text>`;
  return s + '</svg>';
}
