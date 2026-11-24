- Phase: Boards v2 / Tasks 2.1. Implemented in place; no commit, push, install, live-data request, or data migration. Browser verification fulfilled page requests from local files and blocked other requests. No secret files were read.
- Data changes:
  - Added non-mutating who/when/kind/whoSince views with the reference CLI's owner/self-owner, section, hidden-date, hidden-event, unnamed-trigger, and unknown-section mappings. Explicit who/when/kind take precedence.
  - Schema 2 writes retain legacy fields. Who writes use who_to_owner semantics; When writes match apply_when_schema2, including the special triggers-section behavior. Make it a task writes longterm. No schema-3 task fields are added, and a document without a schema property stays that way.
  - Schema 3 writes use who/when/kind/whoSince and omit legacy fields and top-level sections. whoSince changes only when who changes. New tasks use Me / Today in either schema, with native IDs >= 5000 and the existing Room: prefix.
  - Preserved unknown document/task JSON values and sections; edited task and document timestamps advance as before. Fixed nested-field no-op comparison so who/when changes participate correctly in stamping.
  - Kept task LWW comparison on (updatedAt, deviceId), remote wins on exact ties, and native creation-ID remapping. Tombstones remain in storage/merge but not views or suggestions.
  - Clean sessions adopt remotely migrated documents without a write. As in the CLI, pending edits cannot be merged across schema versions: they remain preserved, and sync reports a schema conflict rather than silently migrating or discarding them. Migration should follow flushing/reconciling pending edits.
- UI changes:
  - Tasks / Ideas / Done this week tabs; document title remains Tasks. Header has open count, relative sync, search, menu, Lock, always-visible add, Everyone / My move / Chasing / Waiting filters, and rooms from the data. Removed section picker and hidden checkbox.
  - Tasks group into Today, Next, After an event, Later, and On a date. Arrived dates show a from tag without rewriting data. Future dates retain titles, sort by date, and start collapsed. Event subgroups collapse independently. Date/event collapse state survives reload and Lock through the protected offline cache. Empty groups disappear under filters.
  - Rows retain muted rooms, copyable grey monospace IDs, and detail only when different from title. Chasing/waiting pills show age, amber from five days and red from ten; no Me pill. Schema 2 pill age uses updatedAt.
  - Full autosaving editor: segmented who/when, native date input, name/event/room datalists, title, note, available provenance, separate red Delete with six-second Undo. Narrow screens <= 640px use a bottom sheet. Escape closes; saved changes remain saved.
  - Ideas convert to tasks in Later. Done this week uses a local-time Monday boundary, newest day first, and unticking restores a task.
  - Dragging onto When/event destinations changes when. Generic date/event headers open the editor to obtain the missing date/name instead of inventing one. No DOM rebuild during active drag; editor remains the touch-friendly alternative.
  - Preserved j/k/Enter, /, ?, Escape and input/lock shortcut suppression; no native dialogs or custom context menu. app.js retains var/function syntax. CSP and auth modules are unchanged.
  - Found and fixed unchanged imported long-title truncation on closing the editor; regression preserves the complete imported title.
- Demo and shell:
  - Replaced fixtures with 25 fictional schema 3 tasks: all requested groups, two named events, past/future dates, 2/6/12-day chasing/waiting ages, two ideas, four completions spread across available days this week, Work Driver provenance, and differentiated detail.
  - Demo storage uses tasks-demo:v2:. Existing no-network, no-vault, no-real-storage isolation remains.
  - Worker cache is tasks-shell-v14; versioned page assets use ?v=14. Every page script/link asset is precached.
- Files touched:
  - app.js
  - styles.css
  - index.html
  - demo-fixtures.js
  - sw.js
  - tests/dom-harness.mjs (new)
  - tests/phase21.test.mjs (new)
  - tests/phase1.test.mjs
  - README.md
  - REPORT.md
- Intentional phase-1 test updates:
  - Extracted the existing VM DOM harness for reuse and adapted its action/edit helpers to the full autosaving editor.
  - Demo fixture assertions now require schema 3 instead of schema 2, and use the full fictional-name denylist.
  - Replaced the obsolete hide-editor/cancel contract with date-editor validity, unchanged input/no-op behavior, and dismissal coverage. Escape no longer rolls back changes already autosaved.
  - Retained schema-2 round-trip, deletion Undo, auth/lock, demo isolation, shortcut suppression, native-dialog prohibition, and precache coverage. Existing app, CLI/vault, and worker test files were not changed.
- Test command: `node --test --test-timeout=15000 tests/*.test.mjs`
- Final test output, pasted:
  ```text
  ℹ tests 60
  ℹ suites 0
  ℹ pass 60
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 1599.067342
  ```
- New phase-2.1 coverage includes every requested mapping/write table, schema-2 UI writes and preservation, schema-3 round-trip and whoSince rules, new tasks in either schema, grouping/date/event placement, pills and thresholds, owner/room filters, Done restoration, drag destinations, schema-3 LWW/tombstones/collision remapping, provenance/demo scenarios, schema-less legacy editing, clean migration adoption/pending conflict preservation, and collapse restoration after Lock. Shared phase-1 tests enforce native-dialog/context-menu absence, demo isolation/fictional IDs, and all page assets in precache.
- Real Chromium smoke, using local files with request interception and no live API:
  - Observed desktop groups, room prefixes, distinct detail, normal/amber/red pills, collapsed future dates, and provenance.
  - Changed note, who, and when through the real editor and observed saved schema-3 values. Exercised owner and room filters, Ideas conversion, Done grouping/untick, Room-prefixed add, search, and Delete/Undo.
  - Dragged a real row into Next with mouse events; observed drag active with the original row still attached, then when: next afterward.
  - Captured the 390x844 surface: editor position fixed, bottom aligned, with all controls and Delete visible in the bottom sheet. The browser tool reset viewport settings between calls; the mobile check set the viewport and captured the surface in one call.
  - Loaded a synthetic schema-2 document in isolated demo storage. Opening/closing its long title preserved it exactly. Note/who/when editing produced owner: waiting:Dana, section: followups, sectionManual: true, hidden: false, while preserving sections and custom values and adding no schema-3 fields.
  - Exercised j/Enter/Escape editor navigation. Observed only tasks-demo:v2: application storage keys. Browser application errors were absent; blocked browser-extension injection requests were the only recorded request errors.
- Brief “Tests to add” status:
  - Schema 2 renders and saves unchanged apart from edits: covered now in phase1 and phase21 tests.
  - Schema 3 round trip and whoSince only on who changes: covered now in phase21 tests.
  - Inbox accept/edit/dismiss decision writes and exactly-one-task acceptance: deferred to Tasks phase 3.1.
  - Reading old-status migration, including manual Commented: deferred to Reading phase 2.1, outside this Tasks repository.
  - Reading 90% auto-finish and Undo restoring reading: deferred to Reading phase 2.1.
  - Reading Arrivals/pile split: deferred to Reading phase 3.1.
  - Reading Up next cap of ten: deferred to Reading phase 3.1.
  - Stale Reading bot box when notes are newer: deferred to the Reading bot-box implementation (G2/phase 4 in the Grokbot handoff; frontend release table lists it under 2.1). Outside this Tasks scope; handoffs disagree on that Reading release number.
  - No prompt/confirm/alert calls: covered now for app.js and every auth/*.js file.
- Limits and intentional exclusions:
  - No Inbox tab/cards, inbox.json reads, Listen, or data migration, as requested. No requested Tasks phase-2.1 feature was otherwise intentionally omitted.
  - acceptedFrom is a proposal-ID string in the data contract, not source metadata. Provenance shows source/date/tags available on the task plus its reference; absent metadata is not fabricated or fetched from Inbox. The demo supplies Work Driver and call notes.
  - Physical old-iPad Safari, touch hardware, and live GitHub migration/deployment were not available or permitted. Chromium desktop/mobile layout and pointer smoke plus isolated tests do not substitute for those device/deployment checks.
