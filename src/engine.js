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
  const uniqueIds = [...new Set(ids)];
  const places = uniqueIds.map(getPlace);
  const missing = uniqueIds.filter((_, index) => !places[index]);
  if (missing.length) throw new Error(`Unknown place id(s): ${missing.join(', ')}.`);
  if (places.length < 2) throw new Error('Compare at least two distinct, known place ids.');
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

export function sunlit(lon, hour) {
  const sunLon = (12 - hour) * 15;
  const delta = ((lon - sunLon + 540) % 360) - 180;
  return Math.abs(delta) < 90;
}

export function exportMarkdown(scene) {
  const cameraPlace = getPlace(scene.camera.placeId);
  const lines = [
    `# ${scene.title}`,
    '',
    `- Camera: ${cameraPlace ? cameraPlace.name : `${scene.camera.lat}, ${scene.camera.lon}`}`,
    `- Visualization hour: ${String(scene.time).padStart(2, '0')}:00`,
    `- Layers: ${Object.entries(scene.layers).filter(([, on]) => on).map(([id]) => id).join(', ') || 'none'}`,
    `- Pins: ${scene.pins.length}`,
    '',
    '## Pins',
    ...scene.pins.map((pin) => {
      const place = getPlace(pin.placeId);
      return `- ${pin.label} (${place ? place.name : pin.placeId})${pin.note ? ` — ${pin.note}` : ''}`;
    }),
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
