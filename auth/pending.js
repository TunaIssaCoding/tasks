/* Device-local task cache. The key is deliberately independent of the auth vault. */
const DATABASE = 'tasks-board-pending';
const STORE = 'cache';
const KEY = 'device-key';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function unavailable() {
  const error = new Error('Encrypted offline storage is unavailable.');
  error.code = 'PENDING_UNAVAILABLE';
  return error;
}

function identity(scope) {
  const fields = ['owner', 'repo', 'path', 'branch'].map(name => scope[name]);
  if (fields.some(value => typeof value !== 'string' || !value)) {
    throw new Error('The offline task cache needs a complete repository location.');
  }
  return JSON.stringify(['tasks-board-pending', 1, ...fields]);
}

function recordsOnly(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records) ||
      Object.keys(records).some(key =>
        (key !== 'tasks.doc' && key !== 'tasks.meta') || typeof records[key] !== 'string')) {
    throw new Error('Invalid offline task cache.');
  }
  return records;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
      reject(unavailable());
      return;
    }
    let settled = false;
    let request;
    const timer = setTimeout(() => finish(null), 3000);
    function finish(database) {
      if (settled) {
        if (database) database.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (database) resolve(database);
      else reject(unavailable());
    }
    try {
      request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch (_) {
      finish(null);
    }
  });
}

function transaction(database, mode, action) {
  return new Promise((resolve, reject) => {
    let tx;
    let result;
    try {
      tx = database.transaction(STORE, mode);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(unavailable());
      action(tx.objectStore(STORE), value => { result = value; });
    } catch (_) {
      if (tx) { try { tx.abort(); } catch (_) {} }
      reject(unavailable());
    }
  });
}

async function deviceKey(database, create) {
  let key = await transaction(database, 'readonly', (store, done) => {
    store.get(KEY).onsuccess = event => done(event.target.result);
  });
  if (!key && create) {
    const candidate = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // The read/write transaction arbitrates simultaneous first use in two tabs.
    key = await transaction(database, 'readwrite', (store, done) => {
      store.get(KEY).onsuccess = event => {
        const existing = event.target.result;
        if (!existing) store.put(candidate, KEY);
        done(existing || candidate);
      };
    });
  }
  if (key && (key.extractable || key.type !== 'secret' || key.algorithm?.name !== 'AES-GCM')) {
    throw new Error('Invalid offline task encryption key.');
  }
  return key;
}

export async function loadPending(scope) {
  const id = identity(scope);
  const database = await openDatabase();
  try {
    const record = await transaction(database, 'readonly', (store, done) => {
      store.get(id).onsuccess = event => done(event.target.result);
    });
    if (!record) return null;
    const key = await deviceKey(database, false);
    if (!key || record.version !== 1) throw new Error('Unreadable offline task cache.');
    try {
      const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: record.iv, additionalData: encoder.encode(id),
      }, key, record.ciphertext);
      return recordsOnly(JSON.parse(decoder.decode(plaintext)));
    } catch (_) {
      throw new Error('Offline task edits could not be decrypted. They have not been removed.');
    }
  } finally {
    database.close();
  }
}

export async function savePending(scope, records) {
  const id = identity(scope);
  const plaintext = encoder.encode(JSON.stringify(recordsOnly(records)));
  const database = await openDatabase();
  try {
    const key = await deviceKey(database, true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: encoder.encode(id),
    }, key, plaintext);
    await transaction(database, 'readwrite', store => {
      store.put({ version: 1, iv, ciphertext }, id);
    });
  } finally {
    plaintext.fill(0);
    database.close();
  }
}
