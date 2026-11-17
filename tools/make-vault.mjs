import { readFile, writeFile } from 'node:fs/promises';
import { createVault, serialize } from '../auth/vault.js';

function singleLine(text) {
  const value = text.replace(/\r?\n$/, '');
  if (!value || /[\r\n]/.test(value)) throw new Error();
  return value;
}

function tokenValue(text, key) {
  if (!key) return singleLine(text);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error();
  const matches = text.split(/\r?\n/).filter(line => line.startsWith(`${key}=`));
  if (matches.length !== 1) throw new Error();
  return singleLine(matches[0].slice(key.length + 1));
}

let created;
try {
  const output = process.argv[2];
  const { TOKEN_FILE, TOKEN_KEY, PASSWORD_FILE } = process.env;
  if (!output || process.argv.length !== 3 || !TOKEN_FILE || !PASSWORD_FILE) throw new Error();
  const token = tokenValue(await readFile(TOKEN_FILE, 'utf8'), TOKEN_KEY);
  const password = singleLine(await readFile(PASSWORD_FILE, 'utf8'));
  created = await createVault({
    token, owner: 'TunaIssaCoding', repo: 'tasks-data', path: 'tasks.json',
    branch: 'main', site_repo: 'tasks', site_branch: 'main',
  }, password);
  await writeFile(output, `${serialize(created.vault)}\n`, { mode: 0o600 });
  process.stdout.write(`ok slots=${created.vault.slots.length} vault_id=${created.vault.vault_id}\n`);
} catch {
  process.stderr.write('error: vault creation failed. Check input files and output path.\n');
  process.exitCode = 1;
} finally {
  created?.dek.fill(0);
}
