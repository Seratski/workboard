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
| `richBody` | string | The note body, present only for tasks written in the full-page editor. HTML when `richHtml` is true, otherwise plain text. **Its presence decides which editor `Edit` opens.** |
| `richHtml` | boolean | True on notes saved since August 2026, meaning `richBody` holds sanitized HTML. Absent on older notes, which hold plain text. **Always branch on this** — rendering plain text as HTML or vice versa is the failure mode. |
| `priority` | `'none'` \| `'high'` \| `'medium'` \| `'low'` | |
| `date` | `'YYYY-MM-DD'` | Due date. Compared as a string throughout — no `Date` parsing. |
| `sites` | string[] | Free strings, validated only against `meta/sites` in the UI. |
| `persons` | string[] | |
| `tags` | string[] | **Labels are stored under `tags`.** The UI says "Labels", the settings doc says `projectTasks`, the task field says `tags`. Three names, one concept. |
| `actions` | `[{text, assignee, done}]` | Checklist. `assignee` is a plain name string. |
| `links` | `[{name, url}]` | Parsed by `parseLinkInput`, which allows only `http`, `https` and `mailto` and adds `https://` when the scheme is missing. An Outlook URL is recognised as a mail link and shown with an envelope. |
| `attachments` | `[{id, name, type, size, thumb}]` | References into `attachments/{id}`, plus a small JPEG thumbnail so the board renders without extra reads. Entries written before August 2026 instead hold `{name, type, size, data}` with the full base64 inline; both forms are read correctly. |
| `comments` | `[{text, time}]` | `time` is `Date.now()` ms, not a Firestore timestamp. |
| `history` | `[{type, time}]` | `type` ∈ `created`, `edited`, `completed`, `reopened`, `merged`, `repeated`. |
| `snoozedUntil` | `'YYYY-MM-DD'` \| `''` | Pause. While this is **strictly after** today the task is off the board. Empty or absent means not paused. Compared as a string, like `date`. |
| `repeat` | `{n, unit, from}` \| `null` | Repeat rule. `unit` ∈ `day`, `week`, `month`; `n` is 1–365; `from` is `'due'` or `'done'`, the anchor the next date is counted from. `null` means no repeat. |
| `clickupSent` | `'YYYY-MM-DD'` \| `''` | Set when the task was handed over to ClickUp. A record, not a link — nothing is synced. |
| `clickupArea` | string | The ClickUp Area chosen at hand-over, stored as its display label. |
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

`showPage(p)` toggles `#page-{board,today,paused,done,rich,settings}`. `board` and
`rich` use `display:flex`, the others `display:block`. There is no router and no URL state
— reloading always lands on Board.

Every page appears twice in the markup: as a `.nav-tab` in the top bar (desktop) and as a
`.bottom-nav-item` in the bottom bar (phone, ≤700px, where `.nav-tabs` is hidden). Adding a
page means adding **both**, and adding it to the array inside `showPage`, which is what
sets the `active` class on either.

| Page | Nav | Contents |
|---|---|---|
| `board` | 📋 Board | Filter panel, task list, Today side panel |
| `today` | 📅 Today | Today focus list **and** a separate "Due today" list |
| `paused` | ⏸️ Paused | Tasks with a future `snoozedUntil`, soonest wake first |
| `done` | ✅ Done | Completed tasks |
| `rich` | *none* | Full-page note editor; entered from "Write on a full page ↗" in the quick modal, from `Edit` on a task that has a `richBody`, or from the 📝 button on a task row |
| `settings` | ⚙️ Settings | Sites, People, Labels, defaults, Trash, Account |

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl/Cmd + K` | Focus the board search box (switches to Board first) |
| `Ctrl/Cmd + Shift + K` | New task |
| `Ctrl/Cmd + B` / `I` | Bold / italic, only while the note editor body has focus |
| `Esc` | Closes the topmost overlay: the lightbox, then import, merge, the ClickUp dialog, the pause dialog, then the modals |

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

- **list** (`taskHTML`) — the full-detail row: stripe, checkbox, tags, links (mail links in
  their own colour), note, action progress, attachments.
- **grid** (`taskCardHTML`) — compact cards: stripe, title, note preview, tags, date,
  action progress and an attachment count. Deliberately no per-card checkbox or edit
  buttons — clicking the card opens the detail modal, which has both. That markup used to
  exist but was hidden by CSS with no hover rule, so it was never reachable; it was deleted
  in August 2026 rather than revealed, because a hover rule does nothing on a phone.
- **kanban** (`kanbanCardHTML`) — three columns, **bucketed by priority** (High / Medium / Other), not by status. Cards cannot be dragged between columns; it is a read-only three-way split.

### Sorting and grouping

One `<select>` drives both. `priority`, `date`, `oldest`, `created` sort via `getSorted()`;
`site`, `person`, `label` group via `getGrouped()`. Because a task
can carry several sites, **grouping duplicates a task into every group it belongs to** —
the visible count can exceed the number of tasks. Tasks with no value land in a
`(no site)` / `(no person)` / `(no label)` bucket.

### Filtering

`getFiltered(mode)`. Modes: `board`, `today`, `paused`, `done`, `search`.

**Filters are OR within a group and AND across groups.** The code is
`afS.some(s => (t.sites||[]).includes(s))` — selecting DK *and* NO shows tasks tagged with
DK **or** NO. Add the person Martin on top and you get *(DK or NO) and Martin*. Sites,
people and labels each behave that way; priority and overdue are unchanged.

This changed in August 2026. It used to be `every()`, meaning DK + NO showed only tasks
carrying **both** — which for a board where a task usually has one site meant selecting two
sites returned nothing. If anything downstream assumed intersection semantics, that
assumption is now wrong.

**Paused tasks are excluded from every mode except `search`.** `board`, `today` and the
badge counts all skip them; search deliberately still finds them, so a paused task is never
lost. The `paused` mode is the inverse: unfinished tasks where `isPaused(t)` is true.

Search matches title, note, richBody, sites, persons, tags and comment text, and is the
only mode that includes completed tasks.

### Mentions

`@` autocomplete over persons + sites + labels. Wired up by `initMentionInput()`, which is
called on exactly one element: the detail-modal comment box. `linkify()` renders
`@name` as a clickable span that pushes the mention into the search box. The mention regex
allows one or two words, so three-part names are only partly matched.

### The note editor

The full-page editor. It is not a second kind of object: it writes the same task document
as the quick modal, with the same fields. The only difference is the body — a
`contenteditable` holding sanitized HTML instead of a plain-text `<textarea>`.

**There is one way in and one way back to a task.** Until August 2026 the top bar had both
"+ Task" and "+ Note", which made the same thing and forced a choice before you knew how
much you were going to write; and the detail modal had both `Edit` and `📝 Open note`. Now:

- One "+ Task" button. The quick modal's Note field carries **Write on a full page ↗**
  (`expandToRichEditor()`), which moves the half-typed task over — title, note, priority,
  date, repeat, sites, people, labels, action items, links and attachments — and keeps
  editing the same document if it already existed, which is how a plain task becomes a
  formatted one.
- `Edit` follows the task: a `richBody` opens the full page, anything else opens the quick
  modal. The separate 📝 button in the detail modal is gone.

Two things to know about the escalation:

1. **In `openRichEditor(id, carried)` the `carried` branch must come before the `id`
   branch.** Written the other way round — as it was first — expanding a task that was
   being edited reloaded the stored version and silently discarded everything just typed.
2. `closeModal()` normally writes a `wb_task_draft` for an unsaved task. During an
   escalation `skipTaskDraft` suppresses that: the content is moving, not being abandoned,
   and a leftover draft would reappear the next time + Task was opened.

`plainToHtml()` does the body conversion: escape first, then blank lines become paragraphs
and single newlines become `<br>`, so what was typed keeps its shape. Left side is a `contenteditable`
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

The task holds only `{id, name, type, size, thumb}`. `makeThumb()` downscales to 220 px on
the long edge as JPEG at quality 0.82 — a few KB — on a canvas, with transparency flattened
onto the card background rather than black. So the board renders thumbnails with no extra
reads, and the full image costs exactly one read, on click.

An image already within 220 px and under 40 KB is **not** re-encoded: `makeThumb` returns the
original bytes. Re-encoding a 120 × 101 screenshot to JPEG only added artefacts to something
that needed no downscaling at all. The cost is that such an image is stored twice, once as
the task's `thumb` and once in its own document, which at those sizes is a few KB and buys a
render with no fetch.

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
Enlargement is capped at `LIGHTBOX_MAX_UPSCALE`, 3×, applied as an inline `max-width` from
the decoded `naturalWidth`: filling a 1360 px stage with a 120 px image is an 11×
interpolation that recovers no detail and simply looks broken. The bar reports the real
pixel dimensions, and the enlargement factor when there is one, so a soft image is explained
rather than mysterious.
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
| `snoozedUntil` | whichever pause wakes first, so a merge never hides work longer than either task already was |
| `repeat` | A's rule, or B's if A has none. Was dropped entirely until August 2026 |
| `clickupSent` / `clickupArea` | A's hand-over, or B's if A never went out. The Area is not borrowed from a hand-over that was not kept |

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

### Links, and mail links

Links live on the task as `links: [{name, url}]` and are added in three places: the quick
modal, the note editor, and — since August 2026 — **the detail modal**, which is the one
that matters in practice, because pasting a URL onto an existing task used to mean opening
it for edit. All three go through the same `parseLinkInput`, so the whole task can be
finished on the create screen: link, repeat rule and ClickUp hand-over included. The detail modal's Links section renders every link with a remove button and
an add field, and is shown even when the task has no links, since the add field is the
point.

`parseLinkInput(raw, fallbackName)` turns one pasted string into `{name, url}` or `null`:

- **Only `http`, `https` and `mailto` get through.** A `javascript:` or `data:` URL inside
  an `href` is a script-execution hole, and this page renders task data straight into
  markup. A scheme-less input gets `https://`.
- It accepts a bare URL, `Label | URL`, `Label<tab>URL`, `Label\nURL`, and **no separator at
  all** — the first whitespace-separated token that looks like a URL is the URL, and
  whatever stands in front of it becomes the label. So `Anna · Returflow SOP <url>` works
  as a single paste, which is what you get when you ask for a label and a link together.
- **It refuses rather than guesses.** Text with no URL-shaped token returns `null`. An
  earlier version took the first token unconditionally and turned
  `Harmless label | javascript:alert(1)` into `https://Harmless`.

`isMailLink(url)` matches Outlook and OWA hosts — `outlook.office.com`,
`outlook.office365.com`, `outlook.live.com`, `outlook.com` — and mail links get an envelope
icon and their own chip colour instead of the chain. The trailing `(?=[\/?#:]|$)` lookahead
is load-bearing: without a host boundary, `outlook.office365.com.evil.example` would match
and a phishing URL would be displayed with a friendly mail icon.

`escHtml` escapes `"` and `'` as well as `&`, `<` and `>`. It is used inside
`href="…"`, `alt="…"` and `title="…"`, so without the quotes a crafted URL could close the
attribute and add another one. That was live until August 2026. `esc()` is the different
one, for values interpolated into inline `onclick` handlers.

There is no way to attach a mail *itself*. The practical routes are a link (best — one
click reaches the real thread), the mail's text pasted into a note (`handleRichPaste`
deliberately inserts `text/plain`), a PDF print-out as an attachment, or a screenshot
pasted while the quick modal or note editor is open. Attachments are capped at 700 KB per
file and accept `image/*` and `.pdf` only.

### Handing a task to ClickUp

`openClickup(id, fallbackTask)` opens a dialog that prepares two pieces of text and opens
the destination list. It talks to nothing.

**Reachable while creating a task, not only afterwards.** Both editors have a
*Save & ClickUp* button: `saveTaskAndClickup()` and `saveRichTaskAndClickup()` save, then
open the dialog for the task that was just written. For that, `saveTask()` and
`saveRichTask()` return `{id, data}` — the existing id when editing, the new one when
creating, `null` when nothing was saved (an empty title leaves the editor open and writes
nothing). A task saved a moment ago is not in `tasks` until its snapshot arrives, so the
dialog is handed that data as `fallbackTask` and `cuTask()` prefers the live task when it
appears. A fallback whose id does not match the one asked for is ignored.

**There is no API token, and there must not be one.** A ClickUp personal token grants access
to everything its owner can see in the entire workspace. This page is served from a public
URL, and it renders note bodies with `innerHTML` — so a token held anywhere in this page
would be one sanitizer bypass away from POWER's ClickUp. Storing it in `meta/settings`
does not help: the client reads it into the same JavaScript context. If a one-click
integration is ever wanted, the token belongs in a small server-side proxy (a Cloudflare
Worker or an Apps Script web app) that can only create tasks in one list, and the browser
gets a low-value shared secret instead. Until then this stays a hand-over.

The dialog offers, in order: the Area drop-down; the task title, read-only, with a Copy
button, to paste into ClickUp's task-name field; the description block, with its own Copy
button; and a field to paste the resulting ClickUp URL back. The primary button copies the
title, opens the list in a new tab, and records the hand-over.

`cuBodyText(t, area)` builds the description. Only sections with content are included, so a
bare task does not arrive padded with empty headings: the note body flattened to plain text
(`taskBodyText`, so a formatted note never arrives as markup), the action items as an
**unticked** `- [ ]` checklist, a meta block (due date, sites, people, labels, Area,
priority), and a `From WorkBoard` line.

Two constants at the top of the section carry the destination: `CLICKUP_LIST_URL` /
`CLICKUP_LIST_NAME` for the *NCS BO Team* list, and `CLICKUP_AREAS`, **a snapshot of that
list's Area drop-down taken August 2026**. ClickUp is the source of truth; an Area added
there cannot be chosen here until it is added to that array. Note also that the list carries
*two* custom fields both named "Area" — this is the one with the emoji labels (Cooking,
Scoping, Tech/AI, …), not the Delivery/Aftersales/NOC one.

What it remembers: `clickupSent` and `clickupArea` on the task, the last Area used in
`localStorage` (so a run of tasks for one Area does not mean re-picking it), and the ClickUp
URL as an ordinary entry in `links` named `ClickUp` — reusing `links` rather than adding a
field, so it shows as a chip, survives a backup and merges like any other link. A second
save replaces the ClickUp link rather than piling up, and leaves other links alone.

The list tab is opened *before* the Firestore write, so a slow or failed write cannot stop
it. Clipboard access needs a secure context and a user gesture, so `copyText` falls back to
the old `execCommand('copy')` path and reports failure rather than silently doing nothing.

### Pausing a task

A pause is a single field: `snoozedUntil`, a `'YYYY-MM-DD'` string. `isPaused(t)` is
`t.snoozedUntil > todayStr()` — **strictly** greater, so a task wakes up *on* its date
rather than the day after, and a date in the past is simply not a pause. Nothing runs on a
schedule and nothing clears the field: a woken task keeps its old `snoozedUntil` value
harmlessly, and `resumeTaskById` blanks it only when the user resumes by hand.

`openPause(id)` → `pauseUntil(dateStr)` → the Firestore write. The dialog offers five
presets (tomorrow, +3 days, next week, +2 weeks, next month) and a date input;
`pauseUntil` refuses anything at or before today. Pausing a task that is pinned in Today
focus also unpins it — the point of pausing is "not now", and leaving it pinned would
contradict the disappearance from the board.

Where a pause shows up: the ⏸️ Paused page and its nav badge, a `.task-paused-chip` on
the task row (visible in search results, since the board excludes paused tasks), a Paused
section in the detail modal with a **Resume now** button, and the detail footer button,
which reads *Pause* or *Paused* depending on state.

A merge keeps whichever pause wakes first, so folding a paused task into an active one does
not silently unpause it.

### Repeating tasks

The rule lives on the task as `repeat: {n, unit, from}`. Nothing is scheduled: **the next
occurrence is created at the moment a repeating task is ticked off**, by `spawnRepeat(t)`,
called from `toggleDone`, `toggleDoneFromDetail` and `toggleTodayItemDone`. Re-opening a
completed task does not spawn anything (the callers check `wasDone` first), and a task with
no rule spawns nothing.

`nextRepeatDate(t)` computes the date:

- `from: 'due'` counts from `t.date`, `from: 'done'` from today. A `'due'` rule on a task
  with no due date falls back to today.
- `unit` steps by `addDays` (day, week × 7) or `addMonths` (month). `addMonths` **clamps to
  the end of the shorter month**: 31 January + 1 month is 28 February, not 3 March.
- Dates are built by `dateFromStr`, which parses `'YYYY-MM-DDT12:00:00'` — **local noon**, so
  neither a DST shift nor a UTC conversion can move the day.
- Counting from a due date that is long past would produce a next date that is already
  overdue, so the loop keeps stepping until it lands after today. It preserves the weekday
  of a weekly rule and the day-of-month of a monthly one.

The new occurrence copies title, note, `richBody`/`richHtml`, priority, sites, persons,
labels and links; carries the action items along **unticked** (they are the recipe, not the
record); and starts with `history: [{type:'repeated'}]`, an empty comment list and
`snoozedUntil: ''`.

**Attachments deliberately do not come along.** Payload documents in `attachments/` are
referenced by id, so copying the references would give two tasks the same payloads — and
permanently deleting one occurrence would take the other's images with it. If that is ever
changed, the payload documents have to be copied too.

---

## 5. Known defects and constraints

Confirmed by reading the source, not by guessing. Roughly ordered by impact. Referred to by
name rather than number, so fixing one does not renumber the rest.

**Editing a formatted task through the quick modal saved to a field nobody sees.**
`openEdit` loaded `t.note` — the flattened 500-character preview — into the small textarea,
and `saveTask` wrote it back to `note` without touching `richBody`. The detail modal renders
`richBody` when it exists, so the edit was stored and never displayed again. Fixed by making
`Edit` open the editor that matches the task. The asymmetry is still there in the data, so
anything new that writes `note` on a task with a `richBody` will hit the same trap.

**The bottom navigation was dead markup until August 2026.**
`.bottom-nav` was `display:none` in the base rule, and the only other rule mentioning it
hid it again above 700px — nothing ever turned it on. Since `.nav-tabs` *is* hidden below
700px, a phone had no navigation at all: no way to reach Today, Paused, Done, Filter or
Settings. Fixed by adding `.bottom-nav{display:block;}` inside the `max-width:700px` block.
A browser test now asserts it is visible, positioned at the bottom, and lists all six
destinations, so this cannot regress unnoticed.

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
