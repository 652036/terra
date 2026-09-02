export const PLACES = [
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503, utcOffset: 9, population: 37.4, note: 'Night megacity on the Pacific rim.', climate: 'humid subtropical' },
  { id: 'nyc', name: 'New York', country: 'United States', lat: 40.7128, lon: -74.006, utcOffset: -5, population: 18.8, note: 'Dense Atlantic harbor city.', climate: 'humid subtropical' },
  { id: 'london', name: 'London', country: 'United Kingdom', lat: 51.5074, lon: -0.1278, utcOffset: 0, population: 9.8, note: 'River city at the Greenwich meridian.', climate: 'oceanic' },
  { id: 'nairobi', name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219, utcOffset: 3, population: 5.3, note: 'Highland capital near the equator.', climate: 'subtropical highland' },
  { id: 'reykjavik', name: 'Reykjavik', country: 'Iceland', lat: 64.1466, lon: -21.9426, utcOffset: 0, population: 0.14, note: 'Northern coastal capital with long winter nights.', climate: 'subpolar oceanic' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093, utcOffset: 10, population: 5.3, note: 'Harbor city in the southern hemisphere.', climate: 'humid subtropical' },
  { id: 'sao-paulo', name: 'Sao Paulo', country: 'Brazil', lat: -23.5558, lon: -46.6396, utcOffset: -3, population: 22.4, note: 'Inland plateau megacity.', climate: 'humid subtropical' },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357, utcOffset: 2, population: 22.2, note: 'Nile megacity at the desert edge.', climate: 'hot desert' },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198, utcOffset: 8, population: 6.0, note: 'Equatorial port city-state.', climate: 'tropical rainforest' },
  { id: 'vancouver', name: 'Vancouver', country: 'Canada', lat: 49.2827, lon: -123.1207, utcOffset: -8, population: 2.7, note: 'Coastal city between ocean and mountains.', climate: 'oceanic' },
  { id: 'lagos', name: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792, utcOffset: 1, population: 21.3, note: 'West African Atlantic megacity.', climate: 'tropical savanna' },
  { id: 'ushuaia', name: 'Ushuaia', country: 'Argentina', lat: -54.8019, lon: -68.303, utcOffset: -3, population: 0.08, note: 'Southernmost city on Tierra del Fuego.', climate: 'tundra' },
];

export const LAYERS = [
  { id: 'labels', label: 'Place labels', defaultOn: true },
  { id: 'lights', label: 'City lights', defaultOn: true },
  { id: 'atmosphere', label: 'Atmosphere glow', defaultOn: true },
  { id: 'grid', label: 'Lat/lon grid', defaultOn: false },
  { id: 'pins', label: 'Dropped pins', defaultOn: true },
];

// 13:00 UTC is 22:00 in Tokyo, so the default camera target sits on the night side.
export const DEFAULT_HOUR_UTC = 13;

export function blankScene() {
  return {
    title: 'TERRA briefing',
    camera: { placeId: 'tokyo', lat: 35.6762, lon: 139.6503, altitude: 1 },
    time: DEFAULT_HOUR_UTC,
    layers: Object.fromEntries(LAYERS.map((layer) => [layer.id, layer.defaultOn])),
    pins: [],
    comparisons: [],
    measurements: [],
    activity: [],
    stagedBrief: null,
    published: false,
    history: [],
  };
}

export function exampleScene() {
  const scene = blankScene();
  scene.title = 'Pacific night corridor';
  scene.camera = { placeId: 'tokyo', lat: 35.6762, lon: 139.6503, altitude: 1 };
  scene.time = DEFAULT_HOUR_UTC;
  scene.pins = [
    { id: 'pin-tokyo', placeId: 'tokyo', label: 'Start here', note: 'Megacity night lights at 22:00 local.' },
    { id: 'pin-vancouver', placeId: 'vancouver', label: 'Same ocean, opposite morning', note: 'Pre-dawn at 05:00 local; compare daylight.' },
  ];
  return scene;
}
