import React, { useState, useEffect } from 'react';
import { MuseClient } from 'muse-js';
import EEGChannel from './EEGChannel';

function MuseData() {
  const [eegData, setEegData] = useState([]);
  const [channels, setChannels] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const muse = new MuseClient();

  useEffect(() => {
    async function connectToMuse() {
      setIsConnecting(true);
      muse.enableAux = true;
      await muse.connect();
      setIsConnected(true);
      setIsConnecting(false);
      muse.eegReadings.subscribe(data => {
        setEegData(data);
      });
      muse.start();
    }
    if (isConnecting) {
      connectToMuse();
    }
  }, [isConnecting]);

  channels[eegData.electrode] = <EEGChannel key={eegData.electrode} channel={eegData.electrode} newSamples={eegData.samples}/>;

  return (
    <div>
      {!isConnected && !isConnecting && <button onClick={() => setIsConnecting(true)}>Connect to Muse</button>}
      {isConnecting && <p>Connecting to Muse...</p>}
      {isConnected && channels.map((channel, index) => {
        return channel;
      })}
    </div>
  );
}

export default MuseData;
