import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene } from '../src/data.js';
import { exportMarkdown } from '../src/engine.js';
import {
  MAX_EXPORT_CHARS,
  MAX_READ_ITEMS,
  PREVIEW_CHARS,
  exportMarkdownChunk,
  readScenePage,
} from '../src/output.js';

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
  const page = readScenePage(saturatedScene(), {}, { catalogSize: 12, activeToolCount: 13 });
  assert.equal(page.section, 'summary');
  assert.equal(page.counts.pins, 24);
  assert.equal(page.timeZone, 'UTC');
  assert.equal(page.stagedBriefSummary.bodyChars, 4000);
  assert.equal('pins' in page, false);
  assert.equal('items' in page, false);
  assert.ok(JSON.stringify(page).length < 1500);
});

test('read_scene section pages carry revision and paging only, not the whole summary', () => {
  const page = readScenePage(saturatedScene(), { section: 'measurements' }, { catalogSize: 12, activeToolCount: 13 });
  assert.deepEqual(Object.keys(page).sort(), ['items', 'page', 'published', 'revision', 'section']);
  assert.equal(page.revision, 42);
  assert.equal(page.published, false);
  assert.deepEqual(page.items, []);
  assert.equal(page.page.done, true);
});

test('read_scene pages up to eight records, previews long notes, and keeps every stable id', () => {
  assert.equal(MAX_READ_ITEMS, 8);
  const scene = saturatedScene();
  const recovered = [];
  let offset = 0;
  let pages = 0;
  do {
    const page = readScenePage(scene, { section: 'pins', offset });
    pages += 1;
    assert.ok(page.items.length <= MAX_READ_ITEMS);
    assert.ok(JSON.stringify(page).length < 8000, `page ${offset} was ${JSON.stringify(page).length} chars`);
    assert.equal(page.page.previewed, page.items.length);
    assert.match(page.hint, /complete record/);
    for (const item of page.items) {
      assert.equal('note' in item, false);
      assert.equal(item.notePreview.length, PREVIEW_CHARS);
      assert.equal(item.noteChars, 4000);
      recovered.push(item.id);
    }
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.equal(pages, 3);
  assert.deepEqual(recovered, scene.pins.map((pin) => pin.id));
});

test('read_scene returns short notes verbatim and no hint when nothing is previewed', () => {
  const scene = blankScene();
  scene.revision = 3;
  scene.pins = [{ id: 'pin-short', placeId: 'tokyo', label: 'Short', note: 'Fits in one page.' }];
  const page = readScenePage(scene, { section: 'pins' });
  assert.deepEqual(page.items, scene.pins);
  assert.equal(page.page.previewed, 0);
  assert.equal('hint' in page, false);
});

test('read_scene fetches one complete record by id and lists known ids on a miss', () => {
  const scene = saturatedScene();
  const single = readScenePage(scene, { section: 'pins', id: 'pin-7' });
  assert.deepEqual(Object.keys(single).sort(), ['id', 'item', 'published', 'revision', 'section']);
  assert.deepEqual(single.item, scene.pins[7]);
  assert.equal(single.item.note.length, 4000);
  assert.throws(() => readScenePage(scene, { section: 'pins', id: 'pin-99' }), /Unknown pins id "pin-99"\. Known ids: pin-0, pin-1/);
  assert.throws(() => readScenePage(blankScene(), { section: 'brief', id: 'brief-x' }), /section is empty/);
  assert.throws(() => readScenePage(scene, { id: 'pin-7' }), /id requires a named section/);
});

test('read_scene previews the staged brief on the page and returns it complete by id', () => {
  const scene = saturatedScene();
  const page = readScenePage(scene, { section: 'brief' });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 'brief-saturated');
  assert.equal('body' in page.items[0], false);
  assert.equal(page.items[0].bodyPreview.length, PREVIEW_CHARS);
  assert.equal(page.items[0].bodyChars, 4000);
  assert.equal(page.page.done, true);
  const full = readScenePage(scene, { section: 'brief', id: 'brief-saturated' });
  assert.equal(full.item.body, scene.stagedBrief.body);
  assert.ok(JSON.stringify(full).length < 6000);
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

test('pagination rejects oversized output requests with the valid range', () => {
  const scene = saturatedScene();
  assert.throws(() => readScenePage(scene, { section: 'pins', limit: MAX_READ_ITEMS + 1 }), /limit must be an integer from 1 to 8/);
  assert.throws(() => readScenePage(scene, { section: 'nope' }), /Valid sections: summary, pins, comparisons, measurements, brief/);
  assert.throws(() => exportMarkdownChunk(scene, { maxChars: MAX_EXPORT_CHARS + 1 }), /maxChars/);
});
