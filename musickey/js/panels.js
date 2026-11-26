// MusicKey PRO Studio v2.0 — painéis: banda, repertório, mixer, biblioteca, configurações, diagnóstico, rede
import * as M from './music.js';
import * as DB from './store.js';
import { STYLES, SECTIONS, SECTION_NAMES, PAD_TIMBRES, VOICE_CMDS, METERS, patternFor, Tap } from './band.js';
import { CHANNELS, BUSES, AudioEngine } from './audio.js';
import { voicings, fretSVG, keyboardSVG, INSTRUMENTS } from './chordlib.js';
import { ROLES } from './net.js';
import { qrSVG } from './qr.js';
import { S, $, $$, esc, toast, on, emit, debounce, VERSION } from './state.js';
import { openSong, saveNow, songChanged, showView, saveSettings, download, chordAtAudio, ensureRouted } from './app.js';
import { rebuildStage, publish, fitStage } from './stage.js';

export function initPanels() { initBand(); initRep(); initMixer(); initLibrary(); initConfig(); initDiag(); initNet(); }

// ---------------- banda ----------------
function initBand() {
  const B = S.band;
  for (const [id, s] of Object.entries(STYLES)) $('bdStyle').add(new Option(s.name, id));
  for (const [id, n] of Object.entries(PAD_TIMBRES)) $('bdPadT').add(new Option(n, id));
  M.NICE.forEach((n, i) => { $('bdKey').add(new Option(n, i)); $('bdKey').add(new Option(n + 'm', 'm' + i)); });
  $('bdSections').innerHTML = SECTIONS.map(s => `<button class="btn sm${s === 'estrofe' ? ' sel' : ''}" data-sec="${s}">${SECTION_NAMES[s]}</button>`).join('');
  $('voiceBtns').innerHTML = VOICE_CMDS.map(([id, t]) => `<span class="row" style="gap:2px"><button class="btn sm" data-voice="${id}">${t}</button><button class="btn sm icon" data-rec="${id}" title="Gravar sua voz para este comando" aria-label="Gravar ${t}">●</button></span>`).join('');
  const sync = () => {
    const c = B.cfg; $('bdBpm').value = c.bpm; $('bdMeter').value = c.meter; $('bdStyle').value = c.style; $('bdInt').value = c.intensity; $('bdHum').value = c.humanize;
    $('bdDrums').checked = c.drums; $('bdPad').checked = c.pad; $('bdBass').checked = c.bass; $('bdKeys').checked = c.keys; $('bdClick').checked = c.click; $('bdSub').value = c.clickSub;
    $('bdCount').checked = c.countIn; $('bdVoice').checked = c.voice; $('bdPadT').value = c.padTimbre; $('bdPadMode').value = c.padMode; $('bdPadThird').checked = c.padThird;
    $('bdKey').value = (c.minor ? 'm' : '') + c.key; drawSeq(); beatDots();
  };
  const bindNum = (id, key) => $(id).addEventListener('input', () => { B.set({ [key]: +$(id).value }); saveBandToSong(); });
  const bindChk = (id, key) => $(id).addEventListener('change', () => { B.set({ [key]: $(id).checked }); saveBandToSong(); });
  bindNum('bdInt', 'intensity'); bindNum('bdHum', 'humanize'); bindNum('bdSub', 'clickSub');
  $('bdBpm').addEventListener('change', () => { const v = Math.max(40, Math.min(220, +$('bdBpm').value || 76)); B.set({ bpm: v }); if (S.song) { S.song.bpm = v; $('sBpm').value = v; songChanged(); } });
  for (const [id, k] of [['bdDrums','drums'],['bdPad','pad'],['bdBass','bass'],['bdKeys','keys'],['bdClick','click'],['bdCount','countIn'],['bdVoice','voice'],['bdPadThird','padThird']]) bindChk(id, k);
  $('bdMeter').onchange = () => { B.set({ meter: $('bdMeter').value }); B.pattern = patternFor(B.cfg.style, B.cfg.meter, customFor()); drawSeq(); beatDots(); saveBandToSong(); };
  $('bdStyle').onchange = () => { B.set({ style: $('bdStyle').value }); B.pattern = patternFor(B.cfg.style, B.cfg.meter, customFor()); drawSeq(); saveBandToSong(); };
  $('bdPadT').onchange = () => { B.set({ padTimbre: $('bdPadT').value }); saveBandToSong(); };
  $('bdPadMode').onchange = () => { B.set({ padMode: $('bdPadMode').value }); saveBandToSong(); };
  $('bdKey').onchange = () => { const v = $('bdKey').value; B.set({ key: +v.replace('m', ''), minor: v.startsWith('m') }); };
  $('bdSource').onchange = () => emit('bandSource', $('bdSource').value);
  const tap = new Tap(); $('bdTap').onclick = () => { const b = tap.tap(); if (b) { $('bdBpm').value = b; B.set({ bpm: b }); } };
  $('bdSections').onclick = e => { const b = e.target.closest('[data-sec]'); if (!b) return; $$('[data-sec]').forEach(x => x.classList.toggle('sel', x === b)); B.set({ section: b.dataset.sec });
    if (B.playing) { B.fill(); if (B.cfg.voice) B.cueBeforeBar({ refrao: 'refrao', ponte: 'ponte', final: 'final', intro: 'intro', estrofe: 'estrofe' }[b.dataset.sec] || 'estrofe', 4); } };
  $('bdPlay').onclick = async () => {
    if (B.playing) { B.stop(); return; }
    try { await S.engine.init(S.settings.mixer); await B.start(); $('bdPlay').textContent = 'Parar banda'; $('bdPlay').classList.replace('primary', 'danger'); }
    catch (e) { toast('Áudio indisponível: ' + e.message, true); }
  };
  B.onStop = () => { $('bdPlay').textContent = 'Tocar banda'; $('bdPlay').classList.replace('danger', 'primary'); $$('#beatDots i').forEach(i => i.classList.remove('on')); };
  $('bdFill').onclick = () => B.fill(); $('bdEnd').onclick = () => { if (B.playing) { B.finish(); if (B.cfg.voice) B.cueBeforeBar('final', 4); } };
  B.onBeat = (bar, beat) => { $$('#beatDots i').forEach((d, i) => d.classList.toggle('on', i === beat)); $('bdBar').textContent = bar < 0 ? 'contagem' : `compasso ${bar + 1}`; S.lastBeat = { bar, beat }; highlightSeq(beat); };
  B.onBar = bar => emit('bar', bar);
  // de onde vêm os acordes
  let source = 'song', prog = null;
  on('bandSource', s => { source = s; $('bdSource').value = s; });
  on('prog', p => { prog = p; });
  B.getChord = (bar) => {
    if (source === 'prog' && prog?.length) return prog[bar % prog.length];
    if (source === 'key') return null;
    if (S.audio && !S.audio.paused) { const c = chordAtAudio(); if (c) return c; }
    // linha atual do palco: 1 acorde por compasso, em sequência
    const blk = S.stage.blocks[S.stage.block]; if (!blk) return null;
    const chords = blk.lines.flatMap(l => l.chunks.filter(c => c.chord && M.isChord(c.chord)).map(c => c.chord));
    return chords.length ? chords[bar % chords.length] : null;
  };
  // voz guia: tocar e gravar
  $('voiceBtns').onclick = async e => {
    const p = e.target.closest('[data-voice]'); if (p) { await S.engine.init(S.settings.mixer); const how = B.playing ? B.cueBeforeBar(p.dataset.voice, 4) : B.cueVoice(p.dataset.voice, 0); if (how === 'indisponível') toast('Voz do sistema indisponível. Grave sua voz (●).', true); return; }
    const r = e.target.closest('[data-rec]'); if (!r) return; recordVoice(r.dataset.rec, r);
  };
  (async () => { for (const [id] of VOICE_CMDS) { const rec = await DB.get('blobs', 'voice-' + id).catch(() => null); if (rec) { await B.setVoiceBlob(id, rec.blob).catch(() => {}); markRec(id, true); } } })();
  // sequenciador
  $('seqReset').onclick = () => { delete S.settings.seqCustom[B.cfg.style]; saveSettings(); B.pattern = patternFor(B.cfg.style, B.cfg.meter); B.set({ custom: null }); drawSeq(); };
  $('seqGrid').onclick = e => { const c = e.target.closest('.cell'); if (!c) return; const row = c.dataset.r, i = +c.dataset.i;
    const cur = customFor() || { ...STYLES[B.cfg.style] }; const arr = cur[row].padEnd(16, '.').split(''); arr[i] = arr[i] === 'x' ? '.' : 'x'; cur[row] = arr.join('');
    S.settings.seqCustom[B.cfg.style] = { K: cur.K, S: cur.S, H: cur.H, O: cur.O || '................' }; saveSettings(); B.set({ custom: S.settings.seqCustom[B.cfg.style] }); B.pattern = patternFor(B.cfg.style, B.cfg.meter, B.cfg.custom); drawSeq(); };
  on('song', s => { B.set({ custom: customFor() }); sync(); });
  sync();
}
function customFor() { return S.settings.seqCustom?.[S.band.cfg.style] || null; }
function saveBandToSong() { if (!S.song) return; const c = S.band.cfg; S.song.band = { style: c.style, intensity: c.intensity, drums: c.drums, pad: c.pad, padTimbre: c.padTimbre, padMode: c.padMode, padThird: c.padThird, bass: c.bass, keys: c.keys, click: c.click, clickSub: c.clickSub, voice: c.voice, countIn: c.countIn, humanize: c.humanize }; songChanged(); }
function beatDots() { const m = METERS[S.band.cfg.meter] || METERS['4/4']; $('beatDots').innerHTML = Array.from({ length: m.beats }, (_, i) => `<i class="${i === 0 ? 'one' : ''}"></i>`).join(''); }
function drawSeq() {
  const B = S.band, p = B.cfg.meter === '4/4' ? patternFor(B.cfg.style, '4/4', customFor()) : patternFor(B.cfg.style, B.cfg.meter, customFor());
  const steps = p.K.length, editable = B.cfg.meter === '4/4', names = { K: 'Bumbo', S: 'Caixa', H: 'Chimbal', O: 'Aberto' };
  const spb = (METERS[B.cfg.meter] || METERS['4/4']).spb;
  $('seqGrid').style.gridTemplateColumns = `64px repeat(${steps}, minmax(18px,1fr))`;
  $('seqGrid').innerHTML = Object.keys(names).map(r => `<span class="name">${names[r]}</span>` + p[r].map((on, i) => `<button class="cell${on ? ' on' : ''}${i % spb === 0 ? ' beat' : ''}" data-r="${r}" data-i="${i}" ${editable ? '' : 'disabled'} aria-label="${names[r]} passo ${i + 1}"></button>`).join('')).join('');
  if (!editable) $('seqGrid').insertAdjacentHTML('beforeend', `<span class="small muted" style="grid-column:1/-1">Edição disponível em 4/4. Em ${B.cfg.meter} a levada é automática.</span>`);
}
function highlightSeq(beat) { const spb = (METERS[S.band.cfg.meter] || METERS['4/4']).spb; $$('#seqGrid .cell').forEach(c => c.classList.toggle('play', Math.floor(+c.dataset.i / spb) === beat)); }
function markRec(id, has) { const b = document.querySelector(`[data-rec="${id}"]`); if (b) { b.style.color = has ? 'var(--green)' : ''; b.title = has ? 'Gravação própria (clique para regravar)' : 'Gravar sua voz para este comando'; } }
let recording = null;
async function recordVoice(id, btn) {
  if (recording) { recording.stop(); return; }
  if (!window.MediaRecorder) return toast('Gravação não suportada neste navegador.', true);
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true }); const rec = new MediaRecorder(st); const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => { st.getTracks().forEach(t => t.stop()); recording = null; btn.textContent = '●'; const blob = new Blob(chunks, { type: rec.mimeType });
      await DB.put('blobs', { id: 'voice-' + id, blob, name: 'voz ' + id }); await S.band.setVoiceBlob(id, blob); markRec(id, true); toast('Comando gravado. Ele sai pelo canal "Voz guia" do mixer.'); };
    rec.start(); recording = rec; btn.textContent = '■'; toast('Gravando… fale o comando e toque ■ para parar.');
    setTimeout(() => { if (recording === rec) rec.stop(); }, 6000);
  } catch (e) { toast('Microfone indisponível: ' + e.message, true); }
}

// ---------------- repertório ----------------
async function initRep() {
  const render = async () => {
    const q = $('repSearch').value.trim().toLowerCase(); const songs = (await DB.all('songs')).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt'));
    const f = q ? songs.filter(s => [s.title, s.artist, s.text].some(x => (x || '').toLowerCase().includes(q))) : songs;
    $('repList').innerHTML = f.map(s => `<div class="it${s.id === S.song?.id ? ' cur' : ''}"><div class="t"><b>${esc(s.title || 'Sem título')}</b><small>${esc(s.artist || '')} ${s.key ? '· ' + esc(s.key) : ''} · ${s.bpm || '-'} BPM</small></div>
      <button class="btn sm" data-open="${s.id}">Abrir</button><button class="btn sm" data-stage="${s.id}">Palco</button><button class="btn sm icon" data-dup="${s.id}" title="Duplicar" aria-label="Duplicar">⧉</button><button class="btn sm icon" data-del="${s.id}" title="Apagar" aria-label="Apagar">✕</button></div>`).join('') || '<div class="muted small">Nenhuma música encontrada.</div>';
    await renderSetlists(songs);
  };
  $('repSearch').addEventListener('input', debounce(render, 200));
  $('repNew').onclick = async () => { const s = DB.newSong(); await DB.saveSong(s); await openSong(s.id); showView('musica'); $('sTitle').focus(); render(); };
  $('repList').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.open) { await openSong(b.dataset.open); showView('musica'); }
    else if (b.dataset.stage) { await openSong(b.dataset.stage); showView('palco'); }
    else if (b.dataset.dup) { const s = await DB.get('songs', b.dataset.dup); const c = DB.newSong({ ...s, id: DB.uid(), title: s.title + ' (cópia)', versions: [] }); await DB.saveSong(c); render(); }
    else if (b.dataset.del) { const s = await DB.get('songs', b.dataset.del); if (!confirm(`Apagar "${s.title}"? Não dá para desfazer (exceto pelo backup).`)) return; await DB.del('songs', s.id); if (s.audioId) await DB.del('blobs', s.audioId).catch(() => {});
      if (S.song?.id === s.id) { const all = await DB.all('songs'); if (all.length) await openSong(all[0].id); else { const n = DB.newSong(); await DB.saveSong(n); await openSong(n.id); } } render(); }
  };
  // listas de apresentação
  $('slNew').onclick = async () => { const name = prompt('Nome da lista (ex.: Culto domingo 30/11)'); if (!name) return; const l = { id: DB.uid(), name, songs: [] }; await DB.put('setlists', l); await DB.setSetting('curSetlist', l.id); render(); };
  $('slSelect').onchange = async () => { await DB.setSetting('curSetlist', $('slSelect').value); render(); };
  $('slAdd').onclick = async () => { const l = await curList(); if (!l) return toast('Crie uma lista primeiro.'); if (!S.song) return; await saveNow(); if (!l.songs.includes(S.song.id)) l.songs.push(S.song.id); await DB.put('setlists', l); render(); };
  $('slDel').onclick = async () => { const l = await curList(); if (!l || !confirm(`Apagar a lista "${l.name}"? As músicas continuam no repertório.`)) return; await DB.del('setlists', l.id); render(); };
  $('slPlay').onclick = async () => { const l = await curList(); if (!l?.songs.length) return toast('Lista vazia.'); await openSong(l.songs[0]); showView('palco'); };
  $('slList').onclick = async e => { const b = e.target.closest('button'); if (!b) return; const l = await curList(); const i = +b.dataset.i;
    if (b.dataset.act === 'up' && i > 0) [l.songs[i - 1], l.songs[i]] = [l.songs[i], l.songs[i - 1]];
    else if (b.dataset.act === 'down' && i < l.songs.length - 1) [l.songs[i + 1], l.songs[i]] = [l.songs[i], l.songs[i + 1]];
    else if (b.dataset.act === 'rm') l.songs.splice(i, 1);
    else if (b.dataset.act === 'go') { await openSong(l.songs[i]); showView('palco'); return; }
    await DB.put('setlists', l); render(); };
  // backup
  $('bkExport').onclick = async () => { await saveNow(); const data = await DB.exportBackup(); download(`musickey-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json'); $('bkInfo').textContent = `${data.songs.length} músicas exportadas (sem os arquivos de áudio).`; };
  $('bkImport').onclick = () => $('fileBackup').click();
  $('fileBackup').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const n = await DB.importBackup(JSON.parse(await f.text()), true); toast(`${n} músicas restauradas.`); render(); } catch (err) { toast('Backup inválido: ' + err.message, true); } };
  on('saved', debounce(render, 500)); on('song', render); on('library', render); on('view', v => v === 'rep' && render());
  render();
}
async function curList() { const id = await DB.getSetting('curSetlist', null); const all = await DB.all('setlists'); return all.find(l => l.id === id) || all[0] || null; }
async function renderSetlists(songs) {
  const all = await DB.all('setlists'), cur = await curList(); const byId = Object.fromEntries(songs.map(s => [s.id, s]));
  $('slSelect').innerHTML = all.length ? all.map(l => `<option value="${l.id}"${l.id === cur?.id ? ' selected' : ''}>${esc(l.name)} (${l.songs.length})</option>`).join('') : '<option>Nenhuma lista</option>';
  $('slList').innerHTML = cur ? cur.songs.map((id, i) => { const s = byId[id]; return `<div class="it${id === S.song?.id ? ' cur' : ''}"><span class="badge">${i + 1}</span><div class="t"><b>${esc(s?.title || '(apagada)')}</b><small>${esc(s?.key || '')}</small></div><button class="btn sm" data-act="go" data-i="${i}">Palco</button><button class="btn sm icon" data-act="up" data-i="${i}" aria-label="Subir">↑</button><button class="btn sm icon" data-act="down" data-i="${i}" aria-label="Descer">↓</button><button class="btn sm icon" data-act="rm" data-i="${i}" aria-label="Tirar da lista">✕</button></div>`; }).join('') || '<div class="muted small">Abra uma música e toque em "Adicionar música aberta".</div>' : '';
  // próxima música da lista no palco
  S.nextInList = cur && S.song ? cur.songs[cur.songs.indexOf(S.song.id) + 1] : null;
}

// ---------------- mixer ----------------
function initMixer() {
  let built = false, raf = 0;
  const build = async () => {
    await S.engine.init(S.settings.mixer); S.settings.mixer = S.engine.state; const st = S.engine.state;
    $('mixer').innerHTML = CHANNELS.map(c => `<div class="strip" data-ch="${c.id}"><b class="small">${c.name}</b><div class="vu"><div></div></div>
      <input type="range" min="0" max="1.2" step="0.01" value="${st.vol[c.id] ?? 0.8}" data-k="vol" aria-label="Volume ${c.name}">
      <input type="range" min="-1" max="1" step="0.1" value="${st.pan[c.id] ?? 0}" data-k="pan" aria-label="Pan ${c.name}" title="Panorâmica">
      <div class="row" style="gap:4px"><button class="btn sm grow${st.mute[c.id] ? ' sel' : ''}" data-k="mute">M</button><button class="btn sm grow${st.solo[c.id] ? ' sel' : ''}" data-k="solo">S</button></div>
      <div class="rt">${BUSES.map(b => `<label><input type="checkbox" data-bus="${b.id}" ${st.route[c.id]?.[b.id] ? 'checked' : ''}>${b.id === 'main' ? 'P' : b.id.toUpperCase()}</label>`).join('')}</div></div>`).join('') +
      BUSES.map(b => `<div class="strip" data-bus="${b.id}"><b class="small">${b.name}</b><div class="vu"><div></div></div><input type="range" min="0" max="1.2" step="0.01" value="${st.busVol[b.id] ?? 0.9}" data-k="busVol" aria-label="Volume ${b.name}"></div>`).join('');
    built = true; meter();
    const outs = await AudioEngine.outputs();
    $('outputs').innerHTML = BUSES.map(b => `<label class="field"><span>${b.name}</span><select data-out="${b.id}"><option value="">${b.id === 'main' ? 'Padrão do sistema' : 'Desligado'}</option>${outs.map(o => `<option value="${esc(o.deviceId)}">${esc(o.label || 'Saída ' + o.deviceId.slice(0, 6))}</option>`).join('')}</select></label>`).join('') +
      (outs.some(o => o.label) ? '' : '<div class="small muted">Para ver os nomes das saídas, permita o microfone uma vez (aba Tom).</div>');
  };
  $('mixer').addEventListener('input', e => { const s = e.target.closest('[data-ch],[data-bus]'); const k = e.target.dataset.k; if (!s || !k) return;
    if (k === 'busVol') S.engine.set('busVol', s.dataset.bus, +e.target.value); else S.engine.set(k, s.dataset.ch, +e.target.value); saveSettings(); });
  $('mixer').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; const ch = b.closest('[data-ch]').dataset.ch, k = b.dataset.k; S.engine.set(k, ch, !S.engine.state[k][ch]); b.classList.toggle('sel', S.engine.state[k][ch]); saveSettings(); });
  $('mixer').addEventListener('change', e => { const bus = e.target.dataset.bus; if (!bus || e.target.type !== 'checkbox') return; S.engine.setRoute(e.target.closest('[data-ch]').dataset.ch, bus, e.target.checked); saveSettings(); });
  $('outputs').addEventListener('change', async e => { const bus = e.target.dataset.out; try { await S.engine.setOutput(bus, e.target.value); toast('Saída alterada.'); } catch (err) { toast(err.message, true); e.target.value = ''; } });
  const meter = () => { cancelAnimationFrame(raf); if (!$('v-mais').classList.contains('active')) return;
    $$('#mixer .strip').forEach(s => { const id = s.dataset.ch || s.dataset.bus; s.querySelector('.vu div').style.width = Math.min(100, S.engine.level(id) * 120) + '%'; }); raf = requestAnimationFrame(meter); };
  on('view', v => { if (v === 'mais') (built ? meter() : build().catch(e => toast(e.message, true))); });
}

// ---------------- biblioteca de acordes ----------------
function initLibrary() {
  for (const [id, i] of Object.entries(INSTRUMENTS)) $('libInst').add(new Option(i.name, id)); $('libInst').add(new Option('Teclado', 'teclado'));
  const show = list => {
    const inst = $('libInst').value;
    $('libOut').innerHTML = list.map(ch => { if (!M.isChord(ch)) return `<div class="small" style="color:var(--red)">"${esc(ch)}" não é um acorde reconhecido.</div>`;
      if (inst === 'teclado') return `<div class="diagrams"><div>${keyboardSVG(ch)}<div class="small" style="text-align:center"><b>${esc(ch)}</b></div></div></div>`;
      const v = voicings(ch, inst, 4); return `<div><b>${esc(ch)}</b> <span class="small muted">${M.chordNotes(ch).map(n => M.NICE[n]).join(' · ')}</span><div class="diagrams" style="margin-top:6px">${v.map((x, i) => `<div>${fretSVG(x, inst, i ? 'opção ' + (i + 1) : ch)}</div>`).join('') || '<span class="muted small">Sem posição encontrada.</span>'}</div></div>`; }).join('');
  };
  $('libChord').addEventListener('input', debounce(() => show($('libChord').value.split(/[,\s]+/).filter(Boolean)), 250));
  $('libInst').onchange = () => $('libChord').dispatchEvent(new Event('input'));
  $('libSong').onclick = () => { const cs = [...new Set(M.songChords(S.song?.text || '').filter(M.isChord))]; $('libChord').value = cs.join(', '); show(cs); };
  $('libChord').value = 'G, D, Em, C'; show(['G', 'D', 'Em', 'C']);
}

// ---------------- configurações ----------------
function initConfig() {
  const st = S.settings, P = st.pub;
  const map = [['cfLines', 'lines', 'num', true], ['cfStageSize', 'stageSize', 'num', true], ['cfStageFg', 'stageFg', 'str', true], ['cfStageChords', 'stageChords', 'chk', true], ['cfWake', 'wake', 'chk']];
  for (const [id, k, t, rs] of map) { const el = $(id); if (t === 'chk') el.checked = !!st[k]; else el.value = st[k];
    el.addEventListener(t === 'chk' ? 'change' : 'input', () => { st[k] = t === 'chk' ? el.checked : t === 'num' ? +el.value : el.value; saveSettings(); if (rs) rebuildStage(); }); }
  const pmap = [['cfPubBg', 'bg'], ['cfPubFg', 'fg'], ['cfPubFont', 'font'], ['cfPubAlign', 'align'], ['cfPubSize', 'size', 'num'], ['cfPubFade', 'fade', 'chk']];
  for (const [id, k, t] of pmap) { const el = $(id); if (t === 'chk') el.checked = P[k] !== false; else el.value = P[k];
    el.addEventListener(t === 'chk' ? 'change' : 'input', () => { P[k] = t === 'chk' ? el.checked : t === 'num' ? +el.value : el.value; saveSettings(); publish(); }); }
  const pickImg = (inputId, key) => { $(inputId).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (f.size > 4e6) return toast('Imagem muito grande (máx. 4 MB).', true);
    const r = new FileReader(); r.onload = () => { P[key] = r.result; saveSettings(); publish(); toast('Imagem aplicada na tela do público.'); }; r.readAsDataURL(f); }; };
  $('cfPubImg').onclick = () => $('filePubImg').click(); $('cfPubLogo').onclick = () => $('filePubLogo').click(); pickImg('filePubImg', 'img'); pickImg('filePubLogo', 'logo');
  $('cfPubClear').onclick = () => { P.img = ''; P.logo = ''; saveSettings(); publish(); toast('Imagens removidas.'); };
  $('cfInstall').onclick = async () => { if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; } else toast('No Chrome: menu ⋮ → Instalar app. No iPhone: Compartilhar → Adicionar à Tela de Início.'); };
  $('cfPersist').onclick = async () => { const ok = await DB.askPersist(); toast(ok ? 'Dados protegidos.' : 'O navegador não liberou. Faça backups regulares.'); info(); };
  const info = async () => { const i = await DB.storageInfo(); $('cfInfo').textContent = `MusicKey PRO Studio v${VERSION} · ${(i.usage / 1e6).toFixed(1)} MB usados${i.quota ? ' de ' + (i.quota / 1e9).toFixed(1) + ' GB' : ''} · ${i.persisted ? 'dados protegidos' : 'dados não protegidos'}${i.fallback ? ' · modo reserva (localStorage)' : ''}`; };
  info();
  const mics = async () => { if (!navigator.mediaDevices?.enumerateDevices) return; const d = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'audioinput');
    $('cfMic').innerHTML = '<option value="">Padrão do sistema</option>' + d.map(x => `<option value="${esc(x.deviceId)}">${esc(x.label || 'Entrada ' + x.deviceId.slice(0, 6))}</option>`).join(''); $('cfMic').value = st.mic || ''; };
  mics(); navigator.mediaDevices?.addEventListener?.('devicechange', mics);
  $('cfMic').onchange = () => { st.mic = $('cfMic').value; S.mic.deviceId = st.mic; S.mic.stop(); saveSettings(); toast('Entrada alterada. Ligue o microfone de novo.'); };
  on('subview', s => { if (s === 'config') { mics(); info(); } });
}

// ---------------- diagnóstico pré-palco ----------------
function initDiag() {
  $('diagRun').onclick = async () => {
    const out = []; const add = (ok, t, d) => out.push(`<div class="it"><span class="badge ${ok === true ? 'ok' : ok === false ? '' : 'warn'}">${ok === true ? 'OK' : ok === false ? 'Falha' : 'Atenção'}</span><div class="t"><b>${t}</b><small>${d}</small></div></div>`);
    add(isSecureContext, 'Conexão segura', isSecureContext ? 'Microfone e instalação liberados.' : 'Abra por https:// ou localhost para usar o microfone.');
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); add(true, 'Microfone', 'Permissão concedida.'); } catch (e) { add(false, 'Microfone', e.name === 'NotAllowedError' ? 'Permissão negada.' : e.message); }
    try { await S.engine.init(S.settings.mixer); add(S.engine.ctx.state === 'running', 'Áudio', `Taxa ${S.engine.ctx.sampleRate} Hz · latência ${Math.round((S.engine.ctx.baseLatency || 0) * 1000)} ms`); } catch (e) { add(false, 'Áudio', e.message); }
    add(S.engine.canRoute ? true : null, 'Saídas de retorno', S.engine.canRoute ? 'Navegador permite escolher saídas.' : 'Escolha de saída indisponível (use Chrome/Edge no PC).');
    const i = await DB.storageInfo(); add(!i.fallback, 'Armazenamento', `${(i.usage / 1e6).toFixed(1)} MB usados · ${i.persisted ? 'protegido' : 'não protegido (faça backup)'}`);
    try { await DB.setSetting('diag', Date.now()); add(true, 'Gravação de dados', 'Salvar e ler funcionando.'); } catch (e) { add(false, 'Gravação de dados', e.message); }
    add('wakeLock' in navigator ? true : null, 'Tela ligada no palco', 'wakeLock' in navigator ? 'Suportado.' : 'Não suportado: desative o bloqueio de tela manualmente.');
    add(navigator.serviceWorker?.controller ? true : null, 'Funcionamento offline', navigator.serviceWorker?.controller ? 'Cache ativo.' : 'Ainda não ativo (abra o app de novo com internet).');
    add(S.sync.status === 'rede' ? true : null, 'Rede local', S.sync.status === 'rede' ? `${S.sync.peers.length} aparelho(s) conectado(s) · atraso ${S.sync.rtt ?? '-'} ms` : 'Modo local (sem servidor). Veja "Conectar aparelhos".');
    $('diagOut').innerHTML = out.join('');
  };
}

// ---------------- rede local ----------------
function initNet() {
  const render = () => {
    const srv = S.server, card = $('netCard');
    if (!srv) { card.innerHTML = `<h2>Conectar celulares, tablets e projetor</h2>
      <div class="small">Para sincronizar vários aparelhos (como no Holyrics), rode o servidor no PC central:</div>
      <ol class="small" style="line-height:1.7;margin:4px 0 0;padding-left:20px">
        <li>Instale o <b>Node.js</b> (grátis) no PC com Windows.</li>
        <li>Baixe o pacote do MusicKey e dê dois cliques em <b>INICIAR-SERVIDOR.bat</b>.</li>
        <li>No PC, abra <b>http://localhost:8080</b>. O microfone funciona nesse endereço.</li>
        <li>Volte aqui: aparece o QR Code para os celulares entrarem no mesmo Wi-Fi.</li></ol>
      <div class="small muted">Sem o servidor, as janelas de público e retorno funcionam só neste aparelho.</div>`; return; }
    const base = `http://${srv.ips[0] || location.hostname}:${srv.port}/`, code = srv.code ? `&code=${srv.code}` : '';
    card.innerHTML = `<h2>Aparelhos conectados</h2><div class="small muted">Rede local ${esc(srv.ips.join(', '))} · porta ${srv.port}${srv.code ? ` · código da sessão <b>${srv.code}</b>` : ''}</div>
      <div class="grid2" style="margin-top:8px">${['remote', 'singer', 'musician', 'public', 'return'].map(r => { const url = `${base}?screen=${r}${code}`; return `<div class="card stack" style="align-items:center"><b>${ROLES[r]}</b><div class="qr">${qrSVG(url, 4)}</div><a class="small" href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all">${esc(url)}</a></div>`; }).join('')}</div>
      <h2 style="margin-top:10px">Conectados agora</h2><div class="list" id="peerList"></div>`;
    peers(S.sync.peers);
  };
  const peers = list => { const el = $('peerList'); if (!el) return; el.innerHTML = (list || []).map(p => `<div class="it"><span class="badge ok">●</span><div class="t"><b>${esc(ROLES[p.role] || p.role)}</b><small>${esc(p.name || '')} · ${esc(p.ip || '')}</small></div></div>`).join('') || '<div class="muted small">Nenhum aparelho conectado.</div>'; };
  on('peers', peers); on('net', render); on('subview', s => s === 'rede' && render()); render();
}
