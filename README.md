# Tasks
Static PWA. Tasks remain in the private `TunaIssaCoding/tasks-data` repository, `tasks.json`. The app reads and writes schema 2 or schema 3 without migrating the document. The public site contains only the app shell and, after setup, an encrypted `vault.json`.

## Unlock and setup

Open the board and unlock with a passkey or the password backup. “Remember this device” is checked by default: only use it in a trusted browser profile. The token is held in memory and, when remembered, in an encrypted IndexedDB record—not plaintext localStorage or sessionStorage.

Open `./#setup` to create the vault with a fine-grained GitHub token and a password of at least 12 characters; prefer 4 or 5 random words. Grant Contents read/write on **tasks-data** and **tasks**. Setup verifies that the data repository is private and commits the encrypted vault to `tasks/vault.json` on `main`. The lock screen's collapsed **Other options** links to setup and the separate `./#replace` screen. Replacement requires typing `REPLACE` exactly and checking the explicit replacement checkbox; existing passkeys stop working. GitHub Pages publication can lag behind the commit.

Settings → Security adds/removes passkeys and changes the password after checking the current password. When no vault exists, Settings also offers **Advanced: connect with a token**, which is memory-only and lasts until Lock or reload.

Settings lists Security, then Connection, then the collapsed token fallback. Removing a passkey requires two clicks within five seconds; the second click applies the security change immediately.

Lock gives sync at most 1.5 seconds, cancels stale requests, encrypts the task document with its merge baseline and pending Undo state, then removes plaintext caches and task UI. Offline edits return after the next unlock and merge through the SHA-aware Contents API sync. If encrypted storage fails while edits need preservation, Lock is refused and the board stays unlocked; do not leave a shared device until Lock succeeds. Legacy caches are encrypted before the login flow starts.

## Board controls and demo

Tabs are **Tasks** (the default), **Ideas**, and **Done this week**. Add always creates a task for **Me / Today**; `Room: task` prefixes set its room. Filter tasks by Everyone, My move, Chasing, Waiting, Stale, or a room. Tasks group into Today, Next, After an event, Later, and On a date. Arrived dates appear in Today without changing stored data. Future dates and After an event start collapsed; an event shared by several tasks is a group, and a one-task event is a plain row tagged “after: …”. Collapse state is remembered locally and protected with the offline cache on Lock.

Click a row to open its autosaving editor, or use the bottom sheet on screens up to 640px wide. Edit who moves next, when, room, title, and note; names, events, and rooms have suggestions. Escape closes the editor without undoing saved changes. Chasing/waiting pills show age, amber from five days and red from ten. Schema 3 uses `whoSince`, changed only when who changes; schema 2 uses `updatedAt`. Grey IDs copy `#id`.

Drag a task onto a When header or named event group to move it. Date/event headers without a specific destination open the editor for a date/name. Ideas have **Make it a task**, which moves them to Later. Done this week starts Monday in local time; unticking restores the task. Delete is immediate with a six-second Undo.

The top-right menu contains View, Settings and Help. Outside inputs, editors and the lock/setup screens: `j`/`k` move the visible-row highlight, Enter expands a task, `/` focuses search, `?` toggles Help, and Escape closes panels. The browser context menu is not intercepted.

Open `./#demo` for 25 fictional schema 3 tasks without unlocking or providing a token. Edits persist under `tasks-demo:v3:` localStorage keys, never in the real board caches or vault. Demo boot skips authentication, IndexedDB, service-worker registration and data requests; sync reports “Demo · not synced”. The menu includes Reset demo with Undo. Lock and Leave demo return to `./`.

Schema 2 edits retain legacy fields and unknown task/document values; schema 3 writes use the new fields and no sections. Task LWW and native ID collision remapping at IDs >= 5000 are unchanged. A clean session adopts a remotely migrated document. If migration occurs while local edits are pending, sync preserves those edits and reports a schema conflict instead of migrating or discarding them; reconcile pending edits before proceeding with migration.

**No Inbox (26 Nov 2026).** Bots add tasks directly with `tasks add`, and the app no longer reads or writes `inbox.json`. A bot-added task can carry `addedBy`, `sourceLabel` and `sourceQuote`; the task editor shows them as a provenance line (“Added by Calls bot · date · call notes”, then the quote). Tasks accepted from the old Inbox keep `acceptedFrom` and show “Accepted from the old Inbox”.

If a device edited offline while the board was still schema 2 and the board has since moved to schema 3, those edits are converted with the migration's rules (who/when/kind, `whenManual` from hand-move flags, trigger names kept as `trigger:` tags) and merge by `updatedAt` as usual.


Listen remains parked. [REPORT.md](REPORT.md) describes the Phase 3.1 Inbox release, which has since been removed.

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

Tests use synthetic inputs and mocked GitHub; no installs or real API calls. See [REPORT.md](REPORT.md) for implementation details, real test results, browser smoke coverage, and verification limits.
