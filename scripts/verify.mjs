import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const requiredFiles = [
  'index.html',
  'styles.css',
  'src/app.js',
  'src/data.js',
  'src/engine.js',
  'src/globe.js',
  'src/output.js',
  'src/state.js',
  'src/webmcp.js',
  'assets/earth-texture.svg',
  'public/_headers',
  'netlify.toml',
  'docs/ARCHITECTURE.md',
  'docs/DEMO_SCRIPT.md',
  'docs/DEVPOST_SUBMISSION.md',
  '.github/workflows/ci.yml',
  '.github/workflows/pages.yml',
];

await Promise.all(requiredFiles.map((file) => access(resolve(root, file))));
const [html, app, webmcp, readme, headers, serviceWorker] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'src/app.js'), 'utf8'),
  readFile(resolve(root, 'src/webmcp.js'), 'utf8'),
  readFile(resolve(root, 'README.md'), 'utf8'),
  readFile(resolve(root, 'public/_headers'), 'utf8'),
  readFile(resolve(root, 'sw.js'), 'utf8'),
]);

const names = [...app.matchAll(/name:\s*'(terra_[a-z0-9_]+)'/g)].map((match) => match[1]);
const uniqueNames = new Set(names);
if (names.length !== 15 || uniqueNames.size !== 15) {
  throw new Error(`Expected 15 unique WebMCP tools, found ${names.length} definitions / ${uniqueNames.size} unique.`);
}
for (const name of uniqueNames) {
  if (!readme.includes(`\`${name}\``)) throw new Error(`README does not document ${name}.`);
}
if (!webmcp.includes('await context.registerTool')) throw new Error('Native registerTool calls must be awaited.');
if (!webmcp.includes('{ signal: controller.signal }')) throw new Error('Native tools must use AbortSignal registration cleanup.');
if (webmcp.includes('structuredContent') || webmcp.includes('textResult')) throw new Error('Native Site tools must return one direct result object.');
if (!html.includes('id="globe-canvas"')) throw new Error('3D globe canvas is missing.');
if (/<(script|img)[^>]+(?:src)=["']https?:/i.test(html)) throw new Error('Remote executable or image dependency found in index.html.');
if (!headers.includes('Origin-Agent-Cluster: ?1') || !headers.includes('Permissions-Policy: tools=(self)')) {
  throw new Error('Configured WebMCP deployment headers are incomplete.');
}
if (!serviceWorker.includes("const CACHE = 'terra-v3'") || !serviceWorker.includes("'./src/output.js'") || !serviceWorker.includes("'./src/state.js'")) {
  throw new Error('Service worker cache version or bounded-output modules are stale.');
}
if (!html.includes("additionalProperties")) {
  // Schemas live in JavaScript; this branch only documents that HTML itself is not expected to contain them.
}

console.log(`Verified ${requiredFiles.length} project files and ${uniqueNames.size} WebMCP tool contracts.`);
