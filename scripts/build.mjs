import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const destination = resolve(root, 'dist');
// `.openai/hosting.json` stays at the repository root; ChatGPT Sites reads it from there, not from dist/.
const files = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  'LICENSE',
  'SECURITY.md',
  'assets',
  'src',
  'public/_headers',
];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of files) {
  const outputName = file === 'public/_headers' ? '_headers' : file;
  await cp(resolve(root, file), resolve(destination, outputName), { recursive: true });
}

console.log(`Built ${files.length} source entries in dist/`);
