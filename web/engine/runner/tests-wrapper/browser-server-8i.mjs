// Isolate the API/binary under test while reusing the already running frontend.
// Every /api request reaches the real Fastify app; assets reach the real Next app.
import http from 'node:http';
import { buildApp } from '../../../dist/apps/api/src/app.js';
import { readConfig } from '../../../dist/apps/api/src/config/index.js';
if (!process.env.IRRITATOR_RUNNER) throw new Error('Set IRRITATOR_RUNNER');
const app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 });
const frontend = process.env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:3000';
const server = http.createServer((req, res) => {
  const target = new URL(req.url, req.url.startsWith('/api/') ? app.listeningOrigin : frontend);
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream);
});
server.listen(Number(process.env.BROWSER_PORT ?? 3100), '127.0.0.1', () => console.log(JSON.stringify({ frontend, runner: process.env.IRRITATOR_RUNNER, api: app.listeningOrigin, browser: server.address() })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await app.close(); process.exit(0); });
