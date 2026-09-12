import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const service = 'ascii-city-v3';
const version = '3.0.0-preview';
const host = process.env.HOST || '0.0.0.0';
const requestedPort = process.env.PORT ? Number(process.env.PORT) : 0;
let port = requestedPort;
const startedAt = new Date().toISOString();
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error('PORT must be an integer from 0 to 65535, or omitted for an available port');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
export function createRequestHandler({ root = process.cwd(), identity }) {
  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/whoami') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(identity()));
      return;
    }
    if (!['/', '/index.html', '/styles.css', '/ascii-city.config.js'].includes(url.pathname) && !/^\/src\/[a-zA-Z0-9_/-]+\.js$/.test(url.pathname)) {
      res.statusCode = 404; res.end('Not found'); return;
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(root, rel === '/' ? 'index.html' : rel);
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
      res.setHeader('cache-control', 'no-store');
      createReadStream(file).pipe(res);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!requestedPort) throw new Error('Set PORT using portbroker get or alloc --name ascii-city-v3');
  const server = createServer(createRequestHandler({
    identity: () => ({ service, version, pid: process.pid, startedAt, host, port }),
  }));
  server.listen(requestedPort, host, () => {
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : requestedPort;
    console.log(`ASCII City listening on http://${host}:${port}`);
  });
}
