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

function BandPowerChart({ channel, negative = false, targets = [], targetHistory = {}, durationSec, height = 140 }) {
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
  const chartHeight = height;
  const margin = { top: 6, right: 8, bottom: 28, left: 36 };
  const innerHeight = chartHeight - margin.top - margin.bottom;

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
    const hasTime = bands.some((band) => (channel[band] || []).some(p => p && typeof p === 'object' && p.t != null));
    const timeExtent = hasTime
      ? d3.extent(
        bands.flatMap((band) =>
          (channel[band] || []).map((point) => (point && typeof point === 'object' ? point.t : null)).filter(v => v != null)
        )
      )
      : null;
    const timeMax = timeExtent ? timeExtent[1] : null;
    const xScale = hasTime && timeExtent && timeExtent[0] != null && timeExtent[1] != null
      ? d3.scaleTime().domain(timeExtent.map(t => new Date(t))).range([0, innerWidth])
      : d3.scaleLinear().domain([0, Math.max(1, bandPoints - 1)]).range([0, innerWidth]);
    const targetValues = targets.flatMap(t => {
      const tol = t.tolerance || 0;
      return [t.target - tol, t.target + tol];
    });
    const historyValues = Object.values(targetHistory || {}).flatMap((entries) => (
      Array.isArray(entries)
        ? entries.flatMap((e) => {
          const tol = e?.tolerance || 0;
          return [e?.target - tol, e?.target + tol];
        })
        : []
    ));
    const historySensitivity = Object.values(targetHistory || {}).flatMap((entries) => (
      Array.isArray(entries)
        ? entries.map((e) => (typeof e?.sensitivity === 'number' ? e.sensitivity : null)).filter(v => v != null)
        : []
    ));
    const seriesValues = bands.flatMap((band) =>
      (channel[band] || []).map((point) => {
        if (point && typeof point === 'object') return point.v;
        return point;
      })
    );
    const allValues = [...seriesValues, ...targetValues, ...historyValues]
      .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const valueMin = allValues.length ? Math.min(...allValues) : null;
    const valueMax = allValues.length ? Math.max(...allValues) : null;
    const baseMin = negative ? -1.0 : 0;
    const baseMax = 1.0;
    const yMin = Math.min(baseMin, valueMin != null ? valueMin : baseMin);
    const yMax = Math.max(baseMax, valueMax != null ? valueMax : baseMax);
    const padding = (yMax - yMin) * 0.08;
    const yScale = d3
      .scaleLinear()
      .domain([yMin - padding, yMax + padding])
      .range([innerHeight, 0]);

    // Targets behind lines (current window)
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

    // Target history (tolerance over time)
    if (hasTime && timeExtent && Object.keys(targetHistory || {}).length > 0) {
      const historyGroup = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      Object.entries(targetHistory).forEach(([band, entries]) => {
        if (!Array.isArray(entries) || entries.length < 2) return;
        const sorted = [...entries].filter(e => e && e.t != null).sort((a, b) => a.t - b.t);
        if (sorted.length < 2) return;
        const area = d3.area()
          .x(d => xScale(new Date(d.t)))
          .y0(d => yScale(d.target - (d.tolerance || 0)))
          .y1(d => yScale(d.target + (d.tolerance || 0)));
        const line = d3.line()
          .x(d => xScale(new Date(d.t)))
          .y(d => yScale(d.target));
        historyGroup
          .append('path')
          .datum(sorted)
          .attr('fill', colorMap[band] || '#fff')
          .attr('opacity', 0.18)
          .attr('d', area);
        historyGroup
          .append('path')
          .datum(sorted)
          .attr('fill', 'none')
          .attr('stroke', colorMap[band] || '#fff')
          .attr('stroke-width', 1)
          .attr('opacity', 0.5)
          .attr('d', line);
      });
    }

    if (hasTime && historySensitivity.length > 0) {
      const minSens = Math.min(...historySensitivity);
      const maxSens = Math.max(...historySensitivity);
      const sensPadding = Math.max(0.05, (maxSens - minSens) * 0.2);
      const yScaleSens = d3
        .scaleLinear()
        .domain([minSens - sensPadding, maxSens + sensPadding])
        .range([innerHeight, 0]);
      const sensGroup = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      Object.entries(targetHistory).forEach(([band, entries]) => {
        if (!Array.isArray(entries) || entries.length < 2) return;
        const sorted = [...entries].filter(e => e && e.t != null && typeof e.sensitivity === 'number')
          .sort((a, b) => a.t - b.t);
        if (sorted.length < 2) return;
        const line = d3.line()
          .x(d => xScale(new Date(d.t)))
          .y(d => yScaleSens(d.sensitivity));
        sensGroup
          .append('path')
          .datum(sorted)
          .attr('fill', 'none')
          .attr('stroke', colorMap[band] || '#fff')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4 3')
          .attr('opacity', 0.7)
          .attr('d', line);
      });
      svg.append('g')
        .attr('transform', `translate(${margin.left + innerWidth}, ${margin.top})`)
        .call(d3.axisRight(yScaleSens).ticks(3));
      svg.append('text')
        .attr('x', margin.left + innerWidth + 6)
        .attr('y', margin.top + 10)
        .attr('fill', 'rgba(255,255,255,0.6)')
        .attr('font-size', 10)
        .text('Sens');
    }

    // Lines with gaps
    const lineGroup = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const line = d3
      .line()
      .x((d, i) => (hasTime && d._t != null ? xScale(new Date(d._t)) : xScale(d._xIdx)))
      .y(d => yScale(d.v));

    bands.forEach((band) => {
      const points = (channel[band] || []).map((point, i) => {
        if (point && typeof point === 'object') {
          return { v: point.v, _xIdx: i, _t: point.t ?? null };
        }
        return { v: point, _xIdx: i, _t: null };
      });
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
    const axis = hasTime && timeMax
      ? d3.axisBottom(xScale).ticks(4).tickFormat((d) => {
        const remaining = Math.max(0, (timeMax - new Date(d).getTime()) / 1000);
        return remaining === 0 ? '0s' : `-${Math.round(remaining)}s`;
      })
      : d3.axisBottom(xScale).ticks(4).tickFormat((d) => {
        const remaining = Math.max(0, totalSeconds * (1 - d / Math.max(1, bandPoints - 1)));
        return d >= bandPoints - 1 ? '0s' : `-${Math.round(remaining)}s`;
      });
    svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top + innerHeight})`)
      .call(axis);

    svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`)
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('.1f')));
  }, [
    bandPoints,
    bands,
    channel,
    negative,
    colorMap,
    plotWidth,
    targets,
    targetHistory,
    durationSec,
    innerHeight,
    margin.left,
    margin.right,
    margin.top
  ]);

  return <svg ref={svgRef} width="100%" height={chartHeight} />;
}

export default BandPowerChart;
