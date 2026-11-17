import { fromBase64Url, toBase64Url, unlockWithPrf, validateVault } from './vault.js';

const UNSUPPORTED = 'This browser or passkey does not support unlocking with a passkey. Use your password on this device.';
function unsupported() { return new Error(UNSUPPORTED); }
function random(length) { return globalThis.crypto.getRandomValues(new Uint8Array(length)); }
function credentialApi() {
  if (!globalThis.PublicKeyCredential || !globalThis.navigator?.credentials) throw unsupported();
  return globalThis.navigator.credentials;
}
async function credentialRequest(method, options) {
  try { return await credentialApi()[method](options); }
  catch (error) {
    if (error.name === 'SecurityError') throw new Error('Passkeys are not available on this address.');
    if (error.name === 'NotSupportedError') throw unsupported();
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') throw new Error('The passkey prompt was cancelled or timed out. Try again or use your password.');
    throw unsupported();
  }
}
function extension(credential) {
  let prf;
  try { prf = credential?.getClientExtensionResults?.().prf; }
  catch { throw unsupported(); }
  if (!prf || prf.enabled === false) throw unsupported();
  return prf;
}
function output(prf) {
  const first = prf.results?.first;
  let result;
  if (first instanceof ArrayBuffer) result = new Uint8Array(first);
  else if (ArrayBuffer.isView(first)) result = new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  if (!result || result.length !== 32) throw unsupported();
  return new Uint8Array(result);
}
function credentialId(credential) {
  if (!(credential?.rawId instanceof ArrayBuffer) || credential.rawId.byteLength === 0) throw unsupported();
  return toBase64Url(new Uint8Array(credential.rawId));
}
function requestOptions(slots) {
  return {
    challenge: random(32), rpId: globalThis.location.hostname, userVerification: 'required',
    allowCredentials: slots.map(slot => ({ type: 'public-key', id: fromBase64Url(slot.credential_id) })),
    extensions: { prf: { evalByCredential: Object.fromEntries(slots.map(slot => [slot.credential_id, { first: fromBase64Url(slot.prf_salt) }])) } },
  };
}

export async function passkeysAvailable(vault) {
  const credentialClass = globalThis.PublicKeyCredential;
  if (!credentialClass || !vault?.slots?.some(slot => slot.type === 'passkey')) return false;
  try {
    const capabilities = await credentialClass.getClientCapabilities?.();
    if (capabilities?.['extension:prf'] === false) return false;
  } catch { /* Capability discovery is optional; the actual assertion is authoritative. */ }
  return true;
}

export async function registerPasskey(onStatus = () => {}) {
  const prfSalt = random(32);
  const credential = await credentialRequest('create', { publicKey: {
    challenge: random(32),
    rp: { id: globalThis.location.hostname, name: 'Tasks' },
    user: { id: random(16), name: 'tasks-board', displayName: 'Tasks' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    extensions: { prf: { eval: { first: prfSalt } } },
  } });
  const prf = extension(credential);
  const id = credentialId(credential);
  let prfOutput;
  if (prf.results?.first !== undefined) {
    prfOutput = output(prf);
  } else {
    onStatus('Your browser needs a second passkey prompt to finish setup. Confirm it to continue.');
    const assertion = await credentialRequest('get', { publicKey: requestOptions([{ credential_id: id, prf_salt: toBase64Url(prfSalt) }]) });
    if (credentialId(assertion) !== id) throw unsupported();
    prfOutput = output(extension(assertion));
  }
  return { credentialId: id, prfSalt, prfOutput };
}

export async function unlockPasskey(vault) {
  validateVault(vault);
  const slots = vault.slots.filter(slot => slot.type === 'passkey');
  if (!slots.length) throw unsupported();
  const assertion = await credentialRequest('get', { publicKey: requestOptions(slots) });
  const id = credentialId(assertion);
  const slot = slots.find(item => item.credential_id === id);
  if (!slot) throw unsupported();
  const prfOutput = output(extension(assertion));
  try { return await unlockWithPrf(vault, slot.id, prfOutput); }
  catch { throw unsupported(); }
  finally { prfOutput.fill(0); }
}

export function defaultPasskeyLabel() {
  const ua = globalThis.navigator?.userAgent || '';
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && globalThis.navigator?.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'This device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  return `${platform} (${browser}) · ${date}`;
}
