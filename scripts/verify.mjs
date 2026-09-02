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
const docFiles = ['README.md', 'SECURITY.md', 'docs/ARCHITECTURE.md', 'docs/DEMO_SCRIPT.md', 'docs/DEVPOST_SUBMISSION.md'];

await Promise.all(requiredFiles.map((file) => access(resolve(root, file))));
const read = (file) => readFile(resolve(root, file), 'utf8');
const [html, styles, app, webmcp, globe, headers, serviceWorker] = await Promise.all([
  read('index.html'),
  read('styles.css'),
  read('src/app.js'),
  read('src/webmcp.js'),
  read('src/globe.js'),
  read('public/_headers'),
  read('sw.js'),
]);
const docs = Object.fromEntries(await Promise.all(docFiles.map(async (file) => [file, await read(file)])));
const readme = docs['README.md'];

const TOOL_NAME = /name:\s*'(terra_[a-z0-9_]+)'/g;
function toolNamesIn(fnName) {
  const start = app.indexOf(`function ${fnName}()`);
  if (start < 0) throw new Error(`src/app.js must define ${fnName}().`);
  const end = app.indexOf('\nfunction ', start + 1);
  return [...app.slice(start, end < 0 ? undefined : end).matchAll(TOOL_NAME)].map((match) => match[1]);
}
const alwaysNames = toolNamesIn('alwaysTools');
const mutationNames = toolNamesIn('mutationTools');
const names = [...alwaysNames, ...mutationNames];
const uniqueNames = new Set(names);
const allDefinitions = [...app.matchAll(TOOL_NAME)].length;
if (uniqueNames.size !== names.length) throw new Error(`Duplicate WebMCP tool names: ${names.join(', ')}`);
if (allDefinitions !== names.length) throw new Error('Every tool must be defined inside alwaysTools() or mutationTools().');
if (alwaysNames.length < 1 || mutationNames.length < 1) throw new Error('Both the always-on and mutation tool groups must be non-empty.');
const counts = { total: names.length, always: alwaysNames.length, mutation: mutationNames.length };
const toolSource = app.slice(app.indexOf('function mutationTools()'), app.indexOf('function currentTools()'));
const negativeCopy = toolSource.match(/description: [^\n]*\b(Do not|Never|cannot|are rejected)\b/);
if (negativeCopy) throw new Error(`Tool descriptions must be phrased positively: ${negativeCopy[0].trim()}`);
if (!/name: 'terra_focus_view'[\s\S]*?annotations: annotation\.read/.test(toolSource)) {
  throw new Error('terra_focus_view must carry readOnlyHint: true.');
}

for (const name of uniqueNames) {
  if (!readme.includes(`\`${name}\``)) throw new Error(`README does not document ${name}.`);
}
const numberWords = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
};
const countPattern = new RegExp(`\\b(\\d+|${Object.keys(numberWords).join('|')})\\b((?:\\s+[a-z/-]+){0,2})\\s+tools\\b`, 'gi');
const allowedCounts = new Set(Object.values(counts));
for (const [file, text] of Object.entries(docs)) {
  for (const mention of text.matchAll(/terra_[a-z0-9_]+/g)) {
    if (!uniqueNames.has(mention[0])) throw new Error(`${file} mentions unknown tool ${mention[0]}.`);
  }
  for (const match of text.matchAll(countPattern)) {
    const value = numberWords[match[1].toLowerCase()] ?? Number(match[1]);
    if (!allowedCounts.has(value)) {
      throw new Error(`${file} says "${match[0]}" but the tool groups are ${JSON.stringify(counts)}.`);
    }
  }
}
if (!readme.includes(`${counts.total} tools`) || !readme.includes(`${counts.always} tools`)) {
  throw new Error(`README must state the ${counts.total}-tool draft surface and the ${counts.always}-tool published surface.`);
}

if (!webmcp.includes('await context.registerTool')) throw new Error('Native registerTool calls must be awaited.');
if (!/\{ signal: \w+\.signal \}/.test(webmcp)) throw new Error('Native tools must use AbortSignal registration cleanup.');
if (webmcp.includes('structuredContent') || webmcp.includes('textResult')) throw new Error('Native Site tools must return one direct result object.');
if (!html.includes('id="globe-canvas"')) throw new Error('3D globe canvas is missing.');
if (!/<canvas[^>]+role="application"/.test(html) || !/<svg[^>]+role="group"/.test(html)) {
  throw new Error('Globe canvas must use role="application" and the marker layer role="group".');
}
if (/id="activity-list"[^>]*aria-live/.test(html) || !/id="activity-latest"[^>]*role="status"/.test(html)) {
  throw new Error('Activity must announce only the latest entry through #activity-latest.');
}
if (!app.includes('function captureFocus') || !app.includes('restoreFocus(focusToken)')) {
  throw new Error('render() must preserve keyboard focus across innerHTML rewrites.');
}
for (const id of ['zoom-in', 'zoom-out', 'reset-view']) {
  if (!new RegExp(`<button id="${id}"`).test(html)) throw new Error(`Globe HUD must expose a real <button id="${id}">.`);
}
if (!/#globe-stage\s*\{[^}]*touch-action: pan-y/.test(styles) || !styles.includes('#globe-stage:focus-within { touch-action: none; }')) {
  throw new Error('The globe stage must default to touch-action: pan-y and only claim the gesture (touch-action: none) while focused.');
}
if (globe.includes('ResizeObserver') || globe.includes('high-performance')) {
  throw new Error('src/globe.js must leave resize scheduling to app.js and not request high-performance GPU.');
}
if ((app.match(/new ResizeObserver\(/g) ?? []).length !== 1 || !app.includes("addEventListener('pagehide', persistNow)")) {
  throw new Error('app.js must own the single ResizeObserver and flush persistence on pagehide.');
}
if (/<(script|img)[^>]+(?:src)=["']https?:/i.test(html)) throw new Error('Remote executable or image dependency found in index.html.');
if (!headers.includes('Origin-Agent-Cluster: ?1') || !headers.includes('Permissions-Policy: tools=(self)')) {
  throw new Error('Configured WebMCP deployment headers are incomplete.');
}
if (!headers.includes("frame-ancestors 'none'") || !headers.includes('X-Frame-Options: DENY') || !webmcp.includes('globalThis.top !== globalThis.self')) {
  throw new Error('Anti-embedding headers and the runtime top-level frame guard are both required.');
}
const cacheVersion = serviceWorker.match(/^const CACHE = '(terra-v\d+)';/m)?.[1];
if (!cacheVersion) throw new Error("sw.js must declare const CACHE = 'terra-v<N>'.");
if (serviceWorker.includes('respondWith(undefined)') || !serviceWorker.includes('Response.error()') || !serviceWorker.includes("caches.match('./index.html')")) {
  throw new Error('Service worker must fall back to the cached shell or Response.error() when offline.');
}
if (headers.includes('immutable') || !headers.includes('stale-while-revalidate=86400')) {
  throw new Error('Unhashed assets must not be immutable; use max-age=3600 with stale-while-revalidate.');
}
for (const module of ['app', 'data', 'engine', 'globe', 'output', 'state', 'webmcp']) {
  if (!serviceWorker.includes(`'./src/${module}.js'`)) throw new Error(`Service worker precache list is missing src/${module}.js.`);
}

console.log(`Verified ${requiredFiles.length} project files, ${counts.total} WebMCP tool contracts (${counts.always} always-on + ${counts.mutation} draft-only), and service-worker cache ${cacheVersion}.`);
