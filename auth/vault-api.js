import { validateVault, serialize } from './vault.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const encode = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const decode = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, '')), c => c.charCodeAt(0)));

async function request(payload, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(payload.owner)}/${encodeURIComponent(payload.site_repo)}${path}`, {
      ...options, signal: controller.signal, cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${payload.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers },
    });
    if (!response.ok) {
      const message = response.status === 401 ? 'GitHub rejected the token. Check that it is valid and has not expired.'
        : response.status === 403 ? 'The token lacks access to the site repository, or GitHub is rate limiting requests. Grant Contents read and write on tasks.'
        : response.status === 404 ? 'The site repository or branch is unavailable. Check the repository names and grant the token access to tasks.'
        : response.status === 409 || response.status === 422 ? 'The vault changed on another device. Reload and try again.'
        : 'GitHub could not save the vault. Try again later.';
      throw Object.assign(new Error(message), { status: response.status });
    }
    return response;
  } catch (error) {
    if (error.status) throw error;
    throw new Error('Could not reach GitHub. Check your connection and try again.');
  } finally { clearTimeout(timer); }
}

async function readRemote(payload) {
  let response;
  try { response = await request(payload, `/contents/vault.json?ref=${encodeURIComponent(payload.site_branch)}`); }
  catch (error) {
    if (error.status !== 404) throw error;
    // GitHub also returns 404 for inaccessible repositories: do not treat that as an empty vault.
    await request(payload, '');
    return null;
  }
  const data = await response.json();
  if (typeof data.sha !== 'string' || typeof data.content !== 'string' || data.encoding !== 'base64') throw new Error('GitHub returned an unreadable vault. No changes were saved.');
  return { sha: data.sha, text: decode(data.content) };
}

async function putRemote(payload, vault, sha) {
  const body = { message: 'Update Tasks vault', content: encode(serialize(vault)), branch: payload.site_branch };
  if (sha) body.sha = sha;
  await request(payload, '/contents/vault.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function publishVault(payload, vault, replace) {
  const remote = await readRemote(payload);
  if (remote && !replace) throw new Error('A vault already exists. Tick “Replace the existing vault” to replace it. Existing passkeys will stop working.');
  await putRemote(payload, vault, remote?.sha);
  return vault;
}

// Apply only this device's slot changes to the latest vault. In particular, an unchanged
// local slot must not resurrect a passkey another device removed in the meantime.
export function mergeVaultSlots(base, changed, remote) {
  for (const vault of [base, changed, remote]) validateVault(vault);
  if (base.vault_id !== changed.vault_id || base.vault_id !== remote.vault_id || !same(base.payload, remote.payload) || !same(base.payload, changed.payload)) {
    throw new Error('This vault was replaced. Lock and unlock the current vault before changing security settings.');
  }
  const before = new Map(base.slots.map(slot => [slot.id, slot]));
  const after = new Map(changed.slots.map(slot => [slot.id, slot]));
  const result = new Map(remote.slots.map(slot => [slot.id, slot]));
  const oldPassword = base.slots.find(slot => slot.type === 'password');
  const newPassword = changed.slots.find(slot => slot.type === 'password');
  if (!same(oldPassword, newPassword) && !same(oldPassword, remote.slots.find(slot => slot.type === 'password'))) {
    throw new Error('The password changed on another device. Lock and unlock again before changing it.');
  }
  for (const [id, slot] of before) {
    if (!after.has(id)) result.delete(id);
    else if (!same(slot, after.get(id))) {
      if (!same(slot, result.get(id))) throw new Error('This passkey changed on another device. Reload before trying again.');
      result.set(id, after.get(id));
    }
  }
  for (const [id, slot] of after) if (!before.has(id)) {
    if (result.has(id) && !same(result.get(id), slot)) throw new Error('A conflicting passkey was found. Reload before trying again.');
    result.set(id, slot);
  }
  const merged = { ...remote, slots: [...result.values()], updated_at: new Date().toISOString() };
  validateVault(merged);
  return merged;
}

export async function commitVault(payload, base, changed) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await readRemote(payload);
    if (!remote) throw new Error('The vault was deleted. Run setup to create a new vault.');
    let current;
    try { current = JSON.parse(remote.text); validateVault(current); }
    catch { throw new Error('The remote vault is invalid. No changes were saved.'); }
    const merged = mergeVaultSlots(base, changed, current);
    try { await putRemote(payload, merged, remote.sha); return merged; }
    catch (error) { if (attempt || ![409, 422].includes(error.status)) throw error; }
  }
}

export async function fetchPublicVault() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('./vault.json', { cache: 'no-store', signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error();
    const vault = await response.json(); validateVault(vault); return vault;
  } catch { throw new Error('The vault could not be loaded. Check your connection and retry.'); }
  finally { clearTimeout(timer); }
}
