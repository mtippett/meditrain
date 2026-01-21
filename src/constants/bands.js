export const STANDARD_BANDS = [
  { key: 'delta', label: 'Delta', min: 0.5, max: 4 },
  { key: 'theta', label: 'Theta', min: 4, max: 8 },
  { key: 'alpha', label: 'Alpha', min: 8, max: 12 },
  { key: 'beta', label: 'Beta', min: 12, max: 30 },
  { key: 'gamma', label: 'Gamma', min: 30, max: 50 } // cap at device Nyquist for Muse (~128 Hz, we chart to 50 Hz)
];

export const BAND_KEYS = STANDARD_BANDS.map(b => b.key);
