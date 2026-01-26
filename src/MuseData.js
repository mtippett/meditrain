import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MuseClient } from 'muse-js';

/**
 * Handles Muse connection with simple lifecycle:
 * - Creates a fresh client for each connect attempt.
 * - Cleans up subscriptions/listeners on disconnect or errors.
 * - Surfaces status and allows manual reconnects.
 */
const MuseData = React.forwardRef(function MuseData(
  { onNewData, updateChannelMaps, onTelemetry, onPpg, onAccelerometer, onGyro, onStatusChange },
  ref
) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const clientRef = useRef(null);
  const subRef = useRef([]);

  async function safeDisconnect() {
    setTelemetry(null);
    try {
      if (clientRef.current?.device && clientRef.current._onDisconnect) {
        clientRef.current.device.removeEventListener('gattserverdisconnected', clientRef.current._onDisconnect);
      }
    } catch (e) {
      // ignore
    }
    try {
      subRef.current.forEach(sub => sub?.unsubscribe?.());
    } catch (e) {
      // ignore
    }
    subRef.current = [];
    try {
      await clientRef.current?.disconnect();
    } catch (e) {
      // ignore
    }
    clientRef.current = null;
  }

  async function connect() {
    if (isConnecting) return;
    setIsConnecting(true);
    setError(null);

    const client = new MuseClient();
    clientRef.current = client;

    try {
      client.enableAux = true;
      client.enablePpg = true; // surface all supported streams
      await client.connect();

      // Attach disconnect handler bound to this client
      const onDisconnect = () => {
        setIsConnected(false);
        setIsConnecting(false);
        setError('Device disconnected');
        safeDisconnect();
      };
      client._onDisconnect = onDisconnect;
      client.device?.addEventListener('gattserverdisconnected', onDisconnect);

      subRef.current = [];
      subRef.current.push(client.eegReadings.subscribe(data => onNewData(data)));
      if (client.telemetryData) {
        subRef.current.push(client.telemetryData.subscribe(t => {
          setTelemetry(t);
          if (onTelemetry) onTelemetry(t);
        }));
      }
      if (client.ppgReadings && onPpg) {
        subRef.current.push(client.ppgReadings.subscribe(p => onPpg(p)));
      }
      if (client.accelerometerData && onAccelerometer) {
        subRef.current.push(client.accelerometerData.subscribe(a => onAccelerometer(a)));
      }
      if (client.gyroscopeData && onGyro) {
        subRef.current.push(client.gyroscopeData.subscribe(g => onGyro(g)));
      }
      updateChannelMaps(["TP9", "AF7", "AF8", "TP10", "AUXL", "AUXR"]);
      await client.start();
      setIsConnected(true);
    } catch (err) {
      setError(err?.message || 'Unable to connect');
      await safeDisconnect();
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }

  useEffect(() => {
    return () => {
      safeDisconnect();
    };
  }, []);

  async function onManualDisconnect() {
    await safeDisconnect();
    setIsConnected(false);
    setIsConnecting(false);
    setError('Disconnected');
  }

  useEffect(() => {
    if (onStatusChange) {
      onStatusChange({ isConnected, isConnecting, error });
    }
  }, [isConnected, isConnecting, error, onStatusChange]);

  useImperativeHandle(ref, () => ({
    reconnect: async () => {
      if (isConnecting) return;
      await safeDisconnect();
      await connect();
    },
    disconnect: async () => {
      await onManualDisconnect();
    }
  }));

  return (
    <div>
      {!isConnected && !isConnecting && <button onClick={connect}>Connect to Muse</button>}
      {isConnecting && <p>Connecting to Muse...</p>}
      {isConnected && (
        <div className="inline-buttons">
          <p>Connected to EEG</p>
          {telemetry && (
            <span className="status-pill">Battery: {telemetry.batteryLevel.toFixed(0)}%</span>
          )}
          <button onClick={onManualDisconnect}>Disconnect</button>
        </div>
      )}
      {!isConnected && !isConnecting && error && <p className="subdued">Status: {error}</p>}
      {isConnected && error && <p className="subdued">Status: {error}</p>}
    </div>
  );
});

export default MuseData;
