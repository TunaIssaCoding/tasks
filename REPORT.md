- Phase: Boards v2 / Tasks 3.1 — Inbox. Implemented in place. No commit, push, install, live-data request, or data migration. No secret files read. All repository edits are inside this snapshot.
- UI changes:
  - Added Inbox (n) before Tasks / Ideas / Done this week; Tasks remains the default. The title is `(n) Tasks`, or `Tasks` at zero. Counts include undecided supported proposals, including missing targets that can still be dismissed; unknown future proposal types are not actionable.
  - Added dashed bot cards with a square mark, source.bot, relative creation time, source.label, italic quoted text with a left rule, and the suggestion. The supplied `no quote` label remains unchanged. All bot text is escaped.
  - Add cards offer Accept to the suggested When, Today / Next / Later, Edit and Dismiss. The draft editor uses segmented who/when controls, name/date/event inputs, room and text; edits do not alter proposals. Accept records edited when the accepted fields differ. Opening and accepting unchanged stays accepted; Cancel/Escape discards the draft.
  - Change cards show per-field from/to differences, Apply change and Keep mine. Close cards show the target title, Close it and Keep open. Missing/deleted targets show the missing task ID and Dismiss only.
  - Added Inbox j/k/a/e/d keys and Help text. Inputs, editors, contenteditable fields and lock screens suppress shortcuts.
  - Task-editor provenance resolves acceptedFrom to the Inbox source bot, creation date and label when available, retaining the proposal reference and existing fallback metadata.
- Data and decisions:
  - Fetches inbox.json from the configured task file's sibling directory, same owner/repo/branch. Missing/404 means the specified empty state, no Inbox PUT and no file creation.
  - Stores Inbox, its merge baseline and pending Undo bookkeeping inside the existing tasks.doc cache record. The existing pending-cache encryption protects both documents on Lock; Lock clears plaintext storage, in-memory proposals, task UI and the title count. Demo stays in its own namespace.
  - Acceptance reuses the normal native task creation path and IDs >= 5000. Copies text/who/when/room and optional title/note/tags/kind, sets source=inbox and acceptedFrom, and sets schema-3 whoSince. Schema 2 uses legacy mapped fields without migrating or adding who/when/kind/whoSince.
  - Changes use the existing task mutation path, including whoSince only on an actual who change. Schema-3 kind-only proposals do not implicitly change When. Close sets done and doneAt. Dismiss/Keep mine/Keep open only change the proposal decision and do not write tasks.json.
  - Every decision has six-second Undo: remove a newly accepted task, restore changed fields/completion, or reverse dismissal, and clear the matching decision together. Works before and after publication and after native-ID remapping.
- Sync safety:
  - Tasks publish before Inbox decisions. Both use SHA-aware GET/PUT retries; pending task changes prevent premature publication of their decisions.
  - Inbox three-way merge uses the last-synced base, preserves remotely appended proposals and remote non-decision content, respects remote pruning, and keeps remote decisions when both writers decided. Only decision is modified on proposal objects; document updatedAt advances on publication.
  - Self-heals undecided proposals from existing acceptedFrom tasks, including partial task-success/Inbox-failure recovery. Concurrent acceptance adopts the existing remote accepted task instead of creating a second one; decision IDs follow native task-ID remapping.
  - Undo may clear only its matching earlier decision. A later conflicting remote decision remains authoritative.
  - Reproduced and fixed Undo followed immediately by edited re-accept losing the revised text during sync. Re-accept now reuses the original creation where necessary; Undo followed by Dismiss also preserves the task removal. Permanent regression coverage and an offline command smoke confirm the corrected result.
- Demo and shell:
  - Added seven fictional Inbox fixtures: Calls bot add with quote/note/[call notes] tag; open.md importer add; importer Next-to-date change; Work Driver waiting-six-days Dana-to-chase/Today change; importer close; two decided proposals hidden from Inbox.
  - Uses the existing invented Acme Labs / Northwind / Juniper Co / Studio and Dana / Priya / Sam setting. Reset demo and its Undo handle both documents.
  - Demo storage bumped to tasks-demo:v3:. Demo still makes no data requests, opens no vault/IndexedDB, registers no worker and touches no real-board storage.
  - Worker cache is tasks-shell-v15; page assets use ?v=15; all page assets remain precached.
  - app.js retains var/function syntax, with existing async functions. CSP and auth modules are unchanged. No native prompt/confirm/alert or custom context menu was added.
- Files touched:
  - app.js
  - demo-fixtures.js
  - index.html
  - styles.css
  - sw.js
  - tests/dom-harness.mjs
  - tests/app.test.mjs
  - tests/phase1.test.mjs
  - tests/phase31.test.mjs (new)
  - README.md
  - REPORT.md (replaced)
- Existing-test adaptations:
  - DOM harness now models independent task/Inbox files, Inbox SHA conflicts/failures, request ordering and bounded retry-timer advancement.
  - Existing app-test network mocks return Inbox 404 without disturbing their task transport scenarios.
  - Existing demo namespace assertions use v3. Existing schema-2/schema-3, auth/vault, offline-cache and worker tests continue to pass.
- Test command: `node --test --test-timeout=15000 tests/*.test.mjs`
- Final output, pasted:
  ```text
  ℹ tests 87
  ℹ suites 0
  ℹ pass 87
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 1566.178716
  ```
- Phase-3.1 regression coverage:
  - Accept/edit/dismiss, proposal-field immutability, exactly-one-task acceptance, native IDs, tags/note copying, changed vs unchanged drafts, and task-before-Inbox publication order.
  - Change diffs including text/kind/note, whoSince invariants, Keep mine, close/Keep open, missing/deleted targets, and Undo for all decision types.
  - 404 empty state/no creation, exact title/count behavior, remote append/prune/decision precedence, SHA conflict retry, self-heal and partial publication recovery, concurrent acceptance deduplication, ID-remap Undo and rapid reconsideration.
  - Keyboard/input suppression, schema-2 legacy writes, fictional demo fixtures/decided hiding/isolation/reset, Lock clearing/restoring queued decisions and baselines, and nested task paths with non-default repository/branch.
- Runtime smoke, real local Chromium with page assets fulfilled from local files and other requests blocked:
  - Observed five Inbox cards, two hidden decided fixtures, bot attribution/quotes, diffs, suggested acceptance labels, tab count and title.
  - Accepted the Calls bot suggestion: exactly one task appeared with acceptedFrom, note and [call notes]. Undo removed it and restored Inbox (5). Edited text, who, when and room before accepting; observed result=edited and the expected task fields.
  - Opened the accepted task editor and observed `Proposed by Calls bot · Tue, Nov 24 · call notes · Reference: p-demo-call-checklist`.
  - Applied the Work Driver change and observed chase:Dana, When Today and updated whoSince; exercised Undo. Closed the target task and observed done/doneAt plus its accepted decision; exercised Undo. Dismissed an importer change and observed the count decrease.
  - Captured the desktop cards and the 390x844 editor surface. The mobile editor was fixed to the bottom, with segmented controls and editable fields visible; no horizontal content overflow was observed.
  - Exercised j/e, typing suppression, Escape and d on the refreshed app. Observed only tasks-demo:v3: application storage keys.
  - No application exception was reported. Browser tooling produced blocked extension-injection requests and unexpected blocked localhost navigation; reloaded the locally intercepted page and continued verification. Browser tab was closed afterward.
  - Offline publication smoke before the rapid-reaccept fix returned the old text and accepted result; after the fix it returned one task with `Revised paper moon` and result=edited.
- Brief “Tests to add” status:
  - Schema 2 rendering/write-back without migration: covered by existing phase1/phase21 tests and new Inbox schema-2 coverage.
  - Schema 3 round-trip and whoSince only on who changes: covered by phase21 and Inbox change tests.
  - Inbox accept/edit/dismiss decision-only proposal writes and exactly-one-task acceptance: covered now in phase31.
  - Native prompt/confirm/alert prohibition: existing app/auth coverage still passes.
  - Reading old-status migration including manual Commented, 90% auto-finish/Undo, Arrivals/pile split, Up next cap of ten, and stale bot-box detection: deferred to the separate Reading application; outside this Tasks phase.
- Skipped and limits:
  - No requested Tasks phase-3.1 feature intentionally skipped. No Reading, Listen, bot proposal generation, data migration or G6 scheduling/settings UI; the requested Work Driver change card is rendered normally.
  - No live GitHub calls, deployment, commit or push, per instructions. GitHub behavior was exercised with isolated mocks, not a real repository.
  - Physical old-iPad Safari and touch hardware were unavailable. ES5-style app code and Chromium desktop/mobile checks do not substitute for physical-device verification.
