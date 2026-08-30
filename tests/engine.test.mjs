import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene, exampleScene } from '../src/data.js';
import {
  bearingDegrees,
  comparePlaces,
  exportMarkdown,
  findPlace,
  getPlace,
  haversineKm,
  projectPoint,
  sunlit,
} from '../src/engine.js';

test('catalog search covers ids, countries, climates, and notes', () => {
  assert.equal(findPlace('tokyo')[0].id, 'tokyo');
  assert.equal(findPlace('iceland')[0].id, 'reykjavik');
  assert.ok(findPlace('oceanic').length >= 2);
  assert.deepEqual(findPlace(''), []);
});

test('great-circle distance and bearing are stable', () => {
  const tokyo = getPlace('tokyo');
  const vancouver = getPlace('vancouver');
  const distance = haversineKm(tokyo, vancouver);
  const bearing = bearingDegrees(tokyo, vancouver);
  assert.ok(distance > 7_400 && distance < 7_700, `distance was ${distance}`);
  assert.ok(bearing >= 0 && bearing < 360, `bearing was ${bearing}`);
  assert.equal(haversineKm(tokyo, tokyo), 0);
});

test('place comparison requires distinct known ids', () => {
  const comparison = comparePlaces(['tokyo', 'vancouver', 'sydney']);
  assert.equal(comparison.places.length, 3);
  assert.equal(comparison.pairs.length, 3);
  assert.throws(() => comparePlaces(['tokyo', 'tokyo']), /distinct/);
  assert.throws(() => comparePlaces(['tokyo', 'atlantis']), /Unknown place/);
});

test('orthographic projection centers the camera and clips the far hemisphere', () => {
  const camera = { lat: 0, lon: 0, altitude: 1 };
  const center = projectPoint(0, 0, camera);
  const east = projectPoint(0, 45, camera);
  const farSide = projectPoint(0, 180, camera);
  assert.ok(Math.abs(center.x) < 1e-12);
  assert.ok(Math.abs(center.y) < 1e-12);
  assert.equal(center.depth, 1);
  assert.equal(center.visible, true);
  assert.ok(east.x > 0 && east.visible);
  assert.equal(farSide.visible, false);
});

test('day-night helper follows visualization hour', () => {
  assert.equal(sunlit(0, 12), true);
  assert.equal(sunlit(180, 12), false);
  assert.equal(sunlit(150, 2), true);
});

test('Markdown export states the human publish gate', () => {
  const draft = exampleScene();
  const draftMarkdown = exportMarkdown(draft);
  assert.match(draftMarkdown, /Visible publish review is still open/);
  assert.match(draftMarkdown, /Start here/);
  const published = blankScene();
  published.published = true;
  assert.match(exportMarkdown(published), /finalized through visible user review/);
});
