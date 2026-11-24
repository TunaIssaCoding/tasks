# Tasks
Static PWA. Tasks remain in the private `TunaIssaCoding/tasks-data` repository, `tasks.json` (schema 2). The public site contains only the app shell and, after setup, an encrypted `vault.json`.

## Unlock and setup

Open the board and unlock with a passkey or the password backup. “Remember this device” is checked by default: only use it in a trusted browser profile. The token is held in memory and, when remembered, in an encrypted IndexedDB record—not plaintext localStorage or sessionStorage.

Open `./#setup` to create the vault with a fine-grained GitHub token and a password of at least 12 characters; prefer 4 or 5 random words. Grant Contents read/write on **tasks-data** and **tasks**. Setup verifies that the data repository is private and commits the encrypted vault to `tasks/vault.json` on `main`. The lock screen's collapsed **Other options** links to setup and the separate `./#replace` screen. Replacement requires typing `REPLACE` exactly and checking the explicit replacement checkbox; existing passkeys stop working. GitHub Pages publication can lag behind the commit.

Settings → Security adds/removes passkeys and changes the password after checking the current password. When no vault exists, Settings also offers **Advanced: connect with a token**, which is memory-only and lasts until Lock or reload.

Settings lists Security, then Connection, then the collapsed token fallback. Removing a passkey requires two clicks within five seconds; the second click applies the security change immediately.

Lock gives sync at most 1.5 seconds, cancels stale requests, encrypts the local task document and merge baseline, then removes plaintext caches and task UI. Offline edits return after the next unlock and merge through the existing SHA-aware Contents API sync. If encrypted storage fails while edits need preservation, Lock is refused and the board stays unlocked; do not leave a shared device until Lock succeeds. Legacy caches are encrypted before the login flow starts.

## Board controls and demo

The board continues to read and write schema 2, with the existing section picker, owner filters, hidden checkbox, merge rules and native IDs starting at 5000. Rooms appear before titles; only chasing/waiting owners have pills. Click a grey ID to copy `#id`. The header shows relative sync time with an exact-time tooltip; the refresh button still syncs immediately.

Expand a row to edit its title, note, trigger or hide-until value in place. Enter or blur saves; Escape cancels; Shift+Enter inserts a note line. Delete applies immediately, with a six-second Undo that restores the original task fields and advances its merge timestamp.

The top-right menu contains View, Settings and Help. Outside inputs and the lock/setup screens: `j`/`k` move the visible-row highlight, Enter expands it, `/` focuses search, `?` toggles Help, and Escape closes panels. The browser context menu is no longer intercepted.

Open `./#demo` for 20 fictional tasks without unlocking or providing a token. Edits persist under `tasks-demo:` localStorage keys, never in the real board caches or vault. Demo boot skips authentication, IndexedDB, service-worker registration and data requests; sync reports “Demo · not synced”. The menu includes Reset demo with Undo. Lock and Leave demo return to `./`.

This release does not add schema 3, the new editor/grouping model, Inbox, or Listen. See [REPORT.md](REPORT.md) for Phase 1 verification and deferred brief items.

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
