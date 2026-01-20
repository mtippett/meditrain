import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

function BandPowerChart({ channel, negative = false }) {
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

  useEffect(() => {
    if (!svgRef.current || bandPoints === 0) return;

    const measuredWidth = svgRef.current.parentElement?.clientWidth || 200;
    if (measuredWidth !== plotWidth) {
      setPlotWidth(measuredWidth);
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const xScale = d3.scaleLinear().domain([0, bandPoints - 1]).range([0, measuredWidth]);
    const yScale = d3.scaleLinear().domain([negative ? -1.0 : 0, 1.0]).range([100, 0]);

    const line = d3
      .line()
      .x((d, i) => xScale(i))
      .y(d => yScale(d));

    bands.forEach((band) => {
      svg
        .append('path')
        .datum(channel[band])
        .attr('fill', 'none')
        .attr('stroke', colorMap[band] || '#fff')
        .attr('stroke-width', 1.5)
        .attr('d', line);
    });

    svg
      .append('g')
      .attr('transform', `translate(0, ${100})`)
      .call(d3.axisBottom(xScale).ticks(4).tickFormat(() => ''));

    svg
      .append('g')
      .call(d3.axisLeft(yScale).ticks(3));
  }, [bandPoints, bands, channel, negative, colorMap, plotWidth]);

  return <svg ref={svgRef} width="100%" height={100} />;
}

export default BandPowerChart;
