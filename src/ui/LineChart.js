import React, { useMemo } from 'react';

function LineChart({
  series = [],
  bands = [],
  height = 140,
  width = 300,
  padding = { left: 32, right: 0, top: 0, bottom: 18 },
  xDomain,
  yDomain,
  showAxes = true,
  showLabels = true,
  xLabel = 'time',
  rectOverlays = [],
  emptyLabel = 'No samples to plot.',
  emptyLabelX = 8,
  emptyLabelY,
  yLabelFormatter = (value) => value.toFixed(0)
}) {
  const chart = useMemo(() => {
    const normalizedSeries = (series || []).filter(s => s && Array.isArray(s.points) && s.points.length > 0);
    const normalizedBands = (bands || []).filter(b => b && Array.isArray(b.points) && b.points.length > 0);
    const allPoints = [
      ...normalizedSeries.flatMap(s => s.points),
      ...normalizedBands.flatMap(b => b.points)
    ];
    if (allPoints.length === 0) {
      return { hasData: false };
    }

    const xValues = allPoints.map(p => p.x).filter(Number.isFinite);
    const yValues = allPoints.map(p => p.y).filter(Number.isFinite);
    if (xValues.length === 0 || yValues.length === 0) {
      return { hasData: false };
    }

    const xMin = xDomain?.min ?? Math.min(...xValues);
    const xMax = xDomain?.max ?? Math.max(...xValues);
    const yMinRaw = yDomain?.min ?? Math.min(...yValues);
    const yMaxRaw = yDomain?.max ?? Math.max(...yValues);
    const yPad = yDomain ? 0 : ((yMaxRaw - yMinRaw) || Math.abs(yMaxRaw) || 1) * 0.1;
    const yMin = yMinRaw - yPad;
    const yMax = yMaxRaw + yPad;

    const innerWidth = Math.max(1, width - padding.left - padding.right);
    const innerHeight = Math.max(1, height - padding.top - padding.bottom);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const scaleX = (value) => padding.left + ((value - xMin) / xRange) * innerWidth;
    const scaleY = (value) => padding.top + (1 - (value - yMin) / yRange) * innerHeight;

    return {
      hasData: true,
      innerWidth,
      innerHeight,
      xMin,
      xMax,
      yMin,
      yMax,
      scaleX,
      scaleY,
      normalizedSeries,
      normalizedBands
    };
  }, [bands, height, padding.bottom, padding.left, padding.right, padding.top, series, width, xDomain, yDomain]);

  if (!chart.hasData) {
    const labelY = emptyLabelY ?? height / 2;
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <text x={emptyLabelX} y={labelY} fill="rgba(255,255,255,0.5)" fontSize="10">{emptyLabel}</text>
      </svg>
    );
  }

  const axisY = padding.top + chart.innerHeight;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {(rectOverlays || []).map((o, idx) => {
        if (!Number.isFinite(o.start) || !Number.isFinite(o.end) || o.end <= o.start) return null;
        const xStart = Math.max(chart.xMin, Math.min(chart.xMax, o.start));
        const xEnd = Math.max(chart.xMin, Math.min(chart.xMax, o.end));
        const x = chart.scaleX(xStart);
        const w = Math.max(1, chart.scaleX(xEnd) - chart.scaleX(xStart));
        return (
          <rect
            key={o.id || `${o.start}-${o.end}-${idx}`}
            x={x}
            y={padding.top}
            width={w}
            height={chart.innerHeight}
            fill={o.color || '#f97316'}
            opacity={o.opacity ?? 0.2}
          />
        );
      })}
      {chart.normalizedBands.map((band, idx) => {
        const pointsAttr = band.points.map((p) => `${chart.scaleX(p.x)},${chart.scaleY(p.y)}`).join(' ');
        return (
          <polygon
            key={band.id || `band-${idx}`}
            fill={band.fill || 'rgba(248, 113, 113, 0.18)'}
            opacity={band.opacity ?? 1}
            points={pointsAttr}
          />
        );
      })}
      {chart.normalizedSeries.map((s, idx) => {
        const pointsAttr = s.points.map((p) => `${chart.scaleX(p.x)},${chart.scaleY(p.y)}`).join(' ');
        if (s.points.length === 1 && s.extend === 'x') {
          const y = chart.scaleY(s.points[0].y);
          return (
            <line
              key={s.id || `series-${idx}`}
              x1={padding.left}
              x2={padding.left + chart.innerWidth}
              y1={y}
              y2={y}
              stroke={s.stroke || '#4ade80'}
              strokeWidth={s.strokeWidth || 1.4}
              strokeDasharray={s.strokeDasharray}
              opacity={s.opacity ?? 1}
            />
          );
        }
        return (
          <polyline
            key={s.id || `series-${idx}`}
            fill="none"
            stroke={s.stroke || '#4ade80'}
            strokeWidth={s.strokeWidth || 1.4}
            strokeDasharray={s.strokeDasharray}
            opacity={s.opacity ?? 1}
            points={pointsAttr}
          />
        );
      })}
      {showAxes && (
        <>
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={axisY} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1={padding.left} y1={axisY} x2={padding.left + chart.innerWidth} y2={axisY} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        </>
      )}
      {showLabels && (
        <>
          <text x="4" y="10" fill="rgba(255,255,255,0.6)" fontSize="10">{yLabelFormatter(chart.yMax)}</text>
          <text x="4" y={axisY - 2} fill="rgba(255,255,255,0.6)" fontSize="10">{yLabelFormatter(chart.yMin)}</text>
          <text x={padding.left} y={height - 2} fill="rgba(255,255,255,0.6)" fontSize="10">{xLabel}</text>
        </>
      )}
    </svg>
  );
}

export default LineChart;
