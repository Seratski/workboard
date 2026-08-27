# WorkBoard — technical architecture

Reference for anyone (human or AI assistant) about to change this codebase. Line numbers
drift with every change and are only rough signposts — the section names and function names
are the stable landmarks. As of 27 August 2026 `index.html` is 3,807 lines.

Several things in this app do not do what their names suggest. Those are called out in
**[Known defects and constraints](#5-known-defects-and-constraints)** — read that section
before touching attachments, the Today list, or anything to do with per-user data.

---

## 1. Shape of the thing

One static HTML file. No build step, no bundler, no modules, no framework. All state lives
in module-level `let` variables in a single `<script>` block; all rendering is done by
string-concatenating HTML and assigning `innerHTML`; all event handling is inline
`onclick="..."` attributes.

```
index.html
├── <head>                      CDN script tags
├── <style>                     all CSS, organised by /* SECTION */ comments
├── markup                      login, modals, app shell, the five pages
├── <script>                    Firebase init, global state, application JavaScript
└── trailing markup             mobile filter overlay + lightbox (after </script>)
```

Note the last block: two pieces of markup sit **after** the closing `</script>` tag. Code
that queries `#mobFilterOverlay` or `#lightbox` still works because it only runs on user
interaction, long after parsing. Anything added at the end of the file must go before
`</body>` and be aware of this ordering.

### Runtime dependencies (all CDN, all pinned)

| Dependency | Version | Used for |
|---|---|---|
| `firebase-app-compat` | 10.14.1 | SDK core |
| `firebase-auth-compat` | 10.14.1 | Google sign-in |
| `firebase-firestore-compat` | 10.14.1 | All persistence |
| Google Fonts | — | DM Sans, DM Mono |

The Firebase **compat** SDK is used, not the modular v9+ API. Calls look like
`db.collection('tasks').doc(id).update({...})`, not `updateDoc(doc(db, ...))`. Keep new
code in the same style; mixing the two in one file is possible but confusing.

---

## 2. Backend

Firebase project **`workboard-b9078`**. Config is inline at the top of the script and is
public by design — a Firebase web API key identifies the project, it does not authorise
access.

Auth: Google provider via `signInWithPopup`, `prompt: 'select_account'`, persistence
`LOCAL`. `getRedirectResult()` is checked first, then `onAuthStateChanged` drives
`handleUser()`, which swaps the login screen for the app shell and calls
`startListeners()`.

`signInGoogle()` deliberately swallows `auth/popup-closed-by-user` and
`auth/cancelled-popup-request` so normal popup dismissal is silent. Cross-Origin-Opener-
Policy console warnings from the popup are harmless and are not suppressed — GitHub Pages
does not let you set response headers. (A `_headers` file was committed at one point and
removed again in the "Delete _headers" commit; it is a Netlify/Cloudflare convention and
does nothing on GitHub Pages. Old local clones may still have it lying around untracked.)

### Firestore layout

```
tasks/{autoId}          one document per task
trash/{autoId}          soft-deleted tasks
attachments/{autoId}    one document per attachment payload
meta/sites              { list: string[] }
meta/persons            { list: string[] }
meta/projectTasks       { list: string[] }   ← the UI calls these "Labels"
meta/settings           { defaultLabel: string, defaultPerson: string }
meta/todayFocus         { items: [{id, title, done}] }
```

`storageBucket` is configured but **Firebase Storage is never used**, and cannot be: it
requires the Blaze plan for projects created after September 2024, and this project's
`*.firebasestorage.app` bucket name marks it as one of those. Attachment payloads live in
their own Firestore documents instead — see *Attachments*.

**Adding a collection means adding a rule.** Firestore denies anything no rule matches, so
`firestore.rules` and the code have to change together. The `/attachments` rule was part of
the same change as the collection; without it every attachment write returns
`permission-denied`.

#### `tasks/{id}` document

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `note` | string | Short note. Rich saves put the first 500 chars of the body here. |
| `richBody` | string | The note body, present only for tasks made in the note editor. HTML when `richHtml` is true, otherwise plain text. Its presence is what makes the 📝 button appear. |
| `richHtml` | boolean | True on notes saved since August 2026, meaning `richBody` holds sanitized HTML. Absent on older notes, which hold plain text. **Always branch on this** — rendering plain text as HTML or vice versa is the failure mode. |
| `priority` | `'none'` \| `'high'` \| `'medium'` \| `'low'` | |
| `date` | `'YYYY-MM-DD'` | Due date. Compared as a string throughout — no `Date` parsing. |
| `sites` | string[] | Free strings, validated only against `meta/sites` in the UI. |
| `persons` | string[] | |
| `tags` | string[] | **Labels are stored under `tags`.** The UI says "Labels", the settings doc says `projectTasks`, the task field says `tags`. Three names, one concept. |
| `actions` | `[{text, assignee, done}]` | Checklist. `assignee` is a plain name string. |
| `links` | `[{name, url}]` | `https://` prefixed automatically if missing. |
| `attachments` | `[{id, name, type, size, thumb}]` | References into `attachments/{id}`, plus a small JPEG thumbnail so the board renders without extra reads. Entries written before August 2026 instead hold `{name, type, size, data}` with the full base64 inline; both forms are read correctly. |
| `comments` | `[{text, time}]` | `time` is `Date.now()` ms, not a Firestore timestamp. |
| `history` | `[{type, time}]` | `type` ∈ `created`, `edited`, `completed`, `reopened`, `merged`. |
| `done` | boolean | |
| `createdAt` / `updatedAt` | serverTimestamp | `createdAt` drives the default query order. |

Arrays are rewritten wholesale on every change (read the doc, deep-clone, mutate, write
back). There are no `arrayUnion` operations and no subcollections, so two people editing
comments on the same task simultaneously will lose one of the writes.

#### `trash/{id}` document

A full copy of the task, plus `deletedAt` (serverTimestamp) and `originalId`, with the
client-side `id` stripped. A copy created by a merge also carries `mergedInto` naming the
task it was folded into. Restoring creates a **new** task document — the original ID is
not reused, so anything pointing at the old ID (a pinned Today item, for example) will not
follow. There is no automatic expiry; trash grows until emptied by hand.

### Real-time listeners

`startListeners()` opens `onSnapshot` on `tasks` (ordered `createdAt desc`) and on the four
`meta` docs — `sites`, `persons`, `projectTasks`, `settings` — plus `todayFocus`. The
`trash` listener is lazy, starting the first time Settings is opened. Signing out releases
all seven and clears their handles, so the start guards do not block a later sign-in.

Every snapshot calls `renderAll()`, which re-renders every list on every page. Cheap at
current data volumes; the first thing to revisit if the board ever gets slow.

A 5-second `setTimeout` force-hides the loading screen as a fallback if no snapshot
arrives.

---

## 3. State model

All state is global. The variable prefixes are the single most important thing to
understand before editing, because they are terse and easy to confuse:

| Prefix | Meaning | Variables |
|---|---|---|
| *(none)* | Server-synced collections | `tasks`, `sites`, `persons`, `projectTasks`, `todayFocus`, `trashItems` |
| `f…` | **Form** state — the quick-task modal | `fSites`, `fPersons`, `fProjects`, `fActions`, `fLinks`, `editingId` |
| `r…` | **Rich** editor state | `rSites`, `rPersons`, `rProjects`, `rActions`, `rLinks`, `richEditingId` |
| `af…` | **Active filter** state on the board | `afS`, `afP`, `afT`, `afPr`, `afOv` |

So `fProjects` is "labels selected in the modal right now", `afT` is "labels currently
filtered on the board", and `projectTasks` is "the saved list of all labels". Renaming
these would be the single highest-value readability change to the file.

Other state: `viewMode` (`list`/`grid`/`kanban`), `detailTaskId`, `modalAttachments`,
`richAttachments`, `mentionState`, `todayPanelOpen`, `defaultLabel`, `defaultPerson`.

`localStorage` holds two keys, both drafts of unsaved work:

- `wb_task_draft` — `{title, note, priority, date, savedAt}` from the quick-task modal,
  written by `closeModal()` when a new (not edited) task has a title, restored by
  `openModal()` if less than 24 h old, cleared on a successful save. `saveTask()` sets
  `editingId = 'saved'` purely as a sentinel so `closeModal()` does not re-save the draft
  it just cleared.
- `wb_rich_draft` — the whole note-editor state for a note that has never been saved,
  written by `richFlush()`, offered back by `openRichEditor(null)` for seven days, cleared
  on save or discard. See *The note editor*.

---

## 4. UI structure

### Pages

`showPage(p)` toggles `#page-{board,today,done,rich,settings}`. `board` and
`rich` use `display:flex`, the others `display:block`. There is no router and no URL state
— reloading always lands on Board.

| Page | Nav | Contents |
|---|---|---|
| `board` | 📋 Board | Filter panel, task list, Today side panel |
| `today` | 📅 Today | Today focus list **and** a separate "Due today" list |
| `done` | ✅ Done | Completed tasks |
| `rich` | *none* | Full-page note editor; entered via "+ Note" or a 📝 button |
| `settings` | ⚙️ Settings | Sites, People, Labels, defaults, Trash, Account |

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl/Cmd + K` | Focus the board search box (switches to Board first) |
| `Ctrl/Cmd + Shift + K` | New task |
| `Ctrl/Cmd + B` / `I` | Bold / italic, only while the note editor body has focus |
| `Esc` | Closes the topmost overlay: the lightbox, then import, merge, then the modals |

The browser Back button is intercepted by a `popstate` handler that closes the topmost
overlay instead of leaving the page.

### Two different "today" concepts

This trips people up. The Today page shows both:

1. **Today focus** — a manually curated list. You pin a task with the 📌 button. Stored in
   `meta/todayFocus` as `{id, title, done}` — the title is **denormalised**, so renaming a
   task does not update its Today entry.
2. **Due today** — computed, every task where `date === today`. Drives the badge on the
   Today nav tab (`updateBadges`).

The badge on the Today *panel* toggle button counts undone **focus** items. Same word, two
meanings, two different counts on screen at once.

### Board view modes

- **list** (`taskHTML`) — the full-detail row: stripe, checkbox, tags, links, note, action progress, attachments.
- **grid** (`taskCardHTML`) — compact cards. Note that `.card-check` and `.card-actions` are
  `display:none` in the CSS with no hover rule, so the per-card checkbox and edit/note
  buttons are rendered but never visible. Clicking the card opens the detail modal, which
  has the equivalent controls. See *Grid cards render controls that CSS hides*.
- **kanban** (`kanbanCardHTML`) — three columns, **bucketed by priority** (High / Medium / Other), not by status. Cards cannot be dragged between columns; it is a read-only three-way split.

### Sorting and grouping

One `<select>` drives both. `priority`, `date`, `oldest`, `created` sort via `getSorted()`;
`site`, `person`, `label` group via `getGrouped()`. Because a task
can carry several sites, **grouping duplicates a task into every group it belongs to** —
the visible count can exceed the number of tasks. Tasks with no value land in a
`(no site)` / `(no person)` / `(no label)` bucket.

### Filtering

`getFiltered(mode)`. Modes: `board`, `today`, `done`, `search`.

**Filters combine with AND, not OR.** The code is
`afS.every(s => (t.sites||[]).includes(s))` — selecting DK *and* NO shows only tasks tagged
with **both**, not either. Same for people and labels. Priority and overdue use OR/boolean.
If users report "the filter hides everything", this is why.

Search matches title, note, richBody, sites, persons, tags and comment text, and is the
only mode that includes completed tasks.

### Mentions

`@` autocomplete over persons + sites + labels. Wired up by `initMentionInput()`, which is
called on exactly one element: the detail-modal comment box. `linkify()` renders
`@name` as a clickable span that pushes the mention into the search box. The mention regex
allows one or two words, so three-part names are only partly matched.

### The note editor

The full-page editor reached via "+ Note" or a 📝 button. Left side is a `contenteditable`
with a formatting toolbar (bold, italic, H1, H2, bullet list, numbered list, divider) driven
by `document.execCommand`. Right side holds the same structured fields as the quick modal.

**Formatting is persisted as HTML.** `saveRichTask()` and `richFlush()` store
`sanitizeRichBody(richBody.innerHTML)` in `richBody` and set `richHtml: true`; `note` holds
`richPlainText()` of that HTML, capped at 500 characters, as the preview shown on cards and
rows. `sanitizeRichBody` allows only `B STRONG I EM U H1 H2 H3 UL OL LI BR HR P DIV SPAN`,
replaces anything else with its text, and strips every attribute — so pasted markup, script
tags and event handlers cannot survive a round trip.

Notes written before August 2026 have no `richHtml` flag and hold plain text. Every read
path branches on the flag: `openRichEditor` assigns `innerHTML` or `innerText` accordingly,
the detail modal renders `linkifyHtml(...)` inside `.detail-rich-body.is-html` or
`linkify(...)` inside plain `.detail-rich-body`, and `taskBodyText()` returns plain text for
searching either way. `linkifyHtml` walks text nodes only, so URLs and `@mentions` still
become links without corrupting the surrounding markup.

**Autosave is real.** `richAutoSave()` marks the editor dirty and debounces `richFlush()` by
1.2 s. For a note that already exists, `richFlush` writes to Firestore and the status line
says "Saved to board" — it deliberately omits `history`, so autosave does not spam the
timeline, and it omits `title` when the field is empty so an in-progress retype cannot blank
an existing task's title. For a note that has never been saved, it writes the whole editor
state to `localStorage` under `wb_rich_draft` instead, so half-finished notes never appear
on the board; `openRichEditor(null)` offers that draft back for seven days, and an explicit
save or discard clears it. If the draft exceeds the storage quota — base64 attachments are
the usual cause — it retries without attachments and says so. `closeRichEditor()` flushes a
pending debounce rather than dropping it.

The consequence worth knowing: editing an existing note has no cancel. Changes reach the
board a second or so after you stop typing.

### Attachments

Payloads live one per document in `attachments/{autoId}`:

```
{ name, type, size, data (base64 dataURL), createdAt }
```

The task holds only `{id, name, type, size, thumb}`. `thumb` is a JPEG downscaled to 220 px
on the long edge at quality 0.7 — a few KB — generated in-browser by `makeThumb()` on a
canvas, with transparency flattened onto the card background rather than black. So the board
renders thumbnails with no extra reads, and the full image costs exactly one read, on click.

This is what fixes the old defect. Each attachment now has the 1 MiB document budget to
itself instead of sharing the task's with comments, history and action items, so several
images on one task work. `MAX_FILE_SIZE` rose from 500 KB to 700 KB accordingly — base64
costs 4/3, so ~700 KB of file is what fits safely in one document.

**Lifecycle.** While editing, an entry holds `fullData` in memory and no `id`.
`persistAttachments()` creates the document, stamps the `id` on the entry and drops
`fullData`; it is idempotent and guarded against concurrent autosave runs, so calling it
repeatedly is safe. `attachForTask()` then produces what the task document gets — and
deliberately drops any entry that failed to persist, rather than falling back to writing
base64 inline.

**Deletion is deferred.** `removeAttach()` only queues the id in `pendingAttachDeletes`,
because the edit may still be cancelled. A successful save calls `flushAttachDeletes()`;
`closeModal()` and discarding a note draft call `discardAttachDeletes()`. Sending a task to
Trash does **not** delete its payloads — restoring has to work. `permDelete()` and
`emptyTrash()` do, via `deleteAttachmentsOf()`, once the task is genuinely gone.

**Reading.** `attachPreviewSrc()` returns `thumb || data`, so both formats render.
`loadAttachmentFull()` resolves the full payload from `fullData`, from legacy inline `data`,
or by fetching the document, memoised in `attachCache`. Non-image attachments no longer have
their bytes to hand, so the file chip is a `<button>` calling `downloadAttachment()` rather
than an `<a href>`.

**The lightbox** has two modes, `fit` and `actual`, toggled by clicking the image or the
button in its bar. `fit` scales in *both* directions — the old CSS was `max-width:90vw` with
no `width`, so any screenshot smaller than the window opened at 1:1 and was unreadable.
Note that `fit` is sized in viewport units, not percentages: the stage is content-sized, so
`width:100%` would resolve against the image's own intrinsic width and change nothing. The
stage centres with auto margins rather than `justify-content`, so a zoomed image larger than
the stage scrolls in both directions instead of losing its top-left corner. While the full
payload is in flight the thumbnail shows blurred with a "Loading full image" label, so a
soft preview is never mistaken for the real thing.

**Migration.** Settings → Attachment storage counts what is still inline and offers a button.
`migrateAttachments()` walks the affected tasks, creates a document and a thumbnail per
inline entry, then rewrites the task's array. It skips entries that already have an `id`, so
it is idempotent and an interrupted run can simply be repeated. A failure keeps the inline
copy rather than losing it, and is reported by task and file name.

### Backup: export and import

Both live on the Settings page, under **Data backup**.

`exportData()` writes a versioned envelope, not the flat object it used to:

```
{ workboard: 2, exportedAt: <ISO string>,
  tasks: [...], trash: [...], attachments: [...],
  meta: { sites, persons, projectTasks, settings, todayFocus } }
```

`attachments` carries the payload documents, so a backup is self-contained: restoring a task
also restores the images it points at. v1 files (no `attachments`) and the pre-v1 flat format
both still load.

It reads `trash` and `attachments` with one-off `.get()` calls rather than relying on
`trashItems`, whose listener only starts when Settings is first opened — exporting from the
top bar would otherwise silently omit trash. `normalizeBackup()` flattens any of the three
shapes into one internal form and reports the version it found.

Import runs file → `normalizeBackup` → preview → apply. Nothing is written until a button in
the preview is pressed. `backupPreview(b, mode)` computes the counts shown for both modes so
the numbers on screen are the numbers that will happen.

**Two modes.** *Add missing only* writes tasks whose `id` is not already on the board, unions
sites/people/labels, and leaves trash, defaults and the Today list alone (except a Today list
that is currently empty). *Replace everything* writes every task in the file, deletes board
tasks absent from it, and overwrites defaults, the Today list and trash. Replace needs two
clicks: the first arms the button for four seconds, matching how `deleteFromDetail` behaves.

Tasks are written with `.doc(id).set(...)`, so **ids are preserved**. That makes an import
idempotent and re-runnable, and is why a half-finished import is safe to repeat — unlike
restoring from Trash, which creates a new document and therefore a new id. Tasks in the file
without an id are added fresh and cannot be de-duplicated; the preview warns when the file
contains any.

Attachment documents are written in **both** modes, by id. In merge mode only those actually
referenced by a task in the file are written, so an unrelated payload is not resurrected. A
task restored without its payload would render an attachment that cannot be opened, which is
why this is not limited to replace mode.

`reviveTs()` rebuilds Firestore `Timestamp` values from their serialized
`{seconds, nanoseconds}` form (and the underscored variant, and ISO strings) so restored
tasks keep their original ordering. Where a timestamp is missing, `serverTimestamp()` fills
in.

Writes go through `runChunked()` — 20 concurrent operations at a time, `Promise.allSettled`
— rather than a Firestore `WriteBatch`. A batch aborts wholesale on one bad document, and
the expected failure here is a single oversized task (base64 attachments against the 1 MiB
limit). Per-task failures are collected and listed in the report instead of losing the run.

### Merging two tasks

`openMergePicker()` → `openMergePreview()` → `confirmMerge()`, reached from the
🔀 Merge button in the detail-modal footer. The task whose detail modal is open is
**A** and survives; the task picked from the list is **B** and is moved to Trash.

The picker (`renderMergePicker`) lists every other task with a text search over title,
note, richBody, sites, persons and labels, sorted by `mergePickSort`: unfinished before
done, then newest first. A task created seconds ago still has a pending `serverTimestamp`,
so `createdAt` is `null` client-side and Firestore's `orderBy('createdAt','desc')` sorts it
**last** — `mergePickSort` treats `null` as newest to compensate. Capped at 400 rows.

The preview (`renderMergePreview`) offers a per-field choice for `title`, `priority`,
`date` and the note text, held in `mergeChoice`. The note field has three options: `both`
(the default — A's text, a `--- merged ---` separator, then B's), `a`, or `b`.
Everything else is combined without asking, in `buildMergedData`:

| Field | Rule |
|---|---|
| `sites`, `persons`, `tags` | union, A's order preserved, deduped by value |
| `actions` | union, deduped by `text` + `assignee`; A's copy wins on a clash |
| `links` | union, deduped by `url` |
| `attachments` | union, deduped by `name` + `size`; B's can be excluded via a checkbox |
| `comments` | concatenated, then sorted by `time` ascending |
| `history` | concatenated, sorted by `time`, then a `merged` entry appended |
| `done` | taken from A |

If the result exceeds 500 characters, or either side had a `richBody`, the text is written
to `richBody` with `note` holding the first 500 characters — matching what
`saveRichTask()` does.

Because attachments are base64 inside the document, merging two tasks that both
carry images can exceed the 1 MiB limit. The preview shows the serialized size, warns above
~880 KB, and disables the confirm button above ~977 KB rather than letting the write fail
silently. Excluding B's attachments is the escape hatch.

If B was pinned in Today focus, the pin is moved to A rather than left pointing at a
deleted document. The trash copy of B carries `mergedInto: <A's id>` alongside the usual
`originalId`, so a merge is distinguishable from a plain delete.

---

## 5. Known defects and constraints

Confirmed by reading the source, not by guessing. Roughly ordered by impact. Referred to by
name rather than number, so fixing one does not renumber the rest.

**Grid cards render controls that CSS hides.**
`taskCardHTML` emits a done checkbox and edit/note buttons, and `.card-check` /
`.card-actions` are `display:none` with no hover rule to reveal them. Their `onclick`
handlers were also malformed until August 2026; that is fixed, but the markup is still
unreachable. Either add a `.task-card-grid:hover` rule to reveal them, or delete the markup.
Not urgent: the card opens the detail modal, which offers the same actions.

**Sign-out does not reset every guard.**
`handleUser()` now releases all seven listeners and clears their handles, so a later
sign-in re-attaches cleanly. What it does not reset is editor and filter state — `afS`,
`viewMode`, `richEditingId` and similar survive a sign-out because they are module-level
globals with no teardown. Harmless in a single-user app; worth knowing if a second account
is ever added.

### Structural constraints, not bugs

- **Single-user by design, unenforced in code.** WorkBoard is built for one owner, and
  the code reflects that by having no user dimension at all: `db.collection('tasks')` is
  queried with no `where()` and no `uid` in any path, and `meta/todayFocus` and
  `meta/settings` are singletons. This is fine for one user and would break immediately
  for two — a second account would share one board and overwrite the first's Today list
  and defaults. Do not add a second user without first partitioning the data.
- **Authentication does not restrict *which* account.** A plain `GoogleAuthProvider` with
  `prompt: 'select_account'` accepts any Google account; there is no hosted-domain
  restriction and no allowlist. Combined with the point above, **the Firestore security
  rules are the only access control in the system.** A permissive rule such as
  `if request.auth != null` would expose the whole board to any Google account. The rules
  must pin to the owner's UID — see `firestore.rules`, which is the committed record of
  intent, not the deployed artifact (rules are published from the Firebase console).
- **No test suite, no staging.** `main` is production.
- **`renderAll()` re-renders everything** on every snapshot, and card HTML is built by
  string concatenation. Fine at current scale; the obvious bottleneck later.
- **Dates are compared as `YYYY-MM-DD` strings**, built from local time by `todayStr()`.
  Do not reach for `toISOString().slice(0,10)` — that is UTC, and it used to make "today"
  and "overdue" wrong between midnight and 02:00 Nordic summer time.
- **Deletion is soft, restore is not identity-preserving.** Restoring from Trash creates a
  new document with a new id, so a merge cannot be truly undone and a Today pin aimed at the
  old id will not follow. Importing a backup does preserve ids — see *Backup: export and
  import*.
- **Trash never expires.** It grows until emptied by hand.

---

## 6. Making changes safely

1. Work on a copy of `index.html`, open it in a browser, and click through the screens you
   touched. There is nothing else standing between an edit and production.
2. Prefer editing in place with a script over retyping regions of the file — it is 2,500
   lines of dense, minified-by-hand JavaScript and a stray quote breaks silently at
   runtime rather than loudly at build time.
3. Keep the compat SDK style, the `f…`/`r…`/`af…` naming, and the existing CSS variable
   palette (`--accent` is `#F96700`).
4. Adding a field to a task means touching `saveTask()`, `saveRichTask()`, `openEdit()`,
   `openRichEditor()`, the renderers you want it visible in, and `getFiltered()` if it
   should be searchable. There is no schema and no migration path — old documents simply
   lack the field, so every read must tolerate `undefined`.
5. Commit with a message that says what changed. 48 of the first 58 commits are titled
   "Add files via upload" and another 8 "Update index.html", so the existing history tells
   you nothing about what any change did. Don't extend that.
