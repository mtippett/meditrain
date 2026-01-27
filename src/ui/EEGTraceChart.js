import React, { useMemo } from 'react';
import LineChart from './LineChart';

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

    return {
      points: reduced,
      width: reduced.length > 0 ? reduced[reduced.length - 1].x || 1 : 1,
      min: Math.min(...reduced.map(p => p.y)),
      max: Math.max(...reduced.map(p => p.y))
    };
  }, [samples, maxPoints]);

  if (!trace) {
    return <p className="subdued">No samples yet.</p>;
  }

  const marginLeft = 24;
  const marginBottom = 14;
  const innerWidth = Math.max(1, trace.width);

  return (
    <LineChart
      height={height}
      width={innerWidth + marginLeft}
      padding={{ left: marginLeft, right: 0, top: 0, bottom: marginBottom }}
      series={[{
        id: 'trace',
        points: trace.points,
        stroke: '#4ade80',
        strokeWidth: 1.2
      }]}
      rectOverlays={(overlays || []).map((o, idx) => ({
        id: o.id || `${o.start}-${o.end}-${idx}`,
        start: o.start,
        end: o.end,
        color: o.color,
        opacity: overlayAlpha
      }))}
      xDomain={{ min: 0, max: innerWidth }}
      showAxes
      showLabels
      yLabelFormatter={(value) => value.toFixed(1)}
      emptyLabel="No samples yet."
    />
  );
}

export default EEGTraceChart;
