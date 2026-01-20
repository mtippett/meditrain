import React, { useMemo } from 'react';

const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'];

// Approximate overhead positions (percentages) for Muse-style channels
const SENSOR_POSITIONS = {
  AF7: { x: 30, y: 20 },
  AF8: { x: 70, y: 20 },
  TP9: { x: 25, y: 60 },
  TP10: { x: 75, y: 60 },
  'AUXL': { x: 15, y: 40 },
  'AUXR': { x: 85, y: 40 },
};

function MiniBandChart({ bands }) {
  return (
    <div className="mini-band-chart">
      {BANDS.map((band) => {
        const val = bands[band];
        if (!val) return null;
        const pct = Math.round((val.relative || 0) * 100);
        return (
          <div className="mini-band-row" key={band}>
            <span className="mini-label">{band}</span>
            <div className="mini-bar">
              <span className="mini-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BrainView({ eegData = [] }) {
  const channels = useMemo(() => {
    return eegData
      .filter(c => c.bandPowers)
      .map(c => ({
        label: c.label || c.electrode,
        bands: c.bandPowers
      }));
  }, [eegData]);

  if (channels.length === 0) {
    return <p className="subdued">No band power data yet. Connect a device and wait for periodograms.</p>;
  }

  return (
    <div className="brain-map">
      <div className="brain-head">
        {channels.map((channel) => {
          const pos = SENSOR_POSITIONS[channel.label] || { x: 50, y: 50 };
          return (
            <div
              key={channel.label}
              className="sensor-card"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <p className="eyebrow">{channel.label}</p>
              <MiniBandChart bands={channel.bands} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BrainView;
