import React, { useEffect, useMemo, useState } from 'react';
import BandPowerChart from './BandPowerChart';

const STANDARD_BANDS = [
  { key: 'delta', label: 'Delta', min: 0.5, max: 4 },
  { key: 'theta', label: 'Theta', min: 4, max: 8 },
  { key: 'alpha', label: 'Alpha', min: 8, max: 12 },
  { key: 'beta', label: 'Beta', min: 12, max: 30 },
  { key: 'gamma', label: 'Gamma', min: 30, max: 10000 }
];

const MAX_HISTORY = 120;

function BandPower({ eegData, onBandPowerUpdated }) {
  const [bandHistory, setBandHistory] = useState({});

  const calcBandPowers = useMemo(
    () => (periodogram) => {
      const bandPowers = {};
      let totalPower = 0;

      STANDARD_BANDS.forEach(({ key }) => {
        bandPowers[key] = { absolute: 0, relative: 0 };
      });

      periodogram.frequencies.forEach((frequency, index) => {
        const power = periodogram.magnitudes[index] ** 2;
        const band = STANDARD_BANDS.find(b => frequency >= b.min && frequency < b.max);
        if (band) {
          bandPowers[band.key].absolute += power;
          totalPower += power;
        }
      });

      if (totalPower > 0) {
        STANDARD_BANDS.forEach(({ key }) => {
          bandPowers[key].relative = bandPowers[key].absolute / totalPower;
        });
      }

      return bandPowers;
    },
    []
  );

  useEffect(() => {
    setBandHistory((prev) => {
      const next = { ...prev };
      const snapshots = [];
      const activeLabels = new Set();

      eegData
        .filter(electrode => typeof electrode.averagedPeriodogram !== 'undefined')
        .forEach(electrode => {
          const label = electrode.label || electrode.electrode;
          const bandPowers = calcBandPowers(electrode.averagedPeriodogram);
          electrode.bandPowers = bandPowers;
          activeLabels.add(label);

          if (!next[label]) next[label] = {};
          STANDARD_BANDS.forEach(({ key }) => {
            if (!next[label][key]) next[label][key] = [];
            next[label][key].push(bandPowers[key].relative || 0);
            if (next[label][key].length > MAX_HISTORY) {
              next[label][key].shift();
            }
          });

          snapshots.push({ label, bands: bandPowers });
        });

      // prune history for channels no longer active/selected
      Object.keys(next).forEach(label => {
        if (!activeLabels.has(label)) {
          delete next[label];
        }
      });

      onBandPowerUpdated(snapshots);
      return next;
    });
  }, [calcBandPowers, eegData, onBandPowerUpdated]);

  const historyEntries = Object.entries(bandHistory);

  return (
    <div>
      <div className="panel-heading" style={{ marginTop: 8 }}>
        <h3>Band Power Over Time</h3>
        <span className="subdued">Overlayed lines per band (relative power)</span>
      </div>

      <div className="band-grid">
        {historyEntries.length === 0 && <p className="subdued">Waiting for spectra to compute band power.</p>}
        {historyEntries.map(([label, bands]) => (
          <div className="band-card" key={label}>
            <div className="band-card-header">
              <p className="eyebrow">{label}</p>
              <span className="channel-meta">Relative power history</span>
            </div>
            <BandPowerChart channel={bands} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default BandPower;
