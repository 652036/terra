import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PERSISTED_REVISION,
  createUniqueId,
  dedupeByStableId,
  getAgentUndoTarget,
  incrementRevision,
  normalizeMeasurementValues,
  normalizeRevision,
  removeOneByStableId,
} from '../src/state.js';

test('persisted revisions are bounded safe integers and increment monotonically', () => {
  assert.equal(normalizeRevision(Number.MAX_VALUE), 0);
  assert.equal(normalizeRevision(Number.MAX_SAFE_INTEGER), 0);
  assert.equal(normalizeRevision('4'), 0);
  assert.equal(normalizeRevision(MAX_PERSISTED_REVISION), 0);
  assert.equal(normalizeRevision(MAX_PERSISTED_REVISION - 1), MAX_PERSISTED_REVISION - 1);
  assert.equal(incrementRevision(MAX_PERSISTED_REVISION - 2), MAX_PERSISTED_REVISION - 1);
  assert.throws(() => incrementRevision(MAX_PERSISTED_REVISION - 1), /safe increment/);
  assert.throws(() => incrementRevision(Number.MAX_SAFE_INTEGER), /safe increment/);
});

test('persisted measurements reject impossible distances and non-normal bearings', () => {
  assert.deepEqual(normalizeMeasurementValues({ km: 0, bearing: 0 }), { km: 0, bearing: 0 });
  assert.deepEqual(normalizeMeasurementValues({ km: 20000, bearing: 359.9 }), { km: 20000, bearing: 359.9 });
  assert.equal(normalizeMeasurementValues({ km: -1, bearing: 20 }), null);
  assert.equal(normalizeMeasurementValues({ km: 20041, bearing: 20 }), null);
  assert.equal(normalizeMeasurementValues({ km: 2, bearing: -1 }), null);
  assert.equal(normalizeMeasurementValues({ km: 2, bearing: 360 }), null);
  assert.equal(normalizeMeasurementValues({ km: '2', bearing: 10 }), null);
});

test('undo accepts only the current agent-authored revision', () => {
  const agentEntry = { actor: 'agent', resultRevision: 8, label: 'pin' };
  assert.equal(getAgentUndoTarget([agentEntry], 8, 8), agentEntry);
  assert.throws(() => getAgentUndoTarget([agentEntry], 8, 7), /Revision conflict/);
  assert.throws(() => getAgentUndoTarget([{ ...agentEntry, actor: 'user' }], 8, 8), /visible user interface/);
  assert.throws(() => getAgentUndoTarget([{ ...agentEntry, resultRevision: 7 }], 8, 8), /no longer/);
});

test('stable ids are deduplicated, collision-checked, and removed one at a time', () => {
  const duplicateItems = [{ id: 'pin-a' }, { id: 'pin-a' }, { id: 'pin-b' }];
  assert.deepEqual(dedupeByStableId(duplicateItems).map((item) => item.id), ['pin-a', 'pin-b']);
  const tokens = ['collision', 'collision', 'unique'];
  const id = createUniqueId('pin', (candidate) => candidate === 'pin-collision', () => tokens.shift());
  assert.equal(id, 'pin-unique');
  const removal = removeOneByStableId(duplicateItems, 'pin-a');
  assert.equal(removal.removed, duplicateItems[0]);
  assert.deepEqual(removal.remaining.map((item) => item.id), ['pin-a', 'pin-b']);
});
