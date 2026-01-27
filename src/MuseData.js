import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MuseClient } from 'muse-js';

/**
 * Handles Muse connection with defined modes:
 * - 'auto': Silent attempt (on load or recovery). No popup if fails.
 * - 'manual': Silent attempt triggered by user reconnect. No popup if fails.
 * - 'pair': Forces popup (standard Web Bluetooth flow).
 */
const MuseData = React.forwardRef(function MuseData(
  { onNewData, updateChannelMaps, onTelemetry, onPpg, onAccelerometer, onGyro, onStatusChange, onDeviceInfo },
  ref
) {
  const GATT_CONNECT_TIMEOUT_MS = 12000;
  const SILENT_RETRY_ATTEMPTS = 3;
  const SILENT_RETRY_BACKOFF_MS = 2000;
  const ADVERTISEMENT_TIMEOUT_MS = 10000;
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [debugInfo, setDebugInfo] = useState({});
  const [knownDevice, setKnownDevice] = useState(null);
  const clientRef = useRef(null);
  const subRef = useRef([]);
  const connectInFlightRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const ambientPpgRef = useRef(null);
  const ppgLabelMapRef = useRef(null);

  const detectDeviceType = useCallback((info) => {
    const hw = String(info?.hw || '').toLowerCase();
    const tp = String(info?.tp || '').toLowerCase();
    const sp = String(info?.sp || '').toLowerCase();
    if (hw.includes('s') || tp.includes('s') || sp.includes('s')) return 'muse-s';
    if (hw.includes('2') || tp.includes('2') || sp.includes('2')) return 'muse-2';
    return 'unknown';
  }, []);

  const buildPpgLabelMap = useCallback((deviceType) => {
    // Default to Muse S mapping: AMBIENT, IR, RED
    const mapping = deviceType === 'muse-2'
      ? { ambient: 2, infrared: 0, red: 1 }
      : { ambient: 0, infrared: 1, red: 2 };
    return {
      mapping,
      labels: {
        0: mapping.ambient === 0 ? 'AMBIENT' : mapping.infrared === 0 ? 'IR' : 'RED',
        1: mapping.ambient === 1 ? 'AMBIENT' : mapping.infrared === 1 ? 'IR' : 'RED',
        2: mapping.ambient === 2 ? 'AMBIENT' : mapping.infrared === 2 ? 'IR' : 'RED'
      }
    };
  }, []);

  // Log debug steps
  const addDebugStep = useCallback((msg) => {
    console.log(`[MuseData] ${msg}`);
    setDebugInfo(prev => ({
      ...prev,
      steps: [...(prev.steps || []), { t: Date.now(), msg }]
    }));
  }, []);

  const connectGattWithTimeout = useCallback(async (device) => {
    const connectPromise = device.gatt.connect();
    const timeoutPromise = new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`GATT connect timed out after ${GATT_CONNECT_TIMEOUT_MS}ms`));
      }, GATT_CONNECT_TIMEOUT_MS);
    });
    return Promise.race([connectPromise, timeoutPromise]);
  }, [GATT_CONNECT_TIMEOUT_MS]);

  const sleep = useCallback((ms) => new Promise((resolve) => setTimeout(resolve, ms)), []);

  async function safeDisconnect() {
    setTelemetry(null);
    setIsConnected(false);
    setIsConnecting(false);
    try {
      if (clientRef.current?.device && clientRef.current._onDisconnect) {
        clientRef.current.device.removeEventListener('gattserverdisconnected', clientRef.current._onDisconnect);
      }
    } catch (e) { /* ignore */ }
    try {
      subRef.current.forEach(sub => sub?.unsubscribe?.());
    } catch (e) { /* ignore */ }
    subRef.current = [];
    try {
      await clientRef.current?.disconnect();
    } catch (e) { /* ignore */ }
    clientRef.current = null;
  }

  const connect = useCallback(async (mode = 'manual', trigger = 'unknown') => {
    if (connectInFlightRef.current) return;
    manualDisconnectRef.current = false;
    connectInFlightRef.current = true;
    setIsConnecting(true);
    setError(null);
    setDebugInfo(prev => ({ ...prev, connectStart: Date.now(), steps: [], mode, trigger }));
    
    // Local helper to avoid stale closure if we used addDebugStep directly in async flow?
    // actually addDebugStep is stable via useCallback.
    addDebugStep(`Starting connection in '${mode}' mode (trigger: ${trigger})...`);

    // Manual reconnects should start from a clean slate like auto reconnects do.
    if (mode === 'manual') {
      addDebugStep('Manual reconnect: clearing any existing client before reconnect.');
      await safeDisconnect();
    }

    const client = new MuseClient();
    clientRef.current = client;
    client.enableAux = true;
    client.enablePpg = true;

    let gatt = null;

    try {
      // 1. SILENT DISCOVERY (Auto & Manual)
      if (mode === 'auto' || mode === 'manual') {
        if (!navigator.bluetooth) {
          addDebugStep('navigator.bluetooth undefined. Web Bluetooth not supported/enabled.');
        } else if (!navigator.bluetooth.getDevices) {
           addDebugStep('navigator.bluetooth.getDevices undefined. Check browser flags/secure context.');
        } else {
          addDebugStep('Querying permitted devices (getDevices)...');
          const devices = await navigator.bluetooth.getDevices();
          addDebugStep(`Found ${devices.length} permitted devices.`);

          const museDevices = devices.filter(d => d.name && d.name.indexOf('Muse') >= 0);
          if (museDevices.length > 0) {
            addDebugStep(`Permitted Muse devices: ${museDevices.length}`);
            museDevices.forEach((d, idx) => {
              const idShort = d.id ? d.id.slice(0, 8) : 'unknown-id';
              const gattConnected = !!d.gatt?.connected;
              const adSupport = typeof d.watchAdvertisements === 'function' ? 'yes' : 'no';
              addDebugStep(
                `Muse[${idx + 1}]: ${d.name || 'Unnamed'} (id: ${idShort}…, gatt: ${gattConnected ? 'connected' : 'disconnected'}, ads: ${adSupport})`
              );
            });
          } else {
            addDebugStep('No permitted Muse devices found in getDevices result.');
          }

          const museDevice = museDevices[0];
          if (museDevice) {
            addDebugStep(`Found target: ${museDevice.name} (${museDevice.id})`);

            // Try multiple silent attempts with backoff to handle transient range/OS states.
            let lastSilentError = null;
            for (let attempt = 1; attempt <= SILENT_RETRY_ATTEMPTS; attempt += 1) {
              addDebugStep(`Silent connect attempt ${attempt}/${SILENT_RETRY_ATTEMPTS} (mode: ${mode})...`);

              let adSeen = true;
              if (typeof museDevice.watchAdvertisements === 'function') {
                addDebugStep(`Watching advertisements (${ADVERTISEMENT_TIMEOUT_MS / 1000}s timeout)...`);
                try {
                  await museDevice.watchAdvertisements();
                  await new Promise((resolve, reject) => {
                    const onAd = () => {
                      museDevice.removeEventListener('advertisementreceived', onAd);
                      resolve();
                    };
                    museDevice.addEventListener('advertisementreceived', onAd);
                    setTimeout(() => {
                      museDevice.removeEventListener('advertisementreceived', onAd);
                      reject(new Error('No advertisement received (device off/out of range?)'));
                    }, ADVERTISEMENT_TIMEOUT_MS);
                  });
                  addDebugStep('Advertisement received. Device is awake.');
                } catch (adErr) {
                  addDebugStep(`Advertisement warning: ${adErr.message}`);
                  adSeen = false;
                } finally {
                  if (typeof museDevice.unwatchAdvertisements === 'function') {
                    museDevice.unwatchAdvertisements();
                  }
                }
              }

              if (!adSeen) {
                addDebugStep('No advertisement seen; attempting silent GATT connect anyway.');
              }

              addDebugStep('Attempting GATT connect on existing device handle...');
              try {
                gatt = await connectGattWithTimeout(museDevice);
                addDebugStep('GATT connect successful.');
                setKnownDevice(museDevice.name);
                lastSilentError = null;
                break;
              } catch (gattErr) {
                lastSilentError = gattErr;
                addDebugStep(`Silent GATT connect failed: ${gattErr.message}`);
                gatt = null;
                if (attempt < SILENT_RETRY_ATTEMPTS) {
                  addDebugStep(`Waiting ${SILENT_RETRY_BACKOFF_MS}ms before retrying silent connect...`);
                  await sleep(SILENT_RETRY_BACKOFF_MS);
                }
              }
            }

            if (!gatt && lastSilentError && mode === 'auto') {
              throw lastSilentError;
            }
          } else {
            addDebugStep('No permitted Muse device found.');
            if (mode === 'auto') {
               throw new Error('No previously paired Muse device found.');
            }
          }
        }
      }

      // 2. FALLBACK / PAIRING (Manual & Pair)
      if (!gatt) {
        if (mode === 'auto' || mode === 'manual') {
          // Silent modes: do not popup; require explicit "Pair New".
          addDebugStep('Auto-connect finished without connection.');
          setIsConnecting(false);
          return; 
        }

        // If manual/pair, trigger popup
        addDebugStep(`Initiating browser picker (${mode === 'pair' ? 'forced' : 'fallback'})...`);
        await client.connect(); 
        if (client.deviceName) setKnownDevice(client.deviceName);
        addDebugStep('Browser picker connection successful.');
      } else {
        // If we have a gatt, attach it to the client
        await client.connect(gatt);
        addDebugStep('Client attached to GATT server.');
      }

      // 3. SETUP & STREAM
      addDebugStep('Configuring subscriptions...');
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
        subRef.current.push(client.ppgReadings.subscribe((p) => {
          if (!p || typeof p.ppgChannel !== 'number') {
            onPpg(p);
            return;
          }
          const labelMap = ppgLabelMapRef.current?.labels;
          const mapping = ppgLabelMapRef.current?.mapping;
          const ambientChannel = Number.isInteger(mapping?.ambient) ? mapping.ambient : 0;
          const irChannel = Number.isInteger(mapping?.infrared) ? mapping.infrared : 1;
          const redChannel = Number.isInteger(mapping?.red) ? mapping.red : 2;
          const label = labelMap?.[p.ppgChannel];
          if (p.ppgChannel === ambientChannel && Array.isArray(p.samples)) {
            ambientPpgRef.current = p.samples.slice();
            onPpg(label ? { ...p, label } : p);
            return;
          }
          if ((p.ppgChannel === irChannel || p.ppgChannel === redChannel) && Array.isArray(p.samples)) {
            const ambient = ambientPpgRef.current;
            if (Array.isArray(ambient) && ambient.length === p.samples.length) {
              const cleaned = p.samples.map((v, i) => v - ambient[i]);
              onPpg(label ? { ...p, label, samples: cleaned } : { ...p, samples: cleaned });
              return;
            }
          }
          onPpg(label ? { ...p, label } : p);
        }));
      }
      if (client.accelerometerData && onAccelerometer) {
        subRef.current.push(client.accelerometerData.subscribe(a => onAccelerometer(a)));
      }
      if (client.gyroscopeData && onGyro) {
        subRef.current.push(client.gyroscopeData.subscribe(g => onGyro(g)));
      }
      
      updateChannelMaps(["TP9", "AF7", "AF8", "TP10", "AUXL", "AUXR"]);
      let deviceInfo = null;
      try {
        deviceInfo = await client.deviceInfo();
      } catch (infoErr) {
        addDebugStep(`Device info unavailable: ${infoErr.message}`);
      }
      const deviceType = detectDeviceType(deviceInfo);
      const ppgLabelMap = buildPpgLabelMap(deviceType);
      ppgLabelMapRef.current = ppgLabelMap;
      if (onDeviceInfo) {
        onDeviceInfo({ deviceInfo, deviceType, ppgLabelMap });
      }

      await client.start();
      addDebugStep('Stream started.');
      setIsConnected(true);

    } catch (err) {
      addDebugStep(`Connection flow failed: ${err.message}`);
      console.error(err);
      setError(err.message);
      setIsConnected(false);
      await safeDisconnect();
    } finally {
      setIsConnecting(false);
      connectInFlightRef.current = false;
    }
  }, [
    onNewData,
    updateChannelMaps,
    onTelemetry,
    onPpg,
    onAccelerometer,
    onGyro,
    addDebugStep,
    connectGattWithTimeout,
    buildPpgLabelMap,
    detectDeviceType,
    onDeviceInfo,
    sleep
  ]);

  // Initial Known Device Check (no auto-connect)
  useEffect(() => {
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      navigator.bluetooth.getDevices().then(devices => {
        const hasMuse = devices.some(d => d.name && d.name.indexOf('Muse') >= 0);
        if (hasMuse) {
          setKnownDevice('Muse Device'); // Generic label until connected
        }
      });
    }
  }, []);

  // Lifecycle Cleanup
  useEffect(() => {
    return () => { safeDisconnect(); };
  }, []);

  async function onManualDisconnect() {
    manualDisconnectRef.current = true;
    await safeDisconnect();
    setIsConnected(false);
    setIsConnecting(false);
    setError('Disconnected');
  }

  useEffect(() => {
    if (onStatusChange) {
      onStatusChange({ isConnected, isConnecting, error, debugInfo });
    }
  }, [isConnected, isConnecting, error, debugInfo, onStatusChange]);

  useImperativeHandle(ref, () => ({
    reconnect: async () => {
      // Called by parent (DeviceControl) on data stale
      await safeDisconnect();
      await connect('auto', 'auto-reconnect');
    },
    disconnect: async () => {
      await onManualDisconnect();
    }
  }));

  return (
    <div>
      {!isConnected && !isConnecting && (
        knownDevice ? (
          <div className="inline-buttons">
            <button onClick={() => connect('manual', 'user-reconnect')}>Reconnect {knownDevice}</button>
            <button onClick={() => connect('pair', 'user-pair')} className="secondary">Pair New</button>
          </div>
        ) : (
          <button onClick={() => connect('pair', 'user-connect')}>Connect to Muse</button>
        )
      )}
      {isConnecting && <p>Connecting...</p>}
      {isConnected && (
        <div className="inline-buttons">
          <p>Connected</p>
          {telemetry && (
            <span className="status-pill">Battery: {telemetry.batteryLevel.toFixed(0)}%</span>
          )}
          <button onClick={onManualDisconnect}>Disconnect</button>
        </div>
      )}
      {!isConnected && !isConnecting && error && <p className="subdued">Status: {error}</p>}
      {isConnected && error && <p className="subdued">Warning: {error}</p>}
    </div>
  );
});

export default MuseData;
