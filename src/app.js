import { LAYERS, PLACES, blankScene, exampleScene } from './data.js';
import {
  catalogEntry,
  comparePlaces,
  findPlace,
  formatHour,
  getPlace,
  localHourToUtc,
  projectPoint,
  requirePlace,
  sunlit,
} from './engine.js';
import { GlobeRenderer } from './globe.js';
import { MAX_READ_ITEMS, MAX_READ_OFFSET, READ_SCENE_SECTIONS, exportMarkdownChunk, readScenePage } from './output.js';
import {
  createEditSession,
  createUniqueId,
  dedupeByStableId,
  getAgentUndoTarget,
  incrementRevision,
  isoDateOrNow,
  normalizeMeasurementValues,
  normalizeRevision,
  removeOneByStableId,
} from './state.js';
import { installWebMCP, schemas } from './webmcp.js';

const STORAGE_KEY = 'terra-scene-v2';
const LEGACY_STORAGE_KEY = 'terra-scene-v1';
const HISTORY_LIMIT = 20;
const PIN_LIMIT = 24;
const COMPARISON_LIMIT = 6;
const MEASUREMENT_LIMIT = 8;
const ACTIVITY_LIMIT = 20;
const ALTITUDE_MIN = 0.72;
const ALTITUDE_MAX = 1.55;

const annotation = Object.freeze({
  read: Object.freeze({ readOnlyHint: true }),
  write: Object.freeze({ readOnlyHint: false }),
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const normalizeLongitude = (value) => ((value + 540) % 360) - 180;
const safeText = (value, limit, fallback = '') => {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, limit);
};
const safeId = (value, fallback) => {
  const text = typeof value === 'string' ? value : '';
  return /^[a-z0-9][a-z0-9-]{0,119}$/.test(text) ? text : fallback;
};
const escapeHTML = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]));

function hydrateScene(candidate) {
  const base = blankScene();
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return base;
  const requestedPlace = getPlace(candidate.camera?.placeId);
  const camera = requestedPlace
    ? {
        placeId: requestedPlace.id,
        lat: requestedPlace.lat,
        lon: requestedPlace.lon,
        altitude: clamp(finiteNumber(candidate.camera?.altitude, 1), ALTITUDE_MIN, ALTITUDE_MAX),
      }
    : {
        placeId: null,
        lat: clamp(finiteNumber(candidate.camera?.lat, base.camera.lat), -85, 85),
        lon: normalizeLongitude(finiteNumber(candidate.camera?.lon, base.camera.lon)),
        altitude: clamp(finiteNumber(candidate.camera?.altitude, 1), ALTITUDE_MIN, ALTITUDE_MAX),
      };
  const layers = Object.fromEntries(LAYERS.map((layer) => [
    layer.id,
    typeof candidate.layers?.[layer.id] === 'boolean' ? candidate.layers[layer.id] : base.layers[layer.id],
  ]));
  const pins = dedupeByStableId(Array.isArray(candidate.pins)
    ? candidate.pins.slice(0, PIN_LIMIT).flatMap((pin, index) => {
        if (!pin || !getPlace(pin.placeId)) return [];
        return [{
          id: safeId(pin.id, `pin-restored-${index + 1}`),
          placeId: pin.placeId,
          label: safeText(pin.label, 160, 'Untitled pin'),
          note: safeText(pin.note, 4000),
        }];
      })
    : []);
  const comparisons = Array.isArray(candidate.comparisons)
    ? candidate.comparisons.slice(0, COMPARISON_LIMIT).flatMap((item, index) => {
        try {
          const ids = Array.isArray(item?.places) ? item.places.map((place) => place?.id).filter(Boolean) : [];
          return [{ id: safeId(item?.id, `cmp-restored-${index + 1}`), ...comparePlaces(ids) }];
        } catch {
          return [];
        }
      })
    : [];
  const measurements = Array.isArray(candidate.measurements)
    ? candidate.measurements.slice(0, MEASUREMENT_LIMIT).flatMap((item, index) => {
        const values = normalizeMeasurementValues(item);
        if (!values) return [];
        return [{
          id: safeId(item.id, `msr-restored-${index + 1}`),
          from: safeText(item.from, 120, 'Unknown'),
          to: safeText(item.to, 120, 'Unknown'),
          ...values,
        }];
      })
    : [];
  const activity = Array.isArray(candidate.activity)
    ? candidate.activity.slice(0, ACTIVITY_LIMIT).flatMap((item) => {
        if (!item || typeof item.message !== 'string') return [];
        return [{
          at: isoDateOrNow(item.at),
          message: safeText(item.message, 240, 'Scene changed.'),
        }];
      })
    : [];
  const stagedBrief = candidate.stagedBrief && typeof candidate.stagedBrief === 'object'
    ? {
        id: safeId(candidate.stagedBrief.id, 'brief-restored'),
        headline: safeText(candidate.stagedBrief.headline, 160, 'Untitled brief'),
        body: safeText(candidate.stagedBrief.body, 4000, 'No briefing body.'),
        at: isoDateOrNow(candidate.stagedBrief.at),
      }
    : null;
  return {
    title: safeText(candidate.title, 100, base.title),
    camera,
    time: clamp(Math.round(finiteNumber(candidate.time, base.time)), 0, 23),
    layers,
    pins,
    comparisons,
    measurements,
    activity,
    stagedBrief,
    published: candidate.published === true,
    revision: normalizeRevision(candidate.revision),
    history: [],
  };
}

function loadScene() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? hydrateScene(JSON.parse(raw)) : hydrateScene(exampleScene());
  } catch {
    return hydrateScene(exampleScene());
  }
}

const state = {
  scene: loadScene(),
  focus: 'globe',
};

const globeCanvas = document.getElementById('globe-canvas');
const globeRenderer = new GlobeRenderer(globeCanvas, {
  textureUrl: new URL('../assets/earth-texture.svg', import.meta.url).href,
});

const PERSIST_DEBOUNCE_MS = 200;
let persistTimer = null;

function persistNow() {
  globalThis.clearTimeout(persistTimer);
  persistTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.scene, history: [] }));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn('TERRA could not persist this scene.', error);
  }
}

function persist() {
  if (persistTimer !== null) return;
  persistTimer = globalThis.setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
}

let globeFrame = 0;
function scheduleGlobeRender() {
  if (globeFrame) return;
  globeFrame = requestAnimationFrame(() => {
    globeFrame = 0;
    renderGlobe();
  });
}

function snapshot(label, actor) {
  incrementRevision(state.scene.revision);
  state.scene.history.push({
    label,
    actor,
    resultRevision: null,
    scene: structuredClone({ ...state.scene, history: [] }),
  });
  if (state.scene.history.length > HISTORY_LIMIT) state.scene.history.shift();
}

function discardPendingSnapshot(label) {
  const pending = state.scene.history.at(-1);
  if (pending?.label === label && pending.actor === 'user' && pending.resultRevision === null) state.scene.history.pop();
}

function log(message, actor) {
  state.scene.revision = incrementRevision(state.scene.revision);
  state.scene.activity.unshift({ at: new Date().toISOString(), message });
  state.scene.activity = state.scene.activity.slice(0, ACTIVITY_LIMIT);
  const pending = state.scene.history.at(-1);
  if (pending?.actor === actor && pending.resultRevision === null) {
    pending.resultRevision = state.scene.revision;
  }
}

function nextId(prefix) {
  const isTaken = (candidate) => (
    state.scene.pins.some((item) => item.id === candidate) ||
    state.scene.comparisons.some((item) => item.id === candidate) ||
    state.scene.measurements.some((item) => item.id === candidate) ||
    state.scene.stagedBrief?.id === candidate
  );
  return createUniqueId(prefix, isTaken);
}

function assertOpen() {
  if (state.scene.published) {
    throw new Error(`Scene is published at revision ${state.scene.revision}; mutation tools are locked until a person clicks "Reopen scene" in the visible UI. Read-only tools still work: ${alwaysTools().map((tool) => tool.name).join(', ')}.`);
  }
  incrementRevision(state.scene.revision);
}

function pinIdList() {
  return state.scene.pins.length ? `Current pin ids: ${state.scene.pins.map((pin) => pin.id).join(', ')}.` : 'There are no pins yet.';
}

function ensureNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Tool call was cancelled.', 'AbortError');
}

function sceneReceipt(action, result = {}) {
  return {
    ok: true,
    action,
    revision: state.scene.revision,
    published: state.scene.published,
    visibleState: {
      camera: { ...state.scene.camera },
      time: state.scene.time,
      layers: { ...state.scene.layers },
      pinCount: state.scene.pins.length,
      comparisonCount: state.scene.comparisons.length,
      measurementCount: state.scene.measurements.length,
      hasStagedBrief: Boolean(state.scene.stagedBrief),
    },
    result,
  };
}

const FOCUS_KEYS = ['place', 'layer', 'pin'];

function captureFocus() {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  for (const key of FOCUS_KEYS) {
    const owner = active.closest?.(`[data-${key}]`);
    if (!owner) continue;
    const container = owner.closest('[id]');
    return { containerId: container?.id ?? null, selector: `[data-${key}="${owner.dataset[key]}"]` };
  }
  return null;
}

function restoreFocus(token) {
  if (!token) return;
  const scope = token.containerId ? document.getElementById(token.containerId) : document;
  const target = scope?.querySelector(token.selector);
  if (target && target !== document.activeElement) target.focus({ preventScroll: true });
}

function renderGlobe() {
  if (globeFrame) {
    cancelAnimationFrame(globeFrame);
    globeFrame = 0;
  }
  const scene = state.scene;
  const focusToken = captureFocus();
  const cameraPlace = getPlace(scene.camera.placeId);
  const cameraText = cameraPlace
    ? `${cameraPlace.name} · ${cameraPlace.country}`
    : `${scene.camera.lat.toFixed(2)}°, ${scene.camera.lon.toFixed(2)}°`;
  document.getElementById('camera-readout').textContent = cameraText;
  document.getElementById('time-readout').textContent = `${String(scene.time).padStart(2, '0')}:00`;
  document.getElementById('time-slider').value = String(scene.time);
  document.getElementById('zoom-readout').textContent = `${scene.camera.altitude.toFixed(2)}×`;
  globeCanvas.setAttribute(
    'aria-label',
    `Interactive 3D Earth centered on ${cameraText} at ${formatHour(scene.time)}. Arrow keys rotate, plus and minus zoom; drag to rotate and scroll to zoom with a pointer.`,
  );

  const globe = document.getElementById('globe-stage');
  globe.dataset.night = sunlit(scene.camera.lon, scene.time) ? 'false' : 'true';
  globe.dataset.atmosphere = scene.layers.atmosphere ? 'on' : 'off';
  globe.dataset.grid = scene.layers.grid ? 'on' : 'off';
  globeRenderer.render(scene);

  const rect = globe.getBoundingClientRect();
  const altitude = clamp(Number(scene.camera.altitude) || 1, ALTITUDE_MIN, ALTITUDE_MAX);
  const baseScale = Math.min(0.9, 0.82 / altitude);
  const radius = Math.min(rect.width, rect.height) * baseScale * 0.5;
  const markerLayer = document.getElementById('place-dots');
  markerLayer.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
  const dots = PLACES.map((place) => {
    const point = projectPoint(place.lat, place.lon, scene.camera);
    return { place, point };
  }).filter(({ point }) => point.visible).sort((a, b) => a.point.depth - b.point.depth).map(({ place, point }) => {
    const night = !sunlit(place.lon, scene.time);
    const active = scene.camera.placeId === place.id;
    const pinned = scene.layers.pins && scene.pins.some((pin) => pin.placeId === place.id);
    const left = rect.width / 2 + point.x * radius;
    const top = rect.height / 2 + point.y * radius;
    const opacity = clamp(0.48 + point.depth * 0.68, 0.48, 1);
    const classes = [
      'place-dot',
      active ? 'is-active' : '',
      pinned ? 'is-pinned' : '',
      night && scene.layers.lights ? 'is-lit' : '',
    ].filter(Boolean).join(' ');
    return `<g class="${classes}" data-place="${place.id}" transform="translate(${left.toFixed(1)} ${top.toFixed(1)})" opacity="${opacity.toFixed(2)}" role="button" tabindex="${scene.published ? '-1' : '0'}" aria-disabled="${scene.published}" aria-label="Fly to ${escapeHTML(place.name)}, ${escapeHTML(place.country)}"><title>${escapeHTML(place.name)}</title><circle class="marker-hit" r="13"></circle>${pinned ? '<circle class="pin-ring" r="9"></circle>' : ''}<circle class="marker-core" r="4.5"></circle>${scene.layers.labels ? `<text x="12" y="3">${escapeHTML(place.name)}</text>` : ''}</g>`;
  }).join('');
  markerLayer.innerHTML = dots;
  restoreFocus(focusToken);
}

function render() {
  persist();
  const scene = state.scene;
  const focusToken = captureFocus();
  renderGlobe();
  document.getElementById('workspace-title').textContent = scene.title;
  document.getElementById('published-flag').hidden = !scene.published;
  document.getElementById('publish-brief').disabled = scene.published;
  document.getElementById('reopen-scene').hidden = !scene.published;
  document.getElementById('example-scene').disabled = scene.published;
  document.getElementById('reset-scene').disabled = scene.published;
  document.getElementById('time-slider').disabled = scene.published;
  for (const id of ['zoom-in', 'zoom-out', 'reset-view']) document.getElementById(id).disabled = scene.published;

  document.getElementById('place-list').innerHTML = PLACES.map((place) => {
    const active = scene.camera.placeId === place.id;
    return `<li><button type="button" data-place="${place.id}" class="${active ? 'is-active' : ''}" ${scene.published ? 'disabled' : ''}><span>${escapeHTML(place.name)}</span><small>${escapeHTML(place.country)}</small></button></li>`;
  }).join('');

  document.getElementById('pin-list').innerHTML = scene.pins.length
    ? scene.pins.map((pin) => {
        const place = getPlace(pin.placeId);
        return `<li><strong>${escapeHTML(pin.label)}</strong><span>${escapeHTML(place ? place.name : pin.placeId)}</span><em>${escapeHTML(pin.note || '')}</em></li>`;
      }).join('')
    : '<li class="empty">No pins yet.</li>';

  document.getElementById('compare-panel').innerHTML = scene.comparisons.length
    ? scene.comparisons.map((item) => `<li>${item.places.map((place) => escapeHTML(place.name)).join(' · ')} — max gap ${item.populationSpread}M people</li>`).join('')
    : '<li class="empty">No comparisons yet.</li>';

  document.getElementById('measure-panel').innerHTML = scene.measurements.length
    ? scene.measurements.map((item) => `<li>${escapeHTML(item.from)} → ${escapeHTML(item.to)}: ${item.km.toLocaleString()} km · ${item.bearing.toFixed(1)}°</li>`).join('')
    : '<li class="empty">No measurements yet.</li>';

  document.getElementById('layer-list').innerHTML = LAYERS.map((layer) => `
    <label><input type="checkbox" data-layer="${layer.id}" ${scene.layers[layer.id] ? 'checked' : ''} ${scene.published ? 'disabled' : ''}> ${escapeHTML(layer.label)}</label>
  `).join('');

  document.getElementById('activity-list').innerHTML = scene.activity.length
    ? scene.activity.map((item) => `<li><time datetime="${escapeHTML(item.at)}">${escapeHTML(new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time> · ${escapeHTML(item.message)}</li>`).join('')
    : '<li class="empty">Quiet globe.</li>';
  const latestActivity = document.getElementById('activity-latest');
  const latestMessage = scene.activity[0]?.message ?? '';
  if (latestActivity.textContent !== latestMessage) latestActivity.textContent = latestMessage;

  const staged = document.getElementById('staged-review');
  if (scene.stagedBrief) {
    staged.hidden = false;
    staged.querySelector('[data-role="headline"]').textContent = scene.stagedBrief.headline;
    staged.querySelector('[data-role="body"]').textContent = scene.stagedBrief.body;
  } else {
    staged.hidden = true;
  }

  document.querySelectorAll('[data-focus]').forEach((node) => {
    node.classList.toggle('is-focused', node.dataset.focus === state.focus);
  });
  restoreFocus(focusToken);
}

function mutationTools() {
  return [
    {
      name: 'terra_fly_to',
      title: 'Fly globe to place',
      description: 'Move the shared 3D globe camera to one catalog place. The human sees the same camera change immediately.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['placeId'],
        properties: {
          placeId: { ...schemas.id, description: 'Catalog place id (or city name) returned by terra_find_places.' },
          altitude: {
            type: 'number',
            minimum: ALTITUDE_MIN,
            maximum: ALTITUDE_MAX,
            description: `Optional zoom altitude from ${ALTITUDE_MIN} (closest) to ${ALTITUDE_MAX} (farthest). Defaults to the current altitude.`,
          },
        },
      },
      annotations: annotation.write,
      execute: async ({ placeId, altitude }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const place = requirePlace(placeId);
        snapshot('fly', 'agent');
        state.scene.camera = {
          placeId: place.id,
          lat: place.lat,
          lon: place.lon,
          altitude: altitude === undefined ? state.scene.camera.altitude : clamp(altitude, ALTITUDE_MIN, ALTITUDE_MAX),
        };
        log(`Agent flew to ${place.name}.`, 'agent');
        render();
        return sceneReceipt('fly_to', { place: catalogEntry(place) });
      },
    },
    {
      name: 'terra_drop_pin',
      title: 'Drop a place pin',
      description: 'Add a labeled pin to a catalog place on the shared globe. Labels and notes are displayed as untrusted user content.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['placeId', 'label'],
        properties: {
          placeId: { ...schemas.id, description: 'Catalog place id (or city name) to pin.' },
          label: { ...schemas.shortText, description: 'Short visible label for this pin.' },
          note: { ...schemas.longText, description: 'Optional note shown verbatim to the person beside the pin.' },
        },
      },
      annotations: { ...annotation.write, untrustedContentHint: true },
      execute: async ({ placeId, label, note }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const place = requirePlace(placeId);
        if (state.scene.pins.length >= PIN_LIMIT) {
          throw new Error(`Pin limit reached (${PIN_LIMIT} of ${PIN_LIMIT}). Call terra_remove_pin with one of these ids first. ${pinIdList()}`);
        }
        snapshot('pin', 'agent');
        const pin = { id: nextId('pin'), placeId: place.id, label: label.trim(), note: note?.trim() || '' };
        state.scene.pins.push(pin);
        log(`Agent pinned ${pin.label}.`, 'agent');
        render();
        return sceneReceipt('drop_pin', { pin });
      },
    },
    {
      name: 'terra_remove_pin',
      title: 'Remove a place pin',
      description: 'Remove one visible pin by its stable id. This is reversible with terra_undo_last_change.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['pinId'],
        properties: { pinId: { ...schemas.id, description: 'Pin id returned by terra_read_scene or terra_drop_pin.' } },
      },
      annotations: annotation.write,
      execute: async ({ pinId }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const removal = removeOneByStableId(state.scene.pins, pinId);
        if (!removal) throw new Error(`Unknown pin "${pinId}". ${pinIdList()} Call terra_read_scene with section "pins" to list them.`);
        snapshot('unpin', 'agent');
        state.scene.pins = removal.remaining;
        log(`Agent removed pin ${removal.removed.label}.`, 'agent');
        render();
        return sceneReceipt('remove_pin', { removedPinId: pinId });
      },
    },
    {
      name: 'terra_compare_places',
      title: 'Compare places',
      description: 'Compare two to five distinct catalog places: pairwise great-circle distance and initial bearing, climate, and population appear on the shared board. With exactly two places the pair is also recorded in the Measurements panel.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['placeIds'],
        properties: {
          placeIds: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            uniqueItems: true,
            items: schemas.id,
            description: 'Two to five distinct catalog place ids or city names. Pass exactly two to measure one distance.',
          },
        },
      },
      annotations: annotation.write,
      execute: async ({ placeIds }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const compared = comparePlaces(placeIds);
        snapshot('compare', 'agent');
        const comparison = { id: nextId('cmp'), ...compared };
        state.scene.comparisons.unshift(comparison);
        state.scene.comparisons = state.scene.comparisons.slice(0, COMPARISON_LIMIT);
        let measurement = null;
        if (comparison.places.length === 2) {
          const [pair] = comparison.pairs;
          measurement = {
            id: nextId('msr'),
            from: comparison.places[0].name,
            to: comparison.places[1].name,
            km: pair.km,
            bearing: pair.bearing,
          };
          state.scene.measurements.unshift(measurement);
          state.scene.measurements = state.scene.measurements.slice(0, MEASUREMENT_LIMIT);
        }
        log(`Agent compared ${comparison.places.map((place) => place.name).join(', ')}${measurement ? ` and measured ${measurement.km.toLocaleString()} km` : ''}.`, 'agent');
        render();
        return sceneReceipt('compare_places', measurement ? { comparison, measurement } : { comparison });
      },
    },
    {
      name: 'terra_set_time',
      title: 'Set globe time',
      description: 'Set the visualization hour in UTC (0 through 23). This moves the day-night terminator and city-light state on the shared globe. Pass localTo to give the hour in one catalog place\'s local time instead.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['hour'],
        properties: {
          hour: {
            type: 'integer',
            minimum: 0,
            maximum: 23,
            description: 'Visualization hour in UTC; the sun is overhead at longitude (12−hour)×15°. Tokyo (UTC+9) is dark roughly for hours 9–20 UTC. When localTo is set, this is that place\'s local hour instead.',
          },
          localTo: {
            ...schemas.id,
            description: 'Optional catalog place id or city name. When set, hour is read as local time at that place and converted to UTC using its utcOffset.',
          },
        },
      },
      annotations: annotation.write,
      execute: async ({ hour, localTo }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const place = localTo === undefined ? null : requirePlace(localTo);
        const hourUtc = place ? localHourToUtc(hour, place.utcOffset) : hour;
        snapshot('time', 'agent');
        state.scene.time = hourUtc;
        log(`Agent set visualization hour to ${formatHour(hourUtc)}${place ? ` (${String(hour).padStart(2, '0')}:00 in ${place.name})` : ''}.`, 'agent');
        render();
        return sceneReceipt('set_time', place
          ? { hour: hourUtc, localTo: place.id, localHour: hour, utcOffset: place.utcOffset }
          : { hour: hourUtc });
      },
    },
    {
      name: 'terra_toggle_layer',
      title: 'Toggle globe layer',
      description: 'Enable or disable one visible globe layer: place labels, city lights, atmosphere, latitude-longitude grid, or dropped pins.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['layerId', 'enabled'],
        properties: {
          layerId: { type: 'string', enum: LAYERS.map((layer) => layer.id), description: 'Stable layer id.' },
          enabled: { type: 'boolean', description: 'True to show this layer; false to hide it.' },
        },
      },
      annotations: annotation.write,
      execute: async ({ layerId, enabled }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        if (state.scene.layers[layerId] === enabled) {
          return sceneReceipt('toggle_layer', { layerId, enabled, changed: false });
        }
        snapshot('layer', 'agent');
        state.scene.layers[layerId] = enabled;
        log(`Agent ${enabled ? 'enabled' : 'disabled'} ${layerId}.`, 'agent');
        render();
        return sceneReceipt('toggle_layer', { layerId, enabled, changed: true });
      },
    },
    {
      name: 'terra_stage_brief',
      title: 'Stage briefing draft',
      description: 'Stage a draft briefing in the visible human-review panel. Publishing stays a visible action for the person; this tool only replaces the current draft.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body'],
        properties: {
          headline: { ...schemas.shortText, description: 'Headline shown to the person in the review panel.' },
          body: { ...schemas.longText, description: 'Body text shown verbatim to the person in the review panel.' },
        },
      },
      annotations: { ...annotation.write, untrustedContentHint: true },
      execute: async ({ headline, body }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        snapshot('brief', 'agent');
        state.scene.stagedBrief = { id: nextId('brief'), headline: headline.trim(), body: body.trim(), at: new Date().toISOString() };
        log('Agent staged a briefing for human review.', 'agent');
        render();
        return sceneReceipt('stage_brief', { stagedBrief: structuredClone(state.scene.stagedBrief), published: false });
      },
    },
    {
      name: 'terra_clear_staged_brief',
      title: 'Clear briefing draft',
      description: 'Remove the visible staged draft so the review panel is empty again. Reversible with terra_undo_last_change.',
      inputSchema: schemas.empty,
      annotations: annotation.write,
      execute: async (_input, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        snapshot('clear-brief', 'agent');
        state.scene.stagedBrief = null;
        log('Agent cleared the staged briefing.', 'agent');
        render();
        return sceneReceipt('clear_staged_brief', { cleared: true });
      },
    },
    {
      name: 'terra_undo_last_change',
      title: 'Undo last scene change',
      description: 'Undo the latest agent-authored reversible scene change. Pass the current revision from terra_read_scene or the last receipt; any newer edit made by the person is preserved.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision'],
        properties: {
          expectedRevision: {
            type: 'integer',
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
            description: 'Current revision as returned by terra_read_scene or the most recent receipt.',
          },
        },
      },
      annotations: annotation.write,
      execute: async ({ expectedRevision }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const previous = getAgentUndoTarget(state.scene.history, state.scene.revision, expectedRevision);
        state.scene.history.pop();
        const remainingHistory = state.scene.history;
        const revision = state.scene.revision;
        state.scene = hydrateScene(previous.scene);
        state.scene.history = remainingHistory;
        state.scene.revision = revision;
        log(`Agent undid ${previous.label}.`, 'agent');
        const nextAgentChange = state.scene.history.at(-1);
        if (nextAgentChange?.actor === 'agent') nextAgentChange.resultRevision = state.scene.revision;
        render();
        return sceneReceipt('undo_last_change', { undone: previous.label });
      },
    },
  ];
}

function alwaysTools() {
  return [
    {
      name: 'terra_read_scene',
      title: 'Read shared globe',
      description: `Read a compact live-scene summary (default) or one section page of up to ${MAX_READ_ITEMS} records tied to the current revision. Long notes are previewed; pass id with a section to fetch one complete record.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: {
            type: 'string',
            enum: READ_SCENE_SECTIONS,
            description: 'summary (default), pins, comparisons, measurements, or brief.',
          },
          id: { ...schemas.id, description: 'Stable record id inside the chosen section. Returns that complete record instead of a page.' },
          offset: { type: 'integer', minimum: 0, maximum: MAX_READ_OFFSET, description: 'Section offset. Defaults to 0.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_READ_ITEMS, description: `Items per page, 1 to ${MAX_READ_ITEMS}. Defaults to ${MAX_READ_ITEMS}.` },
        },
      },
      annotations: { ...annotation.read, untrustedContentHint: true },
      execute: async (input) => readScenePage(state.scene, input, {
        historyDepth: state.scene.history.length,
        catalogSize: PLACES.length,
        activeToolCount: currentTools().length,
      }),
    },
    {
      name: 'terra_find_places',
      title: 'Find globe places',
      description: `Return the trusted local catalog: all ${PLACES.length} places when query is omitted, or the places whose id, city, country, climate, or note match the query. Ids returned here are accepted by every place parameter.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 160, description: 'Optional case-insensitive search text. Omit or leave empty to list every place.' },
        },
      },
      annotations: annotation.read,
      execute: async ({ query = '' } = {}) => {
        const needle = query.trim();
        const places = (needle ? findPlace(needle) : PLACES).map(catalogEntry);
        return { query: needle, total: PLACES.length, count: places.length, places };
      },
    },
    {
      name: 'terra_export_markdown',
      title: 'Export draft Markdown',
      description: 'Read a bounded Markdown chunk without publishing or downloading. Follow nextOffset at the same revision to reconstruct the complete export.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          offset: { type: 'integer', minimum: 0, maximum: 250000, description: 'Character offset in this revision export. Defaults to 0.' },
          maxChars: { type: 'integer', minimum: 250, maximum: 2000, description: 'Maximum characters in this chunk. Defaults to 1500.' },
        },
      },
      annotations: { ...annotation.read, untrustedContentHint: true },
      execute: async (input) => exportMarkdownChunk(state.scene, input),
    },
    {
      name: 'terra_focus_view',
      title: 'Focus visible panel',
      description: 'Scrolls a visible panel into view; scene data and revision are unchanged.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['section'],
        properties: {
          section: {
            type: 'string',
            enum: ['globe', 'pins', 'compare', 'measure', 'layers', 'tools', 'brief'],
            description: 'Visible panel to focus.',
          },
        },
      },
      annotations: annotation.read,
      execute: async ({ section }) => {
        state.focus = section;
        render();
        const target = document.querySelector(`[data-focus="${section}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return { ok: true, focus: section, visible: Boolean(target && !target.hidden), revision: state.scene.revision, published: state.scene.published };
      },
    },
  ];
}

function currentTools() {
  return state.scene.published ? alwaysTools() : [...alwaysTools(), ...mutationTools()];
}

async function connectTools() {
  const status = document.getElementById('webmcp-status');
  const tools = currentTools();
  status.dataset.mode = 'connecting';
  status.textContent = `Connecting · ${tools.length} tools`;

  const select = document.getElementById('tool-select');
  const selected = select.value;
  select.innerHTML = tools.map((tool) => `<option value="${tool.name}">${tool.name}</option>`).join('');
  if (tools.some((tool) => tool.name === selected)) select.value = selected;

  await installWebMCP({ always: alwaysTools(), mutation: mutationTools() }, {
    namespace: '__terraWebMCP',
    published: state.scene.published,
    onStatus: ({ mode, toolCount, message }) => {
      status.dataset.mode = mode;
      status.textContent = `${mode === 'native' ? 'Native WebMCP' : 'Tool Lab'} · ${toolCount} tools${message ? ` · ${message}` : ''}`;
    },
  });
}

function replaceScene(nextScene, label) {
  const revision = state.scene.revision;
  snapshot(label, 'user');
  const history = state.scene.history;
  state.scene = hydrateScene(nextScene);
  state.scene.history = history;
  state.scene.revision = revision;
}

function humanFlyTo(placeId, message = 'Human flew to') {
  if (state.scene.published) return;
  const place = getPlace(placeId);
  if (!place) return;
  snapshot('human-fly', 'user');
  state.scene.camera = { placeId: place.id, lat: place.lat, lon: place.lon, altitude: state.scene.camera.altitude };
  log(`${message} ${place.name}.`, 'user');
  render();
}

function publishScene() {
  if (state.scene.published) return;
  incrementRevision(state.scene.revision);
  state.scene.published = true;
  log('User confirmed the reviewed briefing. Mutation tools were unregistered.', 'user');
  render();
  void connectTools();
}

function updatePublishSummary() {
  const place = getPlace(state.scene.camera.placeId);
  const summary = document.getElementById('publish-summary');
  summary.innerHTML = [
    `<p><strong>View:</strong> ${escapeHTML(place?.name ?? `${state.scene.camera.lat.toFixed(2)}°, ${state.scene.camera.lon.toFixed(2)}°`)} at ${formatHour(state.scene.time)}</p>`,
    `<p><strong>Scene:</strong> ${state.scene.pins.length} pins · ${state.scene.comparisons.length} comparisons · ${state.scene.measurements.length} measurements</p>`,
    `<p><strong>Draft:</strong> ${state.scene.stagedBrief ? escapeHTML(state.scene.stagedBrief.headline) : 'No staged narrative'}</p>`,
    '<p>Publishing freezes this local snapshot and its mutation tools. It does not upload or share data. You can reopen it from the UI later.</p>',
  ].join('');
}

function bind() {
  document.getElementById('place-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-place]');
    if (button) humanFlyTo(button.dataset.place);
  });
  document.getElementById('place-dots').addEventListener('click', (event) => {
    const button = event.target.closest('[data-place]');
    if (button) humanFlyTo(button.dataset.place, 'Human selected');
  });
  document.getElementById('place-dots').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const marker = event.target.closest('[data-place]');
    if (!marker || state.scene.published) return;
    event.preventDefault();
    humanFlyTo(marker.dataset.place, 'Human selected');
  });
  document.getElementById('layer-list').addEventListener('change', (event) => {
    const input = event.target.closest('[data-layer]');
    if (!input || state.scene.published) return;
    snapshot('human-layer', 'user');
    state.scene.layers[input.dataset.layer] = input.checked;
    log(`Human ${input.checked ? 'enabled' : 'disabled'} ${input.dataset.layer}.`, 'user');
    render();
  });

  const timeSlider = document.getElementById('time-slider');
  const timeEdit = createEditSession();
  timeSlider.addEventListener('input', (event) => {
    if (state.scene.published) return;
    const next = clamp(Math.round(Number(event.target.value)), 0, 23);
    if (next === state.scene.time) return;
    if (timeEdit.begin(state.scene.time)) snapshot('human-time', 'user');
    state.scene.time = next;
    scheduleGlobeRender();
  });
  const commitTimeChange = () => {
    if (state.scene.published) return;
    const edit = timeEdit.finish(state.scene.time);
    if (!edit) return;
    if (!edit.changed) {
      discardPendingSnapshot('human-time');
      return;
    }
    log(`Human set visualization hour to ${formatHour(state.scene.time)}.`, 'user');
    render();
  };
  timeSlider.addEventListener('change', commitTimeChange);
  timeSlider.addEventListener('pointerup', commitTimeChange);
  timeSlider.addEventListener('blur', commitTimeChange);

  document.getElementById('example-scene').addEventListener('click', () => {
    if (state.scene.published) return;
    replaceScene(exampleScene(), 'example');
    log('Human loaded the Pacific night corridor example.', 'user');
    render();
  });
  document.getElementById('reset-scene').addEventListener('click', () => {
    if (state.scene.published) return;
    replaceScene(blankScene(), 'reset');
    log('Human reset to a blank briefing.', 'user');
    render();
  });

  const publishDialog = document.getElementById('publish-dialog');
  const reviewConfirm = document.getElementById('review-confirm');
  const confirmPublish = document.getElementById('confirm-publish');
  document.getElementById('publish-brief').addEventListener('click', () => {
    if (state.scene.published) return;
    updatePublishSummary();
    reviewConfirm.checked = false;
    confirmPublish.disabled = true;
    publishDialog.returnValue = '';
    if (typeof publishDialog.showModal === 'function') {
      publishDialog.showModal();
    } else if (globalThis.confirm('Publish this reviewed snapshot and lock agent mutation tools?')) {
      publishScene();
    }
  });
  reviewConfirm.addEventListener('change', () => {
    confirmPublish.disabled = !reviewConfirm.checked;
  });
  publishDialog.addEventListener('close', () => {
    if (publishDialog.returnValue === 'confirm' && reviewConfirm.checked) publishScene();
  });
  document.getElementById('reopen-scene').addEventListener('click', () => {
    if (!state.scene.published) return;
    incrementRevision(state.scene.revision);
    state.scene.published = false;
    log('User reopened the scene for more exploration.', 'user');
    render();
    void connectTools();
  });

  document.getElementById('tool-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('tool-select').value;
    const output = document.getElementById('tool-output');
    output.textContent = `Running ${name}…`;
    try {
      const raw = document.getElementById('tool-input').value.trim();
      const input = raw ? JSON.parse(raw) : {};
      const result = await globalThis.__terraWebMCP.executeTool(name, input);
      output.textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      output.textContent = `${error.name || 'Error'}: ${error.message}`;
    }
  });

  const copyButton = document.getElementById('copy-prompt');
  copyButton.addEventListener('click', async () => {
    const prompt = document.getElementById('demo-prompt-text').textContent;
    try {
      await navigator.clipboard.writeText(prompt);
      copyButton.textContent = 'Copied';
    } catch {
      copyButton.textContent = 'Select the prompt above';
    }
    globalThis.setTimeout(() => { copyButton.textContent = 'Copy demo prompt'; }, 1600);
  });

  const stage = document.getElementById('globe-stage');
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const pointerDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  stage.addEventListener('pointerdown', (event) => {
    if (state.scene.published || event.target.closest('.place-dot, .globe-hud')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      drag = null;
      stage.dataset.dragging = 'false';
      pinch = { distance: pointerDistance(), altitude: state.scene.camera.altitude, snapshotTaken: false };
      return;
    }
    if (pointers.size > 2) return;
    globeCanvas.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lat: state.scene.camera.lat,
      lon: state.scene.camera.lon,
      moved: false,
    };
    stage.dataset.dragging = 'true';
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || state.scene.published) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch) {
      if (pointers.size < 2) return;
      const distance = pointerDistance();
      if (!pinch.snapshotTaken && Math.abs(distance - pinch.distance) > 6) {
        snapshot('human-zoom', 'user');
        pinch.snapshotTaken = true;
      }
      if (!pinch.snapshotTaken || distance < 1) return;
      state.scene.camera.altitude = clamp(pinch.altitude * (pinch.distance / distance), ALTITUDE_MIN, ALTITUDE_MAX);
      scheduleGlobeRender();
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) {
      snapshot('human-orbit', 'user');
      drag.moved = true;
    }
    if (!drag.moved) return;
    state.scene.camera = {
      ...state.scene.camera,
      placeId: null,
      lon: normalizeLongitude(drag.lon - deltaX * 0.32),
      lat: clamp(drag.lat + deltaY * 0.24, -85, 85),
    };
    scheduleGlobeRender();
  });
  const finishPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pinch) {
      if (pointers.size >= 2) return;
      const changed = pinch.snapshotTaken;
      pinch = null;
      if (changed) {
        log(`Human pinched globe zoom to ${state.scene.camera.altitude.toFixed(2)}×.`, 'user');
        render();
      }
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    stage.dataset.dragging = 'false';
    if (moved) {
      log('Human orbited the globe camera.', 'user');
      render();
    }
  };
  stage.addEventListener('pointerup', finishPointer);
  stage.addEventListener('pointercancel', finishPointer);
  // touch-action: pan-y lets the page scroll normally; only an active orbit or pinch claims the gesture.
  stage.addEventListener('touchmove', (event) => {
    if (drag?.moved || pinch) event.preventDefault();
  }, { passive: false });

  const zoomStep = (direction) => {
    if (state.scene.published) return;
    const altitude = clamp(state.scene.camera.altitude + direction * 0.08, ALTITUDE_MIN, ALTITUDE_MAX);
    if (altitude === state.scene.camera.altitude) return;
    snapshot('human-zoom', 'user');
    state.scene.camera.altitude = altitude;
    log(`Human set globe zoom to ${altitude.toFixed(2)}×.`, 'user');
    render();
  };
  document.getElementById('zoom-in').addEventListener('click', () => zoomStep(-1));
  document.getElementById('zoom-out').addEventListener('click', () => zoomStep(1));
  document.getElementById('reset-view').addEventListener('click', () => {
    if (state.scene.published) return;
    snapshot('human-reset-view', 'user');
    state.scene.camera = { ...blankScene().camera };
    log('Human reset the globe view.', 'user');
    render();
  });

  let zoomTimer = null;
  let zoomSnapshotTaken = false;
  stage.addEventListener('wheel', (event) => {
    if (state.scene.published || event.target.closest('.place-dot, .globe-hud')) return;
    event.preventDefault();
    if (!zoomSnapshotTaken) {
      snapshot('human-zoom', 'user');
      zoomSnapshotTaken = true;
    }
    state.scene.camera.altitude = clamp(state.scene.camera.altitude + Math.sign(event.deltaY) * 0.06, ALTITUDE_MIN, ALTITUDE_MAX);
    scheduleGlobeRender();
    globalThis.clearTimeout(zoomTimer);
    zoomTimer = globalThis.setTimeout(() => {
      zoomSnapshotTaken = false;
      log(`Human set globe zoom to ${state.scene.camera.altitude.toFixed(2)}×.`, 'user');
      render();
    }, 220);
  }, { passive: false });

  globeCanvas.addEventListener('keydown', (event) => {
    if (state.scene.published) return;
    const camera = { ...state.scene.camera, placeId: null };
    let handled = true;
    if (event.key === 'ArrowLeft') camera.lon = normalizeLongitude(camera.lon - 5);
    else if (event.key === 'ArrowRight') camera.lon = normalizeLongitude(camera.lon + 5);
    else if (event.key === 'ArrowUp') camera.lat = clamp(camera.lat + 5, -85, 85);
    else if (event.key === 'ArrowDown') camera.lat = clamp(camera.lat - 5, -85, 85);
    else if (event.key === '+' || event.key === '=') camera.altitude = clamp(camera.altitude - 0.08, ALTITUDE_MIN, ALTITUDE_MAX);
    else if (event.key === '-') camera.altitude = clamp(camera.altitude + 0.08, ALTITUDE_MIN, ALTITUDE_MAX);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    snapshot('human-camera-key', 'user');
    state.scene.camera = camera;
    log('Human moved the globe camera with the keyboard.', 'user');
    render();
  });

  // Single ResizeObserver for the stage; the WebGL renderer resizes its drawing buffer inside draw().
  new ResizeObserver(scheduleGlobeRender).observe(stage);

  globalThis.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });

  globalThis.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const wasPublished = state.scene.published;
      state.scene = hydrateScene(JSON.parse(event.newValue));
      render();
      if (wasPublished !== state.scene.published) void connectTools();
    } catch {
      // Ignore invalid state written by another tab.
    }
  });
}

bind();
render();
void connectTools();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
