import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene } from '../src/data.js';
import { exportMarkdown } from '../src/engine.js';
import { MAX_EXPORT_CHARS, exportMarkdownChunk, readScenePage } from '../src/output.js';

function saturatedScene() {
  const scene = blankScene();
  scene.revision = 42;
  scene.pins = Array.from({ length: 24 }, (_, index) => ({
    id: `pin-${index}`,
    placeId: index % 2 ? 'tokyo' : 'vancouver',
    label: `Pin ${index}`,
    note: `${index}:`.padEnd(4000, 'x'),
  }));
  scene.stagedBrief = {
    id: 'brief-saturated',
    headline: 'Saturated brief',
    body: 'b'.repeat(4000),
    at: '2026-08-30T00:00:00.000Z',
  };
  return scene;
}

test('read_scene defaults to a bounded summary without large bodies', () => {
  const page = readScenePage(saturatedScene(), {}, { catalogSize: 12, activeToolCount: 15 });
  assert.equal(page.section, 'summary');
  assert.equal(page.counts.pins, 24);
  assert.equal(page.stagedBriefSummary.bodyChars, 4000);
  assert.equal('pins' in page, false);
  assert.equal('items' in page, false);
  assert.ok(JSON.stringify(page).length < 1500);
});

test('read_scene pages preserve every stable pin id and complete note', () => {
  const scene = saturatedScene();
  const recovered = [];
  let offset = 0;
  do {
    const page = readScenePage(scene, { section: 'pins', offset, limit: 1 });
    assert.equal(page.items.length, 1);
    assert.ok(JSON.stringify(page).length < 6000);
    recovered.push(page.items[0]);
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(recovered, scene.pins);
});

test('read_scene retrieves the complete staged brief as one bounded stable record', () => {
  const scene = saturatedScene();
  const page = readScenePage(scene, { section: 'brief' });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 'brief-saturated');
  assert.equal(page.items[0].body, scene.stagedBrief.body);
  assert.equal(page.page.done, true);
  assert.ok(JSON.stringify(page).length < 6000);
});

test('Markdown export chunks are bounded and exactly reconstruct the full export', () => {
  const scene = saturatedScene();
  const chunks = [];
  let offset = 0;
  do {
    const page = exportMarkdownChunk(scene, { offset, maxChars: MAX_EXPORT_CHARS });
    assert.ok(page.markdownChunk.length <= MAX_EXPORT_CHARS);
    assert.equal(page.revision, 42);
    chunks.push(page.markdownChunk);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(chunks.join(''), exportMarkdown(scene));
});

test('pagination rejects oversized output requests', () => {
  const scene = saturatedScene();
  assert.throws(() => readScenePage(scene, { section: 'pins', limit: 2 }), /limit/);
  assert.throws(() => exportMarkdownChunk(scene, { maxChars: MAX_EXPORT_CHARS + 1 }), /maxChars/);
});
