import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

function EEGPeriodogram({ periodograms, averagedPeriodogram }) {
    const svgRef = useRef(null);

    useEffect(() => {
        if (!svgRef.current) return;

        // d3.selectAll("svg > *").remove();
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // Create scales for the x and y axes
        const xScale = d3.scaleLinear().domain([0, d3.max(averagedPeriodogram.frequencies)]).range([0, 100]);
        const yScale = d3.scaleLinear().domain([0, d3.max(averagedPeriodogram.magnitudes)]).range([50, 0]);

        // Create the line generator
        const line = d3.line()
            .x((d, i) => xScale(i))
            .y(d => yScale(d))

        // console.log("e",periodograms);
        // Append the line path to the SVG
        periodograms.forEach(periodogram => {
            svg.append('path')
                .datum(periodogram.magnitudes)
                .attr('fill', 'none')
                .attr('stroke', 'lightblue')
                .attr('stroke-width', 1)
                .attr('d', line);
        })

        svg.append('path')
            .datum(averagedPeriodogram.magnitudes)
            .attr('fill', 'none')
            .attr('stroke', 'red')
            .attr('stroke-width', 2)
            .attr('d', line);

        // Append the x and y axes to the SVG
        svg.append('g')
            .attr('transform', `translate(0, ${250})`)
            .call(d3.axisBottom(xScale));

        svg.append('g')
            .call(d3.axisLeft(yScale));
    }, [periodograms, averagedPeriodogram]);

    return <svg ref={svgRef} width={100} height={50} />;
}

export default EEGPeriodogram;
