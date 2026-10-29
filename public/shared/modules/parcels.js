// Parcel tracking via the DHL Shipment Tracking – Unified API (DHL Paket,
// Express, …) and optionally 17TRACK for other carriers (Hermes, DPD, GLS, …).

export const STATUSES = ['out', 'pickup', 'exception', 'transit', 'pre', 'unknown', 'delivered'];

export default {
  type: 'parcels',
  label: 'Parcel tracking',
  description: 'Status of your parcels (DHL, optionally other carriers via 17TRACK)',
  defaultRegion: 'middle_right',
  defaultTitle: 'Parcels',
  refresh: 600,
  fields: [
    { key: 'dhlApiKey', label: 'DHL API key (free at developer.dhl.com)', type: 'text', default: '', secret: true,
      help: 'Create an app at developer.dhl.com with the "Shipment Tracking – Unified" API and use its API key (not the secret). The free plan allows 250 queries per day – the mirror stays well below that.' },
    { key: 'trackApiKey', label: '17TRACK API key (optional, for other carriers)', type: 'text', default: '', secret: true,
      help: 'Only needed for Hermes, DPD, GLS, UPS & co. 17TRACK gives new accounts 200 tracking numbers for free (once, not per month); each new tracking number uses one of them.' },
    { key: 'parcels', label: 'Parcels', type: 'list', itemLabel: 'Parcel', default: [], fields: [
      { key: 'name', label: 'Name', type: 'text', default: '', placeholder: 'New shoes' },
      // Tracking number and postal code reveal personal data – never sent to the mirror.
      { key: 'number', label: 'Tracking number', type: 'text', default: '', secret: true, placeholder: '00340434161094042557' },
      { key: 'carrier', label: 'Carrier', type: 'select', default: 'auto', options: [
        { value: 'auto', label: 'Automatic (DHL first, then 17TRACK)' },
        { value: 'dhl', label: 'DHL' },
        { value: 'other', label: 'Other carrier (17TRACK)' },
      ] },
      { key: 'postalCode', label: 'Recipient postal code (optional, more details for DHL Paket)', type: 'text', default: '', secret: true, placeholder: '04109' },
      { key: 'enabled', label: 'Enabled', type: 'bool', default: true },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List with details' },
      { value: 'compact', label: 'Compact (one line per parcel)' },
    ] },
    { key: 'showEvent', label: 'Show last tracking event', type: 'bool', default: true, showIf: { layout: 'list' } },
    { key: 'showEta', label: 'Show estimated delivery', type: 'bool', default: true },
    { key: 'hideDeliveredDays', label: 'Hide delivered parcels after (days, 0 = right away)', type: 'number', default: 2, min: 0, max: 30 },
  ],
};
