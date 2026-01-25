import React, { useMemo } from 'react';

function TimeSeriesLineChart({ points = [], height = 140, windowSec = 300, stroke = '#4ade80' }) {
  const series = useMemo(() => {
    if (!points || points.length < 2) return null;
    const end = points[points.length - 1].t || Date.now();
    const start = end - windowSec * 1000;
    const filtered = points.filter(p => p.t >= start && p.t <= end);
    if (filtered.length < 2) return null;
    const values = filtered.map(p => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = ((max - min) || Math.abs(max) || 1) * 0.1;
    return {
      start,
      end,
      values: filtered,
      min: min - pad,
      max: max + pad
    };
  }, [points, windowSec]);

  if (!series) {
    return <p className="subdued">No samples to plot.</p>;
  }

  const marginLeft = 32;
  const marginBottom = 18;
  const viewWidth = marginLeft + windowSec;
  const innerHeight = Math.max(1, height - marginBottom);
  const windowMs = series.end - series.start || 1;
  const range = series.max - series.min || 1;

  const pointsAttr = series.values.map((p) => {
    const x = marginLeft + ((p.t - series.start) / windowMs) * (viewWidth - marginLeft);
    const y = innerHeight - ((p.v - series.min) / range) * innerHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${viewWidth} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%' }}
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        points={pointsAttr}
      />
      <line x1={marginLeft} y1="0" x2={marginLeft} y2={innerHeight} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <line x1={marginLeft} y1={innerHeight} x2={viewWidth} y2={innerHeight} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <text x="4" y="10" fill="rgba(255,255,255,0.6)" fontSize="10">{series.max.toFixed(0)}</text>
      <text x="4" y={innerHeight - 2} fill="rgba(255,255,255,0.6)" fontSize="10">{series.min.toFixed(0)}</text>
      <text x={marginLeft} y={height - 2} fill="rgba(255,255,255,0.6)" fontSize="10">time</text>
    </svg>
  );
}

export default TimeSeriesLineChart;
