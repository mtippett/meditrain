import React, { useState, useEffect, useRef } from 'react';
import EEGChannels from './EEGChannels';
import MuseData from './MuseData';


function DeviceControl() {

    const eegChannelData = useRef([]);
    const channelMaps = useRef([]);

    const [updater, setUpdater] = useState(0);
    const [viewEEG, setViewEEG] = useState(false)
    const eegInterval = useRef(0);

    useEffect(
        () => {
            if (viewEEG) {
                eegInterval.current =
                    setInterval(() => {
                        setUpdater(updater + 1);
                    }, 100);

                return function cleanup() {
                    clearInterval(eegInterval.current);
                };
            }
        },
        [updater,viewEEG]
    );

    function updateChannelMaps(maps) {
        if (channelMaps.current.length === 0) {
            console.log("setting maps", channelMaps, [...maps])
            channelMaps.current = maps;
        }
    }

    function onNewData(data) {
        // console.log(data);
        let currentChannel = eegChannelData.current[data.electrode];
        if (typeof currentChannel === 'undefined') {
            eegChannelData.current[data.electrode] =
            {
                electrode: data.electrode,
                location: channelMaps.current[data.electrode],
                samples: []
            }
        }

        eegChannelData.current[data.electrode].samples.push(...data.samples);


    }

    return (
        <div>
            <div>
                DeviceControl
            </div>
            <div>
                <MuseData onNewData={onNewData} updateChannelMaps={updateChannelMaps} />
                <button onClick={() => setViewEEG(!viewEEG)}>View EEG Data</button>
                {viewEEG &&
                    <EEGChannels eegChannelData={eegChannelData.current} />
                }
            </div>
        </div>
    );
}

export default DeviceControl;
