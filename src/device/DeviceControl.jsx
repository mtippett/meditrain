import React, { useState, useEffect, useRef } from 'react';
import EEGChannels from '../EEGChannels';
import MuseData from '../MuseData';
import {averagedPeriodogram,calcPeriodogram} from '../math/Periodogram.js'

function DeviceControl({ onPeriodgramUpdated }) {

    const eegChannelData = useRef([]);
    const channelMaps = useRef([]);

    const [updater, setUpdater] = useState(0);
    const [viewEEG, setViewEEG] = useState(false)
    const eegInterval = useRef(0);
    const powerInterval = useRef(0);


    useEffect(
        () => {
            if (powerInterval.current === 0 && channelMaps.current.length !== 0) {

                powerInterval.current = setInterval(() => {
                    eegChannelData.current.forEach(electrode => {
                        if (electrode.samples.length > 1024) {
                            electrode.periodograms.push(calcPeriodogram(electrode.samples.slice(-1024)));
                            electrode.periodograms = electrode.periodograms.slice(-4);
                            electrode.averagedPeriodogram = averagedPeriodogram(electrode.periodograms);

                        }
                    });
                    // console.log("ue");
                    onPeriodgramUpdated(eegChannelData.current);
                }, 1000);
            }
            if (viewEEG) {
                eegInterval.current = setInterval(() => {
                    setUpdater(updater + 1);
                }, 100);
            }
            return function cleanup() {
                clearInterval(eegInterval.current);
            };

        },
        [updater, viewEEG]
    );

    function updateChannelMaps(maps) {
        if (channelMaps.current.length === 0) {

            channelMaps.current = [...maps];
            console.log("maps", maps, channelMaps);
            // maps.forEach(map => {
            //     channelMaps.current.push(electrodeMap_10_10[map])
            // });

            setUpdater(updater + 1);
        }
    }



    function onNewData(data) {
        // console.log(data);
        let currentChannel = eegChannelData.current[data.electrode];
        if (typeof currentChannel === 'undefined') {
            eegChannelData.current[data.electrode] =
            {
                electrode: data.electrode,
                // location: channelMaps.current[data.electrode],
                samples: [],
                periodograms: []
            }
        }

        // console.log("onNewData", data);

        const samples = eegChannelData.current[data.electrode].samples
        samples.push(...data.samples);
        eegChannelData.current[data.electrode].samples = samples.slice(-4096)

    }

  
    return (
        <div>
            <div>
                DeviceControl
            </div>
            <div>
                <MuseData onNewData={onNewData} updateChannelMaps={updateChannelMaps} />
                {channelMaps.current.length !== 0 &&
                    <button onClick={() => setViewEEG(!viewEEG)}>{viewEEG ? "Hide" : "View"} EEG Data</button>
                }
                {viewEEG &&
                    <EEGChannels eegChannelData={eegChannelData.current} />
                }
            </div>
        </div>
    );
}


export default DeviceControl;
