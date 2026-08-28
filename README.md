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
| Source | `index.html` — HTML, CSS and JavaScript in one file (~4,300 lines) |
| Build | None. The file is the artifact. |
| Backend | Firebase project `workboard-b9078` (Firestore + Google Auth) |
| Runtime deps | Firebase 10.14.1 (compat SDK), Google Fonts — both via CDN |
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

There is no staging environment. A push to `main` is a deploy, and the deployed app talks
to the production Firestore immediately — there is no second copy of the data to break
safely. Click through the affected screens first.

## Tests

`tests/` holds 287 pure-logic assertions and 508 headless-browser ones, and
[GitHub Actions](.github/workflows/tests.yml) runs all of them on every push. Both suites
read functions and markup **straight out of `index.html`** rather than a fixture of it, so
they exercise the file that ships. `tests/browser/test.html` is generated on each run and is
gitignored.

CI cannot block a deploy — Pages publishes `main` whether the run is green or red — so treat
a red tick as "look at what you just shipped". The run also fails if an owner UID, an API
token, a private key or a real Outlook mailbox id ever appears in a tracked file.

To run them by hand you need Node plus `jsdom` and `playwright`; see `START-HERE.md` in
`NCS Projects\WorkBoard Claude`.

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

## Pausing and repeating

**Pause** puts a task aside until a date. Open a task, choose **Pause**, pick a preset or a
date. A paused task leaves the board, the Today list and the counts, and comes back on its
own on the day chosen — nothing needs to run for that to happen. Paused tasks live on their
own **⏸️ Paused** page, and search still finds them the whole time.

**Repeat** is set per task in the editor: every *n* days, weeks or months, counted either
from the task's due date or from the day it is finished. Ticking the task off creates the
next occurrence there and then, with the action items reset and the attachments left
behind. Nothing is scheduled server-side.

**Filters** combine as OR inside a group and AND across groups: DK + NO gives tasks from DK
*or* NO; add the person Martin and you get those *also* assigned to Martin. This changed in
August 2026 — it used to require a task to carry every selected value at once, which meant
picking two sites usually returned nothing.

## Creating and editing a task

One button: **+ Task**. If the note turns out to need more room, **Write on a full page ↗**
next to the Note field moves everything you have typed into the full-page editor — nothing
is lost and nothing is saved twice. Do it while editing an existing task and that task
becomes a formatted one, in place.

**Edit** follows the task: one with a formatted note opens in the full-page editor, anything
else opens the quick box. There used to be two of each — "+ Task" and "+ Note" that made the
same thing, and "Edit" and "Open note" where Edit quietly wrote to a field the app never
displays.

## Links, and mail from Outlook

Paste a URL into the **Links** field — on the create screen while you are typing the task,
or on an existing task by opening it; either way, no trip through Edit. An
Outlook or OWA link is recognised and labelled **📧 Mail**, with its own colour on the
task row, so a thread you have to go back and read stands out from an ordinary reference.

You can name it in the same paste: `Anna · Returflow SOP | https://outlook…`, or without the
bar at all — anything in front of the URL becomes the label. Only `http`, `https` and
`mailto` links are accepted, and text with no URL in it is refused rather than guessed at.

There is no way to store a mail itself. In order of usefulness: **link to it** (one click
reaches the real thread, with its attachments and the rest of the conversation); paste the
mail's text into a note (formatting is dropped on purpose); print it to PDF and attach the
PDF; or snip it with Win+Shift+S and paste the image while the task modal or note editor is
open. Attachments are capped at 700 KB each and accept images and PDFs.

## Sending a task to ClickUp

**📤 Save & ClickUp** while creating the task, or **📤 ClickUp** in the detail modal for one
that already exists. Pick an Area, and the dialog hands you the two things
ClickUp asks for: the task name, and a description block built from the note, the action
items (as an unticked checklist), the due date, sites, people and labels. One button copies
the name and opens the *NCS BO Team* list; paste the rest yourself. Paste the new task's URL
back and it is kept as a link on the WorkBoard task, which then shows a 📤 chip.

It is a hand-over, not an integration: **WorkBoard holds no ClickUp credentials and must not.**
A ClickUp personal token reaches everything its owner can see in the whole workspace, and
this page is public and renders note bodies as HTML — a token here would be one bug away
from being a company-wide problem. A one-click version is possible, but the token has to
live in a small server-side proxy, not in the browser. See ARCHITECTURE.md.

The Area list in the code is a snapshot of ClickUp's, so a new Area added in ClickUp has to
be added here too.

## Backup and restore

**This board is the only copy of its data.** Nothing backs it up on a schedule — a static
page cannot — so WorkBoard records when you last exported and says so on the board after two
weeks, in red after a month. Settings shows the date next to the Export button. One click
resets it.



**Settings → Data backup.** Export writes one JSON file containing tasks, trash, sites,
people, labels, defaults and the Today list. Import reads it back, shows exactly what will
change, and only then writes — in one of two modes: *Add missing only*, which touches
nothing that already exists, or *Replace everything*, which makes the board match the file
and deletes what is not in it (two clicks required).

Tasks and attachment payloads are restored under their original ids, so an import is
idempotent and safe to re-run. Older backup formats still load.

Restoring a single task from **Trash** also puts it back under its original id, so a pinned
Today item still points at it. Trash does not expire by itself — it is the undo buffer — but
each entry shows its age and one button clears everything older than 30 days.

## Known defects

Nothing currently known loses data. Two things worth having in mind, both detailed in
ARCHITECTURE.md: every Firestore snapshot re-renders every list, which is the visible
flicker on iPhone and the first thing to look at if the board ever feels slow; and Trash
never expires, with a restore creating a new document id, so a pinned Today item does not
follow its task back.

Fixed in August 2026 and described in ARCHITECTURE.md:

- The note editor discarded all formatting on save, and its "Draft saved" label saved
  nothing at all. Notes are now stored as sanitized HTML and autosave is real.
- Dragging an item in the Today panel raised a `ReferenceError` — the three handlers the
  markup called had never been written.
- Five `onclick` attributes were malformed by a `\"` escaping mistake, which broke the
  attachment lightbox in list view and the detail modal.
- `Ctrl+K` opened a new task while the search box claimed it focused search. It now
  focuses search; `Ctrl+Shift+K` creates a task.
- Dates were derived from `toISOString()`, which is UTC, so "today" and "overdue" were
  wrong between midnight and 02:00 Nordic summer time.
- SortableJS was downloaded on every page load and never used. It is gone.
- Completing a task from the detail modal skipped its history entry, and signing out
  leaked three listeners.
- Attachments were base64 inside the task document, so two images on one task breached
  Firestore's 1 MiB limit and the save failed silently. Payloads now live one per document
  in `attachments/`, with a small thumbnail on the task.
- The bottom navigation bar never displayed. `.bottom-nav` was `display:none` with nothing
  to turn it on, and the top nav tabs are hidden below 700px, so on a phone there was no
  way to reach Today, Done, Filter or Settings at all.
- Filters required a task to carry *every* selected site, person and label at once, so
  selecting two sites usually returned an empty board.
- Grid cards emitted a checkbox and edit buttons that CSS hid with no hover rule — rendered,
  never reachable. The markup is gone; the card opens the detail modal, which has both.
- A merge silently dropped the surviving task's repeat rule.
- `escHtml` did not escape quotes, although it is used inside `href` and `alt` attributes,
  so a crafted link URL could have added an attribute of its own.
- Links could only be added by opening a task for edit; the detail modal had the CSS for a
  Links section but never rendered one.
- A new task could not be handed to ClickUp while being created — you had to save it, find
  it again and open it. Both editors now have a Save & ClickUp button.
- The upload zone claimed a 500 KB limit; the code has always enforced 700 KB.
- Editing a task that had a formatted note through the small edit box saved the change to a
  field the app never displays, so the edit vanished from view. Edit now opens the editor
  that matches the task.
- The Today page showed the pinned count or the due-today count in the same field, whichever
  rendered last, and the "Due today" heading's own count was never filled.
- The pinned Today list showed the title and done flag copied when the task was pinned, so a
  rename or a completion elsewhere never reached it.
- One page load performed four complete re-renders of every list, and every later snapshot
  replaced all fourteen lists whether anything had changed or not. Now: one render per
  frame, and nothing written when nothing changed.
- Restoring from Trash created a new document, orphaning anything that pointed at the old id.
- A floating action button had CSS and three lookups but no element.

Full detail, plus the smaller issues and dead code, in ARCHITECTURE.md.
