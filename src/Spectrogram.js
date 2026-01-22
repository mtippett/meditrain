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

function Spectrogram({ eegData, selectedChannels, windowSeconds = 300 }) {
  const [histories, setHistories] = useState({});
  const [channelPeaks, setChannelPeaks] = useState({});
  const maxFreq = 50; // focus on meditation-relevant bands and align with periodograms
  const svgRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(500);
  const lastSignatureRef = useRef({});

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

    const windowMs = windowSeconds * 1000;

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

        // Skip if data is unchanged to avoid flat updates
        const signature = magnitudes.reduce((sum, v) => sum + v, 0);
        const lastSig = lastSignatureRef.current[label];
        if (lastSig && lastSig.len === magnitudes.length && Math.abs(lastSig.sig - signature) < 1e-9) {
          return;
        }
        lastSignatureRef.current[label] = { len: magnitudes.length, sig: signature };

        const existing = next[label] || [];
        const updated = [...existing, slice];
        // prune by time window rather than count only
        while (updated.length && (slice.timestamp - updated[0].timestamp) > windowMs) {
          updated.shift();
        }
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
  }, [channelsWithSpectra, windowSeconds, maxFreq]);

  const labels = Object.keys(histories);
  if (labels.length === 0) {
    return <p className="subdued">Waiting for per-channel spectrograms.</p>;
  }

  const rowHeight = 180;
  const axisHeight = 20;
  const height = labels.length * rowHeight + axisHeight;

  // precompute global dB range for consistent scale
  let globalMaxDb = -Infinity;
  let globalMinDb = Infinity;
  const channelDbSlices = {};
  labels.forEach(label => {
    const history = histories[label];
    if (!history || history.length === 0) return;
    const EPS = 1e-12;
    const dbSlices = history.map(slice => slice.magnitudes.map(m => 10 * Math.log10(Math.max(m, EPS))));
    channelDbSlices[label] = dbSlices;
    dbSlices.flat().forEach(v => {
      if (v > globalMaxDb) globalMaxDb = v;
      if (v < globalMinDb) globalMinDb = v;
    });
  });
  if (!isFinite(globalMaxDb)) globalMaxDb = -60;
  if (!isFinite(globalMinDb)) globalMinDb = -120;
  const globalMinWindowed = Math.max(globalMaxDb - 60, globalMinDb);
  const globalRange = Math.max(1, globalMaxDb - globalMinWindowed);

  // Helper to find time gaps in history
  function findGaps(history, minGapMs = 2000) {
    if (!history || history.length < 2) return [];
    const gaps = [];
    for (let i = 1; i < history.length; ++i) {
      const prev = history[i - 1].timestamp;
      const curr = history[i].timestamp;
      if (curr - prev > minGapMs) {
        gaps.push({ start: i - 1, end: i, gap: curr - prev });
      }
    }
    return gaps;
  }

  return (
    <svg ref={svgRef} width="100%" height={height} className="spectrogram">
      {labels.map((label, idx) => {
        const history = histories[label];
        if (!history || history.length === 0) return null;

        const sliceWidth = plotWidth / history.length;
        const freqBins = history[0].freqs.length || 1;
        const binHeight = rowHeight / freqBins;
        const dbSlices = channelDbSlices[label] || [];

        const colorForValue = (vDb) => {
          const t = (Math.max(vDb, globalMinWindowed) - globalMinWindowed) / globalRange;
          return spectroColor(t);
        };

        // Find gaps in the history
        const minGapMs = 2000; // 2 seconds, can be adjusted
        const gaps = findGaps(history, minGapMs);

        // Render segments between gaps
        let lastIdx = 0;
        const segments = [];
        if (gaps.length === 0) {
          segments.push({ start: 0, end: history.length });
        } else {
          gaps.forEach((gap, i) => {
            segments.push({ start: lastIdx, end: gap.end });
            lastIdx = gap.end;
          });
          if (lastIdx < history.length) {
            segments.push({ start: lastIdx, end: history.length });
          }
        }

        return (
          <g key={label}>
            {segments.map((seg, segIdx) => (
              <g key={`seg-${segIdx}`}
                opacity={1}
              >
                {Array.from({ length: seg.end - seg.start }).map((_, relIdx) => {
                  const xIdx = seg.start + relIdx;
                  const slice = history[xIdx];
                  return slice.magnitudes.map((mag, yIdx) => (
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
                  ));
                })}
              </g>
            ))}
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
      {/* simple time scale */}
      {labels.length > 0 && histories[labels[0]]?.length > 1 && (
        (() => {
          const durationSec = Math.max(1, Math.round(windowSeconds));
          const ticks = 4;
          const texts = [];
          for (let i = 0; i <= ticks; i++) {
            const t = i / ticks;
            const x = t * plotWidth;
            const label = i === ticks ? '0s' : `-${Math.round((1 - t) * durationSec)}s`;
            texts.push(
              <text
                key={`axis-${i}`}
                x={x}
                y={height - 4}
                fill="rgba(255,255,255,0.6)"
                fontSize="10"
                textAnchor={i === ticks ? 'end' : i === 0 ? 'start' : 'middle'}
              >
                {label}
              </text>
            );
          }
          return texts;
        })()
      )}
    </svg>
  );
}

export default Spectrogram;
