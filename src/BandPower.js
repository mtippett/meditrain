import React, { useMemo } from 'react';
import BandPowerChart from './BandPowerChart';
import { STANDARD_BANDS } from './constants/bands';

function BandPower({ bandHistory = {}, trainingTargets = [], windowSeconds = 120 }) {

  const historyEntries = Object.entries(bandHistory);

  const targetMap = useMemo(() => {
    const map = {};
    trainingTargets.forEach(t => {
      if (!map[t.label]) map[t.label] = [];
      map[t.label].push(t);
    });
    return map;
  }, [trainingTargets]);

  return (
    <div>
      <div className="panel-heading" style={{ marginTop: 8 }}>
        <h3>Band Power Over Time</h3>
        <span className="subdued">Overlayed lines per band (relative power)</span>
      </div>
      <div className="band-legend">
        {STANDARD_BANDS.map(b => (
          <span key={b.key} className={`legend-chip legend-${b.key}`}>{b.label}</span>
        ))}
      </div>

      <div className="band-grid">
        {historyEntries.length === 0 && (
          <p className="subdued">Waiting for spectra to compute live band power.</p>
        )}
        {historyEntries.map(([label, bands]) => {
          const targets = targetMap[label] || [];
          const normalized = Object.fromEntries(
            Object.entries(bands).map(([key, series]) => {
              const avg = series.avg || null;
              const vals = Array.isArray(series) ? series.map(point => point.v) : [];
              return [key, vals];
            })
          );
          return (
            <div className="band-card" key={label}>
              <div className="band-card-header">
                <p className="eyebrow">{label}</p>
                <span className="channel-meta">Relative power history</span>
              </div>
              <BandPowerChart channel={normalized} targets={targets} durationSec={windowSeconds} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BandPower;
