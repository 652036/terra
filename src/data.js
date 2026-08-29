export const PLACES = [
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503, population: 37.4, note: 'Night megacity on the Pacific rim.', climate: 'humid subtropical' },
  { id: 'nyc', name: 'New York', country: 'United States', lat: 40.7128, lon: -74.006, population: 18.8, note: 'Dense Atlantic harbor city.', climate: 'humid subtropical' },
  { id: 'london', name: 'London', country: 'United Kingdom', lat: 51.5074, lon: -0.1278, population: 9.8, note: 'River city at the Greenwich meridian.', climate: 'oceanic' },
  { id: 'nairobi', name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219, population: 5.3, note: 'Highland capital near the equator.', climate: 'subtropical highland' },
  { id: 'reykjavik', name: 'Reykjavik', country: 'Iceland', lat: 64.1466, lon: -21.9426, population: 0.14, note: 'Northern coastal capital with long winter nights.', climate: 'subpolar oceanic' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093, population: 5.3, note: 'Harbor city in the southern hemisphere.', climate: 'humid subtropical' },
  { id: 'sao-paulo', name: 'Sao Paulo', country: 'Brazil', lat: -23.5558, lon: -46.6396, population: 22.4, note: 'Inland plateau megacity.', climate: 'humid subtropical' },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357, population: 22.2, note: 'Nile megacity at the desert edge.', climate: 'hot desert' },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198, population: 6.0, note: 'Equatorial port city-state.', climate: 'tropical rainforest' },
  { id: 'vancouver', name: 'Vancouver', country: 'Canada', lat: 49.2827, lon: -123.1207, population: 2.7, note: 'Coastal city between ocean and mountains.', climate: 'oceanic' },
  { id: 'lagos', name: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792, population: 21.3, note: 'West African Atlantic megacity.', climate: 'tropical savanna' },
  { id: 'ushuaia', name: 'Ushuaia', country: 'Argentina', lat: -54.8019, lon: -68.303, population: 0.08, note: 'Southernmost city on Tierra del Fuego.', climate: 'tundra' },
];

export const LAYERS = [
  { id: 'labels', label: 'Place labels', defaultOn: true },
  { id: 'lights', label: 'City lights', defaultOn: true },
  { id: 'atmosphere', label: 'Atmosphere glow', defaultOn: true },
  { id: 'grid', label: 'Lat/lon grid', defaultOn: false },
  { id: 'pins', label: 'Dropped pins', defaultOn: true },
];

export function blankScene() {
  return {
    title: 'TERRA briefing',
    camera: { placeId: 'tokyo', lat: 35.6762, lon: 139.6503, altitude: 1 },
    time: 21,
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
  scene.time = 22;
  scene.pins = [
    { id: 'pin-tokyo', placeId: 'tokyo', label: 'Start here', note: 'Megacity night lights.' },
    { id: 'pin-vancouver', placeId: 'vancouver', label: 'Same ocean, opposite morning', note: 'Compare daylight.' },
  ];
  return scene;
}
