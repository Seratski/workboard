# WorkBoard

A single-file personal task board, built for one user, with tasks tagged by Nordic site,
person and label. No build step, no framework, no package manager — one `index.html`
served as a static file, with Google sign-in and a Firestore backend.

**Live:** https://seratski.github.io/workboard/
**Hosting:** GitHub Pages, served from `main` in this repository.

---

## Quick facts

| | |
|---|---|
| Source | `index.html` — HTML, CSS and JavaScript in one file (~2,500 lines) |
| Build | None. The file is the artifact. |
| Backend | Firebase project `workboard-b9078` (Firestore + Google Auth) |
| Runtime deps | Firebase 10.14.1 (compat SDK), SortableJS 1.15.2, Google Fonts — all via CDN |
| Data scope | **Single-user by design.** No per-user scoping exists in the code — see Access model |

## Running it locally

Open `index.html` in a browser. That is the whole procedure.

Google sign-in uses `signInWithPopup`, which requires the page's origin to be listed in
the Firebase console under **Authentication → Settings → Authorized domains**. From
`file://` the popup will fail, so for local auth testing serve it over HTTP instead:

```bash
python -m http.server 8000     # then open http://localhost:8000
```

`localhost` is authorised by default in Firebase.

## Deploying a change

1. Edit `index.html`.
2. Commit and push to `main`.
3. GitHub Pages redeploys within a minute or two. Hard-refresh to bypass the cache.

There is no staging environment and no test suite. A push to `main` is a deploy, and the
deployed app talks to the production Firestore immediately — there is no second copy of the
data to break safely. Open the file locally and click through the affected screens first.

> **Note on history:** commits before May 2026 were made by uploading the file through
> the GitHub web UI, so they all read "Add files via upload" and carry no description of
> what changed. Commits from here on should say what they actually do.

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the data model, the Firestore document
shapes, the full feature inventory, a map of the code, and a list of known defects and
constraints. Read it before making non-trivial changes — several things in this app are
not what their names suggest.

## Access model

WorkBoard is a **single-user** application: one owner, one board. That is a product
decision, not something the code enforces. Two things follow from it, and they matter.

**The client enforces nothing.** `db.collection('tasks')` is queried with no `uid` in any
document path and no `where()` clause. `meta/todayFocus` and `meta/settings` are single
shared documents. Any account that gets read access lands on the same board.

**Google sign-in does not restrict *which* Google account may sign in.** The code uses a
plain `GoogleAuthProvider` with `prompt: 'select_account'` — no hosted-domain restriction,
no allowlist. Anyone with a Google account can complete authentication and become
`request.auth != null`.

Put together: **the Firestore security rules are the only access control in this system.**
A rule of the shape `allow read, write: if request.auth != null` would expose the entire
board to any Google account on earth. The rules must pin to the owner's identity. See
[`firestore.rules`](firestore.rules) for the correct shape and how to install it.

The deployed rules are pinned to the owner's UID (verified August 2026). They live in the
Firebase console and are **not** applied from this repository — editing `firestore.rules`
here changes nothing until it is pasted into the console and published. It is committed as
the reviewable record of what the rules are supposed to say, so that a drift between the
two is visible.

The Firebase config in `index.html` (including `apiKey`) is public by design; Firebase web
API keys identify a project rather than authorising access to it. This repository being
public is therefore not a key leak — but it does mean the rules carry the entire security
burden, and that the app's URL is discoverable.

## Known defects

Confirmed by reading the source, in rough order of impact:

1. **Rich-editor formatting is discarded on save.** The toolbar applies bold, headings and
   lists in the editor, but `saveRichTask()` persists `.innerText`, so only plain text
   survives.
2. **"Draft saved" in the rich editor saves nothing.** `richAutoSave()` updates a label on
   a timer and never writes to Firestore. Leaving the editor without pressing "Save to
   Board" loses the work, after the UI said it was saved.
3. **Drag-to-reorder in the Today panel throws.** `todayDragStart`, `todayDragOver` and
   `todayDrop` are referenced in the markup but never defined. The ↑/↓ buttons work.
4. **Five broken `onclick` attributes.** A `\"` escaping mistake terminates the attribute
   early, disabling the grid-view checkbox and edit/note buttons, and the attachment
   lightbox in both list view and the detail modal.
5. **Attachments will hit the Firestore document limit.** Images are stored as base64 data
   URLs inside the task document. The 500 KB per-file cap becomes ~683 KB encoded against
   a hard 1 MiB per-document limit, so two images on one task fail to save. A
   `storageBucket` is configured but Firebase Storage is never used.

Full detail, plus the smaller issues and dead code, in ARCHITECTURE.md.
