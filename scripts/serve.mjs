import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const allowed = new Set(['/index.json', '/status.json']);
const server = createServer(async (req, res) => {
  if (req.method !== 'GET' || !allowed.has(req.url)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(new URL('../public' + req.url, import.meta.url));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(503); res.end('Index not built'); }
});
server.listen(0, '127.0.0.1', () => console.log(`Test index: http://127.0.0.1:${server.address().port}/index.json`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
