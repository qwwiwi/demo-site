// Minimal zero-dependency static server for PipeCore (listens on $PORT).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

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


// Leads -> YouGile task via the YouGile MCP endpoint. Secrets come only from env.
const YG_URL = 'https://ru.yougile.com/data/ai/mcp';

async function ygCall(method, params, sessionId) {
  const headers = {
    Authorization: `Bearer ${process.env.YOUGILE_MCP_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const r = await fetch(YG_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
  const text = await r.text();
  const data = text.includes('data:') ? text.split('\n').filter((l) => l.startsWith('data:')).pop().slice(5) : text;
  return { sessionId: r.headers.get('mcp-session-id') || sessionId, body: data ? JSON.parse(data) : {} };
}

async function createLeadTask(lead) {
  const init = await ygCall('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'barn-site', version: '1' } });
  const description = `Телефон: ${lead.phone}\nМодель: ${lead.model || '–'}\nИсточник: сайт ${new Date().toISOString()}`;
  const res = await ygCall('tools/call', { name: 'manage_tasks', arguments: { tasks: [{ id: null, title: `Заявка: ${lead.name}`, columnId: process.env.YOUGILE_COLUMN_ID, description }] } }, init.sessionId);
  if (res.body.error || res.body.result?.isError) throw new Error('yougile rejected the task');
}

function handleLead(req, res) {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 4096) req.destroy(); });
  req.on('end', async () => {
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    let lead;
    try { lead = JSON.parse(raw); } catch { return reply(400, { ok: false }); }
    const clean = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    lead = { name: clean(lead.name), phone: clean(lead.phone), model: clean(lead.model) };
    if (!lead.name || lead.phone.replace(/\D/g, '').length < 10) return reply(400, { ok: false });
    if (!process.env.YOUGILE_MCP_TOKEN || !process.env.YOUGILE_COLUMN_ID) return reply(503, { ok: false });
    try { await createLeadTask(lead); reply(200, { ok: true }); } catch (e) { console.error('lead failed:', e.message); reply(502, { ok: false }); }
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/api/lead') return handleLead(req, res);
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
