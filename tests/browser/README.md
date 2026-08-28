# WorkBoard — browser tests

Headless-browser regression tests for `index.html`. They drive the real UI — clicking
buttons, reading rendered DOM, measuring laid-out boxes — which is the only way some of
these defects were catchable at all: the first attempt at the lightbox fix looked correct
in the source and did nothing, and only a test that measured the rendered image caught it.

`wb-logic-tests.js` in the folder above covers pure functions. These cover everything that
needs a DOM, CSS and a layout pass.

## How it works

There is no copy of the app here. `build-harness.js` reads `index.html` from the git clone,
strips the three Firebase CDN `<script>` tags, and prepends `stub.html` — an offline
stand-in for `firebase-app`, `firebase-auth` and `firebase-firestore` that:

- serves a small fixed board out of `window.__DATA` (tasks, trash, attachments, meta),
- signs in automatically as a fake user, so no popup and no network,
- records **every** write to `window.__WB_WRITES` as `{op, coll, id, data}`, which is how
  the suites assert what the app *would* have sent to Firestore,
- applies writes back into `window.__DATA`, so a re-`startListeners()` sees them.

The result is `test.html`. It is generated, never edited, and never committed to the app
repo. Tests always exercise the shipped code, never a copy of it.

## Running them

Playwright and its Chromium build are large. Install them **outside** this folder —
OneDrive would sync thousands of files — and point `NODE_PATH` at the install:

```
mkdir %LOCALAPPDATA%\wb-test-deps
cd %LOCALAPPDATA%\wb-test-deps
npm install playwright
npx playwright install chromium
set NODE_PATH=%LOCALAPPDATA%\wb-test-deps\node_modules
```

Then run everything with one command:

```
node run-all.js
```

It rebuilds `test.html` from the current `index.html`, starts `serve.js` on
127.0.0.1:8777, runs all eight suites, prints each one's counts and stops the server.
Exit code 0 means everything is green.

The suites load the harness over HTTP rather than `file://`, which breaks `fetch` and blob
handling. To run one suite on its own, start the server yourself first:

```
node serve.js          # one terminal
node pause.mjs         # another
```

`run-all.js` runs the suites with `execFileSync`, which blocks its own event loop
completely — hence a separate server process rather than an in-process one. That is worth
knowing before "simplifying" it.

## The suites

| File | Assertions | Covers |
|---|---|---|
| `drive.mjs` | 28 | Merge end to end: picker, per-field preview, the writes it produces, Today-pin transfer, Escape ordering |
| `fixes.mjs` | 27 | The note editor: formatting survives a save, autosave is real, drafts for brand-new notes, `richHtml` round-trips |
| `cleanup.mjs` | 24 | Today-panel drag handlers, the `Ctrl+K` shortcuts, labels containing quotes, and the removal of dead code |
| `backup.mjs` | 41 | Export and import: both modes, the preview arithmetic, old envelope versions, malformed files, re-runnability |
| `attach.mjs` | 29 | Attachments as separate payload documents, thumbnails, the size guard, backup coverage |
| `lb2.mjs` | 18 | The lightbox: it opens large enough to read, fit vs actual size, Escape ordering |
| `lb3.mjs` | 12 | Thumbnail quality: small images keep their original bytes, enlargement is capped, the readout follows |
| `pause.mjs` | 106 | Pause, repeat, the OR/AND filter change, end-of-month date clamping, and the bottom nav on a phone |
| `clickup.mjs` | 52 | The ClickUp hand-over: the text it prepares, the copy buttons, the Area memory, linking back, and that the page carries no credentials |
| `links.mjs` | 58 | Link parsing and the detail-modal Links section: Outlook mail recognition, the Label \| URL paste forms, scheme refusals, and attribute-safe escaping |
| `create.mjs` | 32 | Doing it all on the create screen: links and repeat while typing, the ids the save paths return, and Save &amp; ClickUp from both editors |
| `onedoor.mjs` | 31 | One create button and one editing door: the escalation to the full page carries everything typed, and Edit follows what the task actually is |
| `upkeep.mjs` | 50 | The two Today counts, the pinned list following the live task, render coalescing and the no-write guard, the backup-age banner, and Trash keeping a restored task's id |

508 assertions in total.

## Writing more

Two traps, both of which produced false green results in this suite already:

1. **A helper that passes on any non-`false` return will pass on a string.** Return `true`
   for a pass and an object for a failure; never let a bare value through.
2. **The stub emits a snapshot only when you subscribe.** After a write that the app would
   normally see echoed back, call `startListeners()` and wait before asserting on
   in-memory state, or the app's `tasks` array is still holding the old values.
