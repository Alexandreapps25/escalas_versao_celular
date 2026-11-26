#!/usr/bin/env node
// MusicKey PRO Studio v2.0 — servidor local (PC central). Sem dependências: só Node.js.
// Serve o app na rede Wi-Fi e sincroniza os aparelhos por WebSocket.
// Uso: node server/server.js [--port 8080] [--code 1234 | --code auto | --code off] [--open]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { exec } = require('child_process');

const VERSION = '2.0';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const PORT = +arg('port', process.env.PORT || 8080);
let CODE = String(arg('code', 'auto'));
if (CODE === 'auto') CODE = String(1000 + crypto.randomInt(9000));
if (CODE === 'off') CODE = '';
const ROOT = path.resolve(__dirname, '..');
const ROLES = new Set(['master', 'remote', 'singer', 'musician', 'public', 'return']);
const MAX_MSG = 8 * 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

function lanIPs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || [])
    if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address) && !/vEthernet|VirtualBox|VMware|WSL|Hyper-V/i.test(name)) out.push(a.address);
  return out.sort((a, b) => (b.startsWith('192.168.') - a.startsWith('192.168.')));
}
const isLocal = ip => /^(::1|127\.|::ffff:127\.)/.test(ip || '');

// ---------- HTTP: arquivos do app ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    // o código só é revelado ao próprio PC (para gerar o QR)
    return res.end(JSON.stringify({ app: 'musickey', version: VERSION, port: PORT, ips: lanIPs(), code: isLocal(req.socket.remoteAddress) ? CODE : (CODE ? 'required' : ''), clients: clients.size }));
  }
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || /[\\/](server|node_modules)[\\/]|[\\/]\./.test(file.slice(ROOT.length))) { res.writeHead(403); return res.end('Proibido'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- WebSocket (RFC 6455) ----------
const clients = new Map(); let lastState = null;
server.on('upgrade', (req, sock) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') return sock.destroy();
  const key = req.headers['sec-websocket-key']; if (!key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const c = { sock, ip: (req.socket.remoteAddress || '').replace('::ffff:', ''), role: null, id: null, name: '', buf: Buffer.alloc(0), frag: [], alive: true, local: isLocal(req.socket.remoteAddress) };
  clients.set(sock, c);
  sock.on('data', d => { c.buf = Buffer.concat([c.buf, d]); if (c.buf.length > MAX_MSG + 16) return drop(c); parse(c); });
  sock.on('close', () => drop(c)); sock.on('error', () => drop(c));
});
function parse(c) {
  while (c.buf.length >= 2) {
    const b0 = c.buf[0], b1 = c.buf[1], fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80; let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > MAX_MSG) return drop(c);
    if (!masked) return drop(c); // clientes devem mascarar
    if (c.buf.length < off + 4 + len) return;
    const mask = c.buf.subarray(off, off + 4), data = Buffer.from(c.buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    c.buf = c.buf.subarray(off + 4 + len);
    if (op === 0x8) return drop(c);
    if (op === 0x9) { frame(c, data, 0xA); continue; }
    if (op === 0xA) { c.alive = true; continue; }
    if (op === 0x1 || op === 0x0) { c.frag.push(data); if (fin) { const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = []; handle(c, msg); } }
  }
}
function frame(c, payload, op = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const head = data.length < 126 ? Buffer.from([0x80 | op, data.length]) : data.length < 65536 ? Buffer.from([0x80 | op, 126, data.length >> 8, data.length & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(data.length), 2); return h; })();
  try { c.sock.write(Buffer.concat([head, data])); } catch {}
}
const send = (c, obj) => frame(c, JSON.stringify(obj));
function drop(c) { if (!clients.has(c.sock)) return; clients.delete(c.sock); try { c.sock.destroy(); } catch {} if (c.role) { log(`saiu: ${c.role} ${c.name} (${c.ip})`); peers(); } }
function peers() { const list = [...clients.values()].filter(x => x.role).map(x => ({ id: x.id, role: x.role, name: x.name, ip: x.ip })); for (const x of clients.values()) if (x.role) send(x, { type: 'peers', from: 'server', peers: list }); }
function handle(c, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  if (m.type === 'ping') return send(c, { type: 'pong', t: m.t, server: Date.now() });
  if (m.type === 'hello') {
    if (!ROLES.has(m.role)) return send(c, { type: 'denied', reason: 'papel inválido' });
    if (CODE && !c.local && String(m.code || '') !== CODE) { send(c, { type: 'denied', reason: 'código da sessão incorreto' }); return setTimeout(() => drop(c), 200); }
    if (m.role === 'master' && !c.local) { send(c, { type: 'denied', reason: 'a central só pode ser aberta no próprio PC (localhost)' }); return setTimeout(() => drop(c), 200); }
    c.role = m.role; c.id = String(m.from || '').slice(0, 20); c.name = String(m.name || '').slice(0, 40);
    log(`entrou: ${c.role} ${c.name} (${c.ip})`); peers();
    if (lastState && c.role !== 'master') send(c, lastState); // recuperação: estado completo ao entrar
    relay(c, m); return;
  }
  if (!c.role) return; // precisa se apresentar antes
  // autoridade: só a central publica o estado; comandos vêm do controle remoto, retorno ou central
  if (m.type === 'state' && c.role !== 'master') return;
  if (m.type === 'cmd' && !['remote', 'return', 'master'].includes(c.role)) return;
  if (!['state', 'cmd', 'getState'].includes(m.type)) return;
  m.role = c.role; // não confia no papel informado pelo cliente
  if (m.type === 'state') lastState = m;
  relay(c, m);
}
function relay(from, m) { const s = JSON.stringify(m); for (const x of clients.values()) if (x !== from && x.role) frame(x, s); }
setInterval(() => { for (const c of clients.values()) { if (!c.alive) { drop(c); continue; } c.alive = false; frame(c, Buffer.alloc(0), 0x9); } }, 15000);

const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a);
server.on('error', e => { if (e.code === 'EADDRINUSE') console.error(`\nA porta ${PORT} já está em uso. Feche o outro servidor ou use: node server/server.js --port 8090\n`); else console.error(e); process.exit(1); });
server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log(`\n  MusicKey PRO Studio v${VERSION} — servidor local\n`);
  console.log(`  No PC (central, com microfone):   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Celulares no mesmo Wi-Fi:         http://${ip}:${PORT}`);
  console.log(`  Código da sessão:                 ${CODE || '(sem código)'}`);
  console.log(`\n  No app: Mais → Conectar aparelhos mostra os QR Codes.`);
  console.log(`  Se o Windows perguntar, permita o acesso na "Rede privada".\n  Para parar: feche esta janela ou aperte Ctrl+C.\n`);
  if (arg('open', false)) exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + `http://localhost:${PORT}`);
});
