const FORMAT = 'tasks-board-vault';
const INFO = 'tasks-board-vault-v1';
const ITERATIONS = 600000;
const PASSWORD_ERROR = 'That password did not unlock Tasks.';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function invalid() { throw new Error('Invalid Tasks vault.'); }
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function bytes(value, length) {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) invalid();
  return value;
}
function random(length) { return globalThis.crypto.getRandomValues(new Uint8Array(length)); }

export function toBase64Url(value) {
  bytes(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) invalid();
  let binary;
  try { binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)); }
  catch { invalid(); }
  const decoded = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (toBase64Url(decoded) !== value) invalid();
  return decoded;
}

function encoded(value, length, minimum = length) {
  const decoded = fromBase64Url(value);
  if ((length !== undefined && decoded.length !== length) || (minimum !== undefined && decoded.length < minimum)) invalid();
  return decoded;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
}
function ciphertext(value, wrapped = false) {
  object(value, ['alg', 'iv', 'ct']);
  if (value.alg !== 'AES-256-GCM') invalid();
  encoded(value.iv, 12);
  encoded(value.ct, wrapped ? 48 : undefined, wrapped ? 48 : 17);
}

export function validateVault(vault) {
  object(vault, ['format', 'version', 'vault_id', 'updated_at', 'payload', 'slots']);
  if (vault.format !== FORMAT || vault.version !== 1) invalid();
  encoded(vault.vault_id, 16);
  timestamp(vault.updated_at);
  ciphertext(vault.payload);
  if (!Array.isArray(vault.slots)) invalid();
  let passwords = 0;
  const ids = new Set();
  const credentials = new Set();
  for (const slot of vault.slots) {
    if (!slot || typeof slot !== 'object') invalid();
    encoded(slot.id, 16);
    if (ids.has(slot.id)) invalid();
    ids.add(slot.id);
    ciphertext(slot.wrap, true);
    if (slot.type === 'password') {
      object(slot, ['id', 'type', 'kdf', 'iterations', 'salt', 'wrap']);
      passwords++;
      if (slot.kdf !== 'PBKDF2-SHA256' || !Number.isSafeInteger(slot.iterations) || slot.iterations < ITERATIONS || slot.iterations > 0xffffffff) invalid();
      encoded(slot.salt, undefined, 16);
    } else if (slot.type === 'passkey') {
      object(slot, ['id', 'type', 'label', 'credential_id', 'prf_salt', 'hkdf_info', 'wrap', 'created_at']);
      if (typeof slot.label !== 'string' || !slot.label.trim() || slot.hkdf_info !== INFO) invalid();
      encoded(slot.credential_id, undefined, 1);
      if (credentials.has(slot.credential_id)) invalid();
      credentials.add(slot.credential_id);
      encoded(slot.prf_salt, 32);
      timestamp(slot.created_at);
    } else invalid();
  }
  if (passwords !== 1) invalid();
  return vault;
}

function validatePayload(payload) {
  const keys = ['token', 'owner', 'repo', 'path', 'branch', 'site_repo', 'site_branch'];
  object(payload, keys);
  for (const key of keys) {
    if (typeof payload[key] !== 'string' || !payload[key].trim() || /[\u0000-\u001f\u007f]/.test(payload[key])) invalid();
  }
  return payload;
}
function newPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use a password with at least 12 characters.');
}
async function dataKey(dek) {
  return globalThis.crypto.subtle.importKey('raw', bytes(dek, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function passwordKey(password, slot) {
  if (typeof password !== 'string') invalid();
  const material = await globalThis.crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(slot.salt), iterations: slot.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function prfKey(vault, slot, output) {
  const material = await globalThis.crypto.subtle.importKey('raw', bytes(output, 32), 'HKDF', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: fromBase64Url(vault.vault_id), info: encoder.encode(slot.hkdf_info) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(key, plaintext, aad) {
  const iv = random(12);
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 }, key, plaintext);
  return { alg: 'AES-256-GCM', iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) };
}
async function decrypt(key, value, aad) {
  return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(value.iv), additionalData: encoder.encode(aad), tagLength: 128 }, key, fromBase64Url(value.ct)));
}
async function readPayload(vault, dek) {
  const plaintext = await decrypt(await dataKey(dek), vault.payload, vault.vault_id);
  try { return validatePayload(JSON.parse(decoder.decode(plaintext))); }
  finally { plaintext.fill(0); }
}
async function passwordSlot(vaultId, dek, password) {
  newPassword(password);
  const slot = { id: toBase64Url(random(16)), type: 'password', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64Url(random(16)) };
  slot.wrap = await encrypt(await passwordKey(password, slot), dek, `${vaultId}:${slot.id}`);
  return slot;
}
function copy(vault) { return JSON.parse(JSON.stringify(vault)); }
function updated(vault) { vault.updated_at = new Date().toISOString(); return validateVault(vault); }

export async function createVault(payload, password) {
  validatePayload(payload);
  newPassword(password);
  const cleanPayload = { ...payload };
  const dek = random(32);
  const vaultId = toBase64Url(random(16));
  const vault = {
    format: FORMAT, version: 1, vault_id: vaultId, updated_at: new Date().toISOString(),
    payload: await encrypt(await dataKey(dek), encoder.encode(JSON.stringify(cleanPayload)), vaultId),
    slots: [await passwordSlot(vaultId, dek, password)],
  };
  return { vault: validateVault(vault), payload: cleanPayload, dek };
}

export async function unlockWithPassword(vault, password) {
  let dek;
  try {
    validateVault(vault);
    const slot = vault.slots.find(item => item.type === 'password');
    dek = await decrypt(await passwordKey(password, slot), slot.wrap, `${vault.vault_id}:${slot.id}`);
    return { payload: await readPayload(vault, dek), dek };
  } catch {
    dek?.fill(0);
    throw new Error(PASSWORD_ERROR);
  }
}

export async function unlockWithPrf(vault, slotId, prfOutput) {
  let dek;
  try {
    validateVault(vault);
    const slot = vault.slots.find(item => item.id === slotId && item.type === 'passkey');
    if (!slot) invalid();
    dek = await decrypt(await prfKey(vault, slot, prfOutput), slot.wrap, `${vault.vault_id}:${slot.id}`);
    return { payload: await readPayload(vault, dek), dek };
  } catch {
    dek?.fill(0);
    throw new Error('This passkey did not unlock Tasks.');
  }
}

export async function addPasskeySlot(vault, dek, { credentialId, prfSalt, prfOutput, label }) {
  validateVault(vault);
  encoded(credentialId, undefined, 1);
  bytes(prfSalt, 32);
  bytes(prfOutput, 32);
  if (typeof label !== 'string' || !label.trim() || vault.slots.some(slot => slot.credential_id === credentialId)) invalid();
  await readPayload(vault, dek);
  const next = copy(vault);
  const slot = { id: toBase64Url(random(16)), type: 'passkey', label, credential_id: credentialId, prf_salt: toBase64Url(prfSalt), hkdf_info: INFO, created_at: new Date().toISOString() };
  slot.wrap = await encrypt(await prfKey(vault, slot, prfOutput), dek, `${vault.vault_id}:${slot.id}`);
  next.slots.push(slot);
  return updated(next);
}

export function removeSlot(vault, slotId) {
  validateVault(vault);
  if (!vault.slots.some(slot => slot.id === slotId && slot.type === 'passkey')) throw new Error('Only an existing passkey can be removed.');
  const next = copy(vault);
  next.slots = next.slots.filter(slot => slot.id !== slotId);
  return updated(next);
}

export async function changePassword(vault, dek, password) {
  validateVault(vault);
  newPassword(password);
  await readPayload(vault, dek);
  const next = copy(vault);
  const replacement = await passwordSlot(vault.vault_id, dek, password);
  next.slots = next.slots.map(slot => slot.type === 'password' ? replacement : slot);
  return updated(next);
}

export function serialize(vault) { return JSON.stringify(validateVault(vault), null, 2); }
