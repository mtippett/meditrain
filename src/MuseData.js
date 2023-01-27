import React, { useState, useEffect, useRef } from 'react';
import { MuseClient } from 'muse-js';
// import EEGChannel from './EEGChannel';

function MuseData({ onNewData,updateChannelMaps }) {
  // const [eegData, setEegData] = useState([]);
  // const [channels, setChannels] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const muse = new MuseClient();
  // const channels = useRef([]);

  useEffect(() => {
    async function connectToMuse() {
      setIsConnecting(true);
      muse.enableAux = true;
      await muse.connect();
      setIsConnected(true);
      setIsConnecting(false);
      muse.eegReadings.subscribe(data => {
        // if (channels.indexOf(data.electrode) < 0) {
        //   console.log("adding data",data.electrode);
        //   setChannels(channels => [...channels, data.electrode])
        // }

        onNewData(data);
      });
      updateChannelMaps(["TP9","AF7","AF8","TP10","AUXL","AUXR"]);
      muse.start();
    }
    if (isConnecting) {
      connectToMuse();
    }
  }, [isConnecting]);


  console.log(" MuseData render");
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
