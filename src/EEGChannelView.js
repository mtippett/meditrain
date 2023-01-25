import React, { useState, useEffect, useRef } from 'react';
import Chart from 'react-apexcharts'


function EEGChannelView({ channel, samples }) {
    
    // const chart = {
    //     options: {
    //         chart: {
    //             id: "basic-bar",
    //             animations: {
    //                 enabled: false
    //             }
    //         }
    //     },
    //     series: [
    //         {
    //             name: "series-1",
    //             data: samples
    //         }
    //     ]
    // }
    
    return (
        <div key={channel}>
            <h3>{channel}</h3>
            <p>{samples.length}</p>
            <div>
                {/* <Chart options={chart.options} series={chart.series} height={500} /> */}
            </div>

        </div>
    );
}

export default EEGChannelView;
