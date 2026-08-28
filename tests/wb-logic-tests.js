/*
 * WorkBoard — pure-logic regression tests.
 *
 * Extracts functions straight out of index.html and asserts against them, so the tests
 * exercise the shipped code rather than a copy. No build step, no test framework.
 *
 * Needs jsdom, and nothing else. GitHub Actions installs it on every push (see
 * .github/workflows/tests.yml). To run it by hand, install jsdom anywhere and point
 * NODE_PATH at it -- do NOT install it beside this file if the checkout is inside a synced
 * folder, because node_modules is ~1800 files:
 *
 *   npm install jsdom          # somewhere outside the repository
 *   NODE_PATH=<that>/node_modules node tests/wb-logic-tests.js
 *
 * With no argument it reads the index.html next to tests/.
 * Exit code 0 = all green, 1 = a failure, 2 = could not set up.
 * Covers: merge field rules, union/dedup, comment + history ordering, richHtml handling,
 * the sanitizer, the document-size guard, the merge picker's sort order, the pause
 * (snooze) rule, date arithmetic including end-of-month clamping, the repeat rule, the
 * filter combination logic (OR within a group, AND across groups), the text the ClickUp
 * hand-over prepares, and link parsing including Outlook mail recognition.
 */
const fs = require('fs');
const path = require('path');

// Default: index.html one level up from tests/. Pass a path to test a different copy.
const INDEX = process.argv[2] || path.join(__dirname, '..', 'index.html');

const html = fs.readFileSync(INDEX, 'utf8');
const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
const src = scripts.map(s => s.replace(/^<script>/, '').replace(/<\/script>$/, ''))
                   .find(s => s.includes('firebaseConfig'));
if (!src) { console.error('Could not find the application script in ' + INDEX); process.exit(2); }

function grab(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('function not found in index.html: ' + name);
  let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.error('jsdom is required:  npm install jsdom'); process.exit(2); }
const dom = new JSDOM('<body></body>');
global.document = dom.window.document;
global.NodeFilter = dom.window.NodeFilter;

const sepMatch = /const MERGE_TEXT_SEP=('(?:[^'\\]|\\.)*');/.exec(src);
if (!sepMatch) throw new Error('MERGE_TEXT_SEP not found');
eval('globalThis.MERGE_TEXT_SEP=' + sepMatch[1] + ';');

// backupPreview and taskForWrite read module-level globals and the firebase namespace.
globalThis.tasks = [];
globalThis.sites = [];
globalThis.persons = [];
globalThis.projectTasks = [];
function FakeTs(sec, ns) { this.seconds = sec; this.nanoseconds = ns; }
FakeTs.fromDate = d => new FakeTs(Math.floor(d.getTime() / 1000), 0);
globalThis.firebase = {
  firestore: { Timestamp: FakeTs, FieldValue: { serverTimestamp: () => '__server_ts__' } }
};

eval([
  'escHtml', 'esc', 'todayStr', 'isOverdue', 'richPlainText', 'sanitizeRichBody',
  'normalizeBackup', 'reviveTs', 'taskForWrite', 'backupPreview',
  'attachForTask', 'attachPreviewSrc', 'isImageAttach', 'countLegacyAttachments',
  'taskBodyText', 'mergeBodyText', 'mergeBodyHtml', 'mergeJoinHtml', 'mergeJoinText',
  'mergeUniq', 'mergeUniqBy', 'buildMergedData', 'mergeDocSize', 'mergePickSort',
  'dateFromStr', 'addDays', 'addMonths', 'addDaysStr', 'addMonthsStr',
  'isPaused', 'nextRepeatDate', 'repeatText', 'getFiltered', 'formatDate', 'cuBodyText',
  'isMailLink', 'linkIcon', 'linkLabel', 'parseLinkInput'
].map(grab).join('\n'));

let pass = 0, fail = 0, group = '';
function section(n) { group = n; console.log('\n' + n); }
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '   got: ' + detail : '')); }
}

const base = { sites: [], persons: [], tags: [], actions: [], links: [], attachments: [],
               comments: [], history: [], done: false, priority: 'none', date: '' };
const C = { title: 'a', priority: 'a', date: 'a', text: 'both', secAttach: true };
const ts = ms => ({ toMillis: () => ms });

// ---------------------------------------------------------------- merge: combining
section('merge — field rules and de-duplication');
const A = { ...base, id: 'a1', title: 'Fix DK pricing', note: 'Short note A',
  priority: 'medium', date: '2026-09-01',
  sites: ['DK', 'NO'], persons: ['Martin'], tags: ['pricing'],
  actions: [{ text: 'Call vendor', assignee: 'Martin', done: false }],
  links: [{ name: 'Sheet', url: 'https://x/1' }],
  attachments: [{ name: 'a.png', type: 'image/png', data: 'data:image/png;base64,AAAA', size: 100 }],
  comments: [{ text: 'second', time: 2000 }],
  history: [{ type: 'created', time: 100 }, { type: 'edited', time: 300 }] };
const B = { ...base, id: 'b1', title: 'DK price bug', note: 'Short note B',
  priority: 'high', date: '2026-08-20', done: true,
  sites: ['NO', 'SE'], persons: ['Martin', 'Anna'], tags: ['pricing', 'bug'],
  actions: [{ text: 'Call vendor', assignee: 'Martin', done: true },
            { text: 'Update sheet', assignee: '', done: false }],
  links: [{ name: 'Same', url: 'https://x/1' }, { name: 'Other', url: 'https://x/2' }],
  attachments: [{ name: 'b.png', type: 'image/png', data: 'data:image/png;base64,BBBB', size: 200 }],
  comments: [{ text: 'first', time: 1000 }, { text: 'third', time: 3000 }],
  history: [{ type: 'created', time: 200 }] };

let d = buildMergedData(A, B, C);
ok('title taken from A', d.title === 'Fix DK pricing', d.title);
ok('priority taken from A', d.priority === 'medium', d.priority);
ok('due date taken from A', d.date === '2026-09-01', d.date);
ok('done taken from A, not B', d.done === false, d.done);
ok('sites unioned, A order kept', JSON.stringify(d.sites) === '["DK","NO","SE"]', JSON.stringify(d.sites));
ok('persons unioned', JSON.stringify(d.persons) === '["Martin","Anna"]', JSON.stringify(d.persons));
ok('labels unioned', JSON.stringify(d.tags) === '["pricing","bug"]', JSON.stringify(d.tags));
ok('actions deduped on text+assignee', d.actions.length === 2, d.actions.length);
ok('duplicate action keeps A copy', d.actions[0].done === false);
ok('links deduped on url', d.links.length === 2, d.links.length);
ok('attachments unioned', d.attachments.length === 2, d.attachments.length);
ok('comments sorted by time', d.comments.map(c => c.text).join(',') === 'first,second,third',
   d.comments.map(c => c.text).join(','));
ok('history sorted by time', d.history.slice(0, 3).map(h => h.time).join(',') === '100,200,300',
   d.history.slice(0, 3).map(h => h.time).join(','));
ok('merged entry appended last', d.history[d.history.length - 1].type === 'merged');

section('merge — choosing sides');
d = buildMergedData(A, B, { ...C, title: 'b', priority: 'b', date: 'b', text: 'b' });
ok('title from B', d.title === 'DK price bug', d.title);
ok('priority from B', d.priority === 'high', d.priority);
ok('date from B', d.date === '2026-08-20', d.date);
ok('note from B only', d.note === 'Short note B', d.note);
d = buildMergedData(A, B, C);
ok('both notes joined by separator',
   d.note === 'Short note A' + MERGE_TEXT_SEP + 'Short note B', JSON.stringify(d.note));
d = buildMergedData(A, B, { ...C, secAttach: false });
ok('B attachments excluded on request', d.attachments.length === 1 && d.attachments[0].name === 'a.png');

section('merge — empty and missing fields');
const E = { ...base, id: 'e', title: '', note: '' };
ok('empty side adds no separator', buildMergedData(A, E, C).note === 'Short note A');
ok('both empty gives empty note', buildMergedData(E, E, C).note === '');
ok('bare objects do not throw', Array.isArray(buildMergedData({}, {}, C).sites));

section('merge — long text moves into richBody');
const long = { ...base, id: 'l', title: 'l', note: 'x'.repeat(900) };
d = buildMergedData(long, E, C);
ok('long text stored in richBody', d.richBody === 'x'.repeat(900), (d.richBody || '').length);
ok('note truncated to 500', d.note.length === 500, d.note.length);

// ---------------------------------------------------------------- richHtml
section('formatted notes (richHtml)');
const HTML = { ...base, id: 'h', title: 'HTML note', richHtml: true,
               richBody: '<h2>Head</h2><p><b>bold</b></p>', note: 'Head bold' };
const PLAIN = { ...base, id: 'p', title: 'Plain note',
                richBody: 'line one\nline two', note: 'line one\nline two' };

d = buildMergedData(HTML, { ...HTML, id: 'h2', richBody: '<p>second</p>', note: 'second' }, C);
ok('HTML + HTML flags richHtml', d.richHtml === true);
ok('HTML + HTML joined with <hr>', d.richBody.includes('<hr>'), d.richBody);
ok('note stays plain text', !d.note.includes('<'), JSON.stringify(d.note));

d = buildMergedData(HTML, PLAIN, C);
ok('HTML + plain flags richHtml', d.richHtml === true);
ok('plain side wrapped in <p>', d.richBody.includes('<p>line one'), d.richBody);
ok('plain newlines become <br>', d.richBody.includes('<br>'), d.richBody);
ok('HTML side untouched', d.richBody.includes('<h2>Head</h2>'));
ok('HTML + empty adds no stray <hr>', !buildMergedData(HTML, E, C).richBody.includes('<hr>'));

d = buildMergedData(PLAIN, { ...base, id: 'n', title: 'n', note: 'just a note' }, C);
ok('plain + plain does NOT flag richHtml', d.richHtml === undefined, d.richHtml);
ok('plain + plain introduces no markup', !(d.richBody || '').includes('<p>') && !d.note.includes('<p>'));

d = buildMergedData(HTML, PLAIN, { ...C, text: 'a' });
ok('A-only keeps A markup verbatim', d.richBody === '<h2>Head</h2><p><b>bold</b></p>', d.richBody);
d = buildMergedData(HTML, PLAIN, { ...C, text: 'b' });
ok('B-only wraps B plain text', d.richBody === '<p>line one<br>line two</p>', d.richBody);
ok('B-only still HTML because A was', d.richHtml === true);

section('plain-text extraction');
ok('block boundaries become newlines',
   richPlainText('<p>one</p><p>two</p>').split('\n').filter(Boolean).join('|') === 'one|two',
   JSON.stringify(richPlainText('<p>one</p><p>two</p>')));
ok('<br> becomes a newline', richPlainText('a<br>b') === 'a\nb', JSON.stringify(richPlainText('a<br>b')));
ok('list items separated', richPlainText('<ul><li>x</li><li>y</li></ul>').includes('x\ny'),
   JSON.stringify(richPlainText('<ul><li>x</li><li>y</li></ul>')));
ok('no tags survive', richPlainText('<h1>t</h1><p>b</p>').indexOf('<') === -1);
ok('empty input safe', richPlainText('') === '' && richPlainText(null) === '');
ok('taskBodyText strips HTML for richHtml tasks', taskBodyText(HTML).indexOf('<') === -1, taskBodyText(HTML));
ok('taskBodyText passes plain through', taskBodyText(PLAIN) === 'line one\nline two');

section('sanitizer');
const NASTY = { ...base, id: 'x', title: 'x', richHtml: true,
                richBody: '<p>ok</p><script>bad()</script><img src=x onerror=alert(1)><b>keep</b>' };
d = buildMergedData(NASTY, E, C);
ok('script element removed', !d.richBody.toLowerCase().includes('<script'), d.richBody);
ok('img element removed', !d.richBody.toLowerCase().includes('<img'), d.richBody);
ok('event handler attribute removed', !d.richBody.toLowerCase().includes('onerror'), d.richBody);
ok('allowed formatting kept', d.richBody.includes('<p>ok</p>') && d.richBody.includes('<b>keep</b>'));

section('document size guard');
const heavy = n => ({ ...base, id: n, title: n,
  attachments: [{ name: n + '.png', type: 'image/png', data: 'd'.repeat(700000), size: 500000 }] });
const h1 = heavy('one'), h2 = heavy('two');
ok('identical attachments dedupe to one',
   buildMergedData(h1, { ...h1, id: 'dup' }, C).attachments.length === 1);
d = buildMergedData(h1, h2, C);
ok('distinct heavy attachments both kept', d.attachments.length === 2);
ok('combined size exceeds the 1MiB guard', mergeDocSize(d) > 1000000, mergeDocSize(d));
ok('excluding B attachments drops back under',
   mergeDocSize(buildMergedData(h1, h2, { ...C, secAttach: false })) < 1000000);

section('merge picker sort order');
const list = [
  { id: 'old', createdAt: ts(1000), done: false },
  { id: 'newer', createdAt: ts(3000), done: false },
  { id: 'doneNewest', createdAt: ts(9000), done: true },
  { id: 'pending', createdAt: null, done: false },
  { id: 'mid', createdAt: ts(2000), done: false }
];
const order = mergePickSort(list).map(x => x.id);
ok('just-created task (pending timestamp) sorts first', order[0] === 'pending', order.join(','));
ok('then newest first', order.slice(0, 4).join(',') === 'pending,newer,mid,old', order.join(','));
ok('completed task sorts last despite newest date', order[order.length - 1] === 'doneNewest');
ok('input array not mutated', list[0].id === 'old');
ok('two pending tasks do not break the comparator',
   mergePickSort([{ id: 'p1', createdAt: null }, { id: 'p2', createdAt: null }, { id: 'a', createdAt: ts(5) }])
     .map(x => x.id).join(',') === 'p1,p2,a');
ok('empty list handled', mergePickSort([]).length === 0);

section('local dates (todayStr)');
{
  const d = new Date(2026, 0, 5, 12, 0, 0);            // 5 Jan 2026, local
  ok('pads month and day', todayStr(d) === '2026-01-05', todayStr(d));
  const d2 = new Date(2026, 11, 31, 23, 59, 0);
  ok('year end correct', todayStr(d2) === '2026-12-31', todayStr(d2));
  // The bug this replaced: just after local midnight, UTC is still the previous day.
  const justAfterMidnight = new Date('2026-08-27T00:30:00+02:00');
  const utcKey = justAfterMidnight.toISOString().slice(0, 10);
  const localKey = todayStr(justAfterMidnight);
  ok('UTC really does disagree just after local midnight', utcKey === '2026-08-26', utcKey);
  if (process.env.TZ === 'Europe/Copenhagen') {
    ok('todayStr returns the local day, not the UTC one', localKey === '2026-08-27', localKey);
  } else {
    console.log('  note: run with TZ=Europe/Copenhagen to assert the timezone case');
  }
  ok('todayStr defaults to now', /^\d{4}-\d{2}-\d{2}$/.test(todayStr()));
}

section('esc() — escaping for inline handlers');
ok('single quote escaped for JS', esc("it's") === "it\\'s", JSON.stringify(esc("it's")));
ok('double quote escaped for HTML', esc('a"b') === 'a&quot;b', esc('a"b'));
ok('angle brackets escaped', esc('<x>') === '&lt;x&gt;', esc('<x>'));
ok('ampersand escaped first', esc('a&b') === 'a&amp;b', esc('a&b'));
ok('backslash escaped', esc('a\\b') === 'a\\\\b', JSON.stringify(esc('a\\b')));
ok('null and undefined safe', esc(null) === '' && esc(undefined) === '');
{
  // The real failure mode: a label containing a quote used to end the attribute early.
  const attr = 'onclick="tF(\'t\',\'' + esc('Say "hi" & <go>') + '\')"';
  ok('attribute is not terminated early', (attr.match(/"/g) || []).length === 2, attr);
  ok('no raw < survives into the attribute', attr.indexOf('<') === -1, attr);
}

section('isOverdue uses local dates');
ok('yesterday is overdue', isOverdue(todayStr(new Date(Date.now() - 86400000))) === true);
ok('today is not overdue', isOverdue(todayStr()) === false);
ok('tomorrow is not overdue', isOverdue(todayStr(new Date(Date.now() + 86400000))) === false);
ok('empty date is not overdue', isOverdue('') === false && isOverdue(null) === false);

section('backup — reading a file (normalizeBackup)');
{
  const v1 = { workboard: 1, exportedAt: '2026-08-27T10:00:00.000Z',
    tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    trash: [{ id: 'z', title: 'Z' }],
    meta: { sites: ['DK'], persons: ['Martin'], projectTasks: ['x'],
            settings: { defaultLabel: 'x' }, todayFocus: [{ id: 'a', title: 'A', done: false }] } };
  let n = normalizeBackup(v1);
  ok('v1 version read', n.version === 1);
  ok('v1 tasks read', n.tasks.length === 2);
  ok('v1 trash read', n.trash.length === 1);
  ok('v1 meta lists read', n.sites.length === 1 && n.persons.length === 1 && n.projectTasks.length === 1);
  ok('v1 settings read', n.settings.defaultLabel === 'x');
  ok('v1 today list read', n.todayFocus.length === 1);

  // the pre-v1 flat export must still load
  const v0 = { tasks: [{ id: 'a', title: 'A' }], sites: ['DK', 'NO'], persons: [], projectTasks: ['old'] };
  n = normalizeBackup(v0);
  ok('old format accepted', n.tasks.length === 1);
  ok('old format flagged as version 0', n.version === 0);
  ok('old format sites read', n.sites.join(',') === 'DK,NO');
  ok('old format has no trash', n.trash.length === 0);
  ok('old format has no today list', n.todayFocus.length === 0);

  ok('non-object rejected', (() => { try { normalizeBackup('nope'); return false; } catch (e) { return true; } })());
  ok('array rejected', (() => { try { normalizeBackup([1, 2]); return false; } catch (e) { return true; } })());
  ok('missing tasks rejected', (() => { try { normalizeBackup({ workboard: 1 }); return false; } catch (e) { return true; } })());
  ok('null rejected', (() => { try { normalizeBackup(null); return false; } catch (e) { return true; } })());
  ok('junk entries in tasks filtered out',
     normalizeBackup({ tasks: [{ id: 'a' }, null, 'str', 5, [], { id: 'b' }] }).tasks.length === 2);
  ok('error message names the problem',
     (() => { try { normalizeBackup({}); } catch (e) { return /tasks/.test(e.message); } })());
}

section('backup — timestamps survive a round trip');
ok('{seconds,nanoseconds} revived', reviveTs({ seconds: 1787000000, nanoseconds: 5 }) instanceof FakeTs);
ok('seconds preserved', reviveTs({ seconds: 1787000000, nanoseconds: 5 }).seconds === 1787000000);
ok('underscored form revived', reviveTs({ _seconds: 42, _nanoseconds: 0 }).seconds === 42);
ok('ISO string revived', reviveTs('2026-08-27T10:00:00.000Z') instanceof FakeTs);
ok('garbage string gives null', reviveTs('not a date') === null);
ok('null gives null', reviveTs(null) === null && reviveTs(undefined) === null);
{
  const t = { id: 'keep-me', title: 'T', createdAt: { seconds: 100, nanoseconds: 0 } };
  const w = taskForWrite(t);
  ok('id stripped from the written document', w.id === undefined);
  ok('createdAt revived, not stamped fresh', w.createdAt.seconds === 100);
  ok('missing updatedAt falls back to serverTimestamp', w.updatedAt === '__server_ts__');
  ok('other fields carried through', w.title === 'T');
  const w2 = taskForWrite({ id: 'x', title: 'Y' });
  ok('missing createdAt falls back to serverTimestamp', w2.createdAt === '__server_ts__');
}

section('backup — preview arithmetic');
{
  globalThis.tasks = [{ id: 'a' }, { id: 'b' }, { id: 'onlyOnBoard' }];
  globalThis.sites = ['DK'];
  globalThis.persons = ['Martin'];
  globalThis.projectTasks = [];
  const b = normalizeBackup({ workboard: 1,
    tasks: [{ id: 'a' }, { id: 'b' }, { id: 'newFromFile' }, { title: 'no id at all' }],
    trash: [{ id: 't1' }],
    meta: { sites: ['DK', 'NO'], persons: ['Anna'], projectTasks: ['lbl'], settings: {}, todayFocus: [{ id: 'a' }] } });

  const m = backupPreview(b, 'merge');
  ok('merge adds only unknown ids plus id-less', m.add === 2, m.add);
  ok('merge skips the two known ids', m.skip === 2, m.skip);
  ok('merge deletes nothing', m.remove === 0, m.remove);
  ok('id-less tasks counted', m.noId === 1, m.noId);
  ok('new sites counted', m.sitesNew === 1, m.sitesNew);
  ok('new people counted', m.personsNew === 1, m.personsNew);
  ok('new labels counted', m.labelsNew === 1, m.labelsNew);
  ok('trash count surfaced', m.trashInFile === 1);
  ok('today count surfaced', m.todayInFile === 1);

  const r = backupPreview(b, 'replace');
  ok('replace adds the same new ones', r.add === 2, r.add);
  ok('replace overwrites the known ids', r.overwrite === 2, r.overwrite);
  ok('replace removes the board-only task', r.remove === 1, r.remove);
  ok('replace never reports skips', r.skip === 0);

  // a file identical to the board should be a no-op in merge mode
  const same = normalizeBackup({ workboard: 1, tasks: [{ id: 'a' }, { id: 'b' }, { id: 'onlyOnBoard' }], meta: {} });
  const ms = backupPreview(same, 'merge');
  ok('identical file adds nothing', ms.add === 0 && ms.skip === 3, ms.add + '/' + ms.skip);
  ok('identical file deletes nothing in replace mode', backupPreview(same, 'replace').remove === 0);

  globalThis.tasks = []; globalThis.sites = []; globalThis.persons = []; globalThis.projectTasks = [];
}

section('attachments — what gets written to the task');
{
  const stored = { id: 'att1', name: 'a.png', type: 'image/png', size: 1234, thumb: 'data:image/jpeg;base64,TH', fullData: 'data:image/png;base64,FULL' };
  const legacy = { name: 'old.png', type: 'image/png', size: 999, data: 'data:image/png;base64,OLD' };
  const unsaved = { name: 'new.png', type: 'image/png', size: 500, thumb: 'data:image/jpeg;base64,T2', fullData: 'data:image/png;base64,F2' };
  const out = attachForTask([stored, legacy, unsaved]);

  ok('a stored attachment becomes a reference', out[0].id === 'att1');
  ok('the full payload is NOT written to the task', out[0].fullData === undefined, JSON.stringify(out[0]));
  ok('the thumbnail is written to the task', out[0].thumb === 'data:image/jpeg;base64,TH');
  ok('metadata is kept', out[0].name === 'a.png' && out[0].type === 'image/png' && out[0].size === 1234);
  ok('a legacy inline entry is passed through untouched', out[1].data === 'data:image/png;base64,OLD' && out[1].id === undefined);
  ok('an entry that never persisted is dropped, not inlined', out.length === 2, out.length);

  ok('empty input safe', attachForTask([]).length === 0 && attachForTask(undefined).length === 0);
  ok('nulls filtered', attachForTask([null, stored]).length === 1);
}

section('attachments — preview source and type test');
ok('thumbnail preferred', attachPreviewSrc({ thumb: 'T', data: 'D' }) === 'T');
ok('legacy data used when there is no thumbnail', attachPreviewSrc({ data: 'D' }) === 'D');
ok('reference with no thumbnail gives empty', attachPreviewSrc({ id: 'x' }) === '');
ok('null safe', attachPreviewSrc(null) === '' && attachPreviewSrc(undefined) === '');
ok('image type detected', isImageAttach({ type: 'image/png' }) === true);
ok('pdf is not an image', isImageAttach({ type: 'application/pdf' }) === false);
ok('missing type is not an image', isImageAttach({}) === false && isImageAttach(null) === false);

section('attachments — counting what still needs moving');
{
  globalThis.tasks = [
    { id: 'a', attachments: [{ id: 'x1', name: 'moved.png' }, { name: 'inline.png', data: 'D' }] },
    { id: 'b', attachments: [{ name: 'inline2.png', data: 'D' }] },
    { id: 'c', attachments: [] },
    { id: 'd' },
    { id: 'e', attachments: [null, { id: 'x2' }] }
  ];
  const c = countLegacyAttachments();
  ok('inline attachments counted', c.legacy === 2, c.legacy);
  ok('already-moved attachments counted', c.moved === 2, c.moved);
  ok('tasks without attachments do not throw', true);
  globalThis.tasks = [];
  const empty = countLegacyAttachments();
  ok('empty board reports zero of each', empty.legacy === 0 && empty.moved === 0);
}

section('backup v2 — attachment documents');
{
  const v2 = normalizeBackup({ workboard: 2, tasks: [{ id: 't', attachments: [{ id: 'att1' }] }],
    attachments: [{ id: 'att1', name: 'a.png', data: 'D' }, { name: 'no id, skipped' }],
    meta: {} });
  ok('attachment docs read', v2.attachments.length === 1, v2.attachments.length);
  ok('an attachment without an id is dropped', v2.attachments[0].id === 'att1');
  const v1 = normalizeBackup({ workboard: 1, tasks: [], meta: {} });
  ok('a v1 backup simply has none', v1.attachments.length === 0);
  const v0 = normalizeBackup({ tasks: [] });
  ok('a v0 backup simply has none', v0.attachments.length === 0);
  globalThis.tasks = [];
  ok('preview surfaces the attachment count', backupPreview(v2, 'merge').attachInFile === 1);
}

// ---------------------------------------------------------------- pause / snooze
section('pause \u2014 a wake date in the future, and only then');
{
  const today = todayStr();
  ok('a wake date well in the future is paused', isPaused({ snoozedUntil: addDaysStr(30) }) === true);
  ok('tomorrow is still paused', isPaused({ snoozedUntil: addDaysStr(1) }) === true);
  ok('today is NOT paused \u2014 it has woken up', isPaused({ snoozedUntil: today }) === false);
  ok('yesterday is NOT paused', isPaused({ snoozedUntil: addDaysStr(-1) }) === false);
  ok('an empty wake date is not paused', isPaused({ snoozedUntil: '' }) === false);
  ok('a task with no wake date at all is not paused', isPaused({ title: 'x' }) === false);
  ok('null and undefined are false, not a throw',
     isPaused(null) === false && isPaused(undefined) === false);
  ok('the return value is a real boolean, never a date string',
     typeof isPaused({ snoozedUntil: addDaysStr(5) }) === 'boolean');
}

// ---------------------------------------------------------------- date arithmetic
section('dates \u2014 local noon, and end-of-month clamping');
{
  ok('dateFromStr lands on local noon, so no DST or UTC drift',
     dateFromStr('2026-06-15').getHours() === 12, dateFromStr('2026-06-15').getHours());
  ok('dateFromStr with no argument means today', todayStr(dateFromStr()) === todayStr());
  ok('addDays crosses a month boundary',
     todayStr(addDays(dateFromStr('2026-08-30'), 3)) === '2026-09-02',
     todayStr(addDays(dateFromStr('2026-08-30'), 3)));
  ok('addDays crosses a year boundary',
     todayStr(addDays(dateFromStr('2026-12-31'), 1)) === '2027-01-01');
  ok('addDays goes backwards',
     todayStr(addDays(dateFromStr('2026-03-01'), -1)) === '2026-02-28');
  ok('addDays(0) is a no-op', todayStr(addDays(dateFromStr('2026-05-05'), 0)) === '2026-05-05');
  ok('31 Jan + 1 month clamps to 28 Feb in a common year',
     todayStr(addMonths(dateFromStr('2026-01-31'), 1)) === '2026-02-28',
     todayStr(addMonths(dateFromStr('2026-01-31'), 1)));
  ok('31 Jan + 1 month clamps to 29 Feb in a leap year',
     todayStr(addMonths(dateFromStr('2028-01-31'), 1)) === '2028-02-29',
     todayStr(addMonths(dateFromStr('2028-01-31'), 1)));
  ok('31 Mar + 1 month clamps to 30 Apr',
     todayStr(addMonths(dateFromStr('2026-03-31'), 1)) === '2026-04-30');
  ok('31 May + 1 month clamps to 30 Jun',
     todayStr(addMonths(dateFromStr('2026-05-31'), 1)) === '2026-06-30');
  ok('31 Aug + 6 months clamps to 28 Feb',
     todayStr(addMonths(dateFromStr('2026-08-31'), 6)) === '2027-02-28',
     todayStr(addMonths(dateFromStr('2026-08-31'), 6)));
  ok('31 Dec + 1 month rolls the year and keeps the day',
     todayStr(addMonths(dateFromStr('2026-12-31'), 1)) === '2027-01-31');
  ok('15 Jan + 12 months keeps the day',
     todayStr(addMonths(dateFromStr('2026-01-15'), 12)) === '2027-01-15');
  ok('a mid-month day is never clamped',
     todayStr(addMonths(dateFromStr('2026-01-15'), 1)) === '2026-02-15');
  ok('addMonths goes backwards and still clamps',
     todayStr(addMonths(dateFromStr('2026-03-31'), -1)) === '2026-02-28',
     todayStr(addMonths(dateFromStr('2026-03-31'), -1)));
  ok('addDaysStr counts from today by default', addDaysStr(0) === todayStr());
  ok('addDaysStr counts from a given date', addDaysStr(2, '2026-02-27') === '2026-03-01');
  ok('addMonthsStr counts from a given date', addMonthsStr(1, '2026-01-31') === '2026-02-28');
}

// ---------------------------------------------------------------- repeat
section('repeat \u2014 when the next occurrence falls due');
{
  ok('no rule means no next date', nextRepeatDate({ date: '2026-09-01' }) === '');
  ok('unit "none" means no next date',
     nextRepeatDate({ repeat: { n: 1, unit: 'none', from: 'due' }, date: '2026-09-01' }) === '');
  ok('null task does not throw', nextRepeatDate(null) === '');

  const daily = { repeat: { n: 1, unit: 'day', from: 'due' }, date: addDaysStr(3) };
  ok('daily from a future due date steps one day', nextRepeatDate(daily) === addDaysStr(4));
  const every3 = { repeat: { n: 3, unit: 'day', from: 'due' }, date: addDaysStr(1) };
  ok('every 3 days steps three days', nextRepeatDate(every3) === addDaysStr(4));
  const weekly = { repeat: { n: 1, unit: 'week', from: 'due' }, date: addDaysStr(2) };
  ok('weekly steps seven days', nextRepeatDate(weekly) === addDaysStr(9));
  const biweekly = { repeat: { n: 2, unit: 'week', from: 'due' }, date: addDaysStr(2) };
  ok('every 2 weeks steps fourteen days', nextRepeatDate(biweekly) === addDaysStr(16));
  const monthly = { repeat: { n: 1, unit: 'month', from: 'due' }, date: addDaysStr(5) };
  ok('monthly steps one month', nextRepeatDate(monthly) === addMonthsStr(1, addDaysStr(5)));

  ok('counting from the finish date ignores the due date entirely',
     nextRepeatDate({ repeat: { n: 2, unit: 'week', from: 'done' }, date: '2020-01-01' })
       === addDaysStr(14));
  ok('counting from the finish date with no due date still works',
     nextRepeatDate({ repeat: { n: 1, unit: 'day', from: 'done' }, date: '' }) === addDaysStr(1));
  ok('counting from the due date with no due date falls back to today',
     nextRepeatDate({ repeat: { n: 1, unit: 'week', from: 'due' }, date: '' }) === addDaysStr(7));

  // The guard: finishing a long-overdue repeating task must not produce a date that is
  // already in the past, which would spawn an occurrence that is overdue on arrival.
  const stale = { repeat: { n: 1, unit: 'week', from: 'due' }, date: '2026-01-05' };
  const staleNext = nextRepeatDate(stale);
  ok('a badly overdue weekly task lands in the future, not the past',
     staleNext > todayStr(), staleNext);
  ok('and it stays on the original weekday',
     dateFromStr(staleNext).getDay() === dateFromStr('2026-01-05').getDay(),
     dateFromStr(staleNext).getDay() + ' vs ' + dateFromStr('2026-01-05').getDay());
  const staleMonthly = nextRepeatDate({ repeat: { n: 1, unit: 'month', from: 'due' },
                                        date: '2024-03-15' });
  ok('a years-overdue monthly task also lands in the future', staleMonthly > todayStr(),
     staleMonthly);
  ok('and it keeps the day of the month',
     staleMonthly.slice(-2) === '15', staleMonthly);
  ok('a task due today with a daily rule moves to tomorrow',
     nextRepeatDate({ repeat: { n: 1, unit: 'day', from: 'due' }, date: todayStr() })
       === addDaysStr(1));

  ok('a non-numeric count is clamped to 1',
     nextRepeatDate({ repeat: { n: 'abc', unit: 'day', from: 'due' }, date: addDaysStr(1) })
       === addDaysStr(2));
  ok('zero is clamped to 1',
     nextRepeatDate({ repeat: { n: 0, unit: 'day', from: 'done' } }) === addDaysStr(1));
  ok('a count above 365 is clamped to 365',
     nextRepeatDate({ repeat: { n: 9999, unit: 'day', from: 'done' } }) === addDaysStr(365));
  ok('an unknown "from" value is treated as "from the finish date"',
     nextRepeatDate({ repeat: { n: 1, unit: 'day', from: 'nonsense' }, date: '2020-01-01' })
       === addDaysStr(1));

  ok('repeatText reads naturally in the singular', repeatText({ n: 1, unit: 'week' }) === 'every week',
     repeatText({ n: 1, unit: 'week' }));
  ok('repeatText pluralises', repeatText({ n: 3, unit: 'day' }) === 'every 3 days',
     repeatText({ n: 3, unit: 'day' }));
  ok('repeatText handles months', repeatText({ n: 2, unit: 'month' }) === 'every 2 months');
  ok('repeatText of nothing is empty',
     repeatText(null) === '' && repeatText({}) === '' && repeatText({ unit: 'none' }) === '');
}

// ---------------------------------------------------------------- filters
section('filters \u2014 OR within a group, AND across groups');
{
  const search = global.document.createElement('input');
  search.id = 'searchInput';
  search.value = '';
  global.document.body.appendChild(search);

  const t = (id, o) => Object.assign({ id, title: id, note: '', priority: 'none', date: '',
    sites: [], persons: [], tags: [], actions: [], links: [], attachments: [],
    comments: [], history: [], done: false }, o);

  globalThis.tasks = [
    t('dk',   { sites: ['DK'], persons: ['Anna'],   tags: ['pricing'] }),
    t('no',   { sites: ['NO'], persons: ['Martin'], tags: ['bug'] }),
    t('se',   { sites: ['SE'], persons: ['Martin'], tags: ['pricing'] }),
    t('both', { sites: ['DK', 'SE'], persons: ['Anna', 'Martin'], tags: [] }),
    t('none', {}),
    t('fin',  { done: true, sites: ['DK'] }),
    t('rest', { snoozedUntil: addDaysStr(10), sites: ['DK'], persons: ['Martin'] }),
    t('duetoday', { date: todayStr(), sites: ['NO'] }),
    t('duetoday_paused', { date: todayStr(), snoozedUntil: addDaysStr(4) })
  ];
  const setF = (s, p, l, pr, ov) => {
    globalThis.afS = s || []; globalThis.afP = p || []; globalThis.afT = l || [];
    globalThis.afPr = pr || []; globalThis.afOv = !!ov;
  };
  const ids = mode => getFiltered(mode).map(x => x.id).join(',');

  setF();
  ok('the board leaves out finished tasks', !ids('board').split(',').includes('fin'), ids('board'));
  ok('the board leaves out paused tasks', !ids('board').split(',').includes('rest'), ids('board'));
  ok('Done lists only finished tasks', ids('done') === 'fin', ids('done'));
  ok('Paused lists only paused, unfinished tasks',
     ids('paused').split(',').sort().join(',') === 'duetoday_paused,rest', ids('paused'));
  ok('Today lists tasks due today', ids('today').split(',').includes('duetoday'), ids('today'));
  ok('Today leaves out a paused task even when it is due today',
     !ids('today').split(',').includes('duetoday_paused'), ids('today'));

  setF(['DK', 'NO']);
  ok('two sites match every task carrying either one (OR)',
     ids('board') === 'dk,no,both,duetoday', ids('board'));
  setF(['SE']);
  ok('one site narrows to that site', ids('board') === 'se,both', ids('board'));
  setF([], ['Martin', 'Anna']);
  ok('two people match a task assigned to either (OR)',
     ids('board') === 'dk,no,se,both', ids('board'));
  setF([], [], ['pricing', 'bug']);
  ok('two labels match a task carrying either (OR)',
     ids('board') === 'dk,no,se', ids('board'));

  setF(['DK', 'NO'], ['Martin']);
  ok('a site group and a person group are ANDed together',
     ids('board') === 'no,both', ids('board'));
  setF(['NO'], ['Anna']);
  ok('an AND across groups that nothing satisfies gives nothing',
     ids('board') === '', ids('board'));
  setF(['DK'], ['Anna'], ['pricing']);
  ok('three groups are all ANDed', ids('board') === 'dk', ids('board'));
  setF([], [], [], ['none']);
  ok('a priority filter still works alongside the change',
     ids('board').split(',').includes('dk'), ids('board'));

  setF();
  search.value = 'rest';
  ok('search still finds a paused task', ids('search') === 'rest', ids('search'));
  search.value = 'fin';
  ok('search still finds a finished task', ids('search') === 'fin', ids('search'));
  search.value = '';
  globalThis.tasks = [];
  setF();
}

// ---------------------------------------------------------------- merge: the newer fields
section('merge \u2014 pause, repeat and the ClickUp hand-over');
{
  const bare = { ...base, sites: [], persons: [], tags: [] };
  const mk = (o) => ({ ...bare, ...o });
  const C2 = { title: 'a', priority: 'a', date: 'a', text: 'both', secAttach: true };

  let m = buildMergedData(mk({ id: 'a', title: 'A', repeat: { n: 2, unit: 'week', from: 'due' } }),
                          mk({ id: 'b', title: 'B' }), C2);
  ok("A's repeat rule survives the merge", m.repeat && m.repeat.n === 2 && m.repeat.unit === 'week',
     JSON.stringify(m.repeat));
  m = buildMergedData(mk({ id: 'a', title: 'A' }),
                      mk({ id: 'b', title: 'B', repeat: { n: 1, unit: 'month', from: 'done' } }), C2);
  ok("B's repeat rule is adopted only when A has none", m.repeat && m.repeat.unit === 'month',
     JSON.stringify(m.repeat));
  m = buildMergedData(mk({ id: 'a', title: 'A', repeat: { n: 1, unit: 'day', from: 'due' } }),
                      mk({ id: 'b', title: 'B', repeat: { n: 9, unit: 'month', from: 'done' } }), C2);
  ok("A wins when both sides repeat", m.repeat.unit === 'day' && m.repeat.n === 1, JSON.stringify(m.repeat));
  m = buildMergedData(mk({ id: 'a', title: 'A' }), mk({ id: 'b', title: 'B' }), C2);
  ok('no rule on either side gives null, not undefined', m.repeat === null, String(m.repeat));
  m = buildMergedData(mk({ id: 'a', title: 'A', repeat: { n: 1, unit: 'none', from: 'due' } }),
                      mk({ id: 'b', title: 'B', repeat: { n: 4, unit: 'week', from: 'due' } }), C2);
  ok('a disabled rule on A does not block B\u2019s', m.repeat && m.repeat.n === 4, JSON.stringify(m.repeat));
  {
    const a = mk({ id: 'a', title: 'A', repeat: { n: 3, unit: 'day', from: 'due' } });
    const d = buildMergedData(a, mk({ id: 'b', title: 'B' }), C2);
    ok('the merged rule is a deep copy, not a shared reference', d.repeat !== a.repeat);
  }

  m = buildMergedData(mk({ id: 'a', title: 'A', clickupSent: '2026-08-01', clickupArea: 'X' }),
                      mk({ id: 'b', title: 'B', clickupSent: '2026-08-05', clickupArea: 'Y' }), C2);
  ok("A's ClickUp hand-over is the one kept",
     m.clickupSent === '2026-08-01' && m.clickupArea === 'X', m.clickupSent + '/' + m.clickupArea);
  m = buildMergedData(mk({ id: 'a', title: 'A' }),
                      mk({ id: 'b', title: 'B', clickupSent: '2026-08-05', clickupArea: 'Y' }), C2);
  ok("B's is inherited when A never went out",
     m.clickupSent === '2026-08-05' && m.clickupArea === 'Y', m.clickupSent + '/' + m.clickupArea);
  m = buildMergedData(mk({ id: 'a', title: 'A' }), mk({ id: 'b', title: 'B' }), C2);
  ok('neither sent leaves empty strings, not undefined',
     m.clickupSent === '' && m.clickupArea === '', m.clickupSent + '/' + m.clickupArea);
  m = buildMergedData(mk({ id: 'a', title: 'A', clickupSent: '2026-08-01' }),
                      mk({ id: 'b', title: 'B', clickupArea: 'Y' }), C2);
  ok('an Area is not borrowed from a task whose hand-over was not kept',
     m.clickupSent === '2026-08-01' && m.clickupArea === '', m.clickupSent + '/' + m.clickupArea);
}

// ---------------------------------------------------------------- ClickUp hand-over text
section('ClickUp \u2014 the description block it prepares');
{
  const T = (o) => ({ ...base, sites: [], persons: [], tags: [], actions: [], ...o });

  let b = cuBodyText(T({ title: 'x', note: 'The note body.' }), '');
  ok('the note body comes first', b.split('\n')[0] === 'The note body.', b.split('\n')[0]);
  ok('it always says where it came from', b.trim().endsWith('From WorkBoard'), b);

  b = cuBodyText(T({ title: 'x' }), '');
  ok('a task with nothing on it produces just the provenance line', b === 'From WorkBoard', JSON.stringify(b));

  b = cuBodyText(T({ note: 'n', date: '2026-09-15', sites: ['DK', 'NO'], persons: ['Martin'],
                     tags: ['sop'], priority: 'high' }), '\u2699 Ops');
  for (const want of ['Due: 15/09/2026', 'Sites: DK, NO', 'People: Martin', 'Labels: sop',
                      'Priority: high', 'Area: \u2699 Ops'])
    ok('the block carries "' + want + '"', b.includes(want), b);

  b = cuBodyText(T({ note: 'n', priority: 'none' }), '');
  ok('priority "none" is left out rather than written out', !b.includes('Priority'), b);
  ok('an empty Area writes no Area line', !b.includes('Area:'), b);

  b = cuBodyText(T({ note: 'n', actions: [{ text: 'Draft it', assignee: 'Martin', done: false },
                                          { text: 'Review', assignee: '', done: true }] }), '');
  ok('action items arrive as an unticked checklist', b.includes('- [ ] Draft it (Martin)'), b);
  ok('a done action is not pre-ticked either \u2014 ClickUp gets a fresh checklist',
     b.includes('- [ ] Review') && !b.includes('- [x]'), b);
  ok('an assignee-less action gets no empty brackets', !b.includes('Review ()'), b);

  b = cuBodyText(T({ note: 'n', actions: [{ text: '', assignee: 'Martin', done: false }] }), '');
  ok('an action with no text is skipped', !b.includes('- [ ]'), b);

  b = cuBodyText(T({ note: 'preview', richBody: '<p>Formatted <b>body</b></p>', richHtml: true }), '');
  ok('a formatted note is flattened to text, never HTML',
     b.includes('Formatted body') && !b.includes('<b>'), b);

  b = cuBodyText(T({ note: '   ' }), '');
  ok('a whitespace-only note does not leave a blank first line', b === 'From WorkBoard', JSON.stringify(b));

  ok('sections are separated by a blank line, not run together',
     cuBodyText(T({ note: 'n', date: '2026-09-15' }), '').includes('n\n\nDue:'),
     JSON.stringify(cuBodyText(T({ note: 'n', date: '2026-09-15' }), '')));
}

// ---------------------------------------------------------------- links
section('links \u2014 recognising an Outlook mail link');
{
  // Shaped like a real OWA deeplink, with an invented id -- this repository is public.
  const OWA = 'https://outlook.office365.com/owa/?ItemID=RjBtWm5UcXk4S2Ru'
            + 'V0hMcDNiNXhFYU9ndjRyMQ%3D&exvsurl=1&viewmodel=ReadMessageItem';
  ok('a real OWA deeplink is mail', isMailLink(OWA) === true);
  ok('outlook.office.com is mail', isMailLink('https://outlook.office.com/mail/inbox/id/AAQk') === true);
  ok('outlook.com is mail', isMailLink('https://outlook.com/mail/0/inbox') === true);
  ok('outlook.live.com is mail', isMailLink('https://outlook.live.com/mail/0/') === true);
  ok('a genuine subdomain is mail', isMailLink('https://nam.outlook.office365.com/owa/?x=1') === true);
  ok('the bare host is mail', isMailLink('https://outlook.office365.com') === true);
  ok('http is accepted as well as https', isMailLink('http://outlook.office.com/mail') === true);
  ok('an ordinary link is not mail', isMailLink('https://example.com/outlook-tips') === false);
  // The host boundary is the point: without it a phishing URL would be shown with a
  // friendly mail icon.
  ok('a look-alike host is NOT mail',
     isMailLink('https://outlook.office365.com.evil.example/owa/?ItemID=1') === false);
  ok('a host that merely starts the same is NOT mail',
     isMailLink('https://outlook.office365.company.example/x') === false);
  ok('null and empty are false, not a throw',
     isMailLink(null) === false && isMailLink('') === false && isMailLink(undefined) === false);
  ok('mail gets the envelope icon', linkIcon({ url: OWA }) === '\uD83D\uDCE7');
  ok('anything else gets the chain icon', linkIcon({ url: 'https://power.dk' }) === '\uD83D\uDD17');
  ok('linkIcon survives a link with no url', linkIcon({}) === '\uD83D\uDD17' && linkIcon(null) === '\uD83D\uDD17');
  ok('linkLabel falls back to the url when unnamed',
     linkLabel({ url: 'https://x.dk' }) === 'https://x.dk');
  ok('linkLabel of nothing is empty', linkLabel(null) === '' && linkLabel({}) === '');
}

section('links \u2014 parsing a pasted link');
{
  const OWA = 'https://outlook.office365.com/owa/?ItemID=RjBtWm5U%2FcXk4S2RuV0hMcDNiNXhFYU9n'
            + '%3D&exvsurl=1&viewmodel=ReadMessageItem';
  const P = parseLinkInput;

  let r = P(OWA);
  ok('a bare URL is kept character for character', r.url === OWA, r.url);
  ok('an unnamed mail link is labelled "Mail"', r.name === 'Mail', r.name);
  ok('an unnamed ordinary link is labelled by its URL',
     P('https://example.com/a').name === 'https://example.com/a');

  ok('"Label | URL" splits on the bar', P('Anna | ' + OWA).name === 'Anna');
  ok('a tab separates label from URL', P('Anna\t' + OWA).name === 'Anna', JSON.stringify(P('Anna\t' + OWA)));
  ok('a newline separates label from URL', P('Anna\n' + OWA).name === 'Anna');
  ok('CRLF is handled like LF', P('Anna\r\n' + OWA).name === 'Anna');
  ok('no separator at all still works: text in front becomes the label',
     P('Anna \u00b7 Returflow SOP  ' + OWA).name === 'Anna \u00b7 Returflow SOP',
     P('Anna \u00b7 Returflow SOP  ' + OWA).name);
  ok('a label ending in a colon is kept', P('Se mailen her: ' + OWA).name === 'Se mailen her:');
  ok('the URL survives label extraction intact', P('Anna \u00b7 SOP ' + OWA).url === OWA);
  ok('a name argument fills in when the paste has no label',
     P(OWA, 'Kundesag 4412').name === 'Kundesag 4412');
  ok('a label in the paste beats the name argument',
     P('From the paste | https://example.com', 'From the field').name === 'From the paste');
  ok('a pipe inside a URL does not split it',
     P('https://example.com/a?x=1|2').url === 'https://example.com/a?x=1|2',
     P('https://example.com/a?x=1|2').url);
  ok('a label longer than 120 characters is capped',
     P('x'.repeat(400) + ' | https://example.com').name.length === 120);

  ok('a bare host gets https://', P('power.dk/kampagne').url === 'https://power.dk/kampagne');
  ok('www. gets https://', P('www.power.dk').url === 'https://www.power.dk');
  ok('http is left as http', P('http://intranet.local/page').url === 'http://intranet.local/page');
  ok('mailto is allowed', P('mailto:anna@example.com').url === 'mailto:anna@example.com');
  ok('trailing words after the URL are dropped',
     P('https://example.com/a some words').url === 'https://example.com/a');
  ok('control characters are stripped',
     P('https://example.com/a\u0000\u001f').url === 'https://example.com/a');

  // Refusals. Guessing is worse than refusing: the old version turned
  // "Harmless label | javascript:alert(1)" into https://Harmless.
  ok('javascript: is refused', P('javascript:alert(1)') === null);
  ok('a labelled javascript: URL is refused', P('Harmless label | javascript:alert(1)') === null);
  ok('data: is refused', P('data:text/html,<script>alert(1)</script>') === null);
  ok('file: is refused', P('file:///C:/Windows/win.ini') === null);
  ok('mailto with no address is refused', P('mailto:') === null);
  ok('prose with no URL in it is refused', P('Husk at ringe til Anna om returflowet') === null);
  ok('empty input is refused', P('') === null && P('   ') === null && P(null) === null);
  ok('a version number is not mistaken for a host', P('release v2.0 shipped') === null,
     JSON.stringify(P('release v2.0 shipped')));
}

section('escHtml \u2014 safe inside an attribute');
{
  ok('a double quote is escaped', escHtml('a"b') === 'a&quot;b', escHtml('a"b'));
  ok('a single quote is escaped', escHtml("a'b") === 'a&#39;b', escHtml("a'b"));
  ok('the ampersand is escaped first, so nothing is double-escaped',
     escHtml('&quot;') === '&amp;quot;', escHtml('&quot;'));
  ok('angle brackets still escaped', escHtml('<b>') === '&lt;b&gt;');
  ok('null is empty, not "null"', escHtml(null) === '' && escHtml(undefined) === '');
  {
    // A URL crafted to break out of href="..." must not be able to add an attribute.
    const nasty = 'https://example.com/" onmouseover="alert(1)';
    const d = global.document.createElement('div');
    d.innerHTML = '<a href="' + escHtml(nasty) + '">x</a>';
    const a = d.querySelector('a');
    ok('a crafted URL cannot inject a second attribute', a.attributes.length === 1,
       Array.from(a.attributes).map(x => x.name).join(','));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
