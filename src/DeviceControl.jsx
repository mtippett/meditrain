import React, { useState, useEffect, useRef } from 'react';
import EEGChannels from './EEGChannels';
import MuseData from './MuseData';


function DeviceControl() {

    const eegChannelData = useRef([]);
    const channelMaps = useRef([]);
    const [triggerRender,setTriggerRender] = useState(0);

    function updateChannelMaps(maps) {
        if (channelMaps.current.length === 0) {
            console.log("setting maps",channelMaps,[...maps])
            channelMaps.current = maps;
            setTriggerRender(0)
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

        setTriggerRender(triggerRender+1)

    }





    console.log(" DeviceControl render", eegChannelData.current);

    return (
        <div>
            <div>
                DeviceControl
            </div>
            <div>
                <MuseData onNewData={onNewData} updateChannelMaps={updateChannelMaps} />
                <EEGChannels eegChannelData={eegChannelData.current}/>
            </div>
        </div>
    );
}

export default DeviceControl;
