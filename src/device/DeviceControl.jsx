import React, { useCallback, useEffect, useRef, useState } from 'react';
import MuseData from '../MuseData';
import ConfigWeights from '../ConfigWeights';
import { averagedPeriodogram, calcPeriodogram } from '../math/Periodogram.js';
import MultiEEGTraceChart from '../ui/MultiEEGTraceChart';
import EEGChannels from '../EEGChannels';

const SAMPLE_RATE_HZ = 256; // Muse sampling rate
const AUTO_DOWNLOAD_MS = 60000;
const DOWNLOAD_WINDOW_SAMPLES = Math.ceil((AUTO_DOWNLOAD_MS / 1000) * SAMPLE_RATE_HZ);
const FFT_WINDOW = 1024; // samples used per FFT (~4s at 256 Hz)
const TRACE_WINDOW = 4096; // visible trace window (~16s at 256 Hz)
const BUFFER_SIZE = Math.max(TRACE_WINDOW, FFT_WINDOW * 2, DOWNLOAD_WINDOW_SAMPLES + FFT_WINDOW); // keep enough samples for downloads
const STREAM_STALE_MS = 5000;

function DeviceControl({ onPeriodgramUpdated, selectedChannels = [], onToggleChannel, availableChannels = [], lastFFT: externalLastFFT = null }) {
  const eegChannelData = useRef([]);
  const channelMaps = useRef([]);
  const [channelsReady, setChannelsReady] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [lastFFT, setLastFFT] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [lastPpg, setLastPpg] = useState(null);
  const [lastAccel, setLastAccel] = useState(null);
  const [lastGyro, setLastGyro] = useState(null);
  const downloadTimer = useRef(null);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);
  const lastEegReceivedAt = useRef(null);
  const eegPacketsReceived = useRef(0);
  const lastDownloadedPacket = useRef(0);
  const streamingRef = useRef(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showPerChannelTraces, setShowPerChannelTraces] = useState(false);
  const powerInterval = useRef(0);
  const periodogramCb = useRef(onPeriodgramUpdated);

  // Keep callback stable for the interval
  useEffect(() => {
    periodogramCb.current = onPeriodgramUpdated;
  }, [onPeriodgramUpdated]);

  useEffect(() => {
    if (!channelsReady || channelMaps.current.length === 0) return;
    if (powerInterval.current === 0) {
      powerInterval.current = setInterval(() => {
        eegChannelData.current.forEach(electrode => {
          if (electrode.samples.length > FFT_WINDOW) {
            electrode.periodograms.push(calcPeriodogram(electrode.samples.slice(-FFT_WINDOW)));
            electrode.periodograms = electrode.periodograms.slice(-4);
            electrode.averagedPeriodogram = averagedPeriodogram(electrode.periodograms);
          }
        });
        periodogramCb.current(eegChannelData.current);
        setLastFFT(Date.now());
      }, 1000);
    }

    return function cleanup() {
      clearInterval(powerInterval.current);
      powerInterval.current = 0;
    };
  }, [channelsReady]);

  useEffect(() => {
    const id = setInterval(() => {
      const last = lastEegReceivedAt.current;
      const next = !!last && Date.now() - last < STREAM_STALE_MS;
      if (streamingRef.current !== next) {
        streamingRef.current = next;
        setIsStreaming(next);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  function updateChannelMaps(maps) {
    if (channelMaps.current.length === 0) {
      channelMaps.current = [...maps];
      channelMaps.current.forEach((label, idx) => {
        if (!eegChannelData.current[idx]) {
          eegChannelData.current[idx] = {
            electrode: idx,
            label,
            samples: [],
            periodograms: [],
            averagedPeriodogram: undefined
          };
        }
      });
      setChannelsReady(true);
      setRenderTick((tick) => tick + 1);
    }
  }

  function onNewData(data) {
    lastEegReceivedAt.current = Date.now();
    eegPacketsReceived.current += 1;
    if (!streamingRef.current) {
      streamingRef.current = true;
      setIsStreaming(true);
    }
    const location = channelMaps.current[data.electrode];
    let currentChannel = eegChannelData.current[data.electrode];
    if (typeof currentChannel === 'undefined') {
      eegChannelData.current[data.electrode] = {
        electrode: data.electrode,
        label: location || `CH ${data.electrode}`,
        samples: [],
        periodograms: [],
        averagedPeriodogram: undefined
      };
      currentChannel = eegChannelData.current[data.electrode];
    }

    const samples = currentChannel.samples;
    samples.push(...data.samples);
    if (samples.length > BUFFER_SIZE) {
      samples.splice(0, samples.length - BUFFER_SIZE);
    }
    currentChannel.samples = samples;
    setRenderTick((tick) => tick + 1); // force re-render so downstream charts update
  }

  let channelsForDisplay =
    channelMaps.current.length > 0
      ? channelMaps.current.map((label, idx) => {
          return eegChannelData.current[idx] || {
            electrode: idx,
            label,
            samples: [],
            periodograms: [],
            averagedPeriodogram: undefined
          };
        })
      : eegChannelData.current.filter(Boolean);

  if (selectedChannels.length > 0) {
    channelsForDisplay = channelsForDisplay.filter(c => selectedChannels.includes(c.label || c.electrode));
  }

  const channelsForDisplayRef = useRef(channelsForDisplay);
  channelsForDisplayRef.current = channelsForDisplay;

  const latestAccel = lastAccel?.samples?.[lastAccel.samples.length - 1];
  const latestGyro = lastGyro?.samples?.[lastGyro.samples.length - 1];
  const ppgAge = lastPpg?.receivedAt ? Math.round((Date.now() - lastPpg.receivedAt) / 1000) : null;
  const telemetryAge = telemetry?.receivedAt ? Math.round((Date.now() - telemetry.receivedAt) / 1000) : null;

  const diag = {
    mapped: channelMaps.current.length,
    withSamples: channelsForDisplay.filter(c => c.samples.length > 0).length,
    withFFT: channelsForDisplay.filter(c => c.averagedPeriodogram).length,
    belowThreshold: channelsForDisplay.filter(c => c.samples.length > 0 && c.samples.length < 1024).length,
    totalPeriodograms: channelsForDisplay.reduce((sum, c) => sum + c.periodograms.length, 0),
    lastFFT: externalLastFFT || lastFFT
  };

  const fftBeat = diag.lastFFT ? Math.round((Date.now() - diag.lastFFT) / 1000) : null;

  const downloadSamples = useCallback(({ requireFullWindow = false } = {}) => {
    const last = lastEegReceivedAt.current;
    if (!last || Date.now() - last > STREAM_STALE_MS) return;
    if (eegPacketsReceived.current <= lastDownloadedPacket.current) return;
    const active = (channelsForDisplayRef.current || []).filter(c => c.samples.length > 0);
    if (active.length === 0) return;
    if (requireFullWindow && active.some(c => c.samples.length < DOWNLOAD_WINDOW_SAMPLES)) return;
    const samplePeriodMs = 1000 / SAMPLE_RATE_HZ;
    const captureEndedAt = new Date(last);
    const windowSamples = requireFullWindow ? DOWNLOAD_WINDOW_SAMPLES : Math.max(...active.map(c => c.samples.length));
    const captureEndedAtIso = captureEndedAt.toISOString();

    const channelStartsMs = [];
    const payload = active.map(c => {
      const samples = c.samples.slice(-windowSamples); // copy window
      const channelCaptureStartMs =
        captureEndedAt.getTime() - Math.max(samples.length - 1, 0) * samplePeriodMs;
      const timestamps = samples.map((_, idx) => new Date(channelCaptureStartMs + idx * samplePeriodMs).toISOString());
      channelStartsMs.push(channelCaptureStartMs);

      return {
        label: c.label || c.electrode,
        samples,
        samplingRateHz: SAMPLE_RATE_HZ,
        timestamps
      };
    });
    const captureStartedAtIso = new Date(Math.min(...channelStartsMs)).toISOString();
    const sensorNames = active.map(c => c.label || c.electrode).join('-');
    const tsSlug = captureStartedAtIso.replace(/[:.]/g, '-');
    const blob = new Blob([JSON.stringify({
      capturedAt: captureStartedAtIso,
      captureEndedAt: captureEndedAtIso,
      samplingRateHz: SAMPLE_RATE_HZ,
      sensors: sensorNames,
      channels: payload
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `samples_${sensorNames || 'unknown'}_${tsSlug}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    lastDownloadedPacket.current = eegPacketsReceived.current;
  }, []);

  // auto-download every 60s when enabled
  useEffect(() => {
    if (!autoDownloadEnabled || !isStreaming) {
      clearInterval(downloadTimer.current);
      return undefined;
    }
    downloadTimer.current = setInterval(() => downloadSamples({ requireFullWindow: true }), AUTO_DOWNLOAD_MS);
    return () => clearInterval(downloadTimer.current);
  }, [autoDownloadEnabled, isStreaming, downloadSamples]);

  return (
    <div className="device-panel" data-render={renderTick}>
      <div className="device-status">
        <MuseData
          onNewData={onNewData}
          updateChannelMaps={updateChannelMaps}
          onTelemetry={(t) => setTelemetry({ ...t, receivedAt: Date.now() })}
          onPpg={(p) => setLastPpg({ ...p, receivedAt: Date.now() })}
          onAccelerometer={(a) => setLastAccel({ ...a, receivedAt: Date.now() })}
          onGyro={(g) => setLastGyro({ ...g, receivedAt: Date.now() })}
        />
        {channelMaps.current.length > 0 && (
          <p className="subdued">Channels detected: {channelMaps.current.join(' • ')}</p>
        )}
        <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={downloadSamples} disabled={!isStreaming}>
            Download samples now
          </button>
          <label className="status-pill" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoDownloadEnabled}
              onChange={(e) => setAutoDownloadEnabled(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Auto-download every 60s
          </label>
        </div>
        <div className="inline-status">
          <span className="status-pill">Mapped: {diag.mapped}</span>
          <span className="status-pill">With samples: {diag.withSamples}</span>
          <span className="status-pill">FFT ready: {diag.withFFT}</span>
          <span className="status-pill">Below 1024 samples: {diag.belowThreshold}</span>
          <span className="status-pill">Periodograms stored: {diag.totalPeriodograms}</span>
          <span className={`status-pill heartbeat ${fftBeat !== null && fftBeat < 5 ? 'alive' : ''}`}>
            Last FFT: {diag.lastFFT ? `${fftBeat}s ago` : '—'}
          </span>
        </div>
        <div className="inline-status">
          <span className="status-pill">
            Battery: {telemetry?.batteryLevel != null ? `${telemetry.batteryLevel}%` : '—'}
          </span>
          <span className="status-pill">
            Voltage: {telemetry?.fuelGaugeVoltage != null ? `${telemetry.fuelGaugeVoltage.toFixed(2)}V` : '—'}
          </span>
          <span className="status-pill">
            Temp: {telemetry?.temperature != null ? `${telemetry.temperature.toFixed(1)}°C` : '—'}
          </span>
          <span className="status-pill">
            Telemetry age: {telemetryAge != null ? `${telemetryAge}s` : '—'}
          </span>
        </div>
        <div className="inline-status">
          <span className="status-pill">
            PPG: {lastPpg ? `ch ${lastPpg.ppgChannel} · ${lastPpg.samples.length} samples (${ppgAge}s ago)` : '—'}
          </span>
          <span className="status-pill">
            Accel: {latestAccel ? `${latestAccel.x.toFixed(2)}, ${latestAccel.y.toFixed(2)}, ${latestAccel.z.toFixed(2)}` : '—'}
          </span>
          <span className="status-pill">
            Gyro: {latestGyro ? `${latestGyro.x.toFixed(2)}, ${latestGyro.y.toFixed(2)}, ${latestGyro.z.toFixed(2)}` : '—'}
          </span>
        </div>
      </div>
      <div className="config-weights">
        <ConfigWeights
          availableChannels={channelMaps.current.length > 0 ? channelMaps.current : availableChannels}
          selectedChannels={selectedChannels}
          onToggleChannel={onToggleChannel}
        />
      </div>
      <div className="chart-block" style={{ marginTop: 10 }}>
        <p className="chart-label">Combined EEG traces (per sensor, last 4096 samples)</p>
        <MultiEEGTraceChart channels={channelsForDisplay.filter(c => c.samples.length > 0)} />
      </div>
      <div className="chart-block" style={{ marginTop: 10 }}>
        <div className="inline-status" style={{ justifyContent: 'space-between', gap: 10 }}>
          <p className="chart-label" style={{ margin: 0 }}>Raw EEG traces (per channel)</p>
          <label className="status-pill" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showPerChannelTraces}
              onChange={(e) => setShowPerChannelTraces(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Show per-channel traces
          </label>
        </div>
        {showPerChannelTraces && (
          <EEGChannels
            eegChannelData={channelsForDisplay.filter(c => c.samples.length > 0)}
            showPeriodograms={false}
          />
        )}
      </div>
    </div>
  );
}

export default DeviceControl;
