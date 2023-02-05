import React from 'react';
import DeviceControl from './DeviceControl';
import BandPower from './BandPower';
import TrainingControl from './TrainingControl';
import TrainingView from './TrainingView';
import BrainView from './BrainView';

import {  useState } from 'react';


function App() {
  const [eegData,setEEGData] = useState([]);

  function onPeriodgramUpdated(updatedEEGData) {
    setEEGData([...updatedEEGData]); // Likely too much data is copied
  }

  return (
    <div>
      <div>
        <div>
          <DeviceControl onPeriodgramUpdated={onPeriodgramUpdated}/>
        </div>
        <div>
          <BandPower eegData={eegData}/>
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
