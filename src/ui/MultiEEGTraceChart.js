import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

/**
 * Renders multiple EEG traces in a single chart.
 * Each channel is normalized independently and vertically separated for clarity.
 */
function MultiEEGTraceChart({ channels = [], windowSize = 4096, height = 220 }) {
  const svgRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(400);
  const sampleRate = 256; // Hz

  const series = useMemo(() => {
    const colors = d3.schemeTableau10;
    return channels
      .filter(c => c.samples && c.samples.length > 0)
      .map((c, idx) => {
        const samples = c.samples.slice(-windowSize);
        const min = d3.min(samples);
        const max = d3.max(samples);
        const pad = ((max - min) || Math.abs(max) || 1) * 0.1;
        return {
          id: c.label || c.electrode,
          color: colors[idx % colors.length],
          samples,
          min: min - pad,
          max: max + pad
        };
      });
  }, [channels, windowSize]);

  useEffect(() => {
    if (!svgRef.current) return;
    const measuredWidth = svgRef.current.parentElement?.clientWidth || plotWidth;
    if (measuredWidth !== plotWidth) {
      setPlotWidth(measuredWidth);
    }
  }, [plotWidth]);

  useEffect(() => {
    if (!svgRef.current || series.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const marginLeft = 28;
    const marginBottom = 20;
    const innerHeight = height - marginBottom;
    const bandHeight = innerHeight / series.length;
    series.forEach((s, idx) => {
      const yOffset = idx * bandHeight;
      const xScale = d3.scaleLinear().domain([0, s.samples.length]).range([0, plotWidth - marginLeft]);
      const yScale = d3.scaleLinear().domain([s.min, s.max]).range([bandHeight, 0]);
      const line = d3.line()
        .x((d, i) => marginLeft + xScale(i))
        .y(d => yOffset + yScale(d));

      svg.append('path')
        .datum(s.samples)
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 1.2)
        .attr('d', line);

      svg.append('text')
        .attr('x', 4)
        .attr('y', yOffset + 12)
        .attr('fill', 'rgba(255,255,255,0.7)')
        .attr('font-size', 10)
        .text(s.id);
    });

    // time scale
    const durationSec = windowSize / sampleRate;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const x = marginLeft + t * (plotWidth - marginLeft);
      const label = `-${Math.round((1 - t) * durationSec)}s`;
      svg.append('text')
        .attr('x', x)
        .attr('y', height - 4)
        .attr('fill', 'rgba(255,255,255,0.6)')
        .attr('font-size', 10)
        .attr('text-anchor', i === ticks ? 'end' : i === 0 ? 'start' : 'middle')
        .text(i === ticks ? '0s' : label);
    }

    svg.append('line')
      .attr('x1', marginLeft)
      .attr('y1', 0)
      .attr('x2', marginLeft)
      .attr('y2', innerHeight)
      .attr('stroke', 'rgba(255,255,255,0.35)')
      .attr('stroke-width', 1);

    svg.append('line')
      .attr('x1', marginLeft)
      .attr('y1', innerHeight)
      .attr('x2', plotWidth)
      .attr('y2', innerHeight)
      .attr('stroke', 'rgba(255,255,255,0.35)')
      .attr('stroke-width', 1);
  }, [series, height, plotWidth, windowSize, sampleRate]);

  if (series.length === 0) {
    return <p className="subdued">No samples to plot.</p>;
  }

  return <svg ref={svgRef} width="100%" height={height} />;
}

export default MultiEEGTraceChart;
