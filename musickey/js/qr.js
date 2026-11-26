// MusicKey PRO Studio v2.0 — gerador de QR Code (modo byte, correção M, versões 1–10), sem dependências
const EC_M = [null, [10,1,16,0,0], [16,1,28,0,0], [26,1,44,0,0], [18,2,32,0,0], [24,2,43,0,0], [16,4,27,0,0], [18,4,31,0,0], [22,2,38,2,39], [22,3,36,2,37], [26,4,43,1,44]];
const ALIGN = [null, [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50]];
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
function rsEncode(data, n) { const g = rsGen(n), r = new Array(n).fill(0); for (const d of data) { const f = d ^ r[0]; r.shift(); r.push(0); for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f); } return r; }
function bch(v, poly, bits) { let x = v << bits; const deg = Math.floor(Math.log2(poly)); while (x && Math.floor(Math.log2(x)) >= deg) x ^= poly << (Math.floor(Math.log2(x)) - deg); return (v << bits) | x; }

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1; for (; ver <= 10; ver++) { const e = EC_M[ver], cap = e[1] * e[2] + e[3] * e[4]; if (4 + (ver < 10 ? 8 : 16) + 8 * bytes.length <= cap * 8) break; }
  if (ver > 10) throw new Error('Texto longo demais para o QR');
  const [ecn, b1, d1, b2, d2] = EC_M[ver], dataCap = b1 * d1 + b2 * d2;
  // fluxo de bits
  const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; data.length < dataCap; p++) data.push(p % 2 ? 0x11 : 0xec);
  // blocos + correção, intercalados
  const blocks = []; let k = 0; for (let i = 0; i < b1 + b2; i++) { const n = i < b1 ? d1 : d2; const d = data.slice(k, k + n); k += n; blocks.push({ d, e: rsEncode(d, ecn) }); }
  const final = []; const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) final.push(b.d[i]);
  for (let i = 0; i < ecn; i++) for (const b of blocks) final.push(b.e[i]);
  // matriz
  const N = 17 + 4 * ver, m = Array.from({ length: N }, () => new Array(N).fill(null)), fn = Array.from({ length: N }, () => new Array(N).fill(false));
  const set = (r, c, v) => { m[r][c] = v; fn[r][c] = true; };
  const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const rr = r + i, cc = c + j; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
    set(rr, cc, i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) ? 1 : 0); } };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 ? 0 : 1); set(i, 6, i % 2 ? 0 : 1); }
  const al = ALIGN[ver], L = al[al.length - 1]; for (const r of al) for (const c of al) { if ((r === 6 && c === 6) || (r === 6 && c === L) || (r === L && c === 6)) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0); }
  set(N - 8, 8, 1); // módulo escuro
  for (let i = 0; i < 9; i++) { if (!fn[8][i]) fn[8][i] = true; if (!fn[i][8]) fn[i][8] = true; } for (let i = 0; i < 8; i++) { fn[8][N - 1 - i] = true; fn[N - 1 - i][8] = true; }
  if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fn[i][N - 11 + j] = true; fn[N - 11 + j][i] = true; }
  // dados em zigue-zague
  const dbits = []; final.forEach(b => { for (let i = 7; i >= 0; i--) dbits.push((b >> i) & 1); });
  let bi = 0; for (let c = N - 1; c > 0; c -= 2) { if (c === 6) c--; for (let t = 0; t < N; t++) for (let j = 0; j < 2; j++) {
    const cc = c - j, up = ((c + 1) & 2) === 0, r = up ? N - 1 - t : t; if (fn[r][cc]) continue; m[r][cc] = bi < dbits.length ? dbits[bi++] : 0; } }
  // máscaras: escolhe a de menor penalidade
  const MASKS = [(r,c)=>(r+c)%2===0,(r)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>r*c%2+r*c%3===0,(r,c)=>(r*c%2+r*c%3)%2===0,(r,c)=>((r+c)%2+r*c%3)%2===0];
  let best = null, bestP = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const q = m.map((row, r) => row.map((v, c) => fn[r][c] ? v : v ^ (MASKS[mk](r, c) ? 1 : 0)));
    const fmt = bch((0 << 3) | mk, 0x537, 10) ^ 0x5412; // nível M = 00
    for (let i = 0; i <= 5; i++) q[i][8] = (fmt >> i) & 1; q[7][8] = (fmt >> 6) & 1; q[8][8] = (fmt >> 7) & 1; q[8][7] = (fmt >> 8) & 1;
    for (let i = 9; i < 15; i++) q[8][14 - i] = (fmt >> i) & 1;
    for (let i = 0; i < 8; i++) q[8][N - 1 - i] = (fmt >> i) & 1; for (let i = 8; i < 15; i++) q[N - 15 + i][8] = (fmt >> i) & 1;
    if (ver >= 7) { const vi = bch(ver, 0x1f25, 12); for (let i = 0; i < 18; i++) { const b = (vi >> i) & 1, a = Math.floor(i / 3), c = N - 11 + i % 3; q[a][c] = b; q[c][a] = b; } }
    const p = penalty(q); if (p < bestP) { bestP = p; best = q; }
  }
  return best;
}
function penalty(q) {
  const N = q.length; let p = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++) { let run = 1; for (let j = 1; j < N; j++) { const a = pass ? q[j][i] : q[i][j], b = pass ? q[j - 1][i] : q[i][j - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) { const v = q[i][j]; if (v === q[i + 1][j] && v === q[i][j + 1] && v === q[i + 1][j + 1]) p += 3; }
  let dark = 0; q.forEach(r => r.forEach(v => dark += v)); p += Math.floor(Math.abs(dark * 100 / (N * N) - 50) / 5) * 10;
  return p;
}
export function qrSVG(text, scale = 4) {
  const q = qrMatrix(text), N = q.length, s = (N + 8) * scale; let d = '';
  q.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${(c + 4) * scale},${(r + 4) * scale}h${scale}v${scale}h-${scale}z`; }));
  return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" role="img" aria-label="QR Code para ${text.replace(/"/g, '')}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
