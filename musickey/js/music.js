// MusicKey PRO Studio v2.0 — teoria musical: acordes, transposição, capo, cifra, ChordPro
export const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const NICE  = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
export const PT    = ['Dó','Dó#','Ré','Mi♭','Mi','Fá','Fá#','Sol','Lá♭','Lá','Si♭','Si'];
const PC = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

// qualidade → intervalos (semitons a partir da fundamental)
export const QUALITIES = {
  '':      [0,4,7],      'm':    [0,3,7],      'dim':  [0,3,6],     'aug':  [0,4,8],
  'sus2':  [0,2,7],      'sus4': [0,5,7],      '7':    [0,4,7,10],  'maj7': [0,4,7,11],
  'm7':    [0,3,7,10],   'm7b5': [0,3,6,10],   'dim7': [0,3,6,9],   '6':    [0,4,7,9],
  'm6':    [0,3,7,9],    '9':    [0,4,7,10,2], 'add9': [0,4,7,2],   'm9':   [0,3,7,10,2],
  '7sus4': [0,5,7,10],   'madd9':[0,3,7,2],    '5':    [0,7],       'maj9': [0,4,7,11,2],
  'mmaj7': [0,3,7,11],   '11':   [0,4,7,10,5], '13':   [0,4,7,10,9]
};
// grafias aceitas → qualidade canônica
const ALIAS = {
  '':'', 'M':'', 'maj':'', 'm':'m', 'min':'m', '-':'m', 'mi':'m',
  'dim':'dim', '°':'dim', 'o':'dim', 'aug':'aug', '+':'aug', '(#5)':'aug', '5+':'aug',
  'sus':'sus4', 'sus4':'sus4', 'sus2':'sus2', '4':'sus4', '2':'sus2',
  '7':'7', 'maj7':'maj7', '7M':'maj7', 'M7':'maj7', 'Δ':'maj7', '7+':'maj7', 'Δ7':'maj7',
  'm7':'m7', 'min7':'m7', '-7':'m7', 'm7b5':'m7b5', 'm7(b5)':'m7b5', 'ø':'m7b5', 'ø7':'m7b5',
  'dim7':'dim7', '°7':'dim7', 'o7':'dim7', '6':'6', 'm6':'m6', '9':'9', 'add9':'add9', '(9)':'add9', 'add2':'add9',
  'm9':'m9', 'm(9)':'madd9', 'madd9':'madd9', 'm(add9)':'madd9', '7sus4':'7sus4', '7(4)':'7sus4', '7sus':'7sus4',
  '5':'5', 'maj9':'maj9', '7M(9)':'maj9', 'm(maj7)':'mmaj7', 'm7M':'mmaj7', 'mmaj7':'mmaj7', '11':'11', '13':'13'
};

export function notePc(s) {
  if (!s) return -1;
  const b = PC[s[0].toUpperCase()]; if (b === undefined) return -1;
  let acc = 0; for (const c of s.slice(1)) { if (c === '#' || c === '♯') acc++; else if (c === 'b' || c === '♭') acc--; }
  return (b + acc + 120) % 12;
}

// "F#m7/C#" → {root:6, q:'m7', bass:1, raw}
export function parseChord(str) {
  if (!str) return null;
  const s = str.trim().replace(/♯/g,'#').replace(/♭/g,'b');
  const m = s.match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
  if (!m) return null;
  const q = ALIAS[m[3]] !== undefined ? ALIAS[m[3]] : null;
  if (q === null) return null;
  const root = notePc(m[1] + m[2]);
  const bass = m[4] ? notePc(m[4]) : -1;
  return { root, q, bass, flat: m[2] === 'b', raw: str };
}
export const isChord = s => parseChord(s) !== null;

// grafia de nota conforme o tom (bemóis em tons com bemol)
const FLAT_KEYS = new Set([5,10,3,8,1,6]); // F Bb Eb Ab Db Gb (maior)
export function spell(pc, preferFlat) { return (preferFlat ? FLAT : SHARP)[(pc % 12 + 12) % 12]; }
export function preferFlatFor(keyPc, minor) {
  const rel = minor ? (keyPc + 3) % 12 : keyPc;
  return rel !== 6 && FLAT_KEYS.has(rel);
}
export function chordStr(c, preferFlat) {
  if (!c) return '';
  const qShow = { dim:'°', aug:'+', maj7:'7M', mmaj7:'m(7M)', m7b5:'m7(b5)', dim7:'°7', add9:'(9)', madd9:'m(9)', '7sus4':'7(4)', maj9:'7M(9)' }[c.q] ?? c.q;
  return spell(c.root, preferFlat) + qShow + (c.bass >= 0 && c.bass !== c.root ? '/' + spell(c.bass, preferFlat) : '');
}
export function transposeChord(str, n, preferFlat) {
  const c = parseChord(str); if (!c) return str;
  const pf = preferFlat ?? c.flat;
  return chordStr({ ...c, root: (c.root + n + 120) % 12, bass: c.bass >= 0 ? (c.bass + n + 120) % 12 : -1 }, pf);
}
// simplificar: só tríade maior/menor/dim, sem baixo
export function simplifyChord(str) {
  const c = parseChord(str); if (!c) return str;
  const minorish = ['m','m7','m6','m9','madd9','mmaj7'].includes(c.q);
  const dimish = ['dim','dim7','m7b5'].includes(c.q);
  return chordStr({ root: c.root, q: dimish ? 'dim' : minorish ? 'm' : c.q === 'aug' ? 'aug' : '', bass: -1 }, c.flat);
}
export function chordNotes(str) {
  const c = typeof str === 'string' ? parseChord(str) : str; if (!c) return [];
  return (QUALITIES[c.q] || [0,4,7]).map(i => (c.root + i) % 12);
}

// ---------- texto da cifra ----------
const SECTION_WORDS = /^(intro(du[cç][aã]o)?|verso|estrofe|pr[eé][- ]?refr[aã]o|refr[aã]o|coro|ponte|solo|interl[uú]dio|final|outro|tag|ending|chorus|verse|bridge|pre[- ]?chorus)\b/i;

// linha → { type, text, chunks:[{chord,text}], section }
export function parseLine(raw) {
  const t = raw.replace(/\s+$/,'');
  if (!t.trim()) return { type: 'empty', raw };
  let m = t.match(/^\s*#\s*(.+)$/) || t.match(/^\s*\{(?:c|comment|ci|soc|start_of_chorus|sov|start_of_verse|sob|start_of_bridge)(?::\s*(.*))?\}\s*$/i);
  if (m) return { type: 'section', text: (m[1] || 'Refrão').trim(), raw };
  m = t.match(/^\s*\{(title|t|artist|key|tempo|time|capo|subtitle|st)\s*:\s*(.*)\}\s*$/i);
  if (m) return { type: 'meta', key: m[1].toLowerCase(), value: m[2].trim(), raw };
  if (/^\s*\{.*\}\s*$/.test(t)) return { type: 'meta', key: 'other', value: t, raw };
  if (/^\s*\[[^\]]+\]\s*$/.test(t) && !isChord(t.trim().slice(1,-1)) && SECTION_WORDS.test(t.trim().slice(1,-1)))
    return { type: 'section', text: t.trim().slice(1,-1), raw };
  const chunks = []; let cur = { chord: null, text: '' };
  for (const tok of t.split(/(\[[^\]]*\])/)) {
    if (/^\[[^\]]*\]$/.test(tok)) { if (cur.chord !== null || cur.text) chunks.push(cur); cur = { chord: tok.slice(1,-1), text: '' }; }
    else cur.text += tok;
  }
  if (cur.chord !== null || cur.text) chunks.push(cur);
  const text = chunks.map(c => c.text).join('');
  return { type: 'line', chunks, text, hasChords: chunks.some(c => c.chord), raw };
}
export function parseSong(text) { return (text || '').split(/\r?\n/).map(parseLine); }

export function songChords(text) {
  const out = []; for (const l of parseSong(text)) if (l.type === 'line') for (const c of l.chunks) if (c.chord) out.push(c.chord);
  return out;
}
export function invalidChords(text) { return [...new Set(songChords(text).filter(c => !isChord(c)))]; }

export function mapChords(text, fn) {
  return (text || '').split(/\r?\n/).map(line => {
    if (/^\s*\{.*\}\s*$/.test(line) || /^\s*#/.test(line)) return line;
    return line.replace(/\[([^\]]+)\]/g, (all, ch) => isChord(ch) ? '[' + fn(ch) + ']' : all);
  }).join('\n');
}
export function transposeText(text, n, preferFlat) { return mapChords(text, ch => transposeChord(ch, n, preferFlat)); }
export function simplifyText(text) { return mapChords(text, simplifyChord); }

// "cifra com acordes em cima" (formato de sites) → [G]inline
export function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const ok = toks.filter(t => isChord(t.replace(/[()|]/g,'')) || /^[|/x\d.()-]+$/i.test(t)).length;
  return ok / toks.length >= 0.8 && toks.some(t => isChord(t.replace(/[()|]/g,'')));
}
export function fromChordsAbove(text) {
  const L = (text || '').split(/\r?\n/), out = [];
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    if (isChordLine(line)) {
      const pos = []; const re = /\S+/g; let m;
      while ((m = re.exec(line))) { const c = m[0].replace(/[()|]/g,''); if (isChord(c)) pos.push([m.index, c]); }
      const next = L[i + 1];
      if (next !== undefined && next.trim() && !isChordLine(next) && !/^\s*[#\[{]/.test(next)) {
        let lyr = next.padEnd(Math.max(next.length, pos.length ? pos[pos.length-1][0] + 1 : 0), ' ');
        for (let k = pos.length - 1; k >= 0; k--) { const [p, c] = pos[k]; lyr = lyr.slice(0, p) + '[' + c + ']' + lyr.slice(p); }
        out.push(lyr.replace(/\s+$/,'')); i++;
      } else out.push(pos.map(([,c]) => '[' + c + ']').join(' '));
    } else out.push(line);
  }
  return out.join('\n');
}
// ChordPro → formato interno e volta
export function fromChordPro(text) {
  const meta = {}; const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const p = parseLine(raw);
    if (p.type === 'meta' && p.key !== 'other') meta[{t:'title',st:'subtitle'}[p.key] || p.key] = p.value;
    else if (p.type === 'section') lines.push('# ' + p.text);
    else if (/^\s*\{(eoc|end_of_chorus|eov|end_of_verse|eob|end_of_bridge)\}\s*$/i.test(raw)) continue;
    else lines.push(raw);
  }
  return { meta, text: lines.join('\n') };
}
export function toChordPro(song) {
  const head = [`{title: ${song.title || 'Sem título'}}`];
  if (song.artist) head.push(`{artist: ${song.artist}}`);
  if (song.key) head.push(`{key: ${song.key}}`);
  if (song.bpm) head.push(`{tempo: ${song.bpm}}`);
  if (song.meter) head.push(`{time: ${song.meter}}`);
  if (song.capo) head.push(`{capo: ${song.capo}}`);
  const body = (song.text || '').split(/\r?\n/).map(l => { const m = l.match(/^\s*#\s*(.+)$/); return m ? `{c: ${m[1]}}` : l; });
  return head.join('\n') + '\n\n' + body.join('\n') + '\n';
}

// blocos do palco: só linhas com letra/acorde; seção vira rótulo da linha seguinte
export function stageLines(text) {
  const out = []; let section = null; let idx = 0;
  for (const [i, l] of parseSong(text).entries()) {
    if (l.type === 'section') { section = l.text; continue; }
    if (l.type !== 'line') continue;
    out.push({ ...l, src: i, section, n: idx++ }); section = null;
  }
  return out;
}
export function stageBlocks(lines, size = 4) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += size)
    blocks.push({ lines: lines.slice(i, i + size), preview: lines[i + size] || null, start: i });
  return blocks;
}

// campo harmônico e progressões (vindo do Detector v4.2)
export function harmony(root, minor) {
  const pf = preferFlatFor(root, minor);
  const mk = (s, q) => chordStr({ root: (root + s) % 12, q, bass: -1 }, pf);
  if (!minor) {
    const f = [[0,'','I'],[2,'m','ii'],[4,'m','iii'],[5,'','IV'],[7,'','V'],[9,'m','vi'],[11,'dim','vii°']].map(([s,q,r]) => ({ roman: r, name: mk(s,q) }));
    const C = i => f[i].name;
    return { field: f, progs: [
      { deg:'1-5-6-4', tag:'Mais usada (pop e louvor)', chords:[C(0),C(4),C(5),C(3)] },
      { deg:'1-4-5-4', tag:'Simples, 3 acordes', chords:[C(0),C(3),C(4),C(3)] },
      { deg:'6-4-1-5', tag:'Começa triste, mesma base', chords:[C(5),C(3),C(0),C(4)] },
      { deg:'1-6-4-5', tag:'Clássica anos 50', chords:[C(0),C(5),C(3),C(4)] },
      { deg:'1-5-6-3-4', tag:'5 acordes (estilo Cânon)', chords:[C(0),C(4),C(5),C(2),C(3)] } ] };
  }
  const f = [[0,'m','i'],[2,'dim','ii°'],[3,'','III'],[5,'m','iv'],[7,'m','v'],[8,'','VI'],[10,'','VII']].map(([s,q,r]) => ({ roman: r, name: mk(s,q) }));
  const C = i => f[i].name; const V = mk(7,'');
  return { field: f, progs: [
    { deg:'1-6-3-7', tag:'Mais usada em tom menor', chords:[C(0),C(5),C(2),C(6)] },
    { deg:'1-4-7-3', tag:'Balada menor', chords:[C(0),C(3),C(6),C(2)] },
    { deg:'1-7-6-7', tag:'Andaluz suave', chords:[C(0),C(6),C(5),C(6)] },
    { deg:'1-4-5', tag:'Com V maior (mais tensão)', chords:[C(0),C(3),V,C(0)] },
    { deg:'1-6-3-7-4', tag:'5 acordes', chords:[C(0),C(5),C(2),C(6),C(3)] } ] };
}
export function keyName(root, minor) { return `${PT[root]} ${minor ? 'menor' : 'Maior'}`; }
export function keySym(root, minor) { return NICE[root] + (minor ? 'm' : ''); }
export function parseKey(s) { // "Em" "G" "Bb" "F#m"
  const c = parseChord(s || ''); if (!c) return null;
  return { root: c.root, minor: c.q === 'm' };
}
export const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
