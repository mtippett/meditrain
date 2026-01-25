import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

/**
 * Renders multiple EEG traces in a single chart.
 * Each channel is normalized independently and vertically separated for clarity.
 */
function MultiEEGTraceChart({
  channels = [],
  windowSize = 4096,
  height = 220,
  sampleRate = 256,
  badLabels = [],
  autoHeight = false
}) {
  const svgRef = useRef(null);
  const [plotHeight, setPlotHeight] = useState(height);
  const effectiveSampleRate = sampleRate; // Hz

  useEffect(() => {
    if (!autoHeight) {
      setPlotHeight(height);
    }
  }, [height, autoHeight]);

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
    if (!svgRef.current || !autoHeight) return;
    const parent = svgRef.current.parentElement;
    if (!parent) return;

    const updateSize = () => {
      const svgBox = svgRef.current?.getBoundingClientRect();
      const parentBox = parent.getBoundingClientRect();
      const svgHeight = svgBox?.height || 0;
      const measuredHeight = svgHeight || parentBox.height || height;
      if (measuredHeight !== plotHeight) {
        setPlotHeight(measuredHeight);
      }
    };

    updateSize();

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateSize());
      observer.observe(svgRef.current);
      observer.observe(parent);
    } else {
      window.addEventListener('resize', updateSize);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', updateSize);
      }
    };
  }, [plotHeight, autoHeight, height]);

  useEffect(() => {
    if (!svgRef.current || series.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const marginLeft = 28;
    const marginBottom = 20;
    const viewWidth = marginLeft + windowSize;
    const innerHeight = plotHeight - marginBottom;
    const bandHeight = innerHeight / series.length;
    series.forEach((s, idx) => {
      const yOffset = idx * bandHeight;
      const isBad = badLabels.includes(s.id);
      const xScale = d3.scaleLinear().domain([0, windowSize]).range([0, viewWidth - marginLeft]);
      const yScale = d3.scaleLinear().domain([s.min, s.max]).range([bandHeight, 0]);
      const line = d3.line()
        .x((d, i) => marginLeft + xScale(i))
        .y(d => yOffset + yScale(d));

      svg.append('path')
        .datum(s.samples)
        .attr('fill', 'none')
        .attr('stroke', isBad ? '#f97316' : s.color)
        .attr('stroke-width', 1.2)
        .attr('d', line);

      svg.append('text')
        .attr('x', 4)
        .attr('y', yOffset + 12)
        .attr('fill', isBad ? '#fbbf24' : 'rgba(255,255,255,0.7)')
        .attr('font-size', 10)
        .text(isBad ? `${s.id} (bad)` : s.id);
    });

    // time scale
    const durationSec = windowSize / effectiveSampleRate;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const x = marginLeft + t * (viewWidth - marginLeft);
      const label = `-${Math.round((1 - t) * durationSec)}s`;
      svg.append('text')
        .attr('x', x)
        .attr('y', plotHeight - 4)
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
      .attr('x2', viewWidth)
      .attr('y2', innerHeight)
      .attr('stroke', 'rgba(255,255,255,0.35)')
      .attr('stroke-width', 1);
  }, [series, plotHeight, windowSize, effectiveSampleRate, badLabels]);

  if (series.length === 0) {
    return <p className="subdued">No samples to plot.</p>;
  }

  const viewBoxWidth = 28 + windowSize;
  return (
    <svg
      ref={svgRef}
      width="100%"
      height={plotHeight}
      viewBox={`0 0 ${viewBoxWidth} ${plotHeight}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%' }}
    />
  );
}

export default MultiEEGTraceChart;
