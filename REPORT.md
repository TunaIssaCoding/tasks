# Boards v2 — Phase 1 report

## What changed

- Removed self-owner pills; retained chasing/waiting pills. Task IDs are small, grey, monospace, right-aligned buttons that copy `#id`, with a legacy clipboard fallback and a toast.
- Added muted room prefixes before titles and room search. Empty sections disappear while search or owner filtering is active.
- Added relative sync text, an exact-time tooltip and a 30-second refresh. Kept Sync now.
- Separated Delete visually at the right of row actions. Delete runs immediately; its six-second Undo restores all original task fields, including ID and optional fields, then advances `updatedAt` and sets the current writer for LWW.
- Replaced title, note, trigger and hide-until prompts with expanded-row editors. Enter/blur saves; Escape cancels; Shift+Enter adds a note line. Existing field semantics and invalid-calendar-date validation remain.
- Added Undo-capable toasts, including demo reset. Expiration clears the Undo callback. Hidden-date expiry remains presentation-only: it does not automatically rewrite tasks. Sync acknowledgements and collision ID remaps are not undoable because reversing them would violate the existing merge protocol.
- Removed the context-menu listener and row CSS that suppressed native text selection/callouts. Existing row actions and drag/move controls remain.
- Added the top-right View / Settings / Help menu and keyboard help. Added visible-row j/k navigation, Enter expansion, search focus with /, Help with ?, and Escape dismissal. Board shortcuts ignore typing, modal settings and locked/setup screens.
- Reordered the lock controls and moved setup/replacement links into collapsed Other options. Replacement has a separate #replace route/screen state requiring exact REPLACE text plus the existing explicit checkbox; normal setup cannot authorize replacement. Existing repository checks and SHA publishing safeguards remain.
- Replaced passkey removal confirmation with a five-second inline two-click action. The second click applies the security operation immediately; stale session/dialog controls cannot remove a key.
- Reordered Settings as Security, Connection, then collapsed Advanced token connection.
- Added #demo with 20 fictional schema 2 tasks, the required banner, local editing/persistence, Reset demo with Undo, and local-only Settings. Demo uses only tasks-demo: localStorage keys, bypasses auth and IndexedDB, does not register a worker, and makes no application fetch calls. Sync is a no-op labelled Demo · not synced. Lock and Leave demo navigate to ./.
- Bumped the public shell cache to tasks-shell-v13, bumped existing versioned page assets to ?v=13, and precached demo-fixtures.js?v=13.
- Added Phase 1 regressions and updated the worker eviction regression for the new cache generation.
- Updated README usage and security instructions.

Schema 2 read/write, task fields, section picker, hidden checkbox, existing owner filters, LWW comparison on (updatedAt, deviceId), and new-task collision remapping at IDs >= 5000 remain intact. No schema migration or new task-model fields were introduced. Existing document-level modification timestamps still advance when edits are saved. CSP and vault cryptography/storage modules were not changed. app.js additions retain var/function syntax; existing async lifecycle functions remain as before.

## Files touched

- README.md
- REPORT.md
- app.js
- styles.css
- index.html
- sw.js
- demo-fixtures.js (new)
- auth/auth.js
- auth/boot.js
- auth/lock.css
- tests/phase1.test.mjs (new)
- tests/sw.test.mjs

## Test result

Command:

```sh
node --test --test-timeout=15000 tests/*.test.mjs
```

Final run, pasted summary:

```text
ℹ tests 44
ℹ suites 0
ℹ pass 44
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1621.21696
```

The suite includes the pre-existing lock failure, late-sync cancellation, encrypted pending-cache, vault, passkey, concurrent security-merge, CLI and private-resource worker tests. The Phase 1 schema round trip fetches a synthetic schema 2 document, renders it, edits a note through the inline editor, and inspects the saved PUT document; unrelated fields, nested task data and sections are preserved.

Separate source searches returned no matches for `\b(prompt|confirm|alert)\s*\(` or `contextmenu` in app.js and auth/*.js.

## Offline browser smoke

Used installed Chrome with local shell files supplied through request interception and synthetic vault/API responses. No real GitHub requests, tokens or live vault operations were used. No installs, commits or pushes were performed.

Observed:

- Desktop and narrow/mobile layouts, with room prefixes, absent self-owner pills, grey right-aligned IDs, visible open count, and right-aligned red Delete.
- Title and trigger edits, note cancellation, invalid-date rejection, room-prefixed add, ticking a new task, search filtering down to one nonempty section, and keyboard input suppression.
- j/Enter row navigation and ?/Escape Help interaction; local-only demo Settings.
- Delete/Undo restoring the task; six-second Undo expiry leaving the deletion in place.
- ID copying through both Clipboard API and the legacy fallback, each reporting Copied #5000; a cancelable contextmenu event was not prevented.
- Demo edits persisted across reload; only tasks-demo: keys were present. Reset restored 20 fixtures, and Undo restored the prior edited 21-task board. Demo page requests were public shell assets only, not vault/auth implementation/data API requests.
- Relative sync changed from Synced just now to Synced 3 min ago when the clock advanced and the captured 30-second refresh callback ran; the exact-time tooltip stayed unchanged.
- Password unlock and successful Lock removed the board. Passkey first-click arming expired after five seconds with zero security PUTs; rearming and clicking again produced exactly one security PUT and removed the passkey.
- Replacement with lowercase replace was rejected with Type REPLACE exactly to replace the vault.; the application fetch count did not change.

Verification limits: no physical old iPad/Safari or real hardware passkey ceremony was available. Chrome layout checks and the existing mocked WebAuthn/real WebCrypto tests are not a substitute for those device checks. Browser automation reused a Chromium target across named handles; sequential checks were completed on the observed app surface, and the tooling issue was reported.

## Brief: “Tests to add” coverage and deferrals

- Schema 2 file -> renders -> saves as schema 2 unchanged apart from edits: covered in tests/phase1.test.mjs, including preservation of unrelated nested fields and sections.
- Schema 3 round trip and whoSince changing only with who: deferred to Tasks Phase 2.1; no schema 3 editor/model exists in this release.
- Inbox accept/edit/dismiss decision writes and exactly-one-task acceptance: deferred to Tasks Phase 3.1.
- Reading old-status migration, including manual Commented: deferred to Reading Phase 2.1; outside this Tasks repository.
- Reading 90% auto-finish with Undo restoring reading: deferred to Reading Phase 2.1. Tasks delete Undo is covered separately now.
- Reading Arrivals/pile split at arrivals_since: deferred to Reading Phase 3.1.
- Reading Up next cap of 10: deferred to Reading Phase 3.1.
- Stale Reading bot box when notes are newer: deferred to Reading Phase 2.1.
- No prompt/confirm/alert calls: covered for app.js and every auth/*.js file by the Phase 1 test and the separate source search.

Additional requested Phase 1 coverage: demo fixture schema/unique IDs/fictional-name denylist, demo storage/network/auth isolation, exact delete restoration apart from required merge bookkeeping, editor cancellation/date validation/no-op behavior, input/lock shortcut suppression, absence of a contextmenu listener, and every index script/link reference being precached.

## Scope and omissions

No requested Phase 1 feature was intentionally skipped. Phase 2.1's new schema/editor/grouping/filter/tab model and removal of the section picker/hidden checkbox were not built. Phase 3.1 Inbox and Phase 5 Listen were not built. Reading-only work and deployment/commit instructions in the broader brief were not executed: this task is limited to the current Tasks snapshot and explicitly forbids commits/pushes/network work.
