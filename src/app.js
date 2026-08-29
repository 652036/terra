import { LAYERS, PLACES, blankScene, exampleScene } from './data.js';
import {
  comparePlaces,
  exportMarkdown,
  findPlace,
  getPlace,
  haversineKm,
  bearingDegrees,
  projectPoint,
  sunlit,
} from './engine.js';
import { installWebMCP, schemas } from './webmcp.js';

const STORAGE_KEY = 'terra-scene-v1';
const historyLimit = 20;

const state = {
  scene: loadScene(),
  focus: 'globe',
};

function loadScene() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return exampleScene();
    return { ...blankScene(), ...JSON.parse(raw) };
  } catch {
    return exampleScene();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.scene, history: state.scene.history.slice(-historyLimit) }));
}

function snapshot(label) {
  state.scene.history.push({ label, scene: structuredClone({ ...state.scene, history: [] }) });
  if (state.scene.history.length > historyLimit) state.scene.history.shift();
}

function log(message) {
  state.scene.activity.unshift({ at: new Date().toISOString(), message });
  state.scene.activity = state.scene.activity.slice(0, 20);
}

function nextId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertOpen() {
  if (state.scene.published) throw new Error('Scene is published. Mutation tools are locked until a human reopens it.');
}

function render() {
  persist();
  const scene = state.scene;
  const cameraPlace = getPlace(scene.camera.placeId);
  document.getElementById('workspace-title').textContent = scene.title;
  document.getElementById('camera-readout').textContent = cameraPlace
    ? `${cameraPlace.name} \u00b7 ${cameraPlace.country}`
    : `${scene.camera.lat.toFixed(2)}, ${scene.camera.lon.toFixed(2)}`;
  document.getElementById('time-readout').textContent = `${String(scene.time).padStart(2, '0')}:00`;
  document.getElementById('time-slider').value = String(scene.time);
  document.getElementById('published-flag').hidden = !scene.published;
  document.getElementById('publish-brief').disabled = scene.published;
  document.getElementById('reopen-scene').hidden = !scene.published;

  const globe = document.getElementById('globe-stage');
  globe.dataset.night = scene.time >= 19 || scene.time <= 6 ? 'true' : 'false';
  globe.dataset.atmosphere = scene.layers.atmosphere ? 'on' : 'off';
  globe.dataset.grid = scene.layers.grid ? 'on' : 'off';
  globe.style.setProperty('--spin', `${-scene.camera.lon}deg`);
  globe.style.setProperty('--tilt', `${scene.camera.lat * 0.35}deg`);

  const dots = PLACES.map((place) => {
    const point = projectPoint(place.lat, place.lon, scene.camera);
    const night = !sunlit(place.lon, scene.time);
    const active = scene.camera.placeId === place.id;
    const pinned = scene.pins.some((pin) => pin.placeId === place.id);
    if (!point.visible) return '';
    const left = 50 + point.x * 0.42;
    const top = 50 + point.y * 0.55;
    return `<button class="place-dot${active ? ' is-active' : ''}${pinned ? ' is-pinned' : ''}${night && scene.layers.lights ? ' is-lit' : ''}" data-place="${place.id}" style="left:${left}%;top:${top}%" title="${place.name}"><span>${scene.layers.labels ? place.name : ''}</span></button>`;
  }).join('');
  document.getElementById('place-dots').innerHTML = dots;

  document.getElementById('place-list').innerHTML = PLACES.map((place) => {
    const active = scene.camera.placeId === place.id;
    return `<li><button data-place="${place.id}" class="${active ? 'is-active' : ''}">${place.name}<small>${place.country}</small></button></li>`;
  }).join('');

  document.getElementById('pin-list').innerHTML = scene.pins.length
    ? scene.pins.map((pin) => {
        const place = getPlace(pin.placeId);
        return `<li><strong>${pin.label}</strong><span>${place ? place.name : pin.placeId}</span><em>${pin.note || ''}</em></li>`;
      }).join('')
    : '<li class="empty">No pins yet.</li>';

  document.getElementById('compare-panel').innerHTML = scene.comparisons.length
    ? scene.comparisons.map((item) => `<li>${item.places.map((p) => p.name).join(' \u00b7 ')} — max gap ${item.populationSpread}M people</li>`).join('')
    : '<li class="empty">No comparisons yet.</li>';

  document.getElementById('measure-panel').innerHTML = scene.measurements.length
    ? scene.measurements.map((item) => `<li>${item.from} → ${item.to}: ${item.km} km</li>`).join('')
    : '<li class="empty">No measurements yet.</li>';

  document.getElementById('layer-list').innerHTML = LAYERS.map((layer) => `
    <label><input type="checkbox" data-layer="${layer.id}" ${scene.layers[layer.id] ? 'checked' : ''}> ${layer.label}</label>
  `).join('');

  document.getElementById('activity-list').innerHTML = scene.activity.length
    ? scene.activity.map((item) => `<li>${item.message}</li>`).join('')
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
      description: 'Fly the shared globe camera to a catalog place so the human can watch the same destination.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['placeId'], properties: { placeId: schemas.id } },
      execute: async ({ placeId }) => {
        assertOpen();
        const place = getPlace(placeId);
        if (!place) throw new Error(`Unknown place: ${placeId}`);
        snapshot('fly');
        state.scene.camera = { placeId: place.id, lat: place.lat, lon: place.lon, altitude: 1 };
        log(`Flew to ${place.name}.`);
        render();
        return { camera: state.scene.camera, place };
      },
    },
    {
      name: 'terra_drop_pin',
      description: 'Drop a labeled pin on a catalog place. The pin appears on the globe the human is watching.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['placeId', 'label'],
        properties: { placeId: schemas.id, label: schemas.shortText, note: schemas.longText },
      },
      execute: async ({ placeId, label, note }) => {
        assertOpen();
        if (!getPlace(placeId)) throw new Error(`Unknown place: ${placeId}`);
        snapshot('pin');
        const pin = { id: nextId('pin'), placeId, label, note: note || '' };
        state.scene.pins.push(pin);
        log(`Pinned ${label}.`);
        render();
        return pin;
      },
    },
    {
      name: 'terra_remove_pin',
      description: 'Remove a dropped pin by id after the human has seen it.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['pinId'], properties: { pinId: schemas.id } },
      execute: async ({ pinId }) => {
        assertOpen();
        const pin = state.scene.pins.find((item) => item.id === pinId);
        if (!pin) throw new Error(`Unknown pin: ${pinId}`);
        snapshot('unpin');
        state.scene.pins = state.scene.pins.filter((item) => item.id !== pinId);
        log(`Removed pin ${pin.label}.`);
        render();
        return { removed: pinId };
      },
    },
    {
      name: 'terra_compare_places',
      description: 'Compare two or more catalog places and publish the result on the shared board.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['placeIds'],
        properties: { placeIds: { type: 'array', minItems: 2, maxItems: 5, items: schemas.id } },
      },
      execute: async ({ placeIds }) => {
        assertOpen();
        snapshot('compare');
        const comparison = { id: nextId('cmp'), ...comparePlaces(placeIds) };
        state.scene.comparisons.unshift(comparison);
        state.scene.comparisons = state.scene.comparisons.slice(0, 6);
        log(`Compared ${comparison.places.map((place) => place.name).join(', ')}.`);
        render();
        return comparison;
      },
    },
    {
      name: 'terra_measure_distance',
      description: 'Measure great-circle distance between two catalog places and show it beside the globe.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['fromId', 'toId'],
        properties: { fromId: schemas.id, toId: schemas.id },
      },
      execute: async ({ fromId, toId }) => {
        assertOpen();
        const from = getPlace(fromId);
        const to = getPlace(toId);
        if (!from || !to) throw new Error('Both place ids must exist in the catalog.');
        snapshot('measure');
        const measurement = {
          id: nextId('msr'),
          from: from.name,
          to: to.name,
          km: Number(haversineKm(from, to).toFixed(1)),
          bearing: Number(bearingDegrees(from, to).toFixed(1)),
        };
        state.scene.measurements.unshift(measurement);
        state.scene.measurements = state.scene.measurements.slice(0, 8);
        log(`Measured ${measurement.from} → ${measurement.to}.`);
        render();
        return measurement;
      },
    },
    {
      name: 'terra_set_time',
      description: 'Set the visualization hour (0-23) that drives day/night lighting on the shared globe.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['hour'], properties: { hour: { type: 'integer', minimum: 0, maximum: 23 } } },
      execute: async ({ hour }) => {
        assertOpen();
        snapshot('time');
        state.scene.time = hour;
        log(`Set visualization hour to ${String(hour).padStart(2, '0')}:00.`);
        render();
        return { time: hour };
      },
    },
    {
      name: 'terra_toggle_layer',
      description: 'Toggle a visible globe layer: labels, lights, atmosphere, grid, or pins.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['layerId', 'enabled'],
        properties: {
          layerId: { type: 'string', enum: LAYERS.map((layer) => layer.id) },
          enabled: { type: 'boolean' },
        },
      },
      execute: async ({ layerId, enabled }) => {
        assertOpen();
        snapshot('layer');
        state.scene.layers[layerId] = enabled;
        log(`${enabled ? 'Enabled' : 'Disabled'} ${layerId}.`);
        render();
        return { layers: state.scene.layers };
      },
    },
    {
      name: 'terra_stage_brief',
      description: 'Stage a briefing for human review. This does not publish the scene.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body'],
        properties: { headline: schemas.shortText, body: schemas.longText },
      },
      annotations: { untrustedContentHint: true },
      execute: async ({ headline, body }) => {
        assertOpen();
        snapshot('brief');
        state.scene.stagedBrief = { headline, body, at: new Date().toISOString() };
        log('Staged a briefing for human review.');
        render();
        return state.scene.stagedBrief;
      },
    },
    {
      name: 'terra_clear_staged_brief',
      description: 'Clear a staged briefing so the human and agent can keep exploring.',
      inputSchema: schemas.empty,
      execute: async () => {
        assertOpen();
        snapshot('clear-brief');
        state.scene.stagedBrief = null;
        log('Cleared staged briefing.');
        render();
        return { cleared: true };
      },
    },
    {
      name: 'terra_undo_last_change',
      description: 'Undo the latest reversible mutation on the shared globe.',
      inputSchema: schemas.empty,
      execute: async () => {
        assertOpen();
        const previous = state.scene.history.pop();
        if (!previous) throw new Error('Nothing to undo.');
        const published = state.scene.published;
        state.scene = { ...previous.scene, history: state.scene.history, published };
        log(`Undid ${previous.label}.`);
        render();
        return { undone: previous.label };
      },
    },
  ];
}

function alwaysTools() {
  return [
    {
      name: 'terra_read_scene',
      description: 'Read the live globe: camera, time, layers, pins, comparisons, measurements, and publish state.',
      inputSchema: schemas.empty,
      annotations: { readOnlyHint: true },
      execute: async () => ({
        title: state.scene.title,
        camera: state.scene.camera,
        time: state.scene.time,
        layers: state.scene.layers,
        pins: state.scene.pins,
        comparisons: state.scene.comparisons,
        measurements: state.scene.measurements,
        stagedBrief: state.scene.stagedBrief,
        published: state.scene.published,
        catalogSize: PLACES.length,
        humanControls: ['publish-brief', 'reopen-scene', 'manual camera and layers'],
      }),
    },
    {
      name: 'terra_list_places',
      description: 'List the built-in geographic catalog the globe can fly to.',
      inputSchema: schemas.empty,
      annotations: { readOnlyHint: true },
      execute: async () => PLACES.map(({ id, name, country, lat, lon, climate }) => ({ id, name, country, lat, lon, climate })),
    },
    {
      name: 'terra_search_place',
      description: 'Search the catalog by city, country, climate, or note.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: schemas.shortText } },
      annotations: { readOnlyHint: true },
      execute: async ({ query }) => findPlace(query),
    },
    {
      name: 'terra_export_markdown',
      description: 'Export the current briefing as Markdown without publishing it.',
      inputSchema: schemas.empty,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => ({ markdown: exportMarkdown(state.scene) }),
    },
    {
      name: 'terra_focus_view',
      description: 'Bring a visible TERRA panel into the human viewport.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['section'],
        properties: { section: { type: 'string', enum: ['globe', 'pins', 'compare', 'measure', 'layers', 'tools', 'brief'] } },
      },
      execute: async ({ section }) => {
        state.focus = section;
        document.querySelector(`[data-focus="${section}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        render();
        return { focus: section };
      },
    },
  ];
}

function currentTools() {
  return state.scene.published ? alwaysTools() : [...alwaysTools(), ...mutationTools()];
}

function connectTools() {
  const status = document.getElementById('webmcp-status');
  installWebMCP(currentTools(), {
    namespace: '__terraWebMCP',
    onStatus: ({ mode, toolCount, message }) => {
      status.dataset.mode = mode;
      status.textContent = `${mode === 'native' ? 'Native WebMCP' : 'Tool Lab'} \u00b7 ${toolCount} tools${message ? ` \u00b7 ${message}` : ''}`;
    },
  });
  const select = document.getElementById('tool-select');
  select.innerHTML = currentTools().map((tool) => `<option value="${tool.name}">${tool.name}</option>`).join('');
}

function bind() {
  document.getElementById('place-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-place]');
    if (!button || state.scene.published) return;
    snapshot('human-fly');
    const place = getPlace(button.dataset.place);
    state.scene.camera = { placeId: place.id, lat: place.lat, lon: place.lon, altitude: 1 };
    log(`Human flew to ${place.name}.`);
    render();
  });
  document.getElementById('place-dots').addEventListener('click', (event) => {
    const button = event.target.closest('[data-place]');
    if (!button || state.scene.published) return;
    snapshot('human-fly');
    const place = getPlace(button.dataset.place);
    state.scene.camera = { placeId: place.id, lat: place.lat, lon: place.lon, altitude: 1 };
    log(`Human selected ${place.name} on the globe.`);
    render();
  });
  document.getElementById('layer-list').addEventListener('change', (event) => {
    const input = event.target.closest('[data-layer]');
    if (!input || state.scene.published) return;
    snapshot('human-layer');
    state.scene.layers[input.dataset.layer] = input.checked;
    log(`Human toggled ${input.dataset.layer}.`);
    render();
  });
  document.getElementById('time-slider').addEventListener('input', (event) => {
    if (state.scene.published) return;
    state.scene.time = Number(event.target.value);
    render();
  });
  document.getElementById('example-scene').addEventListener('click', () => {
    if (state.scene.published) return;
    snapshot('example');
    state.scene = { ...exampleScene(), history: state.scene.history };
    log('Loaded the Pacific night corridor example.');
    render();
    connectTools();
  });
  document.getElementById('reset-scene').addEventListener('click', () => {
    if (state.scene.published) return;
    snapshot('reset');
    state.scene = { ...blankScene(), history: state.scene.history };
    log('Reset to a blank briefing.');
    render();
    connectTools();
  });
  document.getElementById('publish-brief').addEventListener('click', () => {
    state.scene.published = true;
    log('Human published the briefing. Mutation tools unregistered.');
    render();
    connectTools();
  });
  document.getElementById('reopen-scene').addEventListener('click', () => {
    state.scene.published = false;
    log('Human reopened the scene for more exploration.');
    render();
    connectTools();
  });
  document.getElementById('tool-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('tool-select').value;
    const output = document.getElementById('tool-output');
    let input = {};
    try {
      const raw = document.getElementById('tool-input').value.trim();
      input = raw ? JSON.parse(raw) : {};
      const result = await globalThis.__terraWebMCP.executeTool(name, input);
      output.textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      output.textContent = error.message;
    }
  });
}

bind();
render();
connectTools();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
