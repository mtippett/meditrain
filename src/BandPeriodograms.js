import React, { useMemo, useRef, useEffect, useState } from 'react';

// Helper to find time gaps in a time series
function splitByGaps(points, getTime, minGapMs = 2000) {
  if (!points || points.length < 2) return [points];
  const segments = [];
  let lastIdx = 0;
  for (let i = 1; i < points.length; ++i) {
    if (getTime(points[i]) - getTime(points[i - 1]) > minGapMs) {
      segments.push(points.slice(lastIdx, i));
      lastIdx = i;
    }
  }
  if (lastIdx < points.length) segments.push(points.slice(lastIdx));
  return segments;
}

const maxFreq = 50;
const minFreq = 0.5;
const ROW_HEIGHT = 140;
const BAND_MARKS = [
  { name: 'delta', start: 0.5, end: 4 },
  { name: 'theta', start: 4, end: 8 },
  { name: 'alpha', start: 8, end: 12 },
  { name: 'beta', start: 12, end: 30 },
  { name: 'gamma', start: 30, end: 45 },
];

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

function BandPeriodograms({ eegData, selectedChannels }) {
  const svgRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(500);

  const channels = useMemo(() => {
    const targets = selectedChannels.length ? selectedChannels : eegData.map(c => c.label || c.electrode);
    return eegData
      .filter(c => targets.includes(c.label || c.electrode))
      .filter(c => c.averagedPeriodogram);
  }, [eegData, selectedChannels]);

  useEffect(() => {
    if (!svgRef.current) return;
    const measuredWidth = svgRef.current.parentElement?.clientWidth || plotWidth;
    if (measuredWidth !== plotWidth) {
      setPlotWidth(measuredWidth);
    }
  }, [plotWidth]);

  if (channels.length === 0) {
    return <p className="subdued">Waiting for per-channel periodograms.</p>;
  }

  const lineData = channels.map((channel) => {
    const freqs = channel.averagedPeriodogram?.frequencies || [];
    const mags = channel.averagedPeriodogram?.magnitudes || [];
    const points = freqs
      .map((f, i) => ({ f, m: mags[i], t: channel.averagedPeriodogram?.timestamp ? channel.averagedPeriodogram.timestamp[i] : null }))
      .filter(({ f }) => f >= minFreq && f <= maxFreq);

    // downsample bins to reduce DOM load
    const maxBins = 256;
    const step = Math.max(1, Math.floor(points.length / maxBins));
    const sampled = points.filter((_, idx) => idx % step === 0);

    if (!sampled.length) return null;

    const EPS = 1e-12;
    const dbPoints = sampled.map(({ f, m, t }) => ({ f, db: 10 * Math.log10(Math.max(m, EPS)), t }));
    const maxDb = Math.max(...dbPoints.map(p => p.db));
    const minDbLocal = Math.min(...dbPoints.map(p => p.db));
    const minDb = Math.max(maxDb - 60, minDbLocal); // 60 dB window
    const bins = dbPoints.map(({ f, db, t }) => ({
      x: (f / maxFreq) * plotWidth,
      db,
      t
    }));
    return { id: channel.label || channel.electrode, bins, maxDb, minDb };
  }).filter(Boolean);

  const globalMaxDb = Math.max(...lineData.map(l => l.maxDb || -120), -120);
  const globalMinDb = Math.max(globalMaxDb - 60, Math.min(...lineData.map(l => l.minDb || -120)));
  const height = channels.length * ROW_HEIGHT;

  return (
    <svg ref={svgRef} width="100%" height={height} className="periodogram-chart">
      {lineData.map((line, i) => {
        const binWidth = line.bins.length > 0 ? plotWidth / line.bins.length : 0;
        // Find gaps in bins using t if available
        let segments;
        if (line.bins.length > 0 && line.bins[0].t != null) {
          segments = splitByGaps(line.bins, b => b.t, 2000);
        } else {
          segments = [line.bins];
        }
        return (
        <g key={line.id} transform={`translate(0, ${i * ROW_HEIGHT})`}>
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={ROW_HEIGHT}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={ROW_HEIGHT}
            x2={plotWidth}
            y2={ROW_HEIGHT}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
          />
          <text x="4" y={ROW_HEIGHT - 4} fill="rgba(255,255,255,0.6)" fontSize="10">
            {minFreq} Hz
          </text>
          <text x={plotWidth - 4} y={ROW_HEIGHT - 4} fill="rgba(255,255,255,0.6)" fontSize="10" textAnchor="end">
            {maxFreq} Hz
          </text>
          <text x="4" y="12" fill="rgba(255,255,255,0.6)" fontSize="10">
            {globalMaxDb.toFixed(0)} dB
          </text>
          <text x="4" y={ROW_HEIGHT - 16} fill="rgba(255,255,255,0.6)" fontSize="10">
            {globalMinDb.toFixed(0)} dB
          </text>
          {/* Band guides */}
          {BAND_MARKS.map((band) => (
            <g key={band.name}>
              <line
                x1={(band.start / maxFreq) * plotWidth}
                x2={(band.start / maxFreq) * plotWidth}
                y1={0}
                y2={ROW_HEIGHT}
                stroke="rgba(255,255,255,0.15)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text
                x={(band.start / maxFreq) * plotWidth + 4}
                y={12}
                fill="rgba(255,255,255,0.6)"
                fontSize="10"
              >
                {band.name}
              </text>
            </g>
          ))}

          {segments.map((seg, segIdx) => (
            <g key={`seg-${segIdx}`}>
              {seg.map((bin, idxBin) => (
                <rect
                  key={`${line.id}-${segIdx}-${idxBin}`}
                  x={bin.x}
                  y={ROW_HEIGHT - ((bin.db - globalMinDb) / (globalMaxDb - globalMinDb + 1e-6)) * ROW_HEIGHT}
                  width={binWidth + 0.5}
                  height={((bin.db - globalMinDb) / (globalMaxDb - globalMinDb + 1e-6)) * ROW_HEIGHT}
                  fill={spectroColor((bin.db - globalMinDb) / (globalMaxDb - globalMinDb + 1e-6))}
                  stroke="none"
                />
              ))}
            </g>
          ))}
          <text x={6} y={12} fill="rgba(255,255,255,0.7)" fontSize="11">
            {line.id}
          </text>
        </g>
      )})}
    </svg>
  );
}

export default BandPeriodograms;
