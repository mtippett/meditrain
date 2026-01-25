import React, { useMemo, useState } from 'react';
import BandPowerChart from './BandPowerChart';
import { STANDARD_BANDS } from './constants/bands';
import { PanelControlButton } from './ui/PanelControls';

function BandPower({ bandHistory = {}, trainingTargets = [], targetHistory = {}, windowSeconds = 120 }) {
  const [expandedLabel, setExpandedLabel] = useState(null);
  const controlIcons = useMemo(() => ({
    expand: '⤢',
    collapse: '⤡'
  }), []);

  const historyEntries = Object.entries(bandHistory);
  const displayedEntries = expandedLabel
    ? historyEntries.filter(([label]) => label === expandedLabel)
    : historyEntries;

  const targetMap = useMemo(() => {
    const map = {};
    trainingTargets.forEach(t => {
      if ((t.model || 'relative') !== 'relative') return;
      if (!map[t.label]) map[t.label] = [];
      map[t.label].push(t);
    });
    return map;
  }, [trainingTargets]);

  return (
    <div>
      <div className="panel-heading" style={{ marginTop: 8 }}>
        <div className="panel-title">
          <h3>Band Power Over Time</h3>
          <span className="subdued">Overlayed lines per band (relative power)</span>
        </div>
      </div>
      <div className="band-legend">
        {STANDARD_BANDS.map(b => (
          <span key={b.key} className={`legend-chip legend-${b.key}`}>{b.label}</span>
        ))}
      </div>

      <div className={`band-grid ${expandedLabel ? 'expanded' : ''}`}>
        {historyEntries.length === 0 && (
          <p className="subdued">Waiting for spectra to compute live band power.</p>
        )}
        {displayedEntries.map(([label, bands]) => {
          const targets = targetMap[label] || [];
          const labelTargetHistory = targetHistory[label] || {};
          const normalized = Object.fromEntries(
            Object.entries(bands).map(([key, series]) => {
              const vals = Array.isArray(series)
                ? series.map(point => ({ v: point.v, t: point.t }))
                : [];
              return [key, vals];
            })
          );
          return (
            <div className={`band-card ${expandedLabel === label ? 'expanded' : ''}`} key={label}>
              <div className="band-card-header">
                <p className="eyebrow">{label}</p>
                <span className="channel-meta">Relative power history</span>
                <PanelControlButton
                  pressed={expandedLabel === label}
                  ariaLabel={expandedLabel === label ? 'Exit fullscreen' : 'Enter fullscreen'}
                  title={expandedLabel === label ? 'Exit fullscreen' : 'Enter fullscreen'}
                  onClick={() => setExpandedLabel(expandedLabel === label ? null : label)}
                >
                  {expandedLabel === label ? controlIcons.collapse : controlIcons.expand}
                </PanelControlButton>
              </div>
              <BandPowerChart
                channel={normalized}
                targets={targets}
                targetHistory={labelTargetHistory}
                durationSec={windowSeconds}
                height={expandedLabel === label ? 320 : 140}
              />
              {targets.length > 0 && (
                <div className="inline-status" style={{ marginTop: 8 }}>
                  {targets.map((t) => (
                    <span className="status-pill" key={`${t.id}-target`}>
                      {t.band}: {t.target.toFixed(3)} ± {(t.tolerance ?? 0).toFixed(3)} (sens {Number(t.sensitivity || 1).toFixed(2)})
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BandPower;
