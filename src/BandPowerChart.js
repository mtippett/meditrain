import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

function BandPowerChart({ channel,negative=false }) {
    const colorMap = {
        alpha: "red",
        beta: "orange", 
        gamma: "blue", 
        delta: "green", 
        theta: "purple"
    }

    const bands = Object.keys(channel);
    let bandPoints = 10; 

    if(bands.length > 0 ) 
        bandPoints = channel[bands[0]].length;

    const svgRef = useRef(null);

    useEffect(() => {
        if (!svgRef.current) return;

        // d3x.selectAll("svg > *").remove();
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();


        // Create scales for the x and y axes
        const xScale = d3.scaleLinear().domain([0, bandPoints]).range([0, 200]);
        const yScale = d3.scaleLinear().domain([negative?-1.0:0, 1.0]).range([100, 0]);

        // Create the line generator
        const line = d3.line()
            .x((d, i) => xScale(i))
            .y(d => yScale(d))

        // extract keys
        const bandNames = Object.keys(channel);

        bandNames.forEach((band, index) => {
            // Append the line path to the SVG
            svg.append('path')
                .datum(channel[band])
                .attr('fill', 'none')
                .attr('stroke', colorMap[band])
                .attr('stroke-width', 1)
                .attr('d', line);
        });

        // Append the x and y axes to the SVG
        svg.append('g')
            .attr('transform', `translate(0, ${100})`)
            .call(d3.axisBottom(xScale));

        svg.append('g')
            .call(d3.axisLeft(yScale));
    }, []);

    return <svg ref={svgRef} width={200} height={100} />;
}

export default BandPowerChart;
