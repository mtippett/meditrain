import React, { useEffect, useMemo, useState, useRef } from 'react';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor([r1, g1, b1], [r2, g2, b2], t) {
  return `rgb(${Math.round(lerp(r1, r2, t))}, ${Math.round(lerp(g1, g2, t))}, ${Math.round(lerp(b1, b2, t))})`;
}

// Classic spectrogram palette: deep blue -> cyan -> yellow -> red
function spectroColor(t) {
  const stops = [
    [10, 20, 80],
    [30, 120, 200],
    [80, 200, 255],
    [255, 230, 80],
    [255, 120, 40],
    [200, 20, 20]
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (stops.length - 1);
  const i = Math.floor(seg);
  const frac = seg - i;
  if (i >= stops.length - 1) return `rgb(${stops[stops.length - 1].join(',')})`;
  return lerpColor(stops[i], stops[i + 1], frac);
}

function Spectrogram({ eegData, selectedChannels }) {
  const [histories, setHistories] = useState({});
  const [channelPeaks, setChannelPeaks] = useState({});
  const maxSlices = 40;
  const maxFreq = 50; // focus on meditation-relevant bands
  const svgRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(500);

  const channelsWithSpectra = useMemo(() => {
    const targets = selectedChannels.length ? selectedChannels : eegData.map(c => c.label || c.electrode);
    return eegData
      .filter((c) => targets.includes(c.label || c.electrode))
      .filter((c) => c.averagedPeriodogram);
  }, [eegData, selectedChannels]);

  useEffect(() => {
    if (!svgRef.current) return;
    const measuredWidth = svgRef.current.parentElement?.clientWidth || plotWidth;
    if (measuredWidth !== plotWidth) {
      setPlotWidth(measuredWidth);
    }
  }, [plotWidth]);

  useEffect(() => {
    if (channelsWithSpectra.length === 0) return;

    setHistories((prev) => {
      const next = { ...prev };
      const labels = new Set();

      channelsWithSpectra.forEach((channel) => {
        const label = channel.label || channel.electrode;
        labels.add(label);
        const freqRef = channel.averagedPeriodogram.frequencies;
        const indices = freqRef
          .map((f, idx) => ({ f, idx }))
          .filter(({ f }) => f <= maxFreq);

        const magnitudes = indices.map(({ idx }) => channel.averagedPeriodogram.magnitudes[idx]);
        const freqs = indices.map(({ f }) => f);
        const slice = { freqs, magnitudes, timestamp: Date.now() };

        const existing = next[label] || [];
        const updated = [...existing, slice];
        if (updated.length > maxSlices) updated.shift();
        next[label] = updated;
      });

      // prune removed channels
      Object.keys(next).forEach((label) => {
        if (!labels.has(label)) delete next[label];
      });

      return next;
    });

    // track peak per channel for consistent scaling
    setChannelPeaks((prev) => {
      const next = { ...prev };
      channelsWithSpectra.forEach((channel) => {
        const label = channel.label || channel.electrode;
        const localMax = Math.max(...channel.averagedPeriodogram.magnitudes);
        next[label] = Math.max(next[label] || 0, localMax);
      });
      // prune
      Object.keys(next).forEach((label) => {
        if (!channelsWithSpectra.find(c => (c.label || c.electrode) === label)) delete next[label];
      });
      return next;
    });
  }, [channelsWithSpectra, maxSlices, maxFreq]);

  const labels = Object.keys(histories);
  if (labels.length === 0) {
    return <p className="subdued">Waiting for per-channel spectrograms.</p>;
  }

  const rowHeight = 180;
  const height = labels.length * rowHeight;

  return (
    <svg ref={svgRef} width="100%" height={height} className="spectrogram">
      {labels.map((label, idx) => {
        const history = histories[label];
        const peak = channelPeaks[label];
        if (!history || history.length === 0) return null;

        const sliceWidth = plotWidth / history.length;
        const freqBins = history[0].freqs.length || 1;
        const binHeight = rowHeight / freqBins;
        const EPS = 1e-12;
        const dbSlices = history.map(slice => slice.magnitudes.map(m => 10 * Math.log10(Math.max(m, EPS))));
        const allDb = dbSlices.flat();
        const peakDb = peak ? 10 * Math.log10(Math.max(peak, EPS)) : Math.max(...allDb);
        const minDbLocal = Math.min(...allDb);
        const minDb = Math.max(peakDb - 60, minDbLocal);
        const rangeDb = peakDb - minDb || 1;

        const colorForValue = (vDb) => {
          const t = (Math.max(vDb, minDb) - minDb) / rangeDb;
          return spectroColor(t);
        };

        return (
          <g key={label}>
            {history.map((slice, xIdx) =>
              slice.magnitudes.map((mag, yIdx) => (
                <rect
                  key={`${label}-${xIdx}-${yIdx}`}
                  x={xIdx * sliceWidth}
                  y={idx * rowHeight + rowHeight - (yIdx + 1) * binHeight}
                  width={sliceWidth + 0.5}
                  height={binHeight + 0.5}
                  fill={colorForValue(dbSlices[xIdx][yIdx])}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="0.25"
                />
              ))
            )}
            {/* Band guides */}
            {[{ name: 'delta', f: 0.5 }, { name: 'theta', f: 4 }, { name: 'alpha', f: 8 }, { name: 'beta', f: 12 }, { name: 'gamma', f: 30 }].map((band, idxBand) => (
              <g key={band.name}>
                <line
                  x1={(band.f / maxFreq) * plotWidth}
                  x2={(band.f / maxFreq) * plotWidth}
                  y1={idx * rowHeight}
                  y2={idx * rowHeight + rowHeight}
                  stroke="rgba(255,255,255,0.12)"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                {idxBand === 0 && (
                  <text
                    x={(band.f / maxFreq) * plotWidth + 4}
                    y={idx * rowHeight + 12}
                    fill="rgba(255,255,255,0.6)"
                    fontSize="10"
                  >
                    {band.name}
                  </text>
                )}
              </g>
            ))}
            <text x={8} y={idx * rowHeight + 16} fill="rgba(255,255,255,0.8)" fontSize="12">
              {label}
            </text>
            <text x={8} y={idx * rowHeight + rowHeight - 6} fill="rgba(255,255,255,0.8)" fontSize="12">
              {maxFreq} Hz
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default Spectrogram;
