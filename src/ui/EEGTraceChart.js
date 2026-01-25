import React, { useMemo } from 'react';

/**
 * Lightweight EEG trace renderer.
 * - Uses a simple SVG polyline (no D3 dependency).
 * - Automatically downsamples large arrays for performance.
 * - Scales to the parent width via viewBox; height is explicit.
 */
function EEGTraceChart({ samples = [], height = 80, maxPoints = 800, overlays = [], overlayAlpha = 0.2 }) {
  const trace = useMemo(() => {
    if (!samples || samples.length === 0) return null;

    // Downsample uniformly if too many points
    const step = Math.max(1, Math.ceil(samples.length / maxPoints));
    const reduced = [];
    for (let i = 0; i < samples.length; i += step) {
      reduced.push({ x: i, y: samples[i] });
    }

    const ys = reduced.map(p => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = ((maxY - minY) || Math.abs(maxY) || 1) * 0.1;
    const yMin = minY - pad;
    const yMax = maxY + pad;

    const points = reduced.map(({ x, y }) => {
      const scaledY = ((y - yMin) / (yMax - yMin + 1e-9)) * height;
      return `${x},${height - scaledY}`;
    }).join(' ');

    return {
      points,
      width: reduced.length > 0 ? reduced[reduced.length - 1].x || 1 : 1,
      min: minY,
      max: maxY
    };
  }, [samples, height, maxPoints]);

  if (!trace) {
    return <p className="subdued">No samples yet.</p>;
  }

  const marginLeft = 24;
  const marginBottom = 14;
  const innerWidth = Math.max(1, trace.width);
  const innerHeight = Math.max(1, height - marginBottom);

  const normalizedOverlays = overlays
    .filter(o => Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start)
    .map((o) => {
      const start = Math.max(0, Math.min(innerWidth, o.start));
      const end = Math.max(0, Math.min(innerWidth, o.end));
      return { ...o, start, end };
    });

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${innerWidth + marginLeft} ${height}`}
      preserveAspectRatio="none"
    >
      <g transform={`translate(${marginLeft}, 0)`}>
        {normalizedOverlays.map((o, idx) => (
          <rect
            key={`${o.start}-${o.end}-${idx}`}
            x={o.start}
            y="0"
            width={Math.max(1, o.end - o.start)}
            height={innerHeight}
            fill={o.color || '#f97316'}
            opacity={overlayAlpha}
          />
        ))}
        <polyline
          fill="none"
          stroke="#4ade80"
          strokeWidth="1.2"
          points={trace.points}
        />
        <line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      </g>
      <line x1={marginLeft} y1="0" x2={marginLeft} y2={innerHeight} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <text x="2" y="10" fill="rgba(255,255,255,0.6)" fontSize="10">{trace.max.toFixed(1)}</text>
      <text x="2" y={innerHeight - 2} fill="rgba(255,255,255,0.6)" fontSize="10">{trace.min.toFixed(1)}</text>
      <text x={marginLeft} y={height - 2} fill="rgba(255,255,255,0.6)" fontSize="10">time</text>
    </svg>
  );
}

export default EEGTraceChart;
