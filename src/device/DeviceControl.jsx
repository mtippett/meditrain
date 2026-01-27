import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MuseData from '../MuseData';
import ConfigWeights from '../ConfigWeights';
import MultiEEGTraceChart from '../ui/MultiEEGTraceChart';
import DeviceStatusPanel from './DeviceStatusPanel';
import useDeviceDiagnostics from './useDeviceDiagnostics';

const DEFAULT_SAMPLE_RATE_HZ = 256; // Muse sampling rate
const DEFAULT_PPG_SAMPLE_RATE_HZ = 64;
const DEFAULT_FFT_WINDOW = 1024; // samples used per FFT (~4s at 256 Hz)
const DEFAULT_TRACE_WINDOW = 4096; // visible trace window (~16s at 256 Hz)
const DEFAULT_PPG_TRACE_WINDOW = 1024; // visible trace window (~16s at 64 Hz)
const STREAM_STALE_MS = 8000;

function DeviceControl({
  onEegPacket,
  onPpgPacket,
  onChannelMap,
  onTelemetryPacket,
  onAccelerometerPacket,
  onGyroPacket,
  onDeviceInfo,
  onStreamStatus,
  eegData = [],
  ppgChannels = [],
  channelMaps = [],
  onDeviceDebug,
  selectedChannels = [],
  onToggleChannel,
  availableChannels = [],
  availablePpgChannels = [],
  selectedPpgChannels = [],
  onTogglePpgChannel,
  shareTelemetry = true,
  shareAccelerometer = true,
  shareGyro = true,
  onToggleShareTelemetry,
  onToggleShareAccelerometer,
  onToggleShareGyro,
  deviceInfo,
  ppgLabelMap,
  deviceType,
  lastFFT: externalLastFFT = null,
  sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
  ppgSampleRateHz = DEFAULT_PPG_SAMPLE_RATE_HZ,
  fftWindow = DEFAULT_FFT_WINDOW,
  traceWindow = DEFAULT_TRACE_WINDOW,
  ppgTraceWindow = DEFAULT_PPG_TRACE_WINDOW
}) {
  const [telemetry, setTelemetry] = useState(null);
  const [lastPpg, setLastPpg] = useState(null);
  const [lastAccel, setLastAccel] = useState(null);
  const [lastGyro, setLastGyro] = useState(null);
  const [bluetoothStatus, setBluetoothStatus] = useState({
    supported: typeof navigator !== 'undefined' && !!navigator.bluetooth,
    available: null
  });
  const lastEegReceivedAt = useRef(null);
  const eegPacketsReceived = useRef(0);
  const streamingRef = useRef(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dataStale, setDataStale] = useState(false);
  const [museStatus, setMuseStatus] = useState({ isConnected: false, isConnecting: false, error: null });
  const [reconnectState, setReconnectState] = useState({
    attempts: 0,
    lastAttemptAt: null,
    status: 'idle',
    reason: null
  });
  const [eventLog, setEventLog] = useState([]);
  const lastProcessedMuseStepT = useRef(0);
  const museRef = useRef(null);
  const reconnectInFlightRef = useRef(false);
  const autoReconnectPendingRef = useRef(null);
  const lastReconnectAtRef = useRef(0);
  const connectionStartedAt = useRef(null);
  const wakeLockRef = useRef(null);
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const appendLog = useCallback((msg, data = null) => {
    setEventLog(prev => {
      const entry = { t: Date.now(), msg, data };
      return [...prev, entry].slice(-200);
    });
  }, []);


  // Ingest low-level debug steps from MuseData
  useEffect(() => {
    const steps = museStatus?.debugInfo?.steps;
    if (!steps || steps.length === 0) return;
    
    // If the steps array was reset (e.g. new connection start), we might see older timestamps 
    // if we didn't reset our tracker. However, MuseData resets steps=[] on connect.
    // We only want to add *new* steps we haven't seen. 
    // A simple heuristic: filter for t > lastProcessedMuseStepT.
    
    const newSteps = steps.filter(s => s.t > lastProcessedMuseStepT.current);
    if (newSteps.length > 0) {
      setEventLog(prev => {
        const toAdd = newSteps.map(s => ({ t: s.t, msg: s.msg, source: 'driver' }));
        // Update tracker to the latest
        lastProcessedMuseStepT.current = Math.max(lastProcessedMuseStepT.current, ...toAdd.map(x => x.t));
        // Merge and sort
        const combined = [...prev, ...toAdd].sort((a, b) => a.t - b.t);
        return combined.slice(-200);
      });
    }
  }, [museStatus?.debugInfo?.steps]);

  

  useEffect(() => {
    if (museStatus.isConnected) {
      if (!connectionStartedAt.current) {
        connectionStartedAt.current = Date.now();
        appendLog('Connection established (app layer)', { at: connectionStartedAt.current });
      }
    } else {
      if (connectionStartedAt.current) {
         appendLog('Connection lost (app layer)');
      }
      connectionStartedAt.current = null;
      lastEegReceivedAt.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
      setDataStale(false);
    }

    const id = setInterval(() => {
      const now = Date.now();
      const last = lastEegReceivedAt.current;
      
      // Grace period check
      const timeSinceConnect = connectionStartedAt.current ? now - connectionStartedAt.current : 0;
      const inGracePeriod = timeSinceConnect < 15000; // 15s grace

      let isFresh = false;
      if (museStatus.isConnected) {
        if (inGracePeriod) {
          isFresh = true;
        } else {
          isFresh = !!last && now - last < STREAM_STALE_MS;
        }
      }

      if (streamingRef.current !== isFresh) {
        streamingRef.current = isFresh;
        setIsStreaming(isFresh);
        if (!isFresh && museStatus.isConnected) {
          appendLog(`Data stream stale (last: ${last ? now - last : 'never'}ms ago)`);
        } else if (isFresh && museStatus.isConnected) {
          appendLog('Data stream active/fresh');
        }
      }
      const stale = museStatus.isConnected && !isFresh;
      setDataStale(stale);
    }, 1000);
    return () => clearInterval(id);
  }, [museStatus.isConnected, appendLog]);

  const attemptReconnect = useCallback((reason) => {
    if (museStatus.isConnecting) {
      appendLog(`Auto-reconnect skipped: already connecting (${reason})`);
      return;
    }
    if (!museRef.current?.reconnect) {
      appendLog(`Auto-reconnect skipped: reconnect unavailable (${reason})`);
      return;
    }
    const now = Date.now();
    if (reconnectInFlightRef.current) {
      appendLog(`Auto-reconnect skipped: in flight (${reason})`);
      return;
    }
    if (now - lastReconnectAtRef.current < 10000) {
      appendLog(`Auto-reconnect skipped: cooldown (${reason})`);
      return;
    }
    reconnectInFlightRef.current = true;
    lastReconnectAtRef.current = now;
    
    appendLog(`Initiating auto-reconnect (reason: ${reason})`);
    autoReconnectPendingRef.current = reason;
    
    setReconnectState((prev) => ({
      attempts: prev.attempts + 1,
      lastAttemptAt: now,
      status: 'attempting',
      reason
    }));
    museRef.current
      .reconnect()
      .then(() => {
        appendLog('Auto-reconnect promise resolved');
      })
      .catch((err) => {
        console.warn('Auto-reconnect failed', err);
        appendLog(`Auto-reconnect failed: ${err.message}`);
      })
      .finally(() => {
        reconnectInFlightRef.current = false;
        setReconnectState((prev) => ({ ...prev, status: 'idle' }));
      });
  }, [museStatus.isConnecting, appendLog]);

  useEffect(() => {
    if (!dataStale) return;
    if (!museStatus.isConnected) {
      appendLog('Auto-reconnect skipped: not connected during stale check');
      return;
    }
    if (!lastEegReceivedAt.current) {
      appendLog('Auto-reconnect skipped: no EEG timestamp during stale check');
      return;
    }
    attemptReconnect('stale-data');
  }, [attemptReconnect, dataStale, museStatus.isConnected, appendLog]);

  useEffect(() => {
    if (!isStreaming) return;
    if (!autoReconnectPendingRef.current) return;
    appendLog('Auto-reconnect succeeded');
    autoReconnectPendingRef.current = null;
  }, [isStreaming, appendLog]);

  useEffect(() => {
    if (museStatus.isConnected || museStatus.isConnecting) return;
    if (museStatus.error !== 'Device disconnected') return;
    attemptReconnect('disconnect');
  }, [attemptReconnect, museStatus.error, museStatus.isConnected, museStatus.isConnecting]);

  useEffect(() => {
    if (!wakeLockSupported) return undefined;
    let canceled = false;

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch (err) {
          console.warn('Failed to release wake lock', err);
        } finally {
          wakeLockRef.current = null;
        }
      }
    };

    const requestWakeLock = async () => {
      if (wakeLockRef.current || !isStreaming || document.visibilityState !== 'visible') {
        return;
      }
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('Failed to acquire wake lock', err);
      }
    };

    if (isStreaming) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      canceled = true;
      void canceled;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isStreaming, wakeLockSupported]);

  const updateChannelMaps = useCallback((maps) => {
    if (!Array.isArray(maps) || maps.length === 0) return;
    if (onChannelMap) onChannelMap(maps);
  }, [onChannelMap]);

  const onNewData = useCallback((data) => {
    lastEegReceivedAt.current = Date.now();
    eegPacketsReceived.current += 1;
    if (!streamingRef.current) {
      streamingRef.current = true;
      setIsStreaming(true);
    }
    if (onEegPacket) onEegPacket(data);
  }, [onEegPacket]);

  const onPpgData = useCallback((data) => {
    if (!data || typeof data.ppgChannel !== 'number') return;
    if (data.ppgChannel > 2) return;
    setLastPpg({ ...data, receivedAt: Date.now() });
    if (onPpgPacket) onPpgPacket(data);
  }, [onPpgPacket]);

  const onTelemetry = useCallback((t) => {
    const now = Date.now();
    const payload = { ...t, receivedAt: now };
    setTelemetry(payload);
    if (shareTelemetry && onTelemetryPacket) onTelemetryPacket(payload);
  }, [onTelemetryPacket, shareTelemetry]);

  const onAccelerometer = useCallback((a) => {
    const payload = { ...a, receivedAt: Date.now() };
    setLastAccel(payload);
    if (shareAccelerometer && onAccelerometerPacket) onAccelerometerPacket(payload);
  }, [onAccelerometerPacket, shareAccelerometer]);

  const onGyro = useCallback((g) => {
    const payload = { ...g, receivedAt: Date.now() };
    setLastGyro(payload);
    if (shareGyro && onGyroPacket) onGyroPacket(payload);
  }, [onGyroPacket, shareGyro]);

  const channelsForDisplay = Array.isArray(eegData) ? eegData.filter(Boolean) : [];

  const ppgChannelsForDisplay = useMemo(() => (
    (ppgChannels || []).filter(c => c && c.samples.length > 0 && c.ppgChannel <= 2)
  ), [ppgChannels]);

  const {
    statusLabel,
    statusMessage,
    diag,
    fftBeat,
    telemetryAge,
    lastSampleAt,
    ppgAge,
    latestAccel,
    latestGyro
  } = useDeviceDiagnostics({
    channelMaps,
    eegData,
    channelsForDisplay,
    fftWindow,
    lastFFT: externalLastFFT,
    telemetry,
    lastEegReceivedAt,
    lastPpg,
    lastAccel,
    lastGyro,
    museStatus,
    dataStale,
    isStreaming
  });

  void eegPacketsReceived;

  useEffect(() => {
    if (!onDeviceDebug) return;
    onDeviceDebug({ eventLog });
  }, [eventLog, onDeviceDebug]);

  useEffect(() => {
    if (!onStreamStatus) return;
    onStreamStatus({
      isStreaming,
      dataStale,
      isConnected: museStatus.isConnected,
      isConnecting: museStatus.isConnecting
    });
  }, [onStreamStatus, isStreaming, dataStale, museStatus.isConnected, museStatus.isConnecting]);

  useEffect(() => {
    const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;
    if (!supported) {
      setBluetoothStatus({ supported: false, available: false });
      return undefined;
    }
    let canceled = false;
    const bt = navigator.bluetooth;
    const updateAvailability = async () => {
      if (!bt.getAvailability) {
        if (!canceled) {
          setBluetoothStatus({ supported: true, available: null });
        }
        return;
      }
      try {
        const available = await bt.getAvailability();
        if (!canceled) {
          setBluetoothStatus({ supported: true, available });
        }
      } catch (err) {
        if (!canceled) {
          setBluetoothStatus({ supported: true, available: null });
        }
      }
    };
    updateAvailability();
    const onAvailabilityChanged = (event) => {
      const available = typeof event?.value === 'boolean' ? event.value : null;
      setBluetoothStatus({ supported: true, available });
    };
    if (bt.addEventListener && bt.getAvailability) {
      bt.addEventListener('availabilitychanged', onAvailabilityChanged);
    }
    return () => {
      canceled = true;
      if (bt.removeEventListener && bt.getAvailability) {
        bt.removeEventListener('availabilitychanged', onAvailabilityChanged);
      }
    };
  }, []);

  return (
    <div className="device-panel">
      <div className="device-status">
        <MuseData
          ref={museRef}
          onNewData={onNewData}
          updateChannelMaps={updateChannelMaps}
          onTelemetry={onTelemetry}
          onPpg={onPpgData}
          onAccelerometer={onAccelerometer}
          onGyro={onGyro}
          onStatusChange={setMuseStatus}
          onDeviceInfo={onDeviceInfo}
        />
        <DeviceStatusPanel
          museIsConnected={museStatus.isConnected}
          statusLabel={statusLabel}
          statusMessage={statusMessage}
          channelsDetected={channelMaps}
          diag={diag}
          fftWindow={fftWindow}
          fftBeat={fftBeat}
          dataStale={dataStale}
          reconnectAttempts={reconnectState.attempts}
          telemetry={telemetry}
          telemetryAge={telemetryAge}
          lastSampleAt={lastSampleAt}
          lastPpg={lastPpg}
          ppgAge={ppgAge}
          latestAccel={latestAccel}
          latestGyro={latestGyro}
        />
      </div>
      <div className="config-weights">
        <ConfigWeights
          title="EEG Channels"
          helperText="Selections control what the app uses for analysis/export; Device Control still shows all channels."
          availableChannels={channelMaps.length > 0 ? channelMaps : availableChannels}
          selectedChannels={selectedChannels}
          onToggleChannel={onToggleChannel}
        />
        <ConfigWeights
          title="PPG Channels"
          helperText="Selections control what the app uses for heart/PPG views; Device Control still shows all channels."
          availableChannels={availablePpgChannels}
          selectedChannels={selectedPpgChannels}
          onToggleChannel={onTogglePpgChannel}
        />
        <div className="config-weights">
          <p className="chart-label">Detected Device</p>
          <div className="inline-status" style={{ flexWrap: 'wrap' }}>
            <span className="status-pill">Type: {deviceType || '—'}</span>
            <span className="status-pill">HW: {deviceInfo?.hw || '—'}</span>
            <span className="status-pill">FW: {deviceInfo?.fw || '—'}</span>
            <span className="status-pill">Serial: {deviceInfo?.bn || '—'}</span>
          </div>
          <p className="subdued">
            PPG mapping: {ppgLabelMap?.labels
              ? Object.entries(ppgLabelMap.labels)
                .map(([idx, label]) => `ch ${idx} → ${label}`)
                .join(' · ')
              : '—'}
          </p>
        </div>
        <div className="config-weights">
          <p className="chart-label">Bluetooth Status</p>
          <div className="inline-status" style={{ flexWrap: 'wrap' }}>
            <span className="status-pill">Supported: {bluetoothStatus.supported ? 'yes' : 'no'}</span>
            <span className="status-pill">
              Availability: {bluetoothStatus.available == null ? 'unknown' : bluetoothStatus.available ? 'on' : 'off'}
            </span>
            <span className="status-pill">Mode: {museStatus.debugInfo?.mode || '—'}</span>
          </div>
          <p className="subdued">
            Trigger: {museStatus.debugInfo?.trigger || '—'}
          </p>
        </div>
        <div className="config-weights">
          <p className="chart-label">Other Sensors</p>
          <div className="config-list">
            <label className="config-option">
              <input
                type="checkbox"
                checked={shareTelemetry}
                onChange={() => onToggleShareTelemetry && onToggleShareTelemetry()}
              />
              <span>Telemetry (battery)</span>
            </label>
            <label className="config-option">
              <input
                type="checkbox"
                checked={shareAccelerometer}
                onChange={() => onToggleShareAccelerometer && onToggleShareAccelerometer()}
              />
              <span>Accelerometer</span>
            </label>
            <label className="config-option">
              <input
                type="checkbox"
                checked={shareGyro}
                onChange={() => onToggleShareGyro && onToggleShareGyro()}
              />
              <span>Gyroscope</span>
            </label>
          </div>
          <p className="subdued">These toggles control whether sensor data is forwarded to the app.</p>
        </div>
      </div>
      <div className="chart-block chart-fill" style={{ marginTop: 10 }}>
        <p className="chart-label">
          Combined EEG traces (per sensor, last {traceWindow} samples)
        </p>
        <div className="chart-frame">
          <MultiEEGTraceChart
            channels={channelsForDisplay.filter(c => c.samples.length > 0)}
            windowSize={traceWindow}
            autoHeight
          />
        </div>
      </div>
      <div className="chart-block" style={{ marginTop: 10 }}>
        <p className="chart-label">Raw PPG traces (last {ppgTraceWindow} samples)</p>
        {ppgChannelsForDisplay.length > 0 ? (
          <MultiEEGTraceChart
            channels={ppgChannelsForDisplay}
            windowSize={ppgTraceWindow}
            sampleRate={ppgSampleRateHz}
            height={160}
          />
        ) : (
          <p className="subdued">Waiting for PPG data.</p>
        )}
      </div>
    </div>
  );
}

export default DeviceControl;
