import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PERSISTED_REVISION,
  createEditSession,
  createUniqueId,
  dedupeByStableId,
  getAgentUndoTarget,
  incrementRevision,
  isoDateOrNow,
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

test('persisted timestamps must be real ISO dates or they are replaced with now', () => {
  const now = () => new Date('2026-09-02T10:00:00.000Z');
  assert.equal(isoDateOrNow('2026-08-30T00:00:00.000Z', now), '2026-08-30T00:00:00.000Z');
  assert.equal(isoDateOrNow('2026-08-30T01:02:03+09:00', now), '2026-08-29T16:02:03.000Z');
  assert.equal(isoDateOrNow('<img onerror=alert(1)>', now), '2026-09-02T10:00:00.000Z');
  assert.equal(isoDateOrNow('yesterday', now), '2026-09-02T10:00:00.000Z');
  assert.equal(isoDateOrNow('2026-13-45T99:99:99Z', now), '2026-09-02T10:00:00.000Z');
  assert.equal(isoDateOrNow(1_700_000_000_000, now), '2026-09-02T10:00:00.000Z');
  assert.equal(isoDateOrNow(undefined, now), '2026-09-02T10:00:00.000Z');
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

test('undo errors tell the agent the current revision and the next step', () => {
  const agentEntry = { actor: 'agent', resultRevision: 14, label: 'pin' };
  assert.throws(
    () => getAgentUndoTarget([agentEntry], 14, 9),
    /^Error: Revision conflict: scene is at revision 14, not 9\. Call terra_read_scene and retry with the current revision\.$/,
  );
  assert.throws(() => getAgentUndoTarget([], 14, 14), /Nothing to undo.*mutation tool first/);
  assert.throws(() => getAgentUndoTarget([{ ...agentEntry, actor: 'user', label: 'human-orbit' }], 14, 14), /\(human-orbit\).*terra_read_scene/);
});

test('an edit session snapshots once per gesture and reports whether anything changed', () => {
  const session = createEditSession();
  assert.equal(session.active, false);
  assert.equal(session.finish(13), null, 'tabbing through or clicking without moving never begins an edit');
  assert.equal(session.begin(13), true, 'first real value change begins the edit');
  assert.equal(session.begin(14), false, 'later moves in the same gesture do not snapshot again');
  assert.equal(session.active, true);
  assert.deepEqual(session.finish(13), { from: 13, to: 13, changed: false }, 'returning to the origin discards the edit');
  assert.equal(session.active, false);
  assert.equal(session.begin(13), true);
  assert.deepEqual(session.finish(17), { from: 13, to: 17, changed: true });
  assert.equal(session.finish(17), null, 'a second commit (pointerup then change) is a no-op');
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
