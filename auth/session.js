import { validateVault, toBase64Url, fromBase64Url } from './vault.js';

const DATABASE = 'tasks-board-session';
const STORE = 'remembered';
const RECORD = 'device';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let operations = Promise.resolve();

// Serialize complete operations, including crypto, so a Lock/delete cannot be
// overtaken by a save that was still generating its device key.
function exclusive(operation) {
  const result = operations.then(operation);
  operations = result.catch(() => {});
  return result;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Device storage is unavailable.'));
    const request = indexedDB.open(DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
    request.onerror = request.onblocked = () => {
      failed = true;
      reject(new Error('Device storage is unavailable.'));
    };
  });
}

function transact(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(new Error('Device storage could not be updated.'));
  });
}

function additionalData(vaultId, updatedAt) {
  return encoder.encode(JSON.stringify(['tasks-board-session', 1, vaultId, updatedAt]));
}

function validateSession({ vault, payload, dek }) {
  validateVault(vault);
  if (!payload || ['token', 'owner', 'repo', 'path', 'branch', 'site_repo', 'site_branch'].some(
    field => typeof payload[field] !== 'string' || !payload[field].trim(),
  ) || !(dek instanceof Uint8Array) || dek.byteLength !== 32) {
    throw new Error('Invalid remembered session.');
  }
}

export function saveRemembered(session) {
  // Snapshot before any await: later password/passkey edits or DEK erasure must
  // not alter a pending save, and callers retain ownership of their raw key.
  let snapshot;
  try {
    validateSession(session);
    snapshot = structuredClone(session);
  } catch {
    return Promise.reject(new Error('The unlocked session could not be remembered.'));
  }
  return exclusive(async () => {
    let db;
    let plaintext;
    try {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const { vault, payload, dek } = snapshot;
      plaintext = encoder.encode(JSON.stringify({ vault, payload, dek: toBase64Url(dek) }));
      const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM', iv, additionalData: additionalData(vault.vault_id, vault.updated_at),
      }, key, plaintext);
      db = await openDatabase();
      await transact(db, 'readwrite', store => store.put({
        version: 1, vault_id: vault.vault_id, updated_at: vault.updated_at, key, iv, ciphertext,
      }, RECORD));
    } catch {
      throw new Error('This device could not remember the unlock. Keep your password available for the next visit.');
    } finally {
      plaintext?.fill(0);
      snapshot.dek.fill(0);
      snapshot = null;
      db?.close();
    }
  });
}

export function loadRemembered() {
  return exclusive(async () => {
    let db;
    let plaintext;
    let dek;
    try {
      db = await openDatabase();
      const record = await transact(db, 'readonly', store => store.get(RECORD));
      if (!record) return null;
      if (record.version !== 1 || typeof record.vault_id !== 'string' || typeof record.updated_at !== 'string' ||
          !record.key || record.key.type !== 'secret' || record.key.extractable !== false ||
          record.key.algorithm?.name !== 'AES-GCM' || record.key.algorithm.length !== 256 ||
          !record.key.usages.includes('decrypt') || !(record.iv instanceof Uint8Array) || record.iv.byteLength !== 12) {
        throw new Error('Invalid remembered session.');
      }
      plaintext = new Uint8Array(await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: record.iv, additionalData: additionalData(record.vault_id, record.updated_at),
      }, record.key, record.ciphertext));
      const value = JSON.parse(decoder.decode(plaintext));
      dek = fromBase64Url(value.dek);
      const session = { vault: value.vault, payload: value.payload, dek };
      validateSession(session);
      if (session.vault.vault_id !== record.vault_id || session.vault.updated_at !== record.updated_at) {
        throw new Error('Invalid remembered session.');
      }
      return session;
    } catch {
      dek?.fill(0);
      // Stale, tampered or unsupported CryptoKey records must never trap boot in
      // a failing silent-unlock loop. Storage denial is equivalent to no record.
      if (db) {
        try { await transact(db, 'readwrite', store => store.delete(RECORD)); } catch { /* Storage may be disabled. */ }
      }
      return null;
    } finally {
      plaintext?.fill(0);
      db?.close();
    }
  });
}

export function deleteRemembered() {
  return exclusive(async () => {
    const db = await openDatabase();
    try { await transact(db, 'readwrite', store => store.delete(RECORD)); }
    finally { db.close(); }
  });
}
