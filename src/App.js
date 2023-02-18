import React from 'react';
import DeviceControl from './DeviceControl';
import BandPower from './BandPower';
import TrainingControl from './TrainingControl';
import TrainingView from './TrainingView';
import BrainView from './BrainView';

import { useState } from 'react';


function App() {
  const [eegData, setEEGData] = useState([]);
  const [channelMaps, setChannelMaps] = useState([]);



  function onPeriodgramUpdated(updatedEEGData) {
    setEEGData([...updatedEEGData]); // Likely too much data is copied
  }

  function onChannelMapsUpdated(channelMaps) {
    setChannelMaps([...channelMaps]); // Likely too much data is copied
  }

  function onBandPowerUpdated(bandPowerData) {
    console.log("obpu", bandPowerData)
  }


  return (
    <div>
      <div>
        <div>
          <DeviceControl onPeriodgramUpdated={onPeriodgramUpdated} />
        </div>
        <div>
          <BandPower onBandPowerUpdated={onBandPowerUpdated} eegData={eegData} />
          <BrainView />
        </div>
      </div>
      <div>
        <TrainingView />
        <TrainingControl />
      </div>
    </div>
  );
}

export default App;
