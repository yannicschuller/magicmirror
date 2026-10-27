// Field groups shared by several module schemas (also used by plug-in modules
// in ./modules/, which must not import modules.js to avoid import cycles).

export const locationFields = [
  { key: 'useGlobalLocation', label: 'Use location from "General"', type: 'bool', default: true },
  { key: 'location', label: 'Custom location', type: 'location', default: null, showIf: { useGlobalLocation: false } },
];
