# WorkBoard — technical architecture

Reference for anyone (human or AI assistant) about to change this codebase. Line numbers
refer to `index.html` as of commit `56865e7` (1 May 2026, 2,507 lines). They will drift;
the section names and function names are the stable landmarks.

Several things in this app do not do what their names suggest. Those are called out in
**[Known defects and constraints](#known-defects-and-constraints)** — read that section
before touching the rich editor, attachments, or anything to do with per-user data.

---

## 1. Shape of the thing

One static HTML file. No build step, no bundler, no modules, no framework. All state lives
in module-level `let` variables in a single `<script>` block; all rendering is done by
string-concatenating HTML and assigning `innerHTML`; all event handling is inline
`onclick="..."` attributes.

```
index.html
├── lines    1–  11   <head>, CDN script tags
├── lines   12– 541   <style> — all CSS, organised by /* SECTION */ comments
├── lines  543– 936   markup: login, modals, app shell, the five pages
├── lines  937– 951   Firebase init + global state
├── lines  952–2489   application JavaScript
└── lines 2490–2507   mobile filter overlay + lightbox markup (after </script>)
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
| `sortablejs` | 1.15.2 | **nothing — see defect 7** |
| Google Fonts | — | DM Sans, DM Mono |

The Firebase **compat** SDK is used, not the modular v9+ API. Calls look like
`db.collection('tasks').doc(id).update({...})`, not `updateDoc(doc(db, ...))`. Keep new
code in the same style; mixing the two in one file is possible but confusing.

---

## 2. Backend

Firebase project **`workboard-b9078`**. Config is inline at line 938 and is public by
design — a Firebase web API key identifies the project, it does not authorise access.

Auth: Google provider via `signInWithPopup`, `prompt: 'select_account'`, persistence
`LOCAL`. `getRedirectResult()` is checked first, then `onAuthStateChanged` drives
`handleUser()` (line 953), which swaps the login screen for the app shell and calls
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
meta/sites              { list: string[] }
meta/persons            { list: string[] }
meta/projectTasks       { list: string[] }   ← the UI calls these "Labels"
meta/settings           { defaultLabel: string, defaultPerson: string }
meta/todayFocus         { items: [{id, title, done}] }
```

`storageBucket` is configured but **Firebase Storage is never used**. Attachments go into
the task document as base64 (see defect 5).

#### `tasks/{id}` document

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `note` | string | Short note. Rich saves put the first 500 chars of the body here. |
| `richBody` | string | Present only for tasks made in the rich editor. **Plain text** — see defect 1. Its presence is what makes the 📝 button appear. |
| `priority` | `'none'` \| `'high'` \| `'medium'` \| `'low'` | |
| `date` | `'YYYY-MM-DD'` | Due date. Compared as a string throughout — no `Date` parsing. |
| `sites` | string[] | Free strings, validated only against `meta/sites` in the UI. |
| `persons` | string[] | |
| `tags` | string[] | **Labels are stored under `tags`.** The UI says "Labels", the settings doc says `projectTasks`, the task field says `tags`. Three names, one concept. |
| `actions` | `[{text, assignee, done}]` | Checklist. `assignee` is a plain name string. |
| `links` | `[{name, url}]` | `https://` prefixed automatically if missing. |
| `attachments` | `[{name, type, data, size}]` | `data` is a base64 data URL. |
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

`startListeners()` (line 1002) opens `onSnapshot` on `tasks` (ordered `createdAt desc`),
each of the four `meta` docs, and `todayFocus`. The `trash` listener is lazy — it starts
the first time Settings is opened. Every snapshot calls `renderAll()`, which re-renders
every list on every page. Cheap at current data volumes; the first thing to revisit if the
board ever gets slow.

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

`localStorage` holds exactly one key: `wb_task_draft` — `{title, note, priority, date,
savedAt}`, written by `closeModal()` when a new (not edited) task has a title, restored by
`openModal()` if less than 24 h old, cleared on successful save. Note that `saveTask()`
sets `editingId = 'saved'` purely as a sentinel to stop `closeModal()` re-saving the draft
it just cleared.

---

## 4. UI structure

### Pages

`showPage(p)` (line 1126) toggles `#page-{board,today,done,rich,settings}`. `board` and
`rich` use `display:flex`, the others `display:block`. There is no router and no URL state
— reloading always lands on Board.

| Page | Nav | Contents |
|---|---|---|
| `board` | 📋 Board | Filter panel, task list, Today side panel |
| `today` | 📅 Today | Today focus list **and** a separate "Due today" list |
| `done` | ✅ Done | Completed tasks |
| `rich` | *none* | Full-page note editor; entered via "+ Note" or a 📝 button |
| `settings` | ⚙️ Settings | Sites, People, Labels, defaults, Trash, Account |

### Two different "today" concepts

This trips people up. The Today page shows both:

1. **Today focus** — a manually curated list. You pin a task with the 📌 button. Stored in
   `meta/todayFocus` as `{id, title, done}` — the title is **denormalised**, so renaming a
   task does not update its Today entry.
2. **Due today** — computed, every task where `date === today`. Drives the badge on the
   Today nav tab (`updateBadges`, line 1021).

The badge on the Today *panel* toggle button counts undone **focus** items. Same word, two
meanings, two different counts on screen at once.

### Board view modes

- **list** (`taskHTML`, line 1345) — the full-detail row: stripe, checkbox, tags, links, note, action progress, attachments.
- **grid** (`taskCardHTML`, line 1317) — compact cards. Several controls here are broken; see defect 4.
- **kanban** (`kanbanCardHTML`, line 1290) — three columns, **bucketed by priority** (High / Medium / Other), not by status. Cards cannot be dragged between columns; it is a read-only three-way split.

### Sorting and grouping

One `<select>` drives both. `priority`, `date`, `oldest`, `created` sort via `getSorted()`
(line 1186); `site`, `person`, `label` group via `getGrouped()` (line 1196). Because a task
can carry several sites, **grouping duplicates a task into every group it belongs to** —
the visible count can exceed the number of tasks. Tasks with no value land in a
`(no site)` / `(no person)` / `(no label)` bucket.

### Filtering

`getFiltered(mode)` (line 1213). Modes: `board`, `today`, `done`, `search`.

**Filters combine with AND, not OR.** The code is
`afS.every(s => (t.sites||[]).includes(s))` — selecting DK *and* NO shows only tasks tagged
with **both**, not either. Same for people and labels. Priority and overdue use OR/boolean.
If users report "the filter hides everything", this is why.

Search matches title, note, richBody, sites, persons, tags and comment text, and is the
only mode that includes completed tasks.

### Mentions

`@` autocomplete over persons + sites + labels. Wired up by `initMentionInput()`, which is
called on exactly one element: the detail-modal comment box. `linkify()` (line 1310) renders
`@name` as a clickable span that pushes the mention into the search box. The mention regex
allows one or two words, so three-part names are only partly matched.

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

Because attachments are base64 inside the document (defect 5), merging two tasks that both
carry images can exceed the 1 MiB limit. The preview shows the serialized size, warns above
~880 KB, and disables the confirm button above ~977 KB rather than letting the write fail
silently. Excluding B's attachments is the escape hatch.

If B was pinned in Today focus, the pin is moved to A rather than left pointing at a
deleted document. The trash copy of B carries `mergedInto: <A's id>` alongside the usual
`originalId`, so a merge is distinguishable from a plain delete.

---

## 5. Known defects and constraints

Confirmed by reading the source, not by guessing. Roughly ordered by impact.

**1. Rich-editor formatting is discarded on save.**
`saveRichTask()` (line 1847) persists
`document.getElementById('richBody').innerText`. The toolbar's bold, italic, H1, H2, bullet,
numbered and divider commands all apply real formatting in the contenteditable, and all of
it is dropped the moment you save. `openRichEditor()` likewise assigns `.innerText`, so
nothing could round-trip even if it were stored. Fixing this means storing
`.innerHTML`, running it through `sanitizeRichBody()` on the way in, and rendering it as
HTML in the detail modal instead of through `linkify()`.

**2. "Draft saved" in the rich editor is a lie.**
`richAutoSave()` (line 1831) sets the status text to "Saving…", then on an 800 ms timer sets
it to "Draft saved". It never writes to Firestore or localStorage. Navigating away without
pressing "Save to Board" loses everything — after the UI reported it saved. This is the
most likely cause of any "I lost my note" report.

**3. Drag-to-reorder in the Today list throws.**
`renderTodayFocus()` (line 1976) emits `ondragstart="todayDragStart(event,i)"`,
`ondragover="todayDragOver(event)"` and `ondrop="todayDrop(event,i)"`. **None of the three
functions exists** anywhere in the file. Dragging raises a `ReferenceError`. The ↑/↓ buttons
(`moveTodayItem`) work fine, so the feature is not entirely absent — either implement the
three handlers or drop the `draggable` attribute.

**4. Five `onclick` attributes are malformed.**
Lines 1330, 1338, 1339, 1386 and 2186 build handlers as `onclick="fn(\"'+id+'\")"`. Inside a
single-quoted JS string `\"` is just `"`, so the emitted HTML is
`onclick="toggleDone("abc123")"` — the attribute value terminates at the second quote and
the handler is truncated to `toggleDone(`. Broken as a result:

- grid view: the done checkbox, the ✏️ edit button, the 📝 note button;
- list view: clicking an attachment thumbnail to open the lightbox;
- detail modal: the same attachment thumbnails.

The fix is to use `\'` (escaped single quotes) as every other call site in the file already
does.

**5. Attachments will hit the Firestore 1 MiB document limit.**
`MAX_FILE_SIZE` is 500 KB per file (line 2340), but files are stored as base64 data URLs
*inside the task document*. Base64 adds ~33%, so one 500 KB image is ~683 KB of the 1 MiB
budget. **Two images on one task exceeds the limit and the write fails.** Comments,
history and action items share the same budget. A `storageBucket` is already provisioned —
moving attachments to Firebase Storage and keeping only URLs in the document is the real
fix. Meanwhile, lowering the cap to ~200 KB would at least keep failures rare.

**6. `Ctrl+K` does not do what the UI says.**
The search box placeholder reads "Search… (Ctrl+K)", but the keydown handler (line 2464)
maps `Ctrl/Cmd+K` to `openModal()` — new task. Either change the placeholder or focus the
search input.

**7. SortableJS is loaded and never used.**
`new Sortable` appears zero times. ~40 KB of CDN JavaScript downloaded on every load for
nothing. Either delete the script tag or use it to fix defect 3.

**8. `sanitizeRichBody()` is dead code.**
Defined at line 1771, called nowhere. It becomes necessary the moment defect 1 is fixed;
until then it is inert.

**9. Completing a task from the detail modal skips history.**
`toggleDone()` (line 1520) appends a `completed`/`reopened` history entry.
`toggleDoneFromDetail()` (line 2312) writes only `{done: !t.done}`. The History section
silently misses completions made from the detail modal.

**10. Sign-out leaks listeners.**
`handleUser()`'s else-branch unsubscribes `tasks`, `sites`, `persons` and `projectTasks`,
but not `meta/settings`, `meta/todayFocus` or `trash`. `startTodayFocusListener()` and
`startTrashListener()` both early-return if their unsub variable is truthy and never clear
it, so those listeners survive a sign-out and stay attached under the next account.

**11. `esc()` is incomplete.**
`esc()` (line 1401) escapes backslashes and single quotes for interpolation into inline
handlers, but not double quotes or `<`. A site, person or label containing a `"` will break
the surrounding attribute. `escHtml()` handles text content correctly; the two are easy to
reach for interchangeably and are not interchangeable.

**12. Dead variables.** `modalAutoSaveTimer` and `modalDraftId` (lines 2336–2337) are never
read. `fActions`'s declaration is grouped with the filter variables on line 947 despite
being modal state.

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
- **Dates are compared as `YYYY-MM-DD` strings** in the browser's local timezone via
  `new Date().toISOString()`. `toISOString()` is UTC, so between 00:00 and 02:00 local
  summer time "today" is still yesterday's date for a Nordic user.
- **Deletion is soft, restore is not identity-preserving.** See the `trash` notes above.

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
