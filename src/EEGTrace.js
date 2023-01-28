import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';

function EEGTrace({ samples }) {

    const svgRef = useRef(null);

    useEffect(() => {
        if (!svgRef.current) return;

        // d3.selectAll("svg > *").remove();
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();


        // Create scales for the x and y axes
        const xScale = d3.scaleLinear().domain([0, samples.length]).range([0, 500]);
        const yScale = d3.scaleLinear().domain([d3.min(samples), d3.max(samples)]).range([250, 0]);

        // Create the line generator
        const line = d3.line()
            .x((d, i) => xScale(i))
            .y(d => yScale(d))

        // Append the line path to the SVG
        svg.append('path')
            .datum(samples)
            .attr('fill', 'none')
            .attr('stroke', 'steelblue')
            .attr('stroke-width', 1)
            .attr('d', line);

        // Append the x and y axes to the SVG
        svg.append('g')
            .attr('transform', `translate(0, ${250})`)
            .call(d3.axisBottom(xScale));

        svg.append('g')
            .call(d3.axisLeft(yScale));
    }, [samples]);

    return <svg ref={svgRef} width={500} height={250} />;
}

export default EEGTrace;
