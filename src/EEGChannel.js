import React, { useState } from 'react';
import EEGTrace from './EEGTrace'
import EEGPeriodogram from './EEGPeriodogram'

function EEGChannel({ channel }) {
    const [eegView, setEEGView] = useState(false);
    const [powerView, setPowerView] = useState(false);

    return (
        <div id={channel.electrode}>
            {channel.location} {channel.electrode} {channel.samples.length}
            <button onClick={() => { console.log("Flipping EEGView"); setEEGView(!eegView) }}>Toggle EEG</button>
            {eegView &&
                <EEGTrace samples={channel.samples} />}
            {channel.periodograms.length > 0 && 
                    <button onClick={() => { console.log("Flipping PeriodogramView"); setPowerView(!powerView) }}>Toggle Periodograms</button> }
            { powerView &&
            
                    <EEGPeriodogram periodograms={channel.periodograms} averagedPeriodogram={channel.averagedPeriodograms}/>
            }
        </div>
    );
}

export default EEGChannel;
