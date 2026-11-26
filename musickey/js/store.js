// MusicKey PRO Studio v2.0 — armazenamento local (IndexedDB, com reserva em localStorage)
const DB = 'musickey-pro', VER = 1, STORES = ['songs', 'setlists', 'settings', 'blobs'];
let dbp = null, fallback = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in self)) { fallback = true; return res(null); }
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { fallback = true; res(null); };
    r.onblocked = () => rej(new Error('Banco bloqueado por outra aba'));
  });
  return dbp;
}
const lsKey = (s) => 'mk-' + s;
const lsAll = (s) => { try { return JSON.parse(localStorage.getItem(lsKey(s)) || '[]'); } catch { return []; } };
const lsSave = (s, a) => { localStorage.setItem(lsKey(s), JSON.stringify(a)); };

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) {
    if (store === 'blobs') throw new Error('Armazenamento de áudio indisponível neste navegador');
    const a = lsAll(store); const out = fn({ all: a }); lsSave(store, a); return out;
  }
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), os = t.objectStore(store);
    let out; const r = fn(os);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error || new Error('Erro ao salvar'));
    t.onabort = () => rej(t.error || new Error('Gravação cancelada (armazenamento cheio?)'));
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function all(store) {
  const db = await open();
  if (!db) return lsAll(store);
  return (await tx(store, 'readonly', os => os.getAll())) || [];
}
export async function get(store, id) {
  const db = await open();
  if (!db) return lsAll(store).find(x => x.id === id) || null;
  return tx(store, 'readonly', os => os.get(id));
}
export async function put(store, obj) {
  obj.updated = Date.now();
  const db = await open();
  if (!db) { const a = lsAll(store); const i = a.findIndex(x => x.id === obj.id); if (i >= 0) a[i] = obj; else a.push(obj); lsSave(store, a); return obj; }
  await tx(store, 'readwrite', os => os.put(obj)); return obj;
}
export async function del(store, id) {
  const db = await open();
  if (!db) { lsSave(store, lsAll(store).filter(x => x.id !== id)); return; }
  await tx(store, 'readwrite', os => os.delete(id));
}

// configurações
export async function getSetting(key, def) { const r = await get('settings', key).catch(() => null); return r ? r.value : def; }
export async function setSetting(key, value) { return put('settings', { id: key, value }); }

// música nova com esquema versionado
export function newSong(p = {}) {
  return Object.assign({
    id: uid(), v: 1, title: 'Nova música', artist: '', key: '', origKey: '', bpm: 76, meter: '4/4', capo: 0,
    notes: '', text: '', segments: [], lineTimes: {}, keyChanges: [], audioId: null,
    band: { style: 'worship', intensity: 0.7, drums: true, pad: true, padTimbre: 'ambient', bass: false, keys: false, click: false, voice: true, countIn: true },
    versions: []
  }, p);
}
// guarda versão anterior (até 10) antes de salvar mudanças grandes
export async function saveSong(song, snapshot = false) {
  if (snapshot) {
    const old = await get('songs', song.id).catch(() => null);
    if (old && old.text !== song.text) {
      song.versions = [{ at: old.updated, text: old.text, key: old.key }, ...(song.versions || [])].slice(0, 10);
    }
  }
  return put('songs', song);
}

// backup completo (sem arquivos de áudio)
export async function exportBackup() {
  const [songs, setlists, settings] = await Promise.all(['songs', 'setlists', 'settings'].map(all));
  return { app: 'MusicKey PRO Studio', format: 1, exported: new Date().toISOString(), songs, setlists, settings };
}
export async function importBackup(data, merge = true) {
  if (!data || data.app !== 'MusicKey PRO Studio' || !Array.isArray(data.songs)) throw new Error('Arquivo de backup inválido');
  if (!merge) for (const s of ['songs', 'setlists']) for (const x of await all(s)) await del(s, x.id);
  let n = 0;
  for (const s of data.songs) { await put('songs', s); n++; }
  for (const l of data.setlists || []) await put('setlists', l);
  for (const st of data.settings || []) await put('settings', st);
  return n;
}
export async function storageInfo() {
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  return { usage: est?.usage || 0, quota: est?.quota || 0, persisted, fallback };
}
export async function askPersist() { try { return await navigator.storage?.persist?.(); } catch { return false; } }
