import React, { useState } from 'react';
import EEGTraceChart from './EEGTraceChart'
import EEGPeriodogramChart from './EEGPeriodogramChart'

function EEGChannel({ channel }) {
    const [eegView, setEEGView] = useState(false);
    const [powerView, setPowerView] = useState(false);

    return (
        <div id={channel.electrode}>
            {channel.location.name} 
            {channel.electrode} {channel.samples.length}
            <button onClick={() => { console.log("Flipping EEGView"); setEEGView(!eegView) }}>Toggle EEG</button>
            {eegView &&
                <EEGTraceChart samples={channel.samples} />}
            {channel.periodograms.length > 0 && 
                    <button onClick={() => { console.log("Flipping PeriodogramView"); setPowerView(!powerView) }}>Toggle Periodograms</button> }
            { powerView &&
            
                    <EEGPeriodogramChart periodograms={channel.periodograms} averagedPeriodogram={channel.averagedPeriodogram}/>
            }
        </div>
    );
}

export default EEGChannel;
