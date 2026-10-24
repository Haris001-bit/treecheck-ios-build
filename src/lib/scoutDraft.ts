// Keeps an in-progress Scout capture on the device so it survives the phone
// unloading the app while the user is in another app (camera, messages...).
const DB = 'treecheck-scout';
const STORE = 'draft';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScoutDraft(draft: Record<string, unknown>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(draft, KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('[scoutDraft] save failed', e); }
}

export async function loadScoutDraft<T = Record<string, unknown>>(): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => res((req.result as T) ?? null);
      req.onerror = () => rej(req.error);
    });
  } catch { return null; }
}

export async function clearScoutDraft(): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
  } catch { /* noop */ }
}

const STATE_NAMES: Record<string, string> = {
  oklahoma: 'OK', texas: 'TX', alabama: 'AL', idaho: 'ID', kansas: 'KS', arkansas: 'AR', missouri: 'MO', colorado: 'CO',
};
export function toStateCode(v?: string | null): string {
  if (!v) return '';
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAMES[t.toLowerCase()] ?? '';
}
