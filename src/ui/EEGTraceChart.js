import React, { useMemo } from 'react';

/**
 * Lightweight EEG trace renderer.
 * - Uses a simple SVG polyline (no D3 dependency).
 * - Automatically downsamples large arrays for performance.
 * - Scales to the parent width via viewBox; height is explicit.
 */
function EEGTraceChart({ samples = [], height = 80, maxPoints = 800 }) {
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
      width: reduced.length > 0 ? reduced[reduced.length - 1].x || 1 : 1
    };
  }, [samples, height, maxPoints]);

  if (!trace) {
    return <p className="subdued">No samples yet.</p>;
  }

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${trace.width} ${height}`}
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="#4ade80"
        strokeWidth="1.2"
        points={trace.points}
      />
    </svg>
  );
}

export default EEGTraceChart;
