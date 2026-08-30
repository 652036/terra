import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const port = Number.parseInt(process.env.PORT || '4175', 10);
const host = process.env.HOST || '127.0.0.1';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const publicRootFiles = new Set(['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js']);

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const pathSegments = relativePath.split('/');
    const isPublicAsset = relativePath.startsWith('assets/') || relativePath.startsWith('src/');
    if (
      pathSegments.some((segment) => !segment || segment === '..' || segment.startsWith('.')) ||
      (!publicRootFiles.has(relativePath) && !isPublicAsset)
    ) {
      throw new Error('Path is not a public app asset');
    }
    let filePath = resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) throw new Error('Path outside project root');
    if (statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html');

    response.setHeader('Content-Type', mimeTypes[extname(filePath)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Origin-Agent-Cluster', '?1');
    response.setHeader('Permissions-Policy', 'tools=(self)');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    createReadStream(filePath)
      .on('error', () => {
        if (!response.headersSent) response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
      })
      .pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`TERRA ready at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
