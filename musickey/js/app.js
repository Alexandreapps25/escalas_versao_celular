// MusicKey PRO Studio v2.0 — app principal: navegação, detector, música, player e análise
import * as M from './music.js';
import * as DB from './store.js';
import { KeyEngine, CFG as DCFG, mpm, Mic, TUNINGS, tune, LiveChords } from './detector.js';
import { AudioEngine } from './audio.js';
import { Band } from './band.js';
import { Sync } from './net.js';
import { S, $, $$, esc, fmt, debounce, toast, emit, on, lineHTML, VERSION } from './state.js';
import { initStage, rebuildStage, screenMode } from './stage.js';
import { initPanels } from './panels.js';

const params = new URLSearchParams(location.search);
const SCREEN = params.get('screen');

// ---------------- início ----------------
(async function boot() {
  S.settings = Object.assign(S.settings, await DB.getSetting('settings', {}));
  S.settings.pub = Object.assign({ bg: '#000000', fg: '#ffffff', font: 'Inter', align: 'center', size: 6, img: '', logo: '', fade: true }, S.settings.pub || {});
  S.sync = new Sync(SCREEN || 'master', SCREEN ? (params.get('name') || SCREEN) : 'Central');
  const server = await S.sync.detectServer();
  if (server) { S.server = server; S.sync.connect(params.get('code') || ''); }
  if (SCREEN) { screenMode(SCREEN); return; }   // tela secundária não carrega o resto
  S.engine = new AudioEngine(); S.band = new Band(S.engine); S.mic = new Mic();
  S.mic.deviceId = S.settings.mic || '';
  initNav(); initDetector(); initSong(); initPlayer(); initStage(); initPanels();
  const last = await DB.getSetting('lastSong', null);
  const songs = await DB.all('songs');
  if (!songs.length) { const demo = DB.newSong({ title: 'Exemplo — Quando o sol nascer', key: 'G', origKey: 'G', bpm: 76, text: DEMO }); await DB.saveSong(demo); await openSong(demo.id); }
  else await openSong(last && songs.find(s => s.id === last) ? last : songs.sort((a, b) => b.updated - a.updated)[0].id);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  setInterval(() => DB.setSetting('settings', S.settings).catch(() => {}), 15000);
  window.addEventListener('pagehide', () => { saveNow(); DB.setSetting('settings', S.settings).catch(() => {}); });
})().catch(e => { console.error(e); toast('Erro ao iniciar: ' + e.message, true); });

const DEMO = `# Estrofe
[G]Quando o sol nascer
[D]Uma nova luz virá
[Em]Mesmo em meio à tempestade
[C]Minha esperança viverá
# Refrão
[G]Vou seguir sem medo de sonhar
[D]Uma força me conduz
[Em]Cada passo do caminho
[C]Me aproxima dessa luz`;

export const saveSettings = debounce(() => DB.setSetting('settings', S.settings).catch(e => toast('Não salvou as configurações: ' + e.message, true)), 400);

// ---------------- navegação ----------------
function initNav() {
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view); });
  for (const tabs of ['tomTabs', 'maisTabs']) $(tabs).addEventListener('click', e => {
    const b = e.target.closest('[data-sub]'); if (!b) return;
    $$('[data-sub]', $(tabs)).forEach(x => x.classList.toggle('sel', x === b));
    const view = $(tabs).closest('.view');
    $$('[data-subview]', view).forEach(v => v.hidden = v.dataset.subview !== b.dataset.sub);
    emit('subview', b.dataset.sub);
  });
}
export function showView(v) {
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  emit('view', v); window.scrollTo(0, 0);
}

// ---------------- detector de tom (motor v4.2) ----------------
const eng = new KeyEngine();
let lastKeyId = '', lastUi = 0, selProg = 0, live = new LiveChords(), micMode = null;
function micPill(on, txt) { const p = $('micPill'); p.classList.toggle('on', on); p.lastChild.textContent = txt || (on ? 'Ouvindo' : 'Mic'); }
async function micStart(mode) {
  if (micMode && micMode !== mode) micStop();
  try {
    await S.mic.start(mode); micMode = mode; micPill(true, { voice: 'Voz', chords: 'Acordes', tuner: 'Afinador' }[mode]);
  } catch (e) { toast(e.message, true); micMode = null; micPill(false); return false; }
  return true;
}
function micStop() { S.mic.stop(); micMode = null; micPill(false); $('btnVoice').textContent = 'Ouvir voz'; $('btnVoice').classList.replace('danger', 'primary');
  $('btnLive').textContent = 'Ouvir acordes'; $('btnTuner').textContent = 'Ligar afinador'; $('centDot').classList.remove('lit'); $('tunDot').classList.remove('lit'); $('vu').style.width = '0%'; }

function initDetector() {
  S.mic.on_('error', e => { toast(e.message, true); micStop(); });
  S.mic.on_('frame', ({ buf, sr, now }) => {
    if (micMode === 'voice') voiceFrame(buf, sr, now);
    else if (micMode === 'chords') liveFrame(buf, sr, now);
    else if (micMode === 'tuner') tunerFrame(buf, sr);
  });
  $('btnVoice').onclick = async () => {
    if (micMode === 'voice') return micStop();
    eng.noise = null;
    if (await micStart('voice')) { $('btnVoice').textContent = 'Parar'; $('btnVoice').classList.replace('primary', 'danger'); $('freqText').textContent = 'Cante perto do microfone'; }
  };
  $('btnVoiceReset').onclick = () => { eng.reset(); renderKey(null); };
  $('gateSlider').oninput = e => { DCFG.gateFactor = +e.target.value; $('gateMode').textContent = DCFG.gateFactor === 2 ? 'Auto' : '×' + DCFG.gateFactor; };
  $('progs').onclick = e => { const b = e.target.closest('.prog[data-i]'); if (!b) return; selProg = +b.dataset.i; $$('.prog', $('progs')).forEach(x => x.classList.toggle('sel', x === b)); S.progChords = S.harmony.progs[selProg].chords; emit('prog', S.progChords); };
  $('keyToSong').onclick = () => {
    if (!S.detKey || !S.song) return;
    const target = M.keySym(S.detKey.root, S.detKey.minor), cur = M.parseKey(S.song.key);
    if (cur && S.song.text) { const n = ((S.detKey.root - cur.root) % 12 + 12) % 12; const shift = n > 6 ? n - 12 : n; if (shift) { setText(M.transposeText(S.song.text, shift, M.preferFlatFor(S.detKey.root, S.detKey.minor))); } }
    S.song.key = target; $('sKey').value = target; songChanged(true); toast(`Música passada para ${target}`);
  };
  $('keyToBand').onclick = () => { if (!S.detKey) return; S.band.set({ key: S.detKey.root, minor: S.detKey.minor }); S.progChords = S.harmony.progs[selProg].chords; emit('prog', S.progChords); $('bdSource').value = 'prog'; emit('bandSource', 'prog'); showView('banda'); };
  renderKey(null);
  // acordes ao vivo
  $('btnLive').onclick = async () => { if (micMode === 'chords') return micStop(); if (await micStart('chords')) { $('btnLive').textContent = 'Parar'; } };
  $('btnLiveClear').onclick = () => { live.reset(); $('liveHist').textContent = ''; $('liveChord').textContent = '—'; };
  $('btnLiveToSong').onclick = () => {
    if (!live.history.length) return toast('Nenhum acorde registrado ainda.');
    const chords = live.history.map(h => h.chord.split('/')[0] === h.chord ? h.chord : h.chord); const lines = [];
    for (let i = 0; i < chords.length; i += 4) lines.push(chords.slice(i, i + 4).map(c => `[${c}]`).join('  '));
    setText((S.song.text ? S.song.text + '\n' : '') + '# Acordes ao vivo\n' + lines.join('\n')); songChanged(true); showView('musica'); toast('Acordes enviados para a música.');
  };
  // afinador
  for (const n of Object.keys(TUNINGS)) $('tunInst').add(new Option(n, n));
  $('tunInst').value = S.settings.tunInst; $('tunA4').value = S.settings.a4;
  const strings = () => { $('tunStrings').innerHTML = TUNINGS[$('tunInst').value].map(m => `<span class="badge">${M.NICE[m % 12]}${Math.floor(m / 12) - 1}</span>`).join(''); };
  strings(); $('tunInst').onchange = () => { S.settings.tunInst = $('tunInst').value; strings(); saveSettings(); };
  $('tunA4').onchange = () => { S.settings.a4 = Math.min(466, Math.max(415, +$('tunA4').value || 440)); saveSettings(); };
  $('btnTuner').onclick = async () => { if (micMode === 'tuner') return micStop(); if (await micStart('tuner')) $('btnTuner').textContent = 'Desligar afinador'; };
  on('subview', s => { if (micMode && ((s === 'voz' && micMode !== 'voice') || (s === 'vivo' && micMode !== 'chords') || (s === 'afinador' && micMode !== 'tuner'))) micStop(); });
}
function voiceFrame(buf, sr, now) {
  const s = eng.frame(buf, sr, now);
  $('vu').style.width = Math.min(100, s.rms * 400) + '%'; $('gateMark').style.left = Math.min(100, s.gate * 400) + '%';
  const n = s.note, dot = $('centDot');
  if (n) { const c = Math.round(n.cents); $('noteName').textContent = M.NICE[n.pc]; $('noteOct').textContent = Math.floor(n.midi / 12) - 1;
    $('freqText').textContent = `${M.PT[n.pc]} · ${n.freq.toFixed(1).replace('.', ',')} Hz`; dot.classList.add('lit'); dot.style.left = (50 + Math.max(-50, Math.min(50, c))) + '%';
    $('centText').textContent = (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c) + ' cents'; } else dot.classList.remove('lit');
  if (now - lastUi > 250) { lastUi = now; renderKey(eng.key); }
}
function renderKey(k) {
  const badge = $('keyBadge');
  if (!k) {
    $('keyName').textContent = eng.seconds > 0 ? 'Analisando…' : '—'; $('keySym').textContent = '';
    $('confBar').style.width = Math.min(30, eng.effPhrases() * 15) + '%';
    $('confText').textContent = eng.seconds > 0 ? `Continue cantando… ${eng.effPhrases()} de 2 frases` : 'Cante 2 ou 3 frases da música';
    $('altText').textContent = ''; badge.textContent = 'Aguardando'; badge.className = 'badge'; $('keyToSong').disabled = $('keyToBand').disabled = true;
    if (lastKeyId !== '-') { lastKeyId = '-'; renderHarmony(null); } return;
  }
  S.detKey = k;
  $('keyName').textContent = M.keyName(k.root, k.minor); $('keySym').textContent = M.keySym(k.root, k.minor);
  $('confBar').style.width = k.conf + '%'; $('confText').textContent = `Confiança ${k.conf}% · ${k.phrases} frase${k.phrases === 1 ? '' : 's'} · ${k.notes} notas`;
  badge.textContent = k.locked ? 'Confirmado' : 'Provável'; badge.className = k.locked ? 'badge ok' : 'badge';
  let alt = ''; if (k.rel && k.relGap < 0.03) alt = `Pode ser ${M.keyName(k.rel.root, k.rel.minor)} (mesmos acordes). `;
  if (!k.locked && k.alt) alt += `2ª opção: ${M.keyName(k.alt.root, k.alt.minor)}. Cante mais uma frase.`;
  $('altText').textContent = alt; $('keyToSong').disabled = $('keyToBand').disabled = false;
  const id = M.keySym(k.root, k.minor); if (id !== lastKeyId) { lastKeyId = id; selProg = 0; renderHarmony(M.harmony(k.root, k.minor)); }
}
function renderHarmony(h) {
  S.harmony = h;
  if (!h) { $('field').innerHTML = ['I','ii','iii','IV','V','vi','vii°'].map((r, i) => `<div class="chordbox${i ? '' : ' tonic'}"><span>${r}</span><b>-</b></div>`).join('');
    $('progs').innerHTML = '<div class="prog sel"><div class="top"><b>1-5-6-4</b><span>Aparece quando achar o tom</span></div><div class="cs"><i>-</i><i>-</i><i>-</i><i>-</i></div></div>'; return; }
  $('field').innerHTML = h.field.map((c, i) => `<div class="chordbox${i ? '' : ' tonic'}"><span>${c.roman}</span><b>${c.name}</b></div>`).join('');
  $('progs').innerHTML = h.progs.map((p, i) => `<button class="prog${i === selProg ? ' sel' : ''}" data-i="${i}"><div class="top"><b>${p.deg}</b><span>${p.tag}</span></div><div class="cs">${p.chords.map(c => `<i>${c}</i>`).join('')}</div></button>`).join('');
  S.progChords = h.progs[selProg].chords; emit('prog', S.progChords);
}
function liveFrame(buf, sr, now) {
  const r = live.frame(buf, sr, now); if (!r) return;
  $('liveChord').textContent = r.chord || '—'; $('liveCand').textContent = r.silent ? 'silêncio' : (r.candidate && r.candidate !== r.chord ? `ouvindo ${r.candidate}… ${r.conf}%` : `${r.conf}%`);
  $('liveHist').innerHTML = live.history.slice(-60).map(h => `<span class="badge">${h.t.toFixed(1)}s ${esc(h.chord)}</span>`).join(' ');
}
function tunerFrame(buf, sr) {
  const p = mpm(buf, sr); const dot = $('tunDot');
  if (!p) { dot.classList.remove('lit'); return; }
  const t = tune(p.freq, S.settings.a4, TUNINGS[$('tunInst').value]); const c = Math.round(t.cents);
  $('tunNote').textContent = M.NICE[((t.midi % 12) + 12) % 12]; $('tunOct').textContent = Math.floor(t.midi / 12) - 1;
  $('tunFreq').textContent = `${p.freq.toFixed(1)} Hz → alvo ${t.targetFreq.toFixed(1)} Hz`;
  dot.classList.add('lit'); dot.style.left = (50 + Math.max(-50, Math.min(50, c))) + '%'; $('tunCents').textContent = (c > 0 ? '+' : '') + c + ' cents';
  $('tunState').textContent = Math.abs(c) <= 3 ? 'Afinado ✓' : c < 0 ? 'Apertar (subir)' : 'Afrouxar (descer)';
  $('tunState').style.color = Math.abs(c) <= 3 ? 'var(--green)' : 'var(--accent)';
}

// ---------------- música: editor ----------------
export async function openSong(id) {
  saveNow();
  const s = await DB.get('songs', id); if (!s) return toast('Música não encontrada', true);
  S.song = s; DB.setSetting('lastSong', id).catch(() => {});
  $('sTitle').value = s.title || ''; $('sArtist').value = s.artist || ''; $('sKey').value = s.key || ''; $('sOrigKey').value = s.origKey || '';
  $('sBpm').value = s.bpm || 76; $('sMeter').value = s.meter || '4/4'; $('sCapo').value = s.capo || 0; $('sNotes').value = s.notes || '';
  $('sText').value = s.text || ''; $('songTitleTop').textContent = s.title || 'sem título';
  S.band.set({ bpm: s.bpm || 76, meter: s.meter || '4/4', ...(M.parseKey(s.key) ? { key: M.parseKey(s.key).root, minor: M.parseKey(s.key).minor } : {}) , ...(s.band || {}) });
  S.stage.block = 0; renderPreview(); await loadSongAudio(); renderSegments(); renderVersions(); rebuildStage(); emit('song', s);
}
let dirty = false;
const autosave = debounce(() => saveNow(), 1200);
export function saveNow(snapshot) {
  if (!S.song || !dirty) return Promise.resolve();
  dirty = false; return DB.saveSong(S.song, snapshot).then(() => emit('saved', S.song)).catch(e => toast('Não foi possível salvar: ' + e.message, true));
}
export function songChanged(structural) {
  if (!S.song) return; dirty = true; autosave(); $('songTitleTop').textContent = S.song.title || 'sem título';
  if (structural) { renderPreview(); rebuildStage(); }
}
function setText(t) { $('sText').value = t; S.song.text = t; }
function initSong() {
  const bind = (id, key, num, structural) => $(id).addEventListener('input', () => { S.song[key] = num ? +$(id).value : $(id).value; songChanged(structural); if (key === 'bpm') S.band.set({ bpm: +$(id).value || 76 }); if (key === 'meter') S.band.set({ meter: $(id).value }); });
  bind('sTitle', 'title'); bind('sArtist', 'artist'); bind('sOrigKey', 'origKey'); bind('sBpm', 'bpm', true); bind('sMeter', 'meter'); bind('sNotes', 'notes');
  bind('sCapo', 'capo', true, true);
  $('sKey').addEventListener('change', () => { S.song.key = $('sKey').value.trim(); const k = M.parseKey(S.song.key); if (k) S.band.set({ key: k.root, minor: k.minor }); songChanged(); });
  $('sText').addEventListener('input', debounce(() => { S.song.text = $('sText').value; songChanged(true); }, 250));
  $('btnSave').onclick = async () => { dirty = true; await saveNow(true); renderVersions(); toast('Música salva.'); };
  const tr = n => { const k = M.parseKey(S.song.key); const nk = k ? (k.root + n + 12) % 12 : null;
    const pf = k ? M.preferFlatFor(nk, k.minor) : undefined; setText(M.transposeText($('sText').value, n, pf));
    if (k) { S.song.key = M.keySym(nk, k.minor); $('sKey').value = S.song.key; S.band.set({ key: nk }); }
    songChanged(true); toast(`Transposto ${n > 0 ? '+' : ''}${n} semitom → ${S.song.key || ''}`); };
  $('trUp').onclick = () => tr(1); $('trDown').onclick = () => tr(-1);
  $('btnSimplify').onclick = () => { setText(M.simplifyText($('sText').value)); songChanged(true); toast('Acordes simplificados.'); };
  $('btnConvert').onclick = () => { const before = $('sText').value; const after = M.fromChordsAbove(before); if (after === before) return toast('Nenhuma linha de acordes encontrada para converter.'); setText(after); songChanged(true); toast('Cifra convertida para o formato [G]letra.'); };
  $('hideChords').onchange = renderPreview; $('showCapo').onchange = renderPreview;
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = async e => { const f = e.target.files[0]; if (!f) return; e.target.value = '';
    const txt = await f.text();
    if (/\.json$/i.test(f.name)) { try { const j = JSON.parse(txt); if (j.app === 'MusicKey PRO Studio') { const n = await DB.importBackup(j); emit('library'); return toast(`${n} músicas importadas.`); } } catch {} return toast('JSON não reconhecido.', true); }
    const { meta, text } = M.fromChordPro(txt); const converted = /\[[^\]]+\]/.test(text) ? text : M.fromChordsAbove(text);
    const song = DB.newSong({ title: meta.title || f.name.replace(/\.[^.]+$/, ''), artist: meta.artist || '', key: meta.key || '', origKey: meta.key || '', bpm: +meta.tempo || 76, meter: meta.time || '4/4', capo: +meta.capo || 0, text: converted });
    await DB.saveSong(song); await openSong(song.id); emit('library'); toast('Cifra importada.'); };
  $('btnExport').onclick = () => {
    const pick = prompt('Exportar como: 1 = ChordPro (.cho)  2 = Texto (.txt)  3 = JSON (.json)', '1'); if (!pick) return;
    const s = S.song, name = (s.title || 'musica').replace(/[^\w\- ]+/g, '').trim() || 'musica';
    if (pick === '1') download(name + '.cho', M.toChordPro(s));
    else if (pick === '2') download(name + '.txt', `${s.title}\n${s.artist ? s.artist + '\n' : ''}Tom: ${s.key || '-'}  BPM: ${s.bpm}\n\n` + M.parseSong(s.text).map(l => l.type === 'section' ? `[${l.text}]` : l.type === 'line' ? textWithChordsAbove(l) : l.type === 'empty' ? '' : '').join('\n'));
    else download(name + '.json', JSON.stringify({ app: 'MusicKey PRO Studio', format: 1, songs: [s], setlists: [], settings: [] }, null, 1));
  };
}
function textWithChordsAbove(l) { let top = '', low = ''; for (const c of l.chunks) { if (c.chord) { top = top.padEnd(low.length) + c.chord + ' '; } low += c.text; } return (top.trim() ? top.replace(/\s+$/, '') + '\n' : '') + low; }
export function download(name, data, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function renderPreview() {
  const text = S.song?.text || '', capo = $('showCapo').checked ? (S.song.capo || 0) : 0;
  const bad = M.invalidChords(text); const lines = M.parseSong(text);
  $('preview').classList.toggle('nochords', $('hideChords').checked);
  $('preview').innerHTML = lines.map((l, i) => l.type === 'section' ? `<div class="sec">${esc(l.text)}</div>` : l.type === 'line' ? `<div class="ln" data-src="${i}">${lineHTML(l, { shift: -capo })}</div>` : l.type === 'empty' ? '<div class="ln">&nbsp;</div>' : '').join('');
  $('validateMsg').innerHTML = bad.length ? `<span style="color:var(--red)">Acordes não reconhecidos: ${bad.map(esc).join(', ')}</span>` : text ? `<span class="muted">${M.songChords(text).length} acordes · ${M.stageLines(text).length} linhas${capo ? ` · formas com capo na ${capo}ª casa` : ''}</span>` : '';
}
function renderVersions() {
  const v = S.song?.versions || [];
  $('versions').innerHTML = v.length ? v.map((x, i) => `<div class="it"><div class="t"><b>${new Date(x.at).toLocaleString('pt-BR')}</b><small>Tom ${esc(x.key || '-')} · ${x.text.split('\n').length} linhas</small></div><button class="btn sm" data-restore="${i}">Restaurar</button></div>`).join('') : '<div class="muted small">Ao salvar com o botão "Salvar", a versão anterior fica guardada aqui (até 10).</div>';
  $('versions').onclick = e => { const b = e.target.closest('[data-restore]'); if (!b) return; const x = S.song.versions[+b.dataset.restore]; if (!confirm('Restaurar esta versão? A atual será guardada nas versões.')) return; dirty = true; saveNow(true).then(() => { setText(x.text); S.song.key = x.key; $('sKey').value = x.key || ''; songChanged(true); renderVersions(); }); };
}

// ---------------- player, análise e marcação ----------------
let worker = null, curAudioUrl = null, mediaSrc = null, A = null, B = null, abOn = false, markI = 0;
async function loadSongAudio() {
  const a = S.audio; a.pause(); if (curAudioUrl) URL.revokeObjectURL(curAudioUrl); curAudioUrl = null; a.removeAttribute('src');
  $('btnAnalyze').disabled = true; $('audioInfo').textContent = 'Nenhum arquivo'; A = B = null; abOn = false; markI = 0; updateMark();
  if (!S.song.audioId) { drawTimeline(); return; }
  const rec = await DB.get('blobs', S.song.audioId).catch(() => null);
  if (!rec) { $('audioInfo').textContent = 'Áudio não encontrado neste aparelho'; return drawTimeline(); }
  curAudioUrl = URL.createObjectURL(rec.blob); a.src = curAudioUrl; $('btnAnalyze').disabled = false; $('audioInfo').textContent = rec.name || 'Áudio';
  drawTimeline();
}
function initPlayer() {
  const a = S.audio = new Audio(); a.preload = 'auto';
  $('btnLoadAudio').onclick = () => $('fileAudio').click();
  $('fileAudio').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const id = S.song.audioId || DB.uid(); await DB.put('blobs', { id, blob: f, name: f.name, size: f.size }); S.song.audioId = id; songChanged(); await saveNow(); await loadSongAudio(); toast('Áudio carregado. Toque em "Analisar acordes".'); }
    catch (err) { toast('Não foi possível guardar o áudio: ' + err.message, true); } };
  $('plPlay').onclick = async () => { if (!a.src) return toast('Abra um arquivo de áudio primeiro.'); await ensureRouted(); if (a.paused) { await a.play().catch(e => toast(e.message, true)); } else a.pause(); };
  a.onplay = () => $('plPlay').textContent = 'Pausar'; a.onpause = () => $('plPlay').textContent = 'Tocar'; a.onended = () => { $('plPlay').textContent = 'Tocar'; };
  $('plBack').onclick = () => a.currentTime = Math.max(0, a.currentTime - 5); $('plFwd').onclick = () => a.currentTime = Math.min(a.duration || 0, a.currentTime + 5);
  $('plRate').oninput = e => { a.playbackRate = +e.target.value; a.preservesPitch = true; $('plRateTxt').textContent = Math.round(a.playbackRate * 100) + '%'; };
  $('plA').onclick = () => { A = a.currentTime; toast('Ponto A: ' + fmt(A)); drawTimeline(); }; $('plB').onclick = () => { B = a.currentTime; toast('Ponto B: ' + fmt(B)); drawTimeline(); };
  $('plAB').onclick = () => { if (A === null || B === null || B <= A) return toast('Marque A e depois B (B depois de A).'); abOn = !abOn; $('plAB').classList.toggle('sel', abOn); if (abOn) a.currentTime = A; };
  $('timeline').onclick = e => { if (!a.duration) return; const r = $('timeline').getBoundingClientRect(); a.currentTime = (e.clientX - r.left) / r.width * a.duration; };
  $('btnAnalyze').onclick = analyze; $('btnCancelAn').onclick = () => { if (worker) { worker.terminate(); worker = null; } $('anProg').hidden = true; $('btnCancelAn').hidden = true; $('btnAnalyze').disabled = false; toast('Análise cancelada.'); };
  $('segSplit').onclick = () => { const t = a.currentTime, segs = S.song.segments; const i = segs.findIndex(s => t > s.t + 0.1 && t < s.t + s.d - 0.1); if (i < 0) return toast('Toque até o ponto e divida dentro de um trecho.');
    const s = segs[i], d1 = t - s.t; segs.splice(i + 1, 0, { t: +t.toFixed(2), d: +(s.d - d1).toFixed(2), chord: s.chord, conf: s.conf }); s.d = +d1.toFixed(2); songChanged(); renderSegments(); };
  $('segToSong').onclick = segmentsToText;
  $('markBtn').onclick = mark; $('markUndo').onclick = () => { if (markI > 0) { markI--; delete S.song.lineTimes[markI]; songChanged(); updateMark(); } };
  $('markClear').onclick = () => { if (!confirm('Apagar todas as marcações de tempo da letra?')) return; S.song.lineTimes = {}; markI = 0; songChanged(); updateMark(); };
  document.addEventListener('keydown', e => { if (e.code === 'Space' && $('v-musica').classList.contains('active') && !['TEXTAREA','INPUT','SELECT'].includes(e.target.tagName) && $('markBtn').closest('details').open) { e.preventDefault(); mark(); } });
  const tick = () => { playerTick(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}
export async function ensureRouted() { await S.engine.init(S.settings.mixer); if (!mediaSrc) { mediaSrc = S.engine.ctx.createMediaElementSource(S.audio); mediaSrc.connect(S.engine.input('playback')); } }
function mark() { const a = S.audio; if (!a.src) return toast('Abra o áudio primeiro.'); const n = M.stageLines(S.song.text).length; if (markI >= n) return toast('Todas as linhas já foram marcadas.');
  S.song.lineTimes[markI] = +a.currentTime.toFixed(2); markI++; songChanged(); updateMark(); }
function updateMark() { if (!S.song) return; const n = M.stageLines(S.song.text).length, done = Object.keys(S.song.lineTimes || {}).length; markI = Math.min(done, n);
  $('markIdx').textContent = Math.min(markI + 1, n); $('markInfo').textContent = `${done} de ${n} linhas marcadas`; }
let lastSegI = -1, lastStageLine = -1;
function playerTick() {
  const a = S.audio; if (!S.song || !a) return;
  const t = a.currentTime || 0, d = a.duration || 0;
  if (abOn && B !== null && t >= B) a.currentTime = A;
  $('plTime').textContent = `${fmt(t)} / ${fmt(d)}`; $('tlHead').style.left = d ? (t / d * 100) + '%' : '0';
  const segs = S.song.segments || []; const i = segs.findIndex(s => t >= s.t && t < s.t + s.d);
  if (i !== lastSegI) { lastSegI = i; const cur = segs[i], nx = segs.slice(i + 1).find(s => s.chord !== 'N');
    $('curChord').textContent = cur ? (cur.chord === 'N' ? '—' : cur.chord) : '—'; $('nextChord').textContent = nx ? 'próximo: ' + nx.chord : '';
    $$('.seglist .it').forEach((el, k) => el.classList.toggle('cur', k === i)); emit('audioChord', cur && cur.chord !== 'N' ? cur.chord : null); }
  // palco segue o áudio pelas marcações de linha
  if (!a.paused && $('followStage').checked && S.song.lineTimes && Object.keys(S.song.lineTimes).length) {
    let li = -1; for (const [k, v] of Object.entries(S.song.lineTimes)) if (t >= v && +k > li) li = +k;
    if (li !== lastStageLine && li >= 0) { lastStageLine = li; emit('stageLine', li); }
  }
}
export function chordAtAudio() { const t = S.audio?.currentTime || 0; const s = (S.song?.segments || []).find(s => t >= s.t && t < s.t + s.d); return s && s.chord !== 'N' ? s.chord : null; }
async function analyze() {
  const rec = await DB.get('blobs', S.song.audioId).catch(() => null); if (!rec) return toast('Áudio não encontrado.', true);
  $('btnAnalyze').disabled = true; $('btnCancelAn').hidden = false; $('anProg').hidden = false; $('anMsg').textContent = 'Decodificando o áudio…'; $('anBar').style.width = '2%';
  let buf;
  try { const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100); buf = await ac.decodeAudioData(await rec.blob.arrayBuffer()); }
  catch (e) { $('anProg').hidden = true; $('btnCancelAn').hidden = true; $('btnAnalyze').disabled = false; return toast('Formato de áudio não suportado: ' + (e.message || e), true); }
  const mono = new Float32Array(buf.length); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  worker = new Worker('js/chordcore.js'); const t0 = performance.now();
  worker.onmessage = e => { const m = e.data;
    if (m.type === 'progress') { $('anBar').style.width = Math.round(m.p * 100) + '%'; $('anMsg').textContent = `${m.msg}… ${Math.round(m.p * 100)}%`; }
    else if (m.type === 'done') { worker.terminate(); worker = null; applyAnalysis(m.result, performance.now() - t0); }
    else if (m.type === 'error') { worker.terminate(); worker = null; toast('Erro na análise: ' + m.message, true); $('anProg').hidden = true; $('btnCancelAn').hidden = true; $('btnAnalyze').disabled = false; } };
  worker.onerror = e => { toast('Erro na análise: ' + e.message, true); $('anProg').hidden = true; $('btnAnalyze').disabled = false; };
  worker.postMessage({ cmd: 'analyze', samples: mono, sr: buf.sampleRate }, [mono.buffer]);
}
function applyAnalysis(r, ms) {
  $('anProg').hidden = true; $('btnCancelAn').hidden = true; $('btnAnalyze').disabled = false;
  if (S.song.segments?.length && !confirm('Substituir os acordes revisados por uma nova análise?')) return;
  S.song.segments = r.segments; S.song.analysis = { bpm: r.bpm, meter: r.meter, key: r.key, keyChanges: r.keyChanges, tuneCents: r.tuneCents, duration: r.duration, beats: r.beats };
  const key = M.keySym(r.key.root, r.key.minor);
  if (!S.song.key) { S.song.key = key; $('sKey').value = key; } if (!S.song.origKey) { S.song.origKey = key; $('sOrigKey').value = key; }
  S.song.bpm = r.bpm; $('sBpm').value = r.bpm; S.band.set({ bpm: r.bpm });
  songChanged(); renderSegments();
  const low = r.segments.filter(s => s.conf < 60 && s.chord !== 'N').length;
  toast(`Pronto em ${(ms / 1000).toFixed(1)} s: ${r.segments.length} trechos, tom ${key}, ${r.bpm} BPM.`);
  $('anSummary').textContent = `Tom ${key} (${r.key.conf}%) · ${r.bpm} BPM · ${r.meter}${r.keyChanges.length ? ' · muda de tom ' + r.keyChanges.length + 'x' : ''}${low ? ` · ${low} trechos para revisar` : ''}`;
}
function drawTimeline() {
  const segs = S.song?.segments || [], d = S.audio?.duration || S.song?.analysis?.duration || segs.reduce((m, s) => Math.max(m, s.t + s.d), 0);
  const tl = $('timeline'); $$('.seg,.ab', tl).forEach(x => x.remove());
  if (d) { for (const s of segs) { const el = document.createElement('div'); el.className = 'seg' + (s.conf < 60 && s.chord !== 'N' ? ' low' : ''); el.style.left = (s.t / d * 100) + '%'; el.style.width = (s.d / d * 100) + '%'; el.textContent = s.chord === 'N' ? '' : s.chord; el.title = `${fmt(s.t)} ${s.chord} (${s.conf}%)`; tl.prepend(el); }
    if (A !== null && B !== null && B > A) { const ab = document.createElement('div'); ab.className = 'ab'; ab.style.left = (A / d * 100) + '%'; ab.style.width = ((B - A) / d * 100) + '%'; tl.prepend(ab); } }
}
function renderSegments() {
  const segs = S.song?.segments || [];
  if (S.song?.analysis) { const r = S.song.analysis; $('anSummary').textContent = `Tom ${M.keySym(r.key.root, r.key.minor)} · ${r.bpm} BPM · ${r.meter}`; } else $('anSummary').textContent = '';
  $('segList').innerHTML = segs.length ? segs.map((s, i) => `<div class="it" data-i="${i}"><button class="btn sm" data-go="${i}" title="Tocar daqui">${fmt(s.t)}</button><input type="text" value="${esc(s.chord)}" data-ch="${i}" aria-label="Acorde"><span class="small ${s.conf < 60 ? '' : 'muted'}" style="${s.conf < 60 ? 'color:var(--red)' : ''}">${s.conf}%</span><button class="btn sm icon" data-up="${i}" title="Juntar com o anterior" aria-label="Juntar com o anterior">⤒</button><button class="btn sm icon" data-dn="${i}" title="Início 0,2 s antes" aria-label="Mover início para antes">−</button><button class="btn sm icon" data-dp="${i}" title="Início 0,2 s depois" aria-label="Mover início para depois">+</button></div>`).join('') : '<div class="muted small">Abra um áudio e toque em "Analisar acordes". A detecção em gravação com banda pode errar: revise aqui.</div>';
  drawTimeline();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-up],[data-dn],[data-dp]'); if (!t || !t.closest('#segList')) return;
  const segs = S.song.segments;
  if (t.dataset.go) { S.audio.currentTime = segs[+t.dataset.go].t; ensureRouted().then(() => S.audio.play()); return; }
  if (t.dataset.up) { const i = +t.dataset.up; if (i === 0) return; segs[i - 1].d = +(segs[i - 1].d + segs[i].d).toFixed(2); segs.splice(i, 1); }
  for (const [k, dir] of [['dn', -0.2], ['dp', 0.2]]) if (t.dataset[k]) { const i = +t.dataset[k]; if (i === 0) return; const s = segs[i], p = segs[i - 1]; const nt = Math.max(p.t + 0.1, Math.min(s.t + s.d - 0.1, s.t + dir)); p.d = +(nt - p.t).toFixed(2); s.d = +(s.t + s.d - nt).toFixed(2); s.t = +nt.toFixed(2); }
  songChanged(); renderSegments();
});
document.addEventListener('change', e => { const i = e.target.dataset?.ch; if (i === undefined || !e.target.closest('#segList')) return;
  const v = e.target.value.trim(); if (v !== 'N' && !M.isChord(v)) { toast(`"${v}" não é um acorde válido.`, true); e.target.value = S.song.segments[+i].chord; return; }
  S.song.segments[+i].chord = v; S.song.segments[+i].conf = 100; songChanged(); renderSegments(); });
// gera cifra a partir dos acordes detectados (encaixa na letra marcada, se houver)
function segmentsToText() {
  const segs = (S.song.segments || []).filter(s => s.chord !== 'N'); if (!segs.length) return toast('Nenhum acorde detectado ainda.');
  const times = S.song.lineTimes || {}, lines = M.stageLines(S.song.text);
  if (Object.keys(times).length >= 2 && lines.length) {
    const src = S.song.text.split(/\r?\n/);
    lines.forEach((l, k) => { const t0 = times[k]; if (t0 === undefined) return; const t1 = times[k + 1] ?? (t0 + 8);
      const plain = l.text, inLine = segs.filter(s => s.t + s.d > t0 && s.t < t1); let out = plain, offset = 0;
      inLine.forEach(s => { const pos = Math.max(0, Math.min(plain.length, Math.round((Math.max(s.t, t0) - t0) / (t1 - t0) * plain.length))); const tag = `[${s.chord}]`; out = out.slice(0, pos + offset) + tag + out.slice(pos + offset); offset += tag.length; });
      src[l.src] = out; });
    setText(src.join('\n'));
  } else {
    const chords = []; segs.forEach(s => { if (chords[chords.length - 1] !== s.chord) chords.push(s.chord); });
    const L = []; for (let i = 0; i < chords.length; i += 4) L.push(chords.slice(i, i + 4).map(c => `[${c}]`).join('   '));
    setText((S.song.text ? S.song.text + '\n\n' : '') + '# Acordes detectados\n' + L.join('\n'));
  }
  songChanged(true); toast('Cifra gerada. Revise na prévia.');
}
on('song', () => { lastSegI = -1; lastStageLine = -1; });
export { M, DB };
