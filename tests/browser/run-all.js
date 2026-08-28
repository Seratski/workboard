/*
 * Runs every browser suite against a freshly built harness.
 *
 *   node run-all.js [path-to-index.html]
 *
 * Rebuilds test.html from index.html, starts serve.js, runs each suite, reports its
 * counts, stops the server. Exit code 0 means everything is green.
 *
 * Playwright must be installed OUTSIDE this folder, because OneDrive syncs everything in
 * it. Point NODE_PATH at the install, or WB_PLAYWRIGHT at the package itself:
 *
 *   set NODE_PATH=%LOCALAPPDATA%\wb-test-deps\node_modules
 *   node run-all.js
 */
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const here = __dirname;
const SUITES = ['drive', 'fixes', 'cleanup', 'backup', 'attach', 'lb2', 'lb3', 'pause', 'clickup', 'links', 'create', 'onedoor', 'upkeep'];

execFileSync(process.execPath,
  [path.join(here, 'build-harness.js')].concat(process.argv[2] ? [process.argv[2]] : []),
  { stdio: 'inherit' });

// A separate process, not this one: the suites are run with execFileSync, which blocks
// this event loop completely -- an in-process server would never answer a request.
const server = spawn(process.execPath, [path.join(here, 'serve.js')], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch (e) {} };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

function waitForServer(tries) {
  for (let i = 0; i < tries; i++) {
    try { execFileSync(process.execPath, ['-e',
      "require('http').get('http://127.0.0.1:8777/test.html',r=>process.exit(r.statusCode===200?0:1))"
      + ".on('error',()=>process.exit(1))"], { stdio: 'ignore' }); return true; }
    catch (e) { execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']); }
  }
  return false;
}
if (!waitForServer(20)) { console.error('the harness server did not come up on port 8777'); stop(); process.exit(2); }

const bad = [];
let total = 0;
for (const s of SUITES) {
  const f = path.join(here, s + '.mjs');
  if (!fs.existsSync(f)) { console.log(s.padEnd(9) + 'MISSING'); bad.push(s); continue; }
  let out = '';
  try { out = execFileSync(process.execPath, [f], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const ok = (out.match(/^OK  /gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length;
  total += ok;
  console.log(s.padEnd(9) + ok + ' ok, ' + fail + ' failed');
  if (fail || !ok) {
    bad.push(s);
    console.log(out.split('\n').filter(l => /^FAIL|Error/.test(l)).slice(0, 8)
      .map(l => '    ' + l).join('\n'));
  }
}
console.log('\n' + total + ' assertions passed'
  + (bad.length ? ', failing suites: ' + bad.join(', ') : ', all suites green'));
stop();
process.exit(bad.length ? 1 : 0);
