import { PLACES } from './data.js';

const EARTH_RADIUS_KM = 6371;

export function findPlace(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return PLACES.filter((place) =>
    [place.id, place.name, place.country, place.climate, place.note]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

export function getPlace(id) {
  return PLACES.find((place) => place.id === id) ?? null;
}

export function resolvePlace(value) {
  if (typeof value !== 'string') return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return PLACES.find((place) => place.id === needle || place.name.toLowerCase() === needle) ?? null;
}

export function placeIdList() {
  return PLACES.map((place) => place.id).join(', ');
}

export function unknownPlaceMessage(value) {
  return `Unknown place "${String(value)}". Valid ids: ${placeIdList()}. City names such as "New York" are also accepted; call terra_find_places to search.`;
}

export function requirePlace(value) {
  const place = resolvePlace(value);
  if (!place) throw new Error(unknownPlaceMessage(value));
  return place;
}

export function catalogEntry({ id, name, country, lat, lon, utcOffset, population, climate, note }) {
  return { id, name, country, lat, lon, utcOffset, populationMillions: population, climate, note };
}

export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function comparePlaces(ids) {
  const requested = Array.isArray(ids) ? ids : [];
  const missing = requested.filter((value) => !resolvePlace(value));
  if (missing.length) {
    throw new Error(`Unknown place id(s): ${missing.map((value) => `"${String(value)}"`).join(', ')}. Valid ids: ${placeIdList()}.`);
  }
  const places = [...new Map(requested.map((value) => {
    const place = resolvePlace(value);
    return [place.id, place];
  })).values()];
  if (places.length < 2) {
    throw new Error(`Compare at least two distinct places; ${places.length === 1 ? `"${places[0].id}" was given more than once` : 'no places were given'}. Valid ids: ${placeIdList()}.`);
  }
  const pairs = [];
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      pairs.push({
        from: places[i].id,
        to: places[j].id,
        km: Number(haversineKm(places[i], places[j]).toFixed(1)),
        bearing: Number(bearingDegrees(places[i], places[j]).toFixed(1)),
      });
    }
  }
  return {
    places: places.map((place) => ({
      id: place.id,
      name: place.name,
      country: place.country,
      lat: place.lat,
      lon: place.lon,
      populationMillions: place.population,
      climate: place.climate,
    })),
    pairs,
    populationSpread: Number((Math.max(...places.map((p) => p.population)) - Math.min(...places.map((p) => p.population))).toFixed(2)),
  };
}

export function projectPoint(lat, lon, camera) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const latitude = toRad(lat);
  const cameraLatitude = toRad(camera.lat);
  const longitudeDelta = toRad(((lon - camera.lon + 540) % 360) - 180);
  const cosLatitude = Math.cos(latitude);
  const cosCameraLatitude = Math.cos(cameraLatitude);
  const sinCameraLatitude = Math.sin(cameraLatitude);
  const depth =
    sinCameraLatitude * Math.sin(latitude) +
    cosCameraLatitude * cosLatitude * Math.cos(longitudeDelta);
  return {
    x: cosLatitude * Math.sin(longitudeDelta),
    y:
      -(cosCameraLatitude * Math.sin(latitude) -
        sinCameraLatitude * cosLatitude * Math.cos(longitudeDelta)),
    depth,
    visible: depth > 0.015,
  };
}

export function sunlit(lon, hourUtc) {
  const sunLon = (12 - hourUtc) * 15;
  const delta = ((lon - sunLon + 540) % 360) - 180;
  return Math.abs(delta) < 90;
}

export function localHourToUtc(localHour, utcOffset) {
  return (((localHour - utcOffset) % 24) + 24) % 24;
}

export function formatHour(hourUtc) {
  return `${String(hourUtc).padStart(2, '0')}:00 UTC`;
}

export function exportMarkdown(scene) {
  const cameraPlace = getPlace(scene.camera.placeId);
  const lines = [
    `# ${scene.title}`,
    '',
    `- Camera: ${cameraPlace ? cameraPlace.name : `${scene.camera.lat}, ${scene.camera.lon}`}`,
    `- Visualization hour: ${formatHour(scene.time)}`,
    `- Layers: ${Object.entries(scene.layers).filter(([, on]) => on).map(([id]) => id).join(', ') || 'none'}`,
    `- Pins: ${scene.pins.length}`,
    `- Comparisons: ${scene.comparisons.length}`,
    `- Measurements: ${scene.measurements.length}`,
    '',
    '## Pins',
    ...(scene.pins.length
      ? scene.pins.map((pin) => {
          const place = getPlace(pin.placeId);
          return `- ${pin.label} (${place ? place.name : pin.placeId})${pin.note ? ` — ${pin.note}` : ''}`;
        })
      : ['- None']),
    '',
    '## Comparisons',
    ...(scene.comparisons.length
      ? scene.comparisons.flatMap((item) => [
          `- ${item.places.map((place) => place.name).join(' · ')} — population spread ${item.populationSpread}M`,
          ...item.pairs.map((pair) => `  - ${pair.from} → ${pair.to}: ${pair.km} km, bearing ${pair.bearing}°`),
        ])
      : ['- None']),
    '',
    '## Measurements',
    ...(scene.measurements.length
      ? scene.measurements.map((item) => `- ${item.from} → ${item.to}: ${item.km} km, bearing ${item.bearing}°`)
      : ['- None']),
    '',
    scene.stagedBrief ? `## Staged brief\n\n${scene.stagedBrief.headline}\n\n${scene.stagedBrief.body}` : '## Staged brief\n\nNone',
    '',
    scene.published
      ? 'Status: local snapshot finalized through visible user review.'
      : 'Status: local draft. Visible publish review is still open.',
  ];
  return lines.join('\n');
}
