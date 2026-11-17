# Tasks
Static PWA. Tasks remain in the private `TunaIssaCoding/tasks-data` repository, `tasks.json` (schema 2). The public site contains only the app shell and, after setup, an encrypted `vault.json`.

## Unlock and setup

Open the board and unlock with a passkey or the password backup. “Remember this device” is checked by default: only use it in a trusted browser profile. The token is held in memory and, when remembered, in an encrypted IndexedDB record—not plaintext localStorage or sessionStorage.

Open `./#setup` to create the vault with a fine-grained GitHub token and a password of at least 12 characters; prefer 4 or 5 random words. Grant Contents read/write on **tasks-data** and **tasks**. Setup verifies that the data repository is private and commits the encrypted vault to `tasks/vault.json` on `main`. Replacement requires the explicit checkbox and invalidates existing passkeys. GitHub Pages publication can lag behind the commit.

Settings → Security adds/removes passkeys and changes the password after checking the current password. When no vault exists, Settings also offers **Advanced: connect with a token**, which is memory-only and lasts until Lock or reload.

Lock gives sync at most 1.5 seconds, cancels stale requests, encrypts the local task document and merge baseline, then removes plaintext caches and task UI. Offline edits return after the next unlock and merge through the existing SHA-aware Contents API sync. If encrypted storage fails while edits need preservation, Lock is refused and the board stays unlocked; do not leave a shared device until Lock succeeds. Legacy caches are encrypted before the login flow starts.

## Generate a vault locally

Node 24, no dependencies or build step:

```sh
TOKEN_FILE=/secure/token-input PASSWORD_FILE=/secure/password-input \
  node tools/make-vault.mjs vault.json
```

The token input is a raw single line. For `KEY=value` input, also set `TOKEN_KEY` to the desired key name. The password input is a raw single line. Do not put credentials in command arguments, this repository, or shell history. The script prints only `ok slots=N vault_id=...`; failures are sanitized. The output is encrypted, but a weak password remains vulnerable to offline guessing. No production vault is included in this change.

## Verification

```sh
node --test --test-timeout=15000 tests/*.test.mjs
```

Tests use synthetic inputs and mocked GitHub; no installs or real API calls. See [out/CHANGES.md](out/CHANGES.md) for implementation details, real test results, browser smoke coverage, and security limits.
