import React, { useState, useEffect, useRef } from 'react';
import Chart from 'react-apexcharts';
import EEGChannel from './EEGChannel';

function EEGChannelView({ eegChannelData }) {

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
    console.log("EEGChannelsRender",eegChannelData)

    return (
        <div >
            <div>
                EEGChannels
                {eegChannelData.map((channel) => {
                    // console.log("map",channel.electrode, channel.name);
                    <>
                    <p> {channel.location} {channel.electrode} </p>
                    <EEGChannel channel={channel} />
                    </>
                })}

            </div>

        </div>
    );
}

export default EEGChannelView;
