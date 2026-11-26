// MusicKey PRO Studio v2.0 — sincronização: mesma máquina (BroadcastChannel) e rede local (WebSocket)
// O PC central roda server/server.js; celulares entram pelo QR Code no mesmo Wi-Fi.
export const ROLES = { master: 'Central (PC)', remote: 'Controle remoto', singer: 'Cantor (letra)', musician: 'Músico (cifra)', public: 'Público (projeção)', return: 'Retorno (cifra + prévia)' };

export class Sync {
  constructor(role, name) {
    this.role = role; this.name = name || role; this.id = Math.random().toString(36).slice(2, 9);
    this.handlers = []; this.seq = 0; this.lastSeq = {}; this.ws = null; this.wsOk = false; this.retry = 0; this.peers = []; this.code = '';
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('musickey-v2') : null;
    if (this.bc) this.bc.onmessage = e => this.receive(e.data, 'local');
    this.status = 'local';
  }
  onMessage(fn) { this.handlers.push(fn); }
  onStatus(fn) { this.statusFn = fn; }
  setStatus(s, info) { this.status = s; this.statusFn?.(s, info); }
  send(msg) {
    const m = Object.assign({ from: this.id, role: this.role, seq: ++this.seq, at: Date.now() }, msg);
    this.bc?.postMessage(m);
    if (this.wsOk) try { this.ws.send(JSON.stringify(m)); } catch {}
  }
  receive(m, via) {
    if (!m || typeof m !== 'object' || m.from === this.id || typeof m.type !== 'string') return;
    // descarta mensagens repetidas/atrasadas do mesmo remetente
    if (m.seq && this.lastSeq[m.from] >= m.seq && m.type !== 'hello') return;
    if (m.seq) this.lastSeq[m.from] = m.seq;
    if (m.type === 'peers') { this.peers = m.peers || []; }
    for (const h of this.handlers) h(m, via);
  }
  // rede local: só funciona quando o app é aberto pelo servidor local (http://IP:porta)
  async detectServer() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const r = await fetch('/api/info', { cache: 'no-store' });
      if (!r.ok) return null; const j = await r.json(); return j && j.app === 'musickey' ? j : null;
    } catch { return null; }
  }
  connect(code) {
    if (code !== undefined) this.code = code;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    try { this.ws = new WebSocket(url); } catch (e) { this.setStatus('erro', e.message); return; }
    this.setStatus('conectando');
    this.ws.onopen = () => { this.wsOk = true; this.retry = 0; this.ws.send(JSON.stringify({ type: 'hello', from: this.id, role: this.role, name: this.name, code: this.code })); this.setStatus('rede'); this.pingT = setInterval(() => this.ping(), 5000); };
    this.ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'pong') { const rtt = Date.now() - m.t; this.offset = m.server + rtt / 2 - Date.now(); this.rtt = rtt; return; }
      if (m.type === 'denied') { this.setStatus('negado', m.reason); this.denied = true; return; }
      this.receive(m, 'rede'); };
    this.ws.onclose = () => { this.wsOk = false; clearInterval(this.pingT); if (this.denied) return; this.setStatus('reconectando');
      const d = Math.min(8000, 500 * Math.pow(2, this.retry++)); setTimeout(() => this.connect(), d); };
    this.ws.onerror = () => {};
  }
  ping() { if (this.wsOk) try { this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch {} }
}
