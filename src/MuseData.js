import React, { useState, useEffect,useRef } from 'react';
import { MuseClient } from 'muse-js';
// import EEGChannel from './EEGChannel';

function MuseData({ onNewData,updateChannelMaps }) {
  // const [eegData, setEegData] = useState([]);
  // const [channels, setChannels] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const muse = useRef(new MuseClient());
  // const channels = useRef([]);

  useEffect(() => {
    async function connectToMuse() {
      setIsConnecting(true);
      muse.current.enableAux = true;
      await muse.current.connect();
      setIsConnected(true);
      setIsConnecting(false);
      muse.current.eegReadings.subscribe(data => {
        onNewData(data);
      });
      updateChannelMaps(["TP9","AF7","AF8","TP10","AUXL","AUXR"]);
      muse.current.start();
    }
    if (isConnecting) {
      connectToMuse();
    }
  }, [isConnecting,onNewData,updateChannelMaps ]);


  return (
    <div>
      {!isConnected && !isConnecting && <button onClick={() => setIsConnecting(true)}>Connect to Muse</button>}
      {isConnecting && <p>Connecting to Muse...</p>}
      {isConnected &&
        <p>Connected to EEG </p>
      }
    </div>
  );
}

export default MuseData;
