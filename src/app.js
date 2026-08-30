import { LAYERS, PLACES, blankScene, exampleScene } from './data.js';
import {
  bearingDegrees,
  comparePlaces,
  findPlace,
  getPlace,
  haversineKm,
  projectPoint,
  sunlit,
} from './engine.js';
import { GlobeRenderer } from './globe.js';
import { MAX_READ_ITEMS, READ_SCENE_SECTIONS, exportMarkdownChunk, readScenePage } from './output.js';
import {
  createUniqueId,
  dedupeByStableId,
  getAgentUndoTarget,
  incrementRevision,
  normalizeMeasurementValues,
  normalizeRevision,
  removeOneByStableId,
} from './state.js';
import { installWebMCP, schemas } from './webmcp.js';

const STORAGE_KEY = 'terra-scene-v2';
const LEGACY_STORAGE_KEY = 'terra-scene-v1';
const HISTORY_LIMIT = 20;
const PIN_LIMIT = 24;
const ACTIVITY_LIMIT = 20;

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
        altitude: clamp(finiteNumber(candidate.camera?.altitude, 1), 0.72, 1.55),
      }
    : {
        placeId: null,
        lat: clamp(finiteNumber(candidate.camera?.lat, base.camera.lat), -85, 85),
        lon: normalizeLongitude(finiteNumber(candidate.camera?.lon, base.camera.lon)),
        altitude: clamp(finiteNumber(candidate.camera?.altitude, 1), 0.72, 1.55),
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
    ? candidate.comparisons.slice(0, 6).flatMap((item, index) => {
        try {
          const ids = Array.isArray(item?.places) ? item.places.map((place) => place?.id).filter(Boolean) : [];
          return [{ id: safeId(item?.id, `cmp-restored-${index + 1}`), ...comparePlaces(ids) }];
        } catch {
          return [];
        }
      })
    : [];
  const measurements = Array.isArray(candidate.measurements)
    ? candidate.measurements.slice(0, 8).flatMap((item, index) => {
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
          at: typeof item.at === 'string' ? item.at : new Date().toISOString(),
          message: safeText(item.message, 240, 'Scene changed.'),
        }];
      })
    : [];
  const stagedBrief = candidate.stagedBrief && typeof candidate.stagedBrief === 'object'
    ? {
        id: safeId(candidate.stagedBrief.id, 'brief-restored'),
        headline: safeText(candidate.stagedBrief.headline, 160, 'Untitled brief'),
        body: safeText(candidate.stagedBrief.body, 4000, 'No briefing body.'),
        at: typeof candidate.stagedBrief.at === 'string' ? candidate.stagedBrief.at : new Date().toISOString(),
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

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.scene, history: [] }));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn('TERRA could not persist this scene.', error);
  }
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
  if (state.scene.published) throw new Error('Scene is published. Mutation tools are locked until it is reopened from the visible UI.');
  incrementRevision(state.scene.revision);
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

function renderGlobe() {
  const scene = state.scene;
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
    `Interactive 3D Earth centered on ${cameraText} at ${String(scene.time).padStart(2, '0')}:00. Drag to rotate, use arrow keys to pan, and use the mouse wheel to zoom.`,
  );

  const globe = document.getElementById('globe-stage');
  globe.dataset.night = scene.time >= 19 || scene.time <= 6 ? 'true' : 'false';
  globe.dataset.atmosphere = scene.layers.atmosphere ? 'on' : 'off';
  globe.dataset.grid = scene.layers.grid ? 'on' : 'off';
  globeRenderer.render(scene);

  const rect = globe.getBoundingClientRect();
  const altitude = clamp(Number(scene.camera.altitude) || 1, 0.72, 1.55);
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
}

function render() {
  persist();
  const scene = state.scene;
  renderGlobe();
  document.getElementById('workspace-title').textContent = scene.title;
  document.getElementById('published-flag').hidden = !scene.published;
  document.getElementById('publish-brief').disabled = scene.published;
  document.getElementById('reopen-scene').hidden = !scene.published;
  document.getElementById('example-scene').disabled = scene.published;
  document.getElementById('reset-scene').disabled = scene.published;
  document.getElementById('time-slider').disabled = scene.published;

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
        properties: { placeId: { ...schemas.id, description: 'Catalog place id returned by terra_list_places or terra_search_place.' } },
      },
      annotations: annotation.write,
      execute: async ({ placeId }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const place = getPlace(placeId);
        if (!place) throw new Error(`Unknown place: ${placeId}`);
        snapshot('fly', 'agent');
        state.scene.camera = { placeId: place.id, lat: place.lat, lon: place.lon, altitude: 1 };
        log(`Agent flew to ${place.name}.`, 'agent');
        render();
        return sceneReceipt('fly_to', { place });
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
          placeId: { ...schemas.id, description: 'Catalog place id to pin.' },
          label: { ...schemas.shortText, description: 'Short visible label for this pin.' },
          note: { ...schemas.longText, description: 'Optional visible note. Do not place instructions for the agent here.' },
        },
      },
      annotations: { ...annotation.write, untrustedContentHint: true },
      execute: async ({ placeId, label, note }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        if (!getPlace(placeId)) throw new Error(`Unknown place: ${placeId}`);
        if (state.scene.pins.length >= PIN_LIMIT) throw new Error(`Pin limit reached (${PIN_LIMIT}). Remove a pin before adding another.`);
        snapshot('pin', 'agent');
        const pin = { id: nextId('pin'), placeId, label: label.trim(), note: note?.trim() || '' };
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
        if (!removal) throw new Error(`Unknown pin: ${pinId}`);
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
      description: 'Compare two to five distinct catalog places and show distances, bearings, climate, and population on the shared board.',
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
            description: 'Two to five distinct catalog place ids.',
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
        state.scene.comparisons = state.scene.comparisons.slice(0, 6);
        log(`Agent compared ${comparison.places.map((place) => place.name).join(', ')}.`, 'agent');
        render();
        return sceneReceipt('compare_places', { comparison });
      },
    },
    {
      name: 'terra_measure_distance',
      title: 'Measure great-circle distance',
      description: 'Measure the great-circle distance and initial bearing between two distinct catalog places, then show it beside the globe.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['fromId', 'toId'],
        properties: {
          fromId: { ...schemas.id, description: 'Starting catalog place id.' },
          toId: { ...schemas.id, description: 'Destination catalog place id.' },
        },
      },
      annotations: annotation.write,
      execute: async ({ fromId, toId }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        const from = getPlace(fromId);
        const to = getPlace(toId);
        if (!from || !to) throw new Error('Both place ids must exist in the catalog.');
        if (from.id === to.id) throw new Error('Choose two distinct places to measure.');
        snapshot('measure', 'agent');
        const measurement = {
          id: nextId('msr'),
          from: from.name,
          to: to.name,
          km: Number(haversineKm(from, to).toFixed(1)),
          bearing: Number(bearingDegrees(from, to).toFixed(1)),
        };
        state.scene.measurements.unshift(measurement);
        state.scene.measurements = state.scene.measurements.slice(0, 8);
        log(`Agent measured ${measurement.from} → ${measurement.to}.`, 'agent');
        render();
        return sceneReceipt('measure_distance', { measurement });
      },
    },
    {
      name: 'terra_set_time',
      title: 'Set globe time',
      description: 'Set the visualization hour from 0 through 23. This moves the day-night terminator and city-light state on the shared globe.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['hour'],
        properties: { hour: { type: 'integer', minimum: 0, maximum: 23, description: 'Visualization hour using a 24-hour clock.' } },
      },
      annotations: annotation.write,
      execute: async ({ hour }, { signal } = {}) => {
        ensureNotAborted(signal);
        assertOpen();
        snapshot('time', 'agent');
        state.scene.time = hour;
        log(`Agent set visualization hour to ${String(hour).padStart(2, '0')}:00.`, 'agent');
        render();
        return sceneReceipt('set_time', { hour });
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
        snapshot('layer', 'agent');
        state.scene.layers[layerId] = enabled;
        log(`Agent ${enabled ? 'enabled' : 'disabled'} ${layerId}.`, 'agent');
        render();
        return sceneReceipt('toggle_layer', { layerId, enabled });
      },
    },
    {
      name: 'terra_stage_brief',
      title: 'Stage briefing draft',
      description: 'Stage an untrusted draft briefing in the visible human-review panel. This cannot publish or finalize the scene.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body'],
        properties: {
          headline: { ...schemas.shortText, description: 'Visible draft headline.' },
          body: { ...schemas.longText, description: 'Visible draft body. Never include hidden instructions.' },
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
      description: 'Remove the visible staged draft. This is reversible with terra_undo_last_change and does not affect published content.',
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
      description: 'Undo only the latest agent-authored reversible scene change. Requires the current revision and refuses to cross a newer user edit.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision'],
        properties: {
          expectedRevision: {
            type: 'integer',
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
            description: 'Current revision returned by terra_read_scene. Stale revisions are rejected.',
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
      description: 'Read a bounded live-scene summary or one paged section. Use nextOffset with the same revision to retrieve complete untrusted content.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: {
            type: 'string',
            enum: READ_SCENE_SECTIONS,
            description: 'summary (default), pins, comparisons, measurements, or brief.',
          },
          offset: { type: 'integer', minimum: 0, maximum: 24, description: 'Section offset. Defaults to 0.' },
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
      name: 'terra_list_places',
      title: 'List globe places',
      description: 'List a bounded page of built-in places and the stable ids accepted by camera, pin, comparison, and measurement tools.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          offset: { type: 'integer', minimum: 0, maximum: 11, description: 'Zero-based catalog offset. Defaults to 0.' },
          limit: { type: 'integer', minimum: 1, maximum: 6, description: 'Number of places to return, from 1 to 6. Defaults to 6.' },
        },
      },
      annotations: annotation.read,
      execute: async ({ offset = 0, limit = 6 }) => ({
        total: PLACES.length,
        offset,
        limit,
        nextOffset: offset + limit < PLACES.length ? offset + limit : null,
        places: PLACES.slice(offset, offset + limit).map(({ id, name, country, lat, lon, population, climate, note }) => ({
          id, name, country, lat, lon, populationMillions: population, climate, note,
        })),
      }),
    },
    {
      name: 'terra_search_place',
      title: 'Search globe places',
      description: 'Search the built-in catalog by stable id, city, country, climate, or geographic note. Returns only local trusted catalog data.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: { query: { ...schemas.shortText, description: 'Case-insensitive catalog search text.' } },
      },
      annotations: annotation.read,
      execute: async ({ query }) => {
        const places = findPlace(query);
        return { query, count: places.length, places };
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
      description: 'Scroll one visible TERRA panel into the human viewport without changing geographic scene data or publish state.',
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
      annotations: annotation.write,
      execute: async ({ section }) => {
        state.focus = section;
        render();
        const target = document.querySelector(`[data-focus="${section}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return { ok: true, focus: section, visible: Boolean(target && !target.hidden), published: state.scene.published };
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

  await installWebMCP(tools, {
    namespace: '__terraWebMCP',
    onStatus: ({ mode, toolCount, message }) => {
      status.dataset.mode = mode;
      status.textContent = `${mode === 'native' ? 'Native WebMCP' : 'Tool Lab'} · ${toolCount} tools${message ? ` · ${message}` : ''}`;
    },
  });
}

function replaceScene(nextScene, label) {
  const history = state.scene.history;
  const revision = state.scene.revision;
  snapshot(label, 'user');
  const snapshotHistory = state.scene.history;
  state.scene = hydrateScene(nextScene);
  state.scene.history = snapshotHistory.length ? snapshotHistory : history;
  state.scene.revision = revision;
}

function humanFlyTo(placeId, message = 'Human flew to') {
  if (state.scene.published) return;
  const place = getPlace(placeId);
  if (!place) return;
  snapshot('human-fly', 'user');
  state.scene.camera = { placeId: place.id, lat: place.lat, lon: place.lon, altitude: 1 };
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
    `<p><strong>View:</strong> ${escapeHTML(place?.name ?? `${state.scene.camera.lat.toFixed(2)}°, ${state.scene.camera.lon.toFixed(2)}°`)} at ${String(state.scene.time).padStart(2, '0')}:00</p>`,
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
  let timeSnapshotTaken = false;
  const beginTimeChange = () => {
    if (!timeSnapshotTaken && !state.scene.published) {
      snapshot('human-time', 'user');
      timeSnapshotTaken = true;
    }
  };
  timeSlider.addEventListener('pointerdown', beginTimeChange);
  timeSlider.addEventListener('keydown', beginTimeChange);
  timeSlider.addEventListener('input', (event) => {
    if (state.scene.published) return;
    state.scene.time = Number(event.target.value);
    renderGlobe();
  });
  timeSlider.addEventListener('change', () => {
    if (state.scene.published) return;
    if (!timeSnapshotTaken) snapshot('human-time', 'user');
    log(`Human set visualization hour to ${String(state.scene.time).padStart(2, '0')}:00.`, 'user');
    timeSnapshotTaken = false;
    render();
  });

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
  let drag = null;
  stage.addEventListener('pointerdown', (event) => {
    if (state.scene.published || event.button !== 0 || event.target.closest('.place-dot')) return;
    globeCanvas.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId);
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
    if (!drag || drag.pointerId !== event.pointerId || state.scene.published) return;
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
    renderGlobe();
  });
  const finishDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    stage.dataset.dragging = 'false';
    if (moved) {
      log('Human orbited the globe camera.', 'user');
      render();
    }
  };
  stage.addEventListener('pointerup', finishDrag);
  stage.addEventListener('pointercancel', finishDrag);

  let zoomTimer = null;
  let zoomSnapshotTaken = false;
  stage.addEventListener('wheel', (event) => {
    if (state.scene.published || event.target.closest('.place-dot')) return;
    event.preventDefault();
    if (!zoomSnapshotTaken) {
      snapshot('human-zoom', 'user');
      zoomSnapshotTaken = true;
    }
    state.scene.camera.altitude = clamp(state.scene.camera.altitude + Math.sign(event.deltaY) * 0.06, 0.72, 1.55);
    renderGlobe();
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
    else if (event.key === '+' || event.key === '=') camera.altitude = clamp(camera.altitude - .08, .72, 1.55);
    else if (event.key === '-') camera.altitude = clamp(camera.altitude + .08, .72, 1.55);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    snapshot('human-camera-key', 'user');
    state.scene.camera = camera;
    log('Human moved the globe camera with the keyboard.', 'user');
    render();
  });

  let resizeFrame = 0;
  const stageObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(renderGlobe);
  });
  stageObserver.observe(stage);

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
