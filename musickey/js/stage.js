// MusicKey PRO Studio v2.0 — palco 4+1, telas de público/retorno/cantor/músico e controle remoto
import * as M from './music.js';
import { S, $, $$, esc, toast, on, emit, lineHTML } from './state.js';

let wake = null;
export function rebuildStage() {
  if (!S.song) return;
  S.stage.lines = M.stageLines(S.song.text);
  S.stage.blocks = M.stageBlocks(S.stage.lines, Math.max(2, Math.min(8, S.settings.lines || 4)));
  S.stage.block = Math.max(0, Math.min(S.stage.block, S.stage.blocks.length - 1));
  renderStage(); publish();
}
export function go(n, abs) {
  const max = S.stage.blocks.length - 1; if (max < 0) return;
  const nb = Math.max(0, Math.min(max, abs ? n : S.stage.block + n));
  if (nb === S.stage.block && !abs) return;
  S.stage.block = nb; renderStage(); publish();
}
function capoShift() { return 0; }
function renderStage() {
  const b = S.stage.blocks[S.stage.block], sh = $('stSheet'); if (!sh) return;
  sh.classList.toggle('nochords', !S.settings.stageChords);
  if (!b) { sh.innerHTML = '<div class="muted">Escreva a letra na aba Música.</div>'; $('stPos').textContent = ''; $('stTag').textContent = ''; return; }
  sh.innerHTML = b.lines.map(l => `<div class="ln">${lineHTML(l, { shift: capoShift() })}</div>`).join('') +
    (b.preview ? `<div class="ln preview">${lineHTML(b.preview, { shift: capoShift() })}</div>` : '<div class="ln preview muted" style="font-size:.5em">— fim —</div>');
  const sec = [...b.lines].reverse().find(l => l.section)?.section || sectionOf(b.start);
  $('stTag').textContent = [S.song?.title, sec].filter(Boolean).join(' · ');
  $('stPos').textContent = `${S.stage.block + 1}/${S.stage.blocks.length}`;
  $('stage').style.setProperty('--stage-fg', S.settings.stageFg || '#fff');
  fitStage();
}
function sectionOf(i) { for (let k = i; k >= 0; k--) if (S.stage.lines[k]?.section) return S.stage.lines[k].section; return ''; }
// ajusta o tamanho da fonte para caber (largura e altura), sem rolagem
export function fitStage() {
  const st = $('stage'), sh = $('stSheet'); if (!st || !st.offsetParent) return;
  if (S.settings.stageSize > 0) { st.style.setProperty('--stage-size', S.settings.stageSize + 'px'); return; }
  let lo = 12, hi = 140;
  const H = st.clientHeight - 40, W = st.clientWidth - 20;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; st.style.setProperty('--stage-size', mid + 'px'); if (sh.scrollHeight <= H && sh.scrollWidth <= W) lo = mid; else hi = mid; }
  st.style.setProperty('--stage-size', lo + 'px');
}
// estado enviado às outras telas (mesma máquina e rede)
export function publish() {
  if (!S.sync || !S.song) return;
  const b = S.stage.blocks[S.stage.block];
  S.sync.send({ type: 'state', song: { id: S.song.id, title: S.song.title, key: S.song.key, bpm: S.song.bpm },
    block: S.stage.block, total: S.stage.blocks.length,
    lines: b ? b.lines.map(l => ({ chunks: l.chunks, text: l.text, hasChords: l.hasChords, type: 'line', section: l.section })) : [],
    preview: b && b.preview ? { chunks: b.preview.chunks, text: b.preview.text, hasChords: b.preview.hasChords, type: 'line' } : null,
    section: b ? ([...b.lines].reverse().find(l => l.section)?.section || sectionOf(b.start)) : '',
    blackout: S.blackout, pub: S.settings.pub, beat: S.lastBeat || null });
}
function setBlack(v) { S.blackout = v ?? !S.blackout; $('stBlack').classList.toggle('sel', S.blackout); $('stBlack').textContent = S.blackout ? 'Mostrar público' : 'Escurecer público'; publish(); }
async function requestWake() { try { if (S.settings.wake && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => wake = null); } } catch {} }
function releaseWake() { try { wake?.release(); } catch {} wake = null; }
async function openSecondScreen() {
  const url = location.pathname + '?screen=public';
  try {
    if ('getScreenDetails' in window) {
      const d = await window.getScreenDetails(); const other = d.screens.find(s => s !== d.currentScreen) || d.screens[0];
      const w = window.open(url, 'mk-public', `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`);
      if (!w) throw new Error('Pop-up bloqueado'); toast('Tela do público aberta no 2º monitor. Toque nela e aperte F11 (ou o botão de tela cheia).'); return;
    }
  } catch (e) { if (e.name === 'NotAllowedError') toast('Permissão de janelas negada. Abrindo janela comum.'); }
  window.open(url, 'mk-public'); toast('Arraste a janela para o projetor e aperte F11.');
}

export function initStage() {
  $('stNext').onclick = () => go(1); $('stPrev').onclick = () => go(-1);
  $('stFull').onclick = async () => { document.body.classList.add('fs'); try { await document.documentElement.requestFullscreen?.(); } catch {} requestWake(); setTimeout(fitStage, 150); };
  $('stExit').onclick = exitFull;
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { document.body.classList.remove('fs'); setTimeout(fitStage, 100); } });
  $('stPublic').onclick = () => window.open(location.pathname + '?screen=public', 'mk-public');
  $('stPublic2').onclick = openSecondScreen;
  $('stReturn').onclick = () => window.open(location.pathname + '?screen=return', 'mk-return');
  $('stBlack').onclick = () => setBlack();
  $('stLock').onchange = e => document.body.classList.toggle('locked', e.target.checked);
  // toque e gestos
  let x0 = null, y0 = 0;
  $('stage').addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
  $('stage').addEventListener('pointerup', e => {
    if (x0 === null || document.body.classList.contains('locked')) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { const r = $('stage').getBoundingClientRect(); go(e.clientX - r.left > r.width / 2 ? 1 : -1); }
  });
  // teclado e pedal (pedais Bluetooth/USB enviam essas teclas)
  document.addEventListener('keydown', e => {
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const onStage = $('v-palco').classList.contains('active') || document.body.classList.contains('fs');
    if (!onStage) return;
    if (['ArrowRight', 'PageDown', 'ArrowDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'PageUp', 'ArrowUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') go(0, true); else if (e.key === 'End') go(S.stage.blocks.length - 1, true);
    else if (e.key.toLowerCase() === 'b') setBlack(); else if (e.key.toLowerCase() === 'f') $('stFull').click(); else if (e.key === 'Escape') exitFull();
  });
  window.addEventListener('resize', () => setTimeout(fitStage, 60));
  screen.orientation?.addEventListener?.('change', () => setTimeout(fitStage, 200));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (document.body.classList.contains('fs') || $('v-palco').classList.contains('active'))) requestWake(); });
  on('view', v => { if (v === 'palco') { requestWake(); setTimeout(fitStage, 50); } else if (!document.body.classList.contains('fs')) releaseWake(); });
  // avanço automático: pelas marcações do áudio ou pela banda (2 compassos por linha)
  on('stageLine', li => { const bi = Math.floor(li / (S.settings.lines || 4)); if (bi !== S.stage.block) go(bi, true); });
  on('bar', bar => { if ($('stAuto').checked && S.band.playing && !(S.audio && !S.audio.paused)) { const per = (S.settings.lines || 4) * 2; if (bar > 0 && bar % per === 0) go(1); } });
  // comandos vindos do controle remoto / outras telas
  S.sync.onMessage(m => {
    if (m.type === 'hello' || m.type === 'getState') publish();
    if (m.type === 'cmd' && (m.role === 'remote' || m.role === 'master' || m.role === 'return')) {
      if (m.cmd === 'next') go(1); else if (m.cmd === 'prev') go(-1); else if (m.cmd === 'goto') go(+m.n || 0, true); else if (m.cmd === 'black') setBlack();
      else if (m.cmd === 'band' && S.band) { S.band.playing ? S.band.stop() : S.band.start(); }
    }
  });
  S.sync.onStatus((s, info) => { const p = $('netPill'); p.className = 'pill' + (s === 'rede' ? ' ok' : s === 'reconectando' || s === 'conectando' ? ' on' : ''); p.lastChild.textContent = s === 'rede' ? `Rede · ${S.sync.peers.length}` : s === 'local' ? 'Local' : s === 'negado' ? 'Negado' : 'Conectando'; emit('net', s); });
  S.sync.onMessage(m => { if (m.type === 'peers') { const p = $('netPill'); if (S.sync.status === 'rede') p.lastChild.textContent = `Rede · ${m.peers.length}`; emit('peers', m.peers); } });
  setInterval(() => { if (S.sync.peers.length || S.sync.bc) publish(); }, 5000); // recuperação: reenvia estado completo
}
function exitFull() { document.body.classList.remove('fs'); if (document.fullscreenElement) document.exitFullscreen?.(); setTimeout(fitStage, 100); }

// ---------------- modo tela secundária ----------------
export function screenMode(role) {
  document.body.classList.add('screen'); document.title = 'MusicKey — ' + ({ public: 'Público', return: 'Retorno', singer: 'Cantor', musician: 'Músico', remote: 'Controle' }[role] || role);
  const box = $('screen'), content = $('scrContent'), status = $('scrStatus');
  let last = null, lastKey = '';
  const apply = st => {
    last = st; const P = st.pub || {};
    if (role === 'public') {
      box.style.setProperty('--pub-bg', P.bg || '#000'); box.style.setProperty('--pub-fg', P.fg || '#fff'); box.style.setProperty('--pub-font', P.font || 'Inter');
      box.style.setProperty('--pub-align', P.align || 'center'); box.style.setProperty('--pub-size', (P.size || 6) + 'vh');
      box.style.backgroundImage = P.img ? `url("${P.img}")` : '';
      let logo = box.querySelector('.logo'); if (P.logo) { if (!logo) { logo = document.createElement('img'); logo.className = 'logo'; logo.alt = ''; box.append(logo); } logo.src = P.logo; } else logo?.remove();
    }
    box.classList.toggle('dark', !!st.blackout && role === 'public');
    const key = st.song?.id + ':' + st.block + ':' + JSON.stringify(st.lines.map(l => l.text));
    const render = () => {
      if (role === 'public' || role === 'singer') content.innerHTML = `<div class="pubtext">${st.lines.map(l => `<div>${esc(l.text)}</div>`).join('')}</div>`;
      else if (role === 'return' || role === 'musician') content.innerHTML = `<div class="sheet" style="font-size:min(5.5vh,4.2vw);color:#fff"><div class="small" style="color:#9aa0a6;font-size:.45em">${esc(st.song?.title || '')} · Tom ${esc(st.song?.key || '-')} · ${st.song?.bpm || ''} BPM ${st.section ? '· ' + esc(st.section) : ''} · ${st.block + 1}/${st.total}</div>${st.lines.map(l => `<div class="ln">${lineHTML(l)}</div>`).join('')}${st.preview ? `<div class="ln preview" style="opacity:.55;border-top:1px dashed #555">${lineHTML(st.preview)}</div>` : '<div class="ln muted" style="font-size:.5em">— fim —</div>'}</div>`;
      else if (role === 'remote') content.innerHTML = `<div class="remote"><div class="card"><b>${esc(st.song?.title || '—')}</b><div class="small muted">${esc(st.section || '')} · bloco ${st.block + 1}/${st.total}</div><div class="sheet" style="font-size:16px;margin-top:8px">${st.lines.map(l => `<div class="ln">${esc(l.text)}</div>`).join('')}</div></div>
        <button class="btn big primary" data-cmd="next">Próximo ▶</button><button class="btn big" data-cmd="prev">◀ Anterior</button><div class="row"><button class="btn grow" data-cmd="black">${st.blackout ? 'Mostrar público' : 'Escurecer público'}</button><button class="btn grow" data-cmd="band">Banda ▶/■</button></div></div>`;
    };
    if (key === lastKey && role !== 'remote') return; lastKey = key;
    if (role === 'public' && P.fade !== false && content.innerHTML) { content.classList.add('fade'); setTimeout(() => { render(); content.classList.remove('fade'); }, 300); } else render();
  };
  S.sync.onMessage(m => { if (m.type === 'state') apply(m); });
  S.sync.onStatus(s => { status.textContent = s === 'rede' ? '' : s === 'local' ? '' : s; });
  content.innerHTML = `<div class="pubtext" style="font-size:3vh;opacity:.6">${role === 'remote' ? 'Conectando ao controle…' : 'Aguardando a central…'}</div>`;
  if (role === 'remote') content.innerHTML = `<div class="remote"><div class="muted">Aguardando a central…</div></div>`;
  content.addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) S.sync.send({ type: 'cmd', cmd: b.dataset.cmd }); });
  document.addEventListener('keydown', e => {
    if (role === 'public' && e.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
    if (role === 'remote' || role === 'return') { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) S.sync.send({ type: 'cmd', cmd: 'next' }); if (['ArrowLeft', 'PageUp'].includes(e.key)) S.sync.send({ type: 'cmd', cmd: 'prev' }); }
  });
  box.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
  if (role === 'public') { // vídeo de fundo escolhido nesta tela (arquivo local)
    box.addEventListener('contextmenu', e => { e.preventDefault(); const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/*,image/*'; i.onchange = () => { const f = i.files[0]; if (!f) return; box.querySelector('video')?.remove(); if (f.type.startsWith('video')) { const v = document.createElement('video'); v.src = URL.createObjectURL(f); v.loop = v.muted = v.autoplay = v.playsInline = true; box.prepend(v); } else box.style.backgroundImage = `url("${URL.createObjectURL(f)}")`; }; i.click(); });
    try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(() => {}); } catch {}
  }
  const ask = () => S.sync.send({ type: 'getState' }); ask(); setTimeout(ask, 800); setInterval(() => { if (!last) ask(); }, 3000);
}
