import { createVault, unlockWithPassword, addPasskeySlot, removeSlot, changePassword } from './vault.js';
import { passkeysAvailable, registerPasskey, unlockPasskey, defaultPasskeyLabel } from './passkey.js';
import { saveRemembered, loadRemembered, deleteRemembered } from './session.js';
import { fetchPublicVault, publishVault, commitVault } from './vault-api.js';

const $ = selector => document.querySelector(selector);
const PASSWORD_ERROR = 'That password did not unlock Tasks.';
const SAVED = 'Vault saved. GitHub Pages may take a minute to publish it; this device is already unlocked.';

function strength(password) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter(pattern => pattern.test(password)).length;
  let score = password.length * (classes + 1);
  if (/(password|qwerty|letmein|1234|abcd)/i.test(password)) score *= .35;
  if (/(.)\1{2,}/.test(password) || /^(.{1,6})\1+$/.test(password)) score *= .35;
  if (new Set(password).size < 6) score *= .5;
  return password.length < 12 || score < 35 ? 'Weak' : score < 55 ? 'Fair' : score < 85 ? 'Strong' : 'Very strong';
}
function passwordRules(password, confirm) {
  if (password.length < 12) throw new Error('Use a password of at least 12 characters. Try 4 or 5 random words.');
  if (password !== confirm) throw new Error('The passwords do not match.');
}
function clearInputs(...ids) { for (const id of ids) $(id).value = ''; }

async function checkPrivateRepository(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(payload.owner)}/${encodeURIComponent(payload.repo)}`, {
      cache: 'no-store', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${payload.token}` },
    });
    if (!response.ok) throw new Error('The token cannot access the data repository. Grant Contents read and write on tasks-data.');
    const repository = await response.json();
    if (repository.private !== true) throw new Error('The tasks data repository must be private.');
    if (repository.permissions?.push === false) throw new Error('The token needs Contents read and write on tasks-data.');
    return repository;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Could not reach GitHub. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); }
}

export class VaultAccess {
  constructor({ connect, disconnect, notify }) {
    this.connect = connect; this.disconnect = disconnect; this.notify = notify;
    this.session = null; this.vault = null; this.remember = false; this.busy = false; this.generation = 0;
    this.manual = false; this.vaultMissing = false;
    $('#unlock-form').addEventListener('submit', event => { event.preventDefault(); void this.unlock(false); });
    $('#unlock-passkey').addEventListener('click', () => { void this.unlock(true); });
    $('#unlock-retry').addEventListener('click', () => { void this.start(); });
    $('#setup-form').addEventListener('submit', event => { event.preventDefault(); void this.setup(); });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-tasks-lock]')) void this.lock();
      if (event.target.closest('[data-tasks-settings]') && !this.busy) {
        this.renderSecurity();
        $('#advanced-connection').hidden = !this.vaultMissing;
        $('#settings-dialog').showModal();
      }
    });
    $('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
    $('#settings-form').addEventListener('submit', event => { event.preventDefault(); void this.connectManual(); });
    $('#add-passkey').addEventListener('click', () => { void this.addPasskey(); });
    $('#change-password').addEventListener('submit', event => { event.preventDefault(); void this.changePassword(); });
    for (const [input, hint] of [['#setup-password', '#setup-strength'], ['#new-password', '#password-strength']]) {
      $(input).addEventListener('input', () => { $(hint).textContent = `${strength($(input).value)} · Use 4 or 5 random words.`; });
    }
    $('#setup-back').addEventListener('click', event => { event.preventDefault(); history.replaceState(null, '', location.pathname + location.search); void this.start(); });
    $('#settings-setup').addEventListener('click', event => {
      event.preventDefault(); $('#settings-dialog').close();
      if (location.hash !== '#setup') history.pushState(null, '', '#setup');
      void this.openSetup();
    });
    window.addEventListener('hashchange', () => { if (location.hash === '#setup') void this.openSetup(); });
    $('#settings-dialog').addEventListener('close', () => clearInputs('#current-password', '#new-password', '#confirm-password', '#advanced-token'));
  }
  get unlocked() { return Boolean(this.session); }
  get blocked() { return document.body.classList.contains('auth-blocked'); }
  message(error, fallback = 'The operation could not be completed. Please try again.') {
    let message = error instanceof Error ? error.message : fallback;
    if (message === PASSWORD_ERROR) return PASSWORD_ERROR;
    // Never show an accidentally echoed credential, including errors from a browser API.
    for (const secret of [this.session?.payload.token, ...[...document.querySelectorAll('input[type="password"]')].map(input => input.value)]) {
      if (secret) message = message.split(secret).join('[redacted]');
    }
    return message || fallback;
  }
  show(screen) {
    $('#lock-screen').hidden = screen !== 'lock'; $('#setup-screen').hidden = screen !== 'setup';
    document.body.classList.toggle('auth-blocked', Boolean(screen));
    $('#app').inert = Boolean(screen);
    if (screen) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    $('#security-section').hidden = !this.unlocked;
    $('#advanced-connection').hidden = !this.vaultMissing;
  }
  async showLock(message = '') {
    this.show('lock'); $('#unlock-error').textContent = message;
    $('#unlock-submit').disabled = !this.vault; $('#unlock-password').disabled = !this.vault;
    $('#unlock-retry').hidden = !message;
    $('#unlock-passkey').hidden = true;
    const vault = this.vault;
    if (vault && await passkeysAvailable(vault) && this.blocked && !$('#lock-screen').hidden && this.vault === vault) $('#unlock-passkey').hidden = false;
  }
  async start() {
    if (this.busy) return;
    const generation = ++this.generation;
    this.busy = true;
    await this.showLock('Loading vault…');
    let restored;
    try {
      restored = location.hash === '#setup' ? null : await loadRemembered();
      let vault;
      try { vault = await fetchPublicVault(); }
      catch (error) {
        if (!restored) throw error;
        vault = restored.vault; // Offline use of an encrypted remembered session.
      }
      if (generation !== this.generation) { restored?.dek.fill(0); return; }
      // A new vault can take a minute to reach Pages; 404 is not a replacement.
      if (!vault && restored) vault = restored.vault;
      this.vault = vault; this.vaultMissing = vault === null;
      if (restored && restored.vault.vault_id !== vault.vault_id) {
        restored.dek.fill(0); restored = null;
        await deleteRemembered();
      }
      if (location.hash === '#setup') this.show('setup');
      else if (restored) {
        // Never roll a just-saved security edit back to an older Pages publication.
        if (vault.updated_at >= restored.vault.updated_at) restored.vault = vault;
        await this.accept(restored, true);
      } else if (vault) await this.showLock();
      else this.show('setup');
    } catch (error) {
      if (generation === this.generation) await this.showLock(this.message(error));
    } finally { this.busy = false; }
  }
  async persistRemembered() {
    try {
      if (this.remember && this.session) await saveRemembered(this.session);
      else await deleteRemembered();
    } catch {
      this.remember = false;
      try { await deleteRemembered(); } catch { /* Browser storage may be disabled. */ }
      this.notify('This browser could not remember the device. You will need to unlock after reloading.');
    }
  }
  async accept(result, remember) {
    // A successful unlock must not leave a legacy credential in localStorage.
    try {
      const cfg = JSON.parse(localStorage.getItem('tasks.cfg') || '{}');
      delete cfg.token;
      localStorage.setItem('tasks.cfg', JSON.stringify(cfg));
    } catch {
      localStorage.removeItem('tasks.cfg');
    }
    try { await this.connect(result.payload); }
    catch (error) { result.dek.fill(0); throw error; }
    this.vault = result.vault; this.session = result; this.remember = remember;
    this.manual = false; this.vaultMissing = false;
    await this.persistRemembered();
    this.renderSecurity(); this.show(null);
    history.replaceState(null, '', location.pathname + location.search);
  }
  setBusy(value, area, label) {
    this.busy = value;
    $(area).setAttribute('aria-busy', String(value));
    $(area).querySelectorAll('button,input').forEach(control => { control.disabled = value; });
    document.querySelectorAll('[data-tasks-lock]').forEach(button => { button.disabled = value; });
    if (label) label.element.textContent = value ? label.busy : label.normal;
  }
  async unlock(passkey) {
    if (this.busy || !this.vault) return;
    const label = { element: $('#unlock-submit'), normal: 'Unlock', busy: 'Unlocking…' };
    this.setBusy(true, '#lock-screen', label); $('#unlock-error').textContent = '';
    try {
      const result = passkey ? await unlockPasskey(this.vault) : await unlockWithPassword(this.vault, $('#unlock-password').value);
      await this.accept({ ...result, vault: this.vault }, $('#unlock-remember').checked);
    } catch (error) { $('#unlock-error').textContent = this.message(error); }
    finally { clearInputs('#unlock-password'); this.setBusy(false, '#lock-screen', label); }
  }
  async setup() {
    if (this.busy) return;
    const label = { element: $('#setup-submit'), normal: 'Create vault and unlock', busy: 'Encrypting and saving…' };
    this.setBusy(true, '#setup-screen', label); $('#setup-error').textContent = ''; $('#setup-status').textContent = '';
    let created;
    try {
      passwordRules($('#setup-password').value, $('#setup-confirm').value);
      if (this.vault && !$('#setup-replace').checked) throw new Error('A vault already exists. Tick “Replace the existing vault” to replace it. Existing passkeys will stop working.');
      const payload = {
        token: $('#setup-token').value.trim(), owner: $('#setup-owner').value.trim(), repo: $('#setup-repo').value.trim(), path: $('#setup-path').value.trim(), branch: $('#setup-branch').value.trim(),
        site_repo: $('#setup-site-repo').value.trim(), site_branch: $('#setup-site-branch').value.trim(),
      };
      if (!payload.token) throw new Error('Enter the GitHub access token.');
      await checkPrivateRepository(payload);
      created = await createVault(payload, $('#setup-password').value);
      await publishVault(payload, created.vault, $('#setup-replace').checked);
      await this.accept(created, $('#setup-remember').checked);
      clearInputs('#setup-token');
      $('#setup-status').textContent = SAVED; this.notify(SAVED);
    } catch (error) { $('#setup-error').textContent = this.message(error); if (created && created !== this.session) created.dek.fill(0); }
    finally { clearInputs('#setup-token', '#setup-password', '#setup-confirm'); this.setBusy(false, '#setup-screen', label); }
  }
  async openSetup() {
    if (this.busy) return;
    if ((this.session || this.manual) && !await this.lock()) return;
    ++this.generation;
    this.show('setup');
  }
  async connectManual() {
    if (this.busy || !this.vaultMissing) return;
    this.setBusy(true, '#advanced-connection');
    $('#connection-result').textContent = '';
    try {
      // Recheck immediately before using the fallback; it is forbidden once a vault exists.
      if (await fetchPublicVault()) {
        this.vaultMissing = false;
        $('#advanced-connection').hidden = true;
        throw new Error('A vault now exists. Reload and unlock it instead.');
      }
      const payload = {
        token: $('#advanced-token').value.trim(), owner: 'TunaIssaCoding', repo: 'tasks-data',
        path: 'tasks.json', branch: 'main', site_repo: 'tasks', site_branch: 'main',
      };
      await checkPrivateRepository(payload);
      await deleteRemembered().catch(() => {});
      await this.connect(payload);
      this.manual = true;
      $('#settings-dialog').close();
      this.show(null);
      history.replaceState(null, '', location.pathname + location.search);
    } catch (error) { $('#connection-result').textContent = this.message(error); }
    finally { clearInputs('#advanced-token'); this.setBusy(false, '#advanced-connection'); }
  }
  async lock(message = '', nextVault = this.vault) {
    if (this.busy) return false;
    ++this.generation; this.busy = true;
    document.querySelectorAll('[data-tasks-lock]').forEach(button => { button.disabled = true; button.textContent = 'Locking…'; });
    $('#app').inert = true;
    try { await this.disconnect(); }
    catch (error) {
      this.busy = false; $('#app').inert = false;
      document.querySelectorAll('[data-tasks-lock]').forEach(button => { button.disabled = false; button.textContent = 'Lock'; });
      this.notify(this.message(error));
      return false;
    }
    this.notify('');
    try { await deleteRemembered(); }
    catch { this.notify('Device storage could not be cleared. Clear this site’s browser data before leaving a shared device.'); }
    if (this.session) { this.session.dek.fill(0); this.session.payload.token = ''; }
    this.session = null; this.manual = false; this.remember = false; this.vault = nextVault;
    clearInputs('#unlock-password', '#current-password', '#new-password', '#confirm-password', '#setup-token', '#setup-password', '#setup-confirm', '#advanced-token');
    $('#passkey-list').replaceChildren(); $('#security-status').textContent = '';
    this.setBusy(false, '#security-section');
    await this.showLock(message);
    return true;
  }
  renderSecurity() {
    $('#security-section').hidden = !this.session;
    if (!this.session) return;
    $('#passkey-label').value ||= defaultPasskeyLabel();
    const list = $('#passkey-list'); list.replaceChildren();
    for (const slot of this.vault.slots.filter(slot => slot.type === 'passkey')) {
      const row = document.createElement('li'), label = document.createElement('span'), remove = document.createElement('button');
      label.textContent = `${slot.label} · ${new Date(slot.created_at).toLocaleDateString()}`;
      remove.textContent = 'Remove'; remove.type = 'button'; remove.dataset.slotId = slot.id;
      remove.addEventListener('click', () => { if (confirm('Remove this passkey? It will no longer unlock this board.')) void this.securityChange(() => removeSlot(this.vault, slot.id)); });
      row.append(label, remove); list.append(row);
    }
  }
  async securityChange(makeVault) {
    if (this.busy || !this.session?.dek) return;
    const generation = this.generation, base = this.vault, session = this.session;
    this.setBusy(true, '#security-section'); $('#security-status').textContent = 'Updating security…';
    try {
      const changed = await makeVault(base, session);
      if (generation !== this.generation) return;
      const updated = await commitVault(session.payload, base, changed);
      if (generation !== this.generation) return;
      this.vault = updated; this.session.vault = updated;
      await this.persistRemembered();
      if (generation !== this.generation) return;
      this.renderSecurity(); $('#security-status').textContent = 'Security updated. GitHub Pages may take a minute to publish the change.';
    } catch (error) { if (generation === this.generation) $('#security-status').textContent = this.message(error); }
    finally {
      if (generation === this.generation) {
        this.setBusy(false, '#security-section'); clearInputs('#current-password', '#new-password', '#confirm-password');
      }
    }
  }
  async addPasskey() {
    await this.securityChange(async (base, session) => {
      const registration = await registerPasskey(message => { $('#security-status').textContent = message; });
      try { return await addPasskeySlot(base, session.dek, { ...registration, label: $('#passkey-label').value.trim() || defaultPasskeyLabel() }); }
      finally { registration.prfOutput.fill(0); }
    });
  }
  async changePassword() {
    await this.securityChange(async base => {
      const password = $('#new-password').value;
      passwordRules(password, $('#confirm-password').value);
      const verified = await unlockWithPassword(base, $('#current-password').value);
      try { return await changePassword(base, verified.dek, password); }
      finally { verified.dek.fill(0); }
    });
  }
}
