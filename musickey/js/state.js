// MusicKey PRO Studio v2.0 — estado compartilhado e utilitários de interface
export const VERSION = '2.0';
export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const fmt = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
export const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
let toastT;
export function toast(msg, err) {
  let el = document.querySelector('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg; el.classList.toggle('err', !!err); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, err ? 5000 : 2600);
}
export const S = {
  song: null,            // música aberta
  stage: { block: 0, blocks: [], lines: [] },
  blackout: false,
  settings: {
    lines: 4, stageSize: 0, stageFg: '#ffffff', stageChords: true, wake: true,
    pub: { bg: '#000000', fg: '#ffffff', font: 'Inter', align: 'center', size: 6, img: '', logo: '', fade: true },
    mic: '', mixer: null, seqCustom: {}, a4: 440, tunInst: 'Violão / guitarra (padrão)'
  },
  progChords: null,      // sequência escolhida no detector
  detKey: null,          // tom detectado pela voz
  sync: null, engine: null, band: null, mic: null,
  audio: null,           // <audio> da música
  bus: new EventTarget()
};
export const emit = (name, detail) => S.bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => S.bus.addEventListener(name, e => fn(e.detail));

// renderiza linha de cifra com acorde acima da sílaba (alinhado em fonte proporcional)
import { isChord, transposeChord } from './music.js';
export function lineHTML(line, opts = {}) {
  if (!line || line.type !== 'line') return '';
  const shift = opts.shift || 0;
  if (!line.hasChords || opts.noChords) return esc(line.text);
  return line.chunks.map(c => {
    let ch = c.chord;
    if (ch && shift) ch = transposeChord(ch, shift);
    const bad = ch && !isChord(ch);
    const txt = c.text || (ch ? ' ' : '');
    return `<span class="ck"><b${bad ? ' class="bad"' : ''}>${ch ? esc(ch) : ''}</b><span>${esc(txt)}</span></span>`;
  }).join('');
}
