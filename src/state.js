export const MAX_PERSISTED_REVISION = 1_000_000_000;
export const MAX_GREAT_CIRCLE_KM = 20_040;

export function normalizeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < MAX_PERSISTED_REVISION
    ? value
    : 0;
}

export function incrementRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_PERSISTED_REVISION - 1) {
    throw new RangeError('Scene revision is outside the safe increment range.');
  }
  return value + 1;
}

export function isoDateOrNow(value, now = () => new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return now().toISOString();
}

export function normalizeMeasurementValues(item) {
  if (!item || typeof item !== 'object') return null;
  const { km, bearing } = item;
  if (!Number.isFinite(km) || km < 0 || km > MAX_GREAT_CIRCLE_KM) return null;
  if (!Number.isFinite(bearing) || bearing < 0 || bearing >= 360) return null;
  return { km, bearing };
}

export function getAgentUndoTarget(history, currentRevision, expectedRevision) {
  if (expectedRevision !== currentRevision) {
    throw new Error(`Revision conflict: scene is at revision ${currentRevision}, not ${expectedRevision}. Call terra_read_scene and retry with the current revision.`);
  }
  const previous = history.at(-1);
  if (!previous) {
    throw new Error('Nothing to undo: no reversible change has been recorded in this tab yet. Make a change with a mutation tool first.');
  }
  if (previous.actor !== 'agent' || previous.resultRevision !== currentRevision) {
    throw new Error(`Undo refused: the latest change (${previous.label}) was made through the visible user interface or is no longer the current revision. Only the most recent agent-authored change can be undone; call terra_read_scene to see the current state.`);
  }
  return previous;
}

export function dedupeByStableId(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function createUniqueId(prefix, isTaken, randomToken = () => (
  globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10)
  ?? Math.random().toString(36).slice(2, 12)
)) {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(prefix)) throw new TypeError('Invalid id prefix.');
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const token = String(randomToken()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    if (!token) continue;
    const candidate = `${prefix}-${token}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique ${prefix} id.`);
}

// Tracks one continuous human edit (slider drag, key repeat) so a snapshot is taken only once,
// and only when the value really changed from where the edit began.
export function createEditSession() {
  let origin = null;
  return {
    get active() {
      return origin !== null;
    },
    begin(current) {
      if (origin !== null) return false;
      origin = current;
      return true;
    },
    finish(current) {
      if (origin === null) return null;
      const from = origin;
      origin = null;
      return { from, to: current, changed: from !== current };
    },
  };
}

export function removeOneByStableId(items, id) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return {
    removed: items[index],
    remaining: [...items.slice(0, index), ...items.slice(index + 1)],
  };
}
