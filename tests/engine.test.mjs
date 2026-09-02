import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOUR_UTC, PLACES, blankScene, exampleScene } from '../src/data.js';
import {
  bearingDegrees,
  catalogEntry,
  comparePlaces,
  exportMarkdown,
  findPlace,
  formatHour,
  getPlace,
  haversineKm,
  localHourToUtc,
  projectPoint,
  requirePlace,
  resolvePlace,
  sunlit,
  unknownPlaceMessage,
} from '../src/engine.js';

test('catalog search covers ids, countries, climates, and notes', () => {
  assert.equal(findPlace('tokyo')[0].id, 'tokyo');
  assert.equal(findPlace('iceland')[0].id, 'reykjavik');
  assert.ok(findPlace('oceanic').length >= 2);
  assert.deepEqual(findPlace(''), []);
});

test('catalog entries expose one public shape including utcOffset', () => {
  assert.equal(PLACES.length, 12);
  const entry = catalogEntry(getPlace('tokyo'));
  assert.deepEqual(Object.keys(entry).sort(), ['climate', 'country', 'id', 'lat', 'lon', 'name', 'note', 'populationMillions', 'utcOffset']);
  assert.equal(entry.populationMillions, 37.4);
  assert.equal(entry.utcOffset, 9);
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

test('place comparison requires distinct known ids and explains how to fix mistakes', () => {
  const comparison = comparePlaces(['tokyo', 'vancouver', 'sydney']);
  assert.equal(comparison.places.length, 3);
  assert.equal(comparison.pairs.length, 3);
  assert.throws(() => comparePlaces(['tokyo', 'tokyo']), /distinct.*"tokyo" was given more than once.*Valid ids: tokyo, nyc/);
  assert.throws(() => comparePlaces(['tokyo', 'Tokyo']), /distinct/);
  assert.throws(() => comparePlaces(['tokyo', 'atlantis']), /Unknown place id\(s\): "atlantis"\. Valid ids: tokyo, nyc, london/);
  assert.deepEqual(comparePlaces(['New York', 'LONDON']).places.map((place) => place.id), ['nyc', 'london']);
});

test('places resolve by id or case-insensitive city name; failures list valid ids', () => {
  assert.equal(resolvePlace('tokyo').id, 'tokyo');
  assert.equal(resolvePlace('Tokyo').id, 'tokyo');
  assert.equal(resolvePlace('  new york ').id, 'nyc');
  assert.equal(resolvePlace('NYC').id, 'nyc');
  assert.equal(resolvePlace('Sao Paulo').id, 'sao-paulo');
  assert.equal(resolvePlace('tokio'), null);
  assert.equal(resolvePlace(''), null);
  assert.equal(resolvePlace(42), null);
  assert.equal(requirePlace('London').id, 'london');
  assert.throws(() => requirePlace('tokio'), /Unknown place "tokio"\. Valid ids: tokyo, nyc, london, nairobi, reykjavik, sydney, sao-paulo, cairo, singapore, vancouver, lagos, ushuaia\./);
  assert.match(unknownPlaceMessage('x'), /terra_find_places/);
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

test('visualization hour is UTC: 13:00 UTC is night in Tokyo and day in London', () => {
  assert.equal(DEFAULT_HOUR_UTC, 13);
  assert.equal(blankScene().time, 13);
  assert.equal(exampleScene().time, 13);
  assert.equal(sunlit(getPlace('tokyo').lon, 13), false);
  assert.equal(sunlit(getPlace('london').lon, 13), true);
  assert.equal(sunlit(getPlace('tokyo').lon, 22), true, '22:00 UTC is 07:00 in Tokyo');
  for (let hour = 9; hour <= 20; hour += 1) assert.equal(sunlit(getPlace('tokyo').lon, hour), false, `Tokyo dark at ${hour} UTC`);
  assert.equal(sunlit(getPlace('tokyo').lon, 8), true);
  assert.equal(sunlit(getPlace('tokyo').lon, 21), true);
  assert.equal(formatHour(13), '13:00 UTC');
  assert.equal(formatHour(5), '05:00 UTC');
});

test('local hours convert to UTC through catalog utcOffset', () => {
  for (const place of PLACES) {
    assert.ok(Number.isInteger(place.utcOffset) && place.utcOffset >= -12 && place.utcOffset <= 14, `${place.id} utcOffset`);
  }
  assert.equal(localHourToUtc(22, getPlace('tokyo').utcOffset), 13);
  assert.equal(localHourToUtc(5, getPlace('vancouver').utcOffset), 13);
  assert.equal(localHourToUtc(8, getPlace('nyc').utcOffset), 13);
  assert.equal(localHourToUtc(2, getPlace('nairobi').utcOffset), 23);
  assert.equal(localHourToUtc(0, getPlace('london').utcOffset), 0);
  assert.equal(localHourToUtc(23, getPlace('sydney').utcOffset), 13);
});

test('Markdown export states the human publish gate', () => {
  const draft = exampleScene();
  const draftMarkdown = exportMarkdown(draft);
  assert.match(draftMarkdown, /Visible publish review is still open/);
  assert.match(draftMarkdown, /Start here/);
  assert.match(draftMarkdown, /Visualization hour: 13:00 UTC/);
  const published = blankScene();
  published.published = true;
  assert.match(exportMarkdown(published), /finalized through visible user review/);
});

test('Markdown export includes every comparison with its pairwise distances', () => {
  const scene = blankScene();
  scene.comparisons = [
    { id: 'cmp-1', ...comparePlaces(['tokyo', 'vancouver', 'sydney']) },
    { id: 'cmp-2', ...comparePlaces(['london', 'cairo']) },
  ];
  scene.measurements = [{ id: 'msr-1', from: 'London', to: 'Cairo', km: 3513.5, bearing: 121.5 }];
  const markdown = exportMarkdown(scene);
  const sections = markdown.split('\n## ').map((block) => block.split('\n')[0]);
  assert.deepEqual(sections.slice(1), ['Pins', 'Comparisons', 'Measurements', 'Staged brief']);
  assert.match(markdown, /- Comparisons: 2/);
  assert.match(markdown, /## Comparisons\n- Tokyo · Vancouver · Sydney — population spread 34\.7M\n {2}- tokyo → vancouver: [\d.]+ km, bearing [\d.]+°/);
  assert.match(markdown, /- London · Cairo — population spread 12\.4M\n {2}- london → cairo: [\d.]+ km/);
  assert.match(markdown, /## Measurements\n- London → Cairo: 3513\.5 km, bearing 121\.5°/);
  assert.match(exportMarkdown(blankScene()), /## Pins\n- None\n\n## Comparisons\n- None\n\n## Measurements\n- None/);
});
