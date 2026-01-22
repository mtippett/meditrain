import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

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

function BandPowerChart({ channel, negative = false, targets = [], durationSec }) {
  const colorMap = useMemo(() => ({
    alpha: '#f97316',
    beta: '#06b6d4',
    gamma: '#8b5cf6',
    delta: '#22c55e',
    theta: '#facc15'
  }), []);

  const bands = Object.keys(channel);
  const bandPoints = bands.length > 0 ? channel[bands[0]].length : 0;

  const svgRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(200);
  const height = 140;
  const margin = { top: 6, right: 8, bottom: 28, left: 36 };
  const innerHeight = height - margin.top - margin.bottom;

  useEffect(() => {
    if (!svgRef.current) return;
    if (bandPoints === 0 && targets.length === 0) return;

    const measuredWidth = svgRef.current.parentElement?.clientWidth || 200;
    if (measuredWidth !== plotWidth) {
      setPlotWidth(measuredWidth);
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const innerWidth = measuredWidth - margin.left - margin.right;
    const xScale = d3.scaleLinear()
      .domain([0, Math.max(1, bandPoints - 1)])
      .range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain([negative ? -1.0 : 0, 1.0]).range([innerHeight, 0]);

    // Targets behind lines
    const targetGroup = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    targets.forEach((t) => {
      const center = t.target;
      const tol = t.tolerance || 0;
      const y1 = yScale(Math.min(1, center + tol));
      const y2 = yScale(Math.max(negative ? -1 : 0, center - tol));
      targetGroup
        .append('rect')
        .attr('x', 0)
        .attr('width', innerWidth)
        .attr('y', y1)
        .attr('height', Math.max(0, y2 - y1))
        .attr('fill', colorMap[t.band] || '#fff')
        .attr('opacity', 0.12);
    });

    // Lines with gaps
    const lineGroup = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const line = d3
      .line()
      .x((d, i) => xScale(d._xIdx))
      .y(d => yScale(d.v));

    bands.forEach((band) => {
      const points = (channel[band] || []).map((v, i) => ({ v, _xIdx: i, _t: v && v.t ? v.t : null }));
      // If time info is available, use it to find gaps
      let segments;
      if (points.length > 0 && points[0]._t != null) {
        segments = splitByGaps(points, p => p._t, 2000); // 2s gap
      } else {
        segments = [points];
      }
      segments.forEach(seg => {
        if (seg.length < 2) return;
        lineGroup
          .append('path')
          .datum(seg)
          .attr('fill', 'none')
          .attr('stroke', colorMap[band] || '#fff')
          .attr('stroke-width', 1.5)
          .attr('d', line);
      });
    });

    // Axes
    const totalSeconds = durationSec || (bandPoints - 1);
    svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top + innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(4).tickFormat((d) => {
        const remaining = Math.max(0, totalSeconds * (1 - d / Math.max(1, bandPoints - 1)));
        return d >= bandPoints - 1 ? '0s' : `-${Math.round(remaining)}s`;
      }));

    svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`)
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('.1f')));
  }, [bandPoints, bands, channel, negative, colorMap, plotWidth, targets, innerHeight, margin.left, margin.right, margin.top]);

  return <svg ref={svgRef} width="100%" height={height} />;
}

export default BandPowerChart;
