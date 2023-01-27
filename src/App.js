import React from 'react';
import DeviceControl from './DeviceControl';
import BandPower from './BandPower';
import TrainingControl from './TrainingControl';
import TrainingView from './TrainingView';
import BrainView from './BrainView';


function App() {
  return (
    <div>
      <div>
        <div>
          <DeviceControl />
        </div>
        <div>
          <BandPower />
          <TrainingControl />
        </div>
      </div>
      <div>
        <TrainingView />
        <BrainView />
      </div>
    </div>
  );
}

export default App;
