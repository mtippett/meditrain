import React, { useMemo } from 'react';
import LineChart from './LineChart';

function TimeSeriesLineChart({ points = [], height = 140, windowSec = 300, stroke = '#4ade80' }) {
  const series = useMemo(() => {
    if (!points || points.length === 0) return null;
    const end = Date.now();
    const start = end - windowSec * 1000;
    const filtered = points.filter(p => p.t >= start && p.t <= end);
    if (filtered.length === 0) return null;
    const values = filtered.map(p => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = ((max - min) || Math.abs(max) || 1) * 0.1;
    return {
      start,
      end,
      values: filtered,
      yMin: min - pad,
      yMax: max + pad
    };
  }, [points, windowSec]);

  const marginLeft = 32;
  const marginBottom = 18;
  const viewWidth = marginLeft + windowSec;
  const tickFormatter = (value) => {
    if (!series) return '';
    const remaining = Math.max(0, Math.round((series.end - value) / 1000));
    return remaining === 0 ? 'now' : `-${remaining}s`;
  };

  return (
    <LineChart
      height={height}
      width={viewWidth}
      padding={{ left: marginLeft, right: 0, top: 0, bottom: marginBottom }}
      series={series ? [{
        id: 'primary',
        points: series.values.map(p => ({ x: p.t, y: p.v })),
        stroke,
        strokeWidth: 1.4
      }] : []}
      xDomain={series ? { min: series.start, max: series.end } : undefined}
      yDomain={series ? { min: series.yMin, max: series.yMax } : undefined}
      xTickCount={4}
      xTickFormatter={tickFormatter}
      xLabel=""
      emptyLabel="No samples to plot."
      yLabelFormatter={(value) => value.toFixed(0)}
    />
  );
}

export default TimeSeriesLineChart;
