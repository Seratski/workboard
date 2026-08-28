/*
 * Tiny static server for the harness, confined to this folder. Started automatically by
 * run-all.js; run it by hand (node serve.js) when running a single suite:
 *
 *   node serve.js            # in one terminal
 *   node pause.mjs           # in another
 */
const http = require('http'), path = require('path'), fs = require('fs');
const here = __dirname, PORT = Number(process.env.WB_PORT || 8777);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf' };

http.createServer((req, res) => {
  // Join then verify, so a ../ in the URL cannot escape this folder.
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(here, rel);
  if (!file.startsWith(here) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('serving ' + here + ' on http://127.0.0.1:' + PORT));
