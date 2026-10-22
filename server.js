// Minimal zero-dependency static server for PipeCore (listens on $PORT).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function send(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); } catch { return notFound(res); }
  const file = path.normalize(path.join(root, urlPath));
  const hidden = path.relative(root, file).split(path.sep).some((part) => part.startsWith('.'));
  if (!(file === root || file.startsWith(root + path.sep)) || hidden || ['server.js', 'package.json'].includes(path.basename(file)) || file.endsWith('.md')) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err) return notFound(res);
    if (st.isDirectory()) {
      // Directory without trailing slash -> redirect so relative links resolve.
      if (!urlPath.endsWith('/')) { res.writeHead(301, { Location: urlPath + '/' }); res.end(); return; }
      return send(res, path.join(file, 'index.html'));
    }
    send(res, file);
  });
}).listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
