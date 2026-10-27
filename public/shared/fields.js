// Field groups shared by several module schemas (also used by plug-in modules
// in ./modules/, which must not import modules.js to avoid import cycles).

// Empty = the mirror's location from "General".
export const locationFields = [
  { key: 'location', label: 'Location', type: 'location', default: null, help: 'Search for a city. Leave empty to use the location from "General".' },
];
