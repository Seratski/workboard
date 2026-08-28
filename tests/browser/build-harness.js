/*
 * Builds test.html: the app's own index.html with the three Firebase CDN <script> tags
 * replaced by stub.html, an offline stand-in for firebase-app / auth / firestore that
 * serves a fixed board out of window.__DATA and records every write to window.__WB_WRITES.
 *
 *   node build-harness.js [path-to-index.html] [out.html]
 *
 * With no arguments it finds index.html itself and writes ./test.html.
 * Nothing here touches the app; index.html is read, never written.
 */
const fs = require('fs'), path = require('path');
const here = __dirname;
// With no argument, find index.html where it is actually mounted. The first entry is the
// repository layout (tests/browser/ -> ../../index.html), which is what CI uses; the others
// are from when these tests lived outside the repository.
const CANDIDATES = [
  path.join(here, '..', '..', 'index.html'),
  path.join(here, '..', '..', '..', '..', '..', '..', 'Dokumenter', 'GitHub', 'workboard', 'index.html'),
  path.join(here, '..', '..', '..', 'workboard', 'index.html')
];
const src = process.argv[2] || CANDIDATES.find(p => fs.existsSync(p));
if (!src) {
  console.error('Could not find index.html. Looked in:\n  ' + CANDIDATES.join('\n  ')
    + '\nPass the path as the first argument.');
  process.exit(2);
}
const out = process.argv[3] || path.join(here, 'test.html');

const html = fs.readFileSync(src, 'utf8');
const stub = fs.readFileSync(path.join(here, 'stub.html'), 'utf8');

// Everything from <!DOCTYPE through the last firebase CDN tag is replaced by the stub,
// which carries its own <head> (and no Google Fonts link, so the harness runs offline).
const marker = /^[\s\S]*?firebase-firestore-compat\.min\.js"><\/script>\n/;
if (!marker.test(html)) {
  console.error('Could not find the Firebase CDN script tags in ' + src);
  process.exit(2);
}
const body = html.replace(marker, '');
if (/cdn\.jsdelivr\.net/.test(body)) {
  console.error('A CDN script tag survived the replacement — check the marker.');
  process.exit(2);
}
fs.writeFileSync(out, stub + body);
console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes) from ' + src);
