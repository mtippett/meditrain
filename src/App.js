import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeviceControl from './device/DeviceControl';
import BandPower from './BandPower';
import TrainingControl from './TrainingControl';
import TrainingView from './TrainingView';
import Spectrogram from './Spectrogram';
import BandPeriodograms from './BandPeriodograms';
import TimeSeriesLineChart from './ui/TimeSeriesLineChart';
import EEGTraceChart from './ui/EEGTraceChart';
import { PanelControlButton, PanelControls, PanelHeading } from './ui/PanelControls';
import useEegProcessing from './hooks/useEegProcessing';
import usePpgProcessing from './hooks/usePpgProcessing';
import { exportBrainVision } from './export/exportManager';

import './App.css';
import { STANDARD_BANDS } from './constants/bands';

const TELEMETRY_WINDOW_SEC = 120;
const HEART_OBSERVATORY_WINDOW_SEC = 120;

const FALLBACK_SETTINGS = {
  selectedChannels: [],
  selectedPpgChannels: ['IR', 'AMBIENT', 'RED'],
  shareTelemetry: true,
  shareAccelerometer: true,
  shareGyro: true,
  ppgSensorMapping: {
    irChannel: 1,
    redChannel: 2,
    greenChannel: 0
  },
  trainingTargets: [],
  bandWindowSec: 300,
  spectrogramWindowSec: 300,
  bandSmoothingSec: 20,
  deltaSmoothingSec: 20,
  eegTraceWindow: 4096,
  eegFftWindow: 1024,
  ppgTraceWindow: 3840,
  notchHz: 50,
  spectrogramUseCachedSlices: true,
  artifactWindowSec: 2,
  artifactStepSec: 1,
  amplitudeRangeThreshold: 150,
  lineNoiseHz: 60,
  lineNoiseBandHz: 2,
  lineNoiseMaxHz: 80,
  lineNoiseRatioThreshold: 0.5,
  targetSensitivityRisePerSec: 0.002,
  targetSensitivityFallPerSec: 0.008,
  targetSensitivityMin: 0.0,
  targetSensitivityMax: 2.0,
  audioSensitivityRisePerSec: 0.01,
  audioSensitivityFallPerSec: 0.003,
  audioSensitivityMin: 1.0,
  audioSensitivityMax: 2.0,
  audioFeedbackScale: 5,
  audioFeedbackGain: 0.2,
  audioIncreaseStopNorm: 0.5,
  rejectionOverlayMode: 'auto',
  rejectionOverlayMaxWindows: 200,
  showBandPower: false,
  showPeriodograms: false,
  showSpectrogram: false,
  showArtifactDiagnostics: true
};

const DEFAULT_SETTINGS = FALLBACK_SETTINGS;

function getTargetModel(target) {
  return target?.model === 'ratio' ? 'ratio' : 'relative';
}

function resolveTargetValue(target, snapshotMap) {
  const snapshot = snapshotMap.get(target.label);
  if (!snapshot) return null;
  const model = getTargetModel(target);
  if (model === 'ratio') {
    const numerator = snapshot.bands?.[target.numeratorBand]?.relative;
    const denominator = snapshot.bands?.[target.denominatorBand]?.relative;
    if (typeof numerator !== 'number' || typeof denominator !== 'number' || denominator === 0) {
      return null;
    }
    return numerator / denominator;
  }
  const value = snapshot.bands?.[target.band]?.relative;
  return typeof value === 'number' ? value : null;
}

function App() {
  const [selectedChannels, setSelectedChannels] = useState(DEFAULT_SETTINGS.selectedChannels);
  const [selectedPpgChannels, setSelectedPpgChannels] = useState(DEFAULT_SETTINGS.selectedPpgChannels);
  const [shareTelemetry, setShareTelemetry] = useState(DEFAULT_SETTINGS.shareTelemetry);
  const [shareAccelerometer, setShareAccelerometer] = useState(DEFAULT_SETTINGS.shareAccelerometer);
  const [shareGyro, setShareGyro] = useState(DEFAULT_SETTINGS.shareGyro);
  const [ppgSensorMapping, setPpgSensorMapping] = useState(DEFAULT_SETTINGS.ppgSensorMapping);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [ppgLabelMap, setPpgLabelMap] = useState(null);
  const [deviceType, setDeviceType] = useState(null);
  const [trainingTargets, setTrainingTargets] = useState(DEFAULT_SETTINGS.trainingTargets);
  const [bandSnapshots, setBandSnapshots] = useState([]);
  const [bandHistory, setBandHistory] = useState({});
  const [targetHistory, setTargetHistory] = useState({});
  const [targetHistoryById, setTargetHistoryById] = useState({});
  const [bandWindowSec, setBandWindowSec] = useState(DEFAULT_SETTINGS.bandWindowSec);
  const [spectrogramWindowSec, setSpectrogramWindowSec] = useState(DEFAULT_SETTINGS.spectrogramWindowSec);
  const [bandSmoothingSec, setBandSmoothingSec] = useState(DEFAULT_SETTINGS.bandSmoothingSec);
  const [deltaSmoothingSec, setDeltaSmoothingSec] = useState(DEFAULT_SETTINGS.deltaSmoothingSec);
  const [eegTraceWindow, setEegTraceWindow] = useState(DEFAULT_SETTINGS.eegTraceWindow);
  const [eegFftWindow, setEegFftWindow] = useState(DEFAULT_SETTINGS.eegFftWindow);
  const [ppgTraceWindow, setPpgTraceWindow] = useState(DEFAULT_SETTINGS.ppgTraceWindow);
  const [notchHz, setNotchHz] = useState(DEFAULT_SETTINGS.notchHz);
  const [artifactWindowSec, setArtifactWindowSec] = useState(DEFAULT_SETTINGS.artifactWindowSec);
  const [artifactStepSec, setArtifactStepSec] = useState(DEFAULT_SETTINGS.artifactStepSec);
  const [amplitudeRangeThreshold, setAmplitudeRangeThreshold] = useState(DEFAULT_SETTINGS.amplitudeRangeThreshold);
  const [lineNoiseHz, setLineNoiseHz] = useState(DEFAULT_SETTINGS.lineNoiseHz);
  const [lineNoiseBandHz, setLineNoiseBandHz] = useState(DEFAULT_SETTINGS.lineNoiseBandHz);
  const [lineNoiseMaxHz, setLineNoiseMaxHz] = useState(DEFAULT_SETTINGS.lineNoiseMaxHz);
  const [lineNoiseRatioThreshold, setLineNoiseRatioThreshold] = useState(DEFAULT_SETTINGS.lineNoiseRatioThreshold);
  const [rejectionOverlayMode, setRejectionOverlayMode] = useState(DEFAULT_SETTINGS.rejectionOverlayMode);
  const [rejectionOverlayMaxWindows, setRejectionOverlayMaxWindows] = useState(DEFAULT_SETTINGS.rejectionOverlayMaxWindows);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [streamStatus, setStreamStatus] = useState({
    isStreaming: false,
    dataStale: false,
    isConnected: false,
    isConnecting: false
  });
  const [sharedTelemetry, setSharedTelemetry] = useState(null);
  const [sharedAccelerometer, setSharedAccelerometer] = useState(null);
  const [sharedGyro, setSharedGyro] = useState(null);
  const lastEegReceivedAtRef = useRef(null);
  const eegPacketsReceivedRef = useRef(0);
  const lastDownloadedPacketRef = useRef(0);
  const nextAutoDownloadAtRef = useRef(null);
  const downloadSamplesRef = useRef(null);
  const [autoDownloadCountdownSec, setAutoDownloadCountdownSec] = useState(null);
  const [downloadLogs, setDownloadLogs] = useState([]);
  const [batteryHistory, setBatteryHistory] = useState([]);
  const [tempHistory, setTempHistory] = useState([]);
  const [accelHistoryX, setAccelHistoryX] = useState([]);
  const [accelHistoryY, setAccelHistoryY] = useState([]);
  const [accelHistoryZ, setAccelHistoryZ] = useState([]);
  const [gyroHistoryX, setGyroHistoryX] = useState([]);
  const [gyroHistoryY, setGyroHistoryY] = useState([]);
  const [gyroHistoryZ, setGyroHistoryZ] = useState([]);

  const sampleRateHz = 256;
  const ppgSampleRateHz = 64;
  const heartObservatoryWindowMs = HEART_OBSERVATORY_WINDOW_SEC * 1000;
  const heartObservatorySamples = Math.max(1, Math.round(ppgSampleRateHz * HEART_OBSERVATORY_WINDOW_SEC));
  const autoDownloadMs = 60000;
  const {
    eegData,
    lastFFT,
    channelMaps,
    handleChannelMaps,
    handleEegPacket: handleEegPacketRaw
  } = useEegProcessing({
    sampleRateHz,
    fftWindow: eegFftWindow,
    traceWindow: eegTraceWindow,
    notchHz,
    spectrogramWindowSec,
    artifactWindowSec,
    artifactStepSec,
    amplitudeRangeThreshold,
    lineNoiseHz,
    lineNoiseBandHz,
    lineNoiseMaxHz,
    lineNoiseRatioThreshold,
    autoDownloadMs
  });
  const {
    ppgChannels,
    heartData,
    handlePpgPacket: handlePpgPacketRaw
  } = usePpgProcessing({
    ppgTraceWindow,
    sampleRateHz: ppgSampleRateHz,
    autoDownloadMs,
    enabledPpgLabels: selectedPpgChannels,
    sensorMapping: ppgSensorMapping
  });

  const handleEegPacket = useCallback((data) => {
    lastEegReceivedAtRef.current = Date.now();
    eegPacketsReceivedRef.current += 1;
    handleEegPacketRaw(data);
  }, [handleEegPacketRaw]);

  const handlePpgPacket = useCallback((data) => {
    handlePpgPacketRaw(data);
  }, [handlePpgPacketRaw]);

  const handleTelemetryPacket = useCallback((data) => {
    setSharedTelemetry(data);
  }, []);

  const handleAccelerometerPacket = useCallback((data) => {
    setSharedAccelerometer(data);
  }, []);

  const handleGyroPacket = useCallback((data) => {
    setSharedGyro(data);
  }, []);

  const handleDeviceInfo = useCallback((info) => {
    setDeviceInfo(info?.deviceInfo || null);
    setPpgLabelMap(info?.ppgLabelMap || null);
    setDeviceType(info?.deviceType || null);
    if (info?.ppgLabelMap?.mapping) {
      const mapping = info.ppgLabelMap.mapping;
      setPpgSensorMapping({
        irChannel: mapping.infrared,
        redChannel: mapping.red,
        greenChannel: mapping.ambient
      });
    }
  }, []);

  const pushHistoryPoint = useCallback((setter, value, windowMs = TELEMETRY_WINDOW_SEC * 1000) => {
    if (!Number.isFinite(value)) return;
    const now = Date.now();
    setter((prev) => {
      const next = [...prev, { t: now, v: value }].filter(p => p.t >= now - windowMs);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!sharedTelemetry) return;
    if (Number.isFinite(sharedTelemetry.batteryLevel)) {
      pushHistoryPoint(setBatteryHistory, sharedTelemetry.batteryLevel);
    }
    if (Number.isFinite(sharedTelemetry.temperature)) {
      pushHistoryPoint(setTempHistory, sharedTelemetry.temperature);
    }
  }, [sharedTelemetry, pushHistoryPoint]);

  useEffect(() => {
    if (!sharedAccelerometer?.samples || sharedAccelerometer.samples.length === 0) return;
    const last = sharedAccelerometer.samples[sharedAccelerometer.samples.length - 1];
    if (!last) return;
    pushHistoryPoint(setAccelHistoryX, last.x);
    pushHistoryPoint(setAccelHistoryY, last.y);
    pushHistoryPoint(setAccelHistoryZ, last.z);
  }, [sharedAccelerometer, pushHistoryPoint]);

  useEffect(() => {
    if (!sharedGyro?.samples || sharedGyro.samples.length === 0) return;
    const last = sharedGyro.samples[sharedGyro.samples.length - 1];
    if (!last) return;
    pushHistoryPoint(setGyroHistoryX, last.x);
    pushHistoryPoint(setGyroHistoryY, last.y);
    pushHistoryPoint(setGyroHistoryZ, last.z);
  }, [sharedGyro, pushHistoryPoint]);

  const [targetSensitivity, setTargetSensitivity] = useState({});
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const noiseRef = useRef(null);
  const audioSensitivityRef = useRef({ value: 1, lastUpdate: Date.now() });
  const lastGoodSnapshotRef = useRef({});
  const lastBandSigRef = useRef({});
  const defaultSettingsRef = useRef(DEFAULT_SETTINGS);
  const [showBandPower, setShowBandPower] = useState(DEFAULT_SETTINGS.showBandPower);
  const [showPeriodograms, setShowPeriodograms] = useState(DEFAULT_SETTINGS.showPeriodograms);
  const [showSpectrogram, setShowSpectrogram] = useState(DEFAULT_SETTINGS.showSpectrogram);
  const [spectrogramUseCachedSlices, setSpectrogramUseCachedSlices] = useState(DEFAULT_SETTINGS.spectrogramUseCachedSlices);
  const [showArtifactDiagnostics, setShowArtifactDiagnostics] = useState(DEFAULT_SETTINGS.showArtifactDiagnostics);
  const [deviceDebug, setDeviceDebug] = useState(null);
  const deviceDebugPreRef = useRef(null);
  const [fullscreenPanel, setFullscreenPanel] = useState(null);
  const [heartRateHistory, setHeartRateHistory] = useState([]);
  const [bandTargetPresets, setBandTargetPresets] = useState({ profiles: [] });
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState(null);
  const controlIcons = useMemo(() => ({
    show: '○',
    hide: '◉',
    expand: '⤢',
    collapse: '⤡'
  }), []);

  useEffect(() => {
    const el = deviceDebugPreRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [deviceDebug?.eventLog?.length]);

  function applySettings(settings) {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    setSelectedChannels(Array.isArray(merged.selectedChannels) ? merged.selectedChannels : DEFAULT_SETTINGS.selectedChannels);
    setSelectedPpgChannels(Array.isArray(merged.selectedPpgChannels) ? merged.selectedPpgChannels : DEFAULT_SETTINGS.selectedPpgChannels);
    if (typeof merged.shareTelemetry === 'boolean') setShareTelemetry(merged.shareTelemetry);
    if (typeof merged.shareAccelerometer === 'boolean') setShareAccelerometer(merged.shareAccelerometer);
    if (typeof merged.shareGyro === 'boolean') setShareGyro(merged.shareGyro);
    if (merged.ppgSensorMapping && typeof merged.ppgSensorMapping === 'object') {
      setPpgSensorMapping(merged.ppgSensorMapping);
    }
    setTrainingTargets(Array.isArray(merged.trainingTargets) ? merged.trainingTargets : DEFAULT_SETTINGS.trainingTargets);
    if (typeof merged.bandWindowSec === 'number') setBandWindowSec(merged.bandWindowSec);
    if (typeof merged.spectrogramWindowSec === 'number') setSpectrogramWindowSec(merged.spectrogramWindowSec);
    if (typeof merged.bandSmoothingSec === 'number') setBandSmoothingSec(merged.bandSmoothingSec);
    if (typeof merged.deltaSmoothingSec === 'number') setDeltaSmoothingSec(merged.deltaSmoothingSec);
    if (typeof merged.eegTraceWindow === 'number') setEegTraceWindow(merged.eegTraceWindow);
    if (typeof merged.eegFftWindow === 'number') setEegFftWindow(merged.eegFftWindow);
    if (typeof merged.ppgTraceWindow === 'number') setPpgTraceWindow(merged.ppgTraceWindow);
    if (typeof merged.notchHz === 'number') setNotchHz(merged.notchHz);
    if (typeof merged.spectrogramUseCachedSlices === 'boolean') {
      setSpectrogramUseCachedSlices(merged.spectrogramUseCachedSlices);
    }
    if (typeof merged.artifactWindowSec === 'number') setArtifactWindowSec(merged.artifactWindowSec);
    if (typeof merged.artifactStepSec === 'number') setArtifactStepSec(merged.artifactStepSec);
    if (typeof merged.amplitudeRangeThreshold === 'number') setAmplitudeRangeThreshold(merged.amplitudeRangeThreshold);
    if (typeof merged.lineNoiseHz === 'number') setLineNoiseHz(merged.lineNoiseHz);
    if (typeof merged.lineNoiseBandHz === 'number') setLineNoiseBandHz(merged.lineNoiseBandHz);
    if (typeof merged.lineNoiseMaxHz === 'number') setLineNoiseMaxHz(merged.lineNoiseMaxHz);
    if (typeof merged.lineNoiseRatioThreshold === 'number') setLineNoiseRatioThreshold(merged.lineNoiseRatioThreshold);
    if (typeof merged.rejectionOverlayMode === 'string') setRejectionOverlayMode(merged.rejectionOverlayMode);
    if (typeof merged.rejectionOverlayMaxWindows === 'number') setRejectionOverlayMaxWindows(merged.rejectionOverlayMaxWindows);
    if (typeof merged.showBandPower === 'boolean') setShowBandPower(merged.showBandPower);
    if (typeof merged.showPeriodograms === 'boolean') setShowPeriodograms(merged.showPeriodograms);
    if (typeof merged.showSpectrogram === 'boolean') setShowSpectrogram(merged.showSpectrogram);
    if (typeof merged.showArtifactDiagnostics === 'boolean') setShowArtifactDiagnostics(merged.showArtifactDiagnostics);
  }

  // Load band target presets from JSON
  useEffect(() => {
    setPresetsLoading(true);
    setPresetsError(null);
    // Use PUBLIC_URL to handle apps deployed to subdirectories (e.g., /meditrain)
    const cacheBust = Date.now();
    const url = `${process.env.PUBLIC_URL}/band_targets.json?ts=${cacheBust}`;
    fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' } })
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load band_targets.json: HTTP ${res.status} ${res.statusText}`);
        }
        // Check content-type to ensure we got JSON, not HTML fallback
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          throw new Error('Failed to load band_targets.json: received HTML (likely base path or SPA fallback)');
        }
        return res.json();
      })
      .then(data => {
        if (!data.profiles || !Array.isArray(data.profiles)) {
          throw new Error('Failed to load band_targets.json: missing profiles array');
        }
        setBandTargetPresets(data);
        setPresetsLoading(false);
      })
      .catch(err => {
        setPresetsLoading(false);
        setPresetsError(err && err.message ? err.message : 'Failed to load band_targets.json');
        throw err;
      });
  }, []);


  const activeElectrodes = eegData.length;
  const totalSamples = eegData.reduce((sum, channel) => sum + (channel.samples?.length || 0), 0);
  const totalPeriodograms = eegData.reduce((sum, channel) => sum + (channel.periodograms?.length || 0), 0);

  const availableChannels = Array.from(
    new Set(
      eegData.map((c) => c.label || c.electrode)
    )
  );
  const availablePpgChannels = Array.from(
    new Set(
      ppgChannels.map((c) => c.label)
    )
  );

  function onToggleChannel(label) {
    setSelectedChannels((prev) => {
      if (prev.includes(label)) {
        return prev.filter((l) => l !== label);
      }
      return [...prev, label];
    });
  }

  function onTogglePpgChannel(label) {
    setSelectedPpgChannels((prev) => {
      if (prev.includes(label)) {
        return prev.filter((l) => l !== label);
      }
      return [...prev, label];
    });
  }

  // Default to all non-AUX channels once they appear
  useEffect(() => {
    if (availableChannels.length > 0 && selectedChannels.length === 0) {
      const defaultEnabled = availableChannels.filter(ch => ch !== 'AUXL' && ch !== 'AUXR');
      setSelectedChannels(defaultEnabled);
    }
  }, [availableChannels, selectedChannels.length]);

  // Default to all PPG channels once they appear
  useEffect(() => {
    if (availablePpgChannels.length > 0 && selectedPpgChannels.length === 0) {
      const preferred = ['IR', 'AMBIENT', 'RED'].filter((label) => availablePpgChannels.includes(label));
      setSelectedPpgChannels(preferred.length > 0 ? preferred : availablePpgChannels);
    }
  }, [availablePpgChannels, selectedPpgChannels.length]);

  useEffect(() => {
    if (availablePpgChannels.length === 0) return;
    setSelectedPpgChannels((prev) => prev.filter((label) => availablePpgChannels.includes(label)));
  }, [availablePpgChannels]);

  // Load defaults and then apply persisted settings
  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      const cacheBust = Date.now();
      const url = `${process.env.PUBLIC_URL}/default_settings.json?ts=${cacheBust}`;
      const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' } });
      if (!res.ok) {
        throw new Error(`Failed to load default_settings.json: HTTP ${res.status} ${res.statusText}`);
      }
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        throw new Error('Failed to load default_settings.json: received HTML (likely base path or SPA fallback)');
      }
      const data = await res.json();
      const defaults = { ...DEFAULT_SETTINGS, ...(data || {}) };
      if (!active) return;
      defaultSettingsRef.current = defaults;
      applySettings(defaults);
      try {
        const stored = JSON.parse(localStorage.getItem('meditrain-settings') || '{}');
        const merged = { ...defaults, ...(stored || {}) };
        applySettings(merged);
      } catch (e) {
        // ignore parse errors
      }
    };
    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const handleSaveSettings = useCallback(() => {
    const payload = {
      selectedChannels,
      selectedPpgChannels,
      shareTelemetry,
      shareAccelerometer,
      shareGyro,
      ppgSensorMapping,
      trainingTargets,
      bandWindowSec,
      spectrogramWindowSec,
      bandSmoothingSec,
      deltaSmoothingSec,
      eegTraceWindow,
      eegFftWindow,
      ppgTraceWindow,
      notchHz,
      spectrogramUseCachedSlices,
      artifactWindowSec,
      artifactStepSec,
      amplitudeRangeThreshold,
      lineNoiseHz,
      lineNoiseBandHz,
      lineNoiseMaxHz,
      lineNoiseRatioThreshold,
      rejectionOverlayMode,
      rejectionOverlayMaxWindows,
      showBandPower,
      showPeriodograms,
      showSpectrogram,
      showArtifactDiagnostics
    };
    localStorage.setItem('meditrain-settings', JSON.stringify(payload));
  }, [
    selectedChannels,
    selectedPpgChannels,
    shareTelemetry,
    shareAccelerometer,
    shareGyro,
    ppgSensorMapping,
    trainingTargets,
    bandWindowSec,
    spectrogramWindowSec,
    bandSmoothingSec,
    deltaSmoothingSec,
    eegTraceWindow,
    eegFftWindow,
    ppgTraceWindow,
    notchHz,
    spectrogramUseCachedSlices,
    artifactWindowSec,
    artifactStepSec,
    amplitudeRangeThreshold,
    lineNoiseHz,
    lineNoiseBandHz,
    lineNoiseMaxHz,
    lineNoiseRatioThreshold,
    rejectionOverlayMode,
    rejectionOverlayMaxWindows,
    showBandPower,
    showPeriodograms,
    showSpectrogram,
    showArtifactDiagnostics
  ]);

  const handleResetDefaults = useCallback(() => {
    applySettings(defaultSettingsRef.current || DEFAULT_SETTINGS);
    localStorage.removeItem('meditrain-settings');
  }, []);

  useEffect(() => {
    if (heartData.heartRateBpm == null) return;
    const now = Date.now();
    setHeartRateHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && now - last.t < 1000) {
        return prev;
      }
      const cutoff = now - heartObservatoryWindowMs;
      const next = [...prev, { t: now, v: heartData.heartRateBpm }].filter(p => p.t >= cutoff);
      return next;
    });
  }, [heartData.heartRateBpm, heartObservatoryWindowMs]);

  useEffect(() => {
    if (eegTraceWindow < eegFftWindow) {
      setEegTraceWindow(eegFftWindow);
    }
  }, [eegFftWindow, eegTraceWindow]);

  useEffect(() => {
    if (ppgTraceWindow < heartObservatorySamples) {
      setPpgTraceWindow(heartObservatorySamples);
    }
  }, [heartObservatorySamples, ppgTraceWindow]);

  const filteredEegData =
    selectedChannels.length === 0
      ? eegData
      : eegData.filter(c => selectedChannels.includes(c.label || c.electrode));
  const artifactChannels = useMemo(() => (
    filteredEegData.map((channel) => {
      const label = channel.label || channel.electrode;
      const samples = channel.samples?.slice(-eegTraceWindow) || [];
      const artifactWindows = Array.isArray(channel.artifactWindows) ? channel.artifactWindows : [];
      const latest = channel.artifactLatest || artifactWindows[artifactWindows.length - 1] || null;
      return {
        label,
        samples,
        artifactWindows,
        latest
      };
    })
  ), [filteredEegData, eegTraceWindow]);

  const integrateBandPower = useCallback((freqs, mags, minHz, maxHz) => {
    const xs = [];
    const ys = [];
    for (let i = 0; i < freqs.length; i += 1) {
      const f = freqs[i];
      if (f >= minHz && f < maxHz) {
        xs.push(f);
        ys.push(mags[i]);
      }
    }
    if (xs.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < xs.length; i += 1) {
      total += (xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1]) * 0.5;
    }
    return total;
  }, []);

  const median = useCallback((values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }, []);

  const robustPeriodogram = useCallback((periodograms) => {
    if (!periodograms || periodograms.length === 0) return null;
    const base = periodograms[0];
    if (!base?.frequencies || !base?.magnitudes) return null;
    const mags = base.magnitudes.map((_, idx) => {
      const vals = periodograms.map(p => p.magnitudes?.[idx]).filter(v => typeof v === 'number');
      return median(vals);
    });
    return { frequencies: base.frequencies, magnitudes: mags };
  }, [median]);

  // Always compute band snapshots from incoming FFTs, regardless of which panels are visible
  useEffect(() => {
    const channelList =
      selectedChannels.length === 0
        ? eegData
        : eegData.filter(c => selectedChannels.includes(c.label || c.electrode));

    const snapshots = [];
    const now = Date.now();
    channelList.forEach(electrode => {
      const label = electrode.label || electrode.electrode;
      if (electrode?.artifactLatest?.amplitudeArtifact || electrode?.artifactLatest?.lineNoiseArtifact) {
        const fallback = lastGoodSnapshotRef.current[label];
        if (fallback) {
          snapshots.push({ ...fallback, timestamp: now });
        }
        return;
      }
      const periodograms = electrode?.periodograms?.length ? electrode.periodograms : [];
      const robust = robustPeriodogram(periodograms);
      const periodogram = robust || electrode?.averagedPeriodogram;
      if (!periodogram) return;
      const bandTotals = {};
      let totalPower = 0;
      STANDARD_BANDS.forEach(({ key }) => {
        bandTotals[key] = 0;
      });
      const freqs = periodogram.frequencies;
      const mags = periodogram.magnitudes;
      STANDARD_BANDS.forEach(({ key, min, max }) => {
        const power = integrateBandPower(freqs, mags, min, max);
        bandTotals[key] += power;
        totalPower += power;
      });
      const bands = {};
      STANDARD_BANDS.forEach(({ key }) => {
        const absolute = bandTotals[key];
        bands[key] = {
          absolute,
          relative: totalPower > 0 ? absolute / totalPower : 0
        };
      });
      const snapshot = { label, bands, timestamp: now };
      lastGoodSnapshotRef.current[label] = snapshot;
      snapshots.push(snapshot);
    });

    const snapshotMap = Object.fromEntries(snapshots.map(s => [s.label, s]));
    function addAggregate(label, members) {
      const present = members.map(m => snapshotMap[m]).filter(Boolean);
      if (present.length === 0) return;
      const bandTotals = {};
      STANDARD_BANDS.forEach(({ key }) => { bandTotals[key] = 0; });
      present.forEach(snap => {
        STANDARD_BANDS.forEach(({ key }) => {
          bandTotals[key] += snap.bands?.[key]?.absolute || 0;
        });
      });
      const total = Object.values(bandTotals).reduce((sum, v) => sum + v, 0);
      const bands = {};
      STANDARD_BANDS.forEach(({ key }) => {
        const absolute = bandTotals[key];
        bands[key] = {
          absolute,
          relative: total > 0 ? absolute / total : 0
        };
      });
      snapshots.push({ label, bands, timestamp: now });
    }

    addAggregate('ALL', snapshots.map(s => s.label));
    addAggregate('PAIR_TP9_10', ['TP9', 'TP10']);
    addAggregate('PAIR_AF7_8', ['AF7', 'AF8']);

    setBandSnapshots(snapshots);
  }, [eegData, selectedChannels, integrateBandPower, robustPeriodogram]);

  // Maintain rolling history for band power over the same 120s window used by the charts
  useEffect(() => {
    const newSigs = {};
    let changed = false;
    bandSnapshots.forEach(s => {
      const sig = STANDARD_BANDS.map(b => s.bands?.[b.key]?.relative || 0).join('|');
      newSigs[s.label] = sig;
      if (!changed && lastBandSigRef.current[s.label] !== sig) {
        changed = true;
      }
    });
    if (
      !changed &&
      Object.keys(newSigs).length === Object.keys(lastBandSigRef.current).length &&
      Object.keys(newSigs).every(k => lastBandSigRef.current[k] === newSigs[k])
    ) {
      return;
    }
    lastBandSigRef.current = newSigs;

    const now = Date.now();
    const windowMs = bandWindowSec * 1000;
    const smoothMs = bandSmoothingSec * 1000;
    setBandHistory(prev => {
      const next = { ...prev };
      const active = new Set();
      bandSnapshots.forEach(snapshot => {
        const label = snapshot.label;
        active.add(label);
        if (!next[label]) next[label] = {};
        STANDARD_BANDS.forEach(({ key }) => {
          const val = snapshot.bands?.[key]?.relative;
          if (typeof val !== 'number') return;
          if (!next[label][key]) next[label][key] = [];
          const t = snapshot.timestamp || now;
          next[label][key].push({ t, v: val });
          while (next[label][key].length && next[label][key][0].t < t - windowMs) {
            next[label][key].shift();
          }
          // maintain simple moving average over smoothing window
          const smoothStart = t - smoothMs;
          const windowVals = next[label][key].filter(p => p.t >= smoothStart).map(p => p.v);
          const avg = windowVals.length ? windowVals.reduce((s, v) => s + v, 0) / windowVals.length : val;
          next[label][key].avg = avg;
        });
      });
      Object.keys(next).forEach(label => {
        if (!active.has(label)) delete next[label];
      });
      return next;
    });
  }, [bandSnapshots, bandWindowSec, bandSmoothingSec]);

  useEffect(() => {
    if (trainingTargets.length === 0) {
      setTargetSensitivity({});
      return;
    }
    const now = Date.now();
    setTargetSensitivity((prev) => {
      let changed = false;
      const next = { ...prev };
      const activeIds = new Set(trainingTargets.map(t => t.id));
      trainingTargets.forEach((target) => {
        if (!next[target.id]) {
          next[target.id] = { value: 1, lastUpdate: now, inZone: false };
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [trainingTargets]);

  useEffect(() => {
    if (trainingTargets.length === 0 || bandSnapshots.length === 0) return;
    const now = Date.now();
    const snapshotMap = new Map(bandSnapshots.map(s => [s.label, s]));
    const rateUpPerSec = 0.002;
    const rateDownPerSec = 0.008;
    const minSensitivity = 0.0;
    const maxSensitivity = 2.0;

    setTargetSensitivity((prev) => {
      let changed = false;
      const next = { ...prev };
      trainingTargets.forEach((target) => {
        const current = resolveTargetValue(target, snapshotMap);
        const baseTol = typeof target.tolerance === 'number' ? target.tolerance : 0;
        const prevState = next[target.id] || { value: 1, lastUpdate: now, inZone: false };
        const elapsedSec = Math.max(0, (now - prevState.lastUpdate) / 1000);
        if (elapsedSec === 0) {
          return;
        }
        const effectiveTol = prevState.value > 0 ? baseTol / prevState.value : baseTol;
        const inZone = typeof current === 'number'
          ? Math.abs(current - target.target) <= effectiveTol
          : prevState.inZone;
        const delta = (inZone ? rateUpPerSec : -rateDownPerSec) * elapsedSec;
        const updatedValue = Math.min(maxSensitivity, Math.max(minSensitivity, prevState.value + delta));
        const updated = {
          value: updatedValue,
          lastUpdate: now,
          inZone
        };
        if (
          updated.value !== prevState.value ||
          updated.inZone !== prevState.inZone ||
          updated.lastUpdate !== prevState.lastUpdate
        ) {
          next[target.id] = updated;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [bandSnapshots, trainingTargets]);

  const targetMetrics = useMemo(() => {
    const metrics = {};
    trainingTargets.forEach((target) => {
      const state = targetSensitivity[target.id] || { value: 1, inZone: false };
      const baseTol = typeof target.tolerance === 'number' ? target.tolerance : 0;
      const effectiveTolerance = state.value > 0 ? baseTol / state.value : baseTol;
      metrics[target.id] = {
        sensitivity: state.value,
        effectiveTolerance,
        inZone: state.inZone
      };
    });
    return metrics;
  }, [trainingTargets, targetSensitivity]);

  const targetReadings = useMemo(() => {
    const snapshotMap = new Map(bandSnapshots.map(s => [s.label, s]));
    const timestamp = bandSnapshots[0]?.timestamp || Date.now();
    return trainingTargets.map((target) => {
      const value = resolveTargetValue(target, snapshotMap);
      const metric = targetMetrics[target.id];
      return {
        id: target.id,
        label: target.label,
        model: getTargetModel(target),
        band: target.band ?? null,
        numeratorBand: target.numeratorBand ?? null,
        denominatorBand: target.denominatorBand ?? null,
        target: target.target,
        tolerance: metric?.effectiveTolerance ?? target.tolerance ?? 0,
        value,
        delta: typeof value === 'number' ? value - target.target : null,
        inZone: metric?.inZone ?? false,
        timestamp
      };
    });
  }, [bandSnapshots, trainingTargets, targetMetrics]);

  const effectiveTargets = useMemo(() => (
    trainingTargets.map((target) => {
      const metric = targetMetrics[target.id];
      return {
        ...target,
        tolerance: metric ? metric.effectiveTolerance : target.tolerance,
        baseTolerance: target.tolerance,
        sensitivity: metric ? metric.sensitivity : 1,
        inZone: metric ? metric.inZone : false
      };
    })
  ), [trainingTargets, targetMetrics]);

  useEffect(() => {
    if (effectiveTargets.length === 0) {
      setTargetHistory({});
      return;
    }
    const now = Date.now();
    const windowMs = bandWindowSec * 1000;
    setTargetHistory((prev) => {
      const next = { ...prev };
      effectiveTargets.forEach((target) => {
        if (getTargetModel(target) !== 'relative') return;
        const label = target.label;
        const band = target.band;
        if (!label || !band) return;
        if (!next[label]) next[label] = {};
        const series = next[label][band] ? [...next[label][band]] : [];
        series.push({
          t: now,
          target: target.target,
          tolerance: target.tolerance ?? 0,
          baseTolerance: target.baseTolerance ?? target.tolerance ?? 0,
          sensitivity: target.sensitivity ?? 1
        });
        next[label][band] = series.filter(p => p.t >= now - windowMs);
      });
      return next;
    });
  }, [effectiveTargets, bandWindowSec]);

  useEffect(() => {
    if (effectiveTargets.length === 0) {
      setTargetHistoryById({});
      return;
    }
    const now = Date.now();
    const windowMs = bandWindowSec * 1000;
    setTargetHistoryById((prev) => {
      const next = { ...prev };
      const activeIds = new Set(effectiveTargets.map(t => t.id));
      effectiveTargets.forEach((target) => {
        const series = next[target.id] ? [...next[target.id]] : [];
        series.push({
          t: now,
          target: target.target,
          tolerance: target.tolerance ?? 0,
          baseTolerance: target.baseTolerance ?? target.tolerance ?? 0,
          sensitivity: target.sensitivity ?? 1
        });
        next[target.id] = series.filter(p => p.t >= now - windowMs);
      });
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) delete next[id];
      });
      return next;
    });
  }, [effectiveTargets, bandWindowSec]);

  const downloadMetadata = useMemo(() => ({
    trainingTargets: effectiveTargets,
    targetMetrics,
    targetHistory,
    targetHistoryById,
    targetReadings,
    telemetry: sharedTelemetry,
    accelerometer: sharedAccelerometer,
    gyroscope: sharedGyro,
    telemetryHistory: {
      battery: batteryHistory,
      temperature: tempHistory
    },
    accelerometerHistory: {
      x: accelHistoryX,
      y: accelHistoryY,
      z: accelHistoryZ
    },
    gyroscopeHistory: {
      x: gyroHistoryX,
      y: gyroHistoryY,
      z: gyroHistoryZ
    },
    deviceInfo,
    ppgLabelMap,
    config: {
      bandWindowSec,
      bandSmoothingSec,
      deltaSmoothingSec,
      spectrogramWindowSec,
      eegTraceWindow,
      eegFftWindow,
      ppgTraceWindow,
      notchHz,
      spectrogramUseCachedSlices,
      artifactWindowSec,
      artifactStepSec,
      amplitudeRangeThreshold,
      lineNoiseHz,
      lineNoiseBandHz,
      lineNoiseMaxHz,
      lineNoiseRatioThreshold,
      rejectionOverlayMode,
      rejectionOverlayMaxWindows,
      ppgSensorMapping
    }
  }), [
    effectiveTargets,
    targetMetrics,
    targetHistory,
    targetHistoryById,
    targetReadings,
    sharedTelemetry,
    sharedAccelerometer,
    sharedGyro,
    batteryHistory,
    tempHistory,
    accelHistoryX,
    accelHistoryY,
    accelHistoryZ,
    gyroHistoryX,
    gyroHistoryY,
    gyroHistoryZ,
    deviceInfo,
    ppgLabelMap,
    bandWindowSec,
    bandSmoothingSec,
    deltaSmoothingSec,
    spectrogramWindowSec,
    eegTraceWindow,
    eegFftWindow,
    ppgTraceWindow,
    notchHz,
    spectrogramUseCachedSlices,
    artifactWindowSec,
    artifactStepSec,
    amplitudeRangeThreshold,
    lineNoiseHz,
    lineNoiseBandHz,
    lineNoiseMaxHz,
    lineNoiseRatioThreshold,
    rejectionOverlayMode,
    rejectionOverlayMaxWindows,
    ppgSensorMapping
  ]);

  const downloadSamples = useCallback(({ requireFullWindow = false } = {}) => {
    const last = lastEegReceivedAtRef.current;
    if (!last) return false;
    if (eegPacketsReceivedRef.current <= lastDownloadedPacketRef.current) return false;

    const downloadWindowSamples = Math.ceil((autoDownloadMs / 1000) * sampleRateHz);
    let active = (eegData || []).filter(c => c && c.samples && c.samples.length > 0);
    if (selectedChannels.length > 0) {
      active = active.filter(c => selectedChannels.includes(c.label || c.electrode));
    }
    if (requireFullWindow) {
      active = active.filter(c => c.samples.length >= downloadWindowSamples);
    }
    if (active.length === 0) return false;

    const availableCounts = active.map(c => c.samples.length);
    const windowSamples = requireFullWindow
      ? downloadWindowSamples
      : Math.min(...availableCounts);
    if (!windowSamples || windowSamples <= 0) return false;
    const exportResult = exportBrainVision({
      activeEeg: active,
      windowSamples,
      sampleRateHz,
      lastTimestampMs: last,
      notchHz,
      downloadMetadata,
      ppgChannels,
      ppgSampleRateHz
    });

    lastDownloadedPacketRef.current = eegPacketsReceivedRef.current;
    nextAutoDownloadAtRef.current = Date.now() + autoDownloadMs;
    const windowSec = exportResult.windowSec;
    setDownloadLogs((prev) => {
      const entry = {
        t: Date.now(),
        windowSec
      };
      return [...prev, entry].slice(-20);
    });
    return true;
  }, [
    autoDownloadMs,
    downloadMetadata,
    eegData,
    notchHz,
    ppgChannels,
    ppgSampleRateHz,
    sampleRateHz,
    selectedChannels
  ]);

  useEffect(() => {
    downloadSamplesRef.current = downloadSamples;
  }, [downloadSamples]);

  useEffect(() => {
    if (!autoDownloadEnabled) return undefined;
    if (!streamStatus.isStreaming) return undefined;
    if (autoDownloadMs <= 0) return undefined;
    if (!nextAutoDownloadAtRef.current) {
      nextAutoDownloadAtRef.current = Date.now() + autoDownloadMs;
    }
    const timer = setInterval(() => {
      if (eegPacketsReceivedRef.current === lastDownloadedPacketRef.current) return;
      if (downloadSamplesRef.current) downloadSamplesRef.current({ requireFullWindow: true });
    }, autoDownloadMs);

    return () => {
      clearInterval(timer);
      nextAutoDownloadAtRef.current = null;
    };
  }, [autoDownloadEnabled, autoDownloadMs, streamStatus.isStreaming]);

  useEffect(() => {
    if (!autoDownloadEnabled || !streamStatus.isStreaming || autoDownloadMs <= 0) {
      nextAutoDownloadAtRef.current = null;
      setAutoDownloadCountdownSec(null);
      return undefined;
    }
    const tick = () => {
      if (!nextAutoDownloadAtRef.current) {
        nextAutoDownloadAtRef.current = Date.now() + autoDownloadMs;
      }
      if (!nextAutoDownloadAtRef.current) {
        setAutoDownloadCountdownSec(null);
        return;
      }
      const remainingMs = Math.max(0, nextAutoDownloadAtRef.current - Date.now());
      setAutoDownloadCountdownSec(Math.ceil(remainingMs / 1000));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [autoDownloadEnabled, autoDownloadMs, streamStatus.isStreaming]);

  function upsertTarget(target) {
    setTrainingTargets(prev => {
      const existingIdx = prev.findIndex(t => t.id === target.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = target;
        return next;
      }
      return [...prev, target];
    });
  }

  function deleteTarget(id) {
    setTrainingTargets(prev => prev.filter(t => t.id !== id));
  }

  // Apply a preset profile from band_targets.json
  function applyPreset(profileName) {
    const profile = bandTargetPresets.profiles?.find(p => p.name === profileName);
    if (!profile) return;

    // Clear existing targets and build new ones from the preset
    const newTargets = [];
    profile.targets.forEach(targetGroup => {
      // Map electrodes to label format used by TrainingControl
      const electrodes = targetGroup.electrodes || [];
      const model = targetGroup.model || profile.model || 'relative';
      let label;
      if (electrodes.length === 2) {
        // Check for known pairs
        if (electrodes.includes('TP9') && electrodes.includes('TP10')) {
          label = 'PAIR_TP9_10';
        } else if (electrodes.includes('AF7') && electrodes.includes('AF8')) {
          label = 'PAIR_AF7_8';
        } else {
          // Use first electrode if pair not recognized
          label = electrodes[0];
        }
      } else if (electrodes.length === 1) {
        label = electrodes[0];
      } else {
        label = 'ALL';
      }

      if (model === 'ratio') {
        const ratios = targetGroup.ratios || {};
        Object.entries(ratios).forEach(([ratioKey, config]) => {
          if (!config?.numerator || !config?.denominator) return;
          newTargets.push({
            id: `preset-${profileName}-${label}-${ratioKey}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label,
            model: 'ratio',
            numeratorBand: config.numerator,
            denominatorBand: config.denominator,
            target: config.target,
            tolerance: config.tolerance
          });
        });
      } else {
        // Create a target for each band in this electrode group
        Object.entries(targetGroup.bands || {}).forEach(([band, config]) => {
          newTargets.push({
            id: `preset-${profileName}-${label}-${band}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label,
            model: 'relative',
            band,
            target: config.target,
            tolerance: config.tolerance
          });
        });
      }
    });

    setTrainingTargets(newTargets);
  }

  function clearAllTargets() {
    setTrainingTargets([]);
  }

  // Simple audio white noise driven by distance from targets
  useEffect(() => {
    if (!audioEnabled || trainingTargets.length === 0) {
      return;
    }
    audioSensitivityRef.current = { value: 1, lastUpdate: Date.now() };

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    noise.connect(gain).connect(ctx.destination);
    noise.start();
    audioCtxRef.current = ctx;
    gainRef.current = gain;
    noiseRef.current = noise;

    return () => {
      noise.stop();
      noise.disconnect();
      gain.disconnect();
      ctx.close();
      audioCtxRef.current = null;
      gainRef.current = null;
      noiseRef.current = null;
    };
  }, [audioEnabled, trainingTargets.length]);

  useEffect(() => {
    if (!audioEnabled || trainingTargets.length === 0) return;
    audioSensitivityRef.current = { value: 1, lastUpdate: Date.now() };
  }, [audioEnabled, trainingTargets]);

  useEffect(() => {
    if (!audioEnabled || !gainRef.current || trainingTargets.length === 0) {
      if (gainRef.current) gainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
      return;
    }
    // compute max distance outside target ranges
    let maxDistance = 0;
    let allMatched = true;
    const snapshotMap = new Map(bandSnapshots.map(s => [s.label, s]));
    trainingTargets.forEach(target => {
      const current = resolveTargetValue(target, snapshotMap);
      if (typeof current !== 'number') {
        allMatched = false;
        return;
      }
      const diff = Math.abs(current - target.target);
      const effectiveTol = targetMetrics[target.id]?.effectiveTolerance ?? target.tolerance ?? 0;
      const over = Math.max(0, diff - effectiveTol);
      if (over > maxDistance) maxDistance = over;
      if (over > 0) {
        allMatched = false;
      }
    });

    const now = Date.now();
    const sensitivityState = audioSensitivityRef.current;
    const elapsedSec = Math.max(0, (now - sensitivityState.lastUpdate) / 1000);
    const baseDecreasePerSec = 0.003;
    const matchedIncreasePerSec = 0.01;
    const minAudioSensitivity = 1.0;
    const maxAudioSensitivity = 2.0;
    const currentNorm = Math.max(0, Math.min(1, (maxDistance * 5) / sensitivityState.value));
    const allowIncrease = allMatched && currentNorm <= 0.5;
    const delta = (allowIncrease ? matchedIncreasePerSec : -baseDecreasePerSec) * elapsedSec;
    const nextSensitivity = Math.min(
      maxAudioSensitivity,
      Math.max(minAudioSensitivity, sensitivityState.value + delta)
    );
    audioSensitivityRef.current = { value: nextSensitivity, lastUpdate: now };

    const norm = Math.max(0, Math.min(1, (maxDistance * 5) / nextSensitivity)); // higher sensitivity reduces feedback
    if (gainRef.current) {
      gainRef.current.gain.setTargetAtTime(norm * 0.2, audioCtxRef.current.currentTime, 0.05);
    }
  }, [audioEnabled, trainingTargets, bandSnapshots, targetMetrics]);

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <header className="hero">
        <div>
          <p className="eyebrow">Meditrain</p>
          <h1>EEG Biofeedback Lab</h1>
          <p>Connect a Muse headset, monitor brain rhythm trends in real time, and experiment with band-power training loops.</p>
          <div className="stat-row">
            <div className="stat-card">
              <p className="stat-label">Active Electrodes</p>
              <p className="stat-value">{activeElectrodes || '—'}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Samples Buffered</p>
              <p className="stat-value">{totalSamples || '—'}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Periodograms</p>
              <p className="stat-value">{totalPeriodograms || '—'}</p>
            </div>
          </div>
        </div>
        <div className="hero-card">
          <h3>Live Device & Signal</h3>
          <p>Connect, stream EEG, and preview channels without leaving this dashboard.</p>
          <DeviceControl
            onEegPacket={handleEegPacket}
            onPpgPacket={handlePpgPacket}
            onChannelMap={handleChannelMaps}
            onTelemetryPacket={handleTelemetryPacket}
            onAccelerometerPacket={handleAccelerometerPacket}
            onGyroPacket={handleGyroPacket}
            onDeviceInfo={handleDeviceInfo}
            onStreamStatus={setStreamStatus}
            eegData={eegData}
            ppgChannels={ppgChannels}
            channelMaps={channelMaps}
            onDeviceDebug={setDeviceDebug}
            selectedChannels={selectedChannels}
            onToggleChannel={onToggleChannel}
            availableChannels={availableChannels}
            availablePpgChannels={availablePpgChannels}
            selectedPpgChannels={selectedPpgChannels}
            onTogglePpgChannel={onTogglePpgChannel}
            shareTelemetry={shareTelemetry}
            shareAccelerometer={shareAccelerometer}
            shareGyro={shareGyro}
            onToggleShareTelemetry={() => setShareTelemetry(prev => !prev)}
            onToggleShareAccelerometer={() => setShareAccelerometer(prev => !prev)}
            onToggleShareGyro={() => setShareGyro(prev => !prev)}
            deviceInfo={deviceInfo}
            deviceType={deviceType}
            ppgLabelMap={ppgLabelMap}
            lastFFT={lastFFT}
            sampleRateHz={sampleRateHz}
            ppgSampleRateHz={ppgSampleRateHz}
            traceWindow={eegTraceWindow}
            fftWindow={eegFftWindow}
            ppgTraceWindow={ppgTraceWindow}
          />
        </div>
      </header>

      <main className="content-grid">
        <section className={`panel tall ${fullscreenPanel === 'bandpower' ? 'fullscreen' : ''}`}>
          <PanelHeading
            title="Band Power Observatory"
            subtitle="Alpha / Beta / Gamma with regional deltas"
            indicator={(
              <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
                {lastFFT ? `${Math.round((Date.now() - lastFFT) / 1000)}s` : '—'}
              </span>
            )}
          >
            <PanelControls>
              <PanelControlButton
                pressed={showBandPower}
                ariaLabel={showBandPower ? 'Hide band power' : 'Show band power'}
                title={showBandPower ? 'Hide band power' : 'Show band power'}
                onClick={() => setShowBandPower(v => !v)}
              >
                {showBandPower ? controlIcons.hide : controlIcons.show}
              </PanelControlButton>
              <PanelControlButton
                pressed={fullscreenPanel === 'bandpower'}
                ariaLabel={fullscreenPanel === 'bandpower' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'bandpower' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'bandpower' ? null : 'bandpower')}
              >
                {fullscreenPanel === 'bandpower' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">
            Toggle into band views to compare electrodes, see averaged periodograms, and spot left/right imbalances.
            Targets (if defined) are shaded on each band line; a preview appears when no live data is available.
          </p>
          {showBandPower && (
            <BandPower
              bandHistory={bandHistory}
              trainingTargets={effectiveTargets}
              targetHistory={targetHistory}
              windowSeconds={bandWindowSec}
            />
          )}
        </section>

        <section className={`panel ${fullscreenPanel === 'training' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Training Console" subtitle="Targets & feedback">
            <PanelControls>
              <PanelControlButton
                pressed={fullscreenPanel === 'training'}
                ariaLabel={fullscreenPanel === 'training' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'training' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'training' ? null : 'training')}
              >
                {fullscreenPanel === 'training' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Select targets, pick a feedback mode, and monitor how often you stay in the pocket.</p>
          <TrainingControl
            availableChannels={availableChannels}
            selectedTargets={trainingTargets}
            bandSnapshots={bandSnapshots}
            bandHistory={bandHistory}
            targetHistoryById={targetHistoryById}
            deltaSmoothingSec={deltaSmoothingSec}
            onSaveTarget={upsertTarget}
            onDeleteTarget={deleteTarget}
            audioEnabled={audioEnabled}
            onToggleAudio={setAudioEnabled}
            presets={bandTargetPresets.profiles || []}
            presetsLoading={presetsLoading}
            presetsError={presetsError}
            onApplyPreset={applyPreset}
            onClearTargets={clearAllTargets}
            targetMetrics={targetMetrics}
          />
          <TrainingView />
        </section>

        <section className={`panel ${fullscreenPanel === 'telemetry' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Telemetry" subtitle="Battery, temperature, motion sensors">
            <PanelControls>
              <PanelControlButton
                pressed={fullscreenPanel === 'telemetry'}
                ariaLabel={fullscreenPanel === 'telemetry' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'telemetry' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'telemetry' ? null : 'telemetry')}
              >
                {fullscreenPanel === 'telemetry' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Latest sensor readings plus rolling charts for device health.</p>
          <div className="inline-status" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="status-pill">
              Battery: {sharedTelemetry?.batteryLevel != null ? `${sharedTelemetry.batteryLevel}%` : '—'}
            </span>
            <span className="status-pill">
              Temp: {sharedTelemetry?.temperature != null ? `${sharedTelemetry.temperature.toFixed(1)}°C` : '—'}
            </span>
            <span className="status-pill">
              Accel: {sharedAccelerometer?.samples?.length
                ? `x${sharedAccelerometer.samples.at(-1)?.x?.toFixed(2) ?? '—'} y${sharedAccelerometer.samples.at(-1)?.y?.toFixed(2) ?? '—'} z${sharedAccelerometer.samples.at(-1)?.z?.toFixed(2) ?? '—'}`
                : '—'}
            </span>
            <span className="status-pill">
              Gyro: {sharedGyro?.samples?.length
                ? `x${sharedGyro.samples.at(-1)?.x?.toFixed(2) ?? '—'} y${sharedGyro.samples.at(-1)?.y?.toFixed(2) ?? '—'} z${sharedGyro.samples.at(-1)?.z?.toFixed(2) ?? '—'}`
                : '—'}
            </span>
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Battery (%)</p>
            <TimeSeriesLineChart points={batteryHistory} windowSec={TELEMETRY_WINDOW_SEC} height={140} />
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Temperature (°C)</p>
            <TimeSeriesLineChart points={tempHistory} windowSec={TELEMETRY_WINDOW_SEC} height={140} />
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Accelerometer X</p>
            <TimeSeriesLineChart points={accelHistoryX} windowSec={TELEMETRY_WINDOW_SEC} height={120} />
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Accelerometer Y</p>
            <TimeSeriesLineChart points={accelHistoryY} windowSec={TELEMETRY_WINDOW_SEC} height={120} />
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Accelerometer Z</p>
            <TimeSeriesLineChart points={accelHistoryZ} windowSec={TELEMETRY_WINDOW_SEC} height={120} />
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Gyroscope X</p>
            <TimeSeriesLineChart points={gyroHistoryX} windowSec={TELEMETRY_WINDOW_SEC} height={120} />
          </div>
          <div className="chart-block" style={{ marginBottom: 10 }}>
            <p className="chart-label">Gyroscope Y</p>
            <TimeSeriesLineChart points={gyroHistoryY} windowSec={TELEMETRY_WINDOW_SEC} height={120} />
          </div>
          <div className="chart-block">
            <p className="chart-label">Gyroscope Z</p>
            <TimeSeriesLineChart points={gyroHistoryZ} windowSec={TELEMETRY_WINDOW_SEC} height={120} />
          </div>
        </section>

        <section className={`panel ${fullscreenPanel === 'heart' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Heart Observatory" subtitle="PPG heart rate + SpO2 estimate">
            <PanelControls>
              <PanelControlButton
                pressed={fullscreenPanel === 'heart'}
                ariaLabel={fullscreenPanel === 'heart' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'heart' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'heart' ? null : 'heart')}
              >
                {fullscreenPanel === 'heart' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Combined PPG pulse trace, cardiogram, and SpO2 (ratio-of-ratios).</p>
          <p className="subdued">
            SpO2 debug: IR={heartData.spo2Labels?.ir || '—'} ({heartData.ppgChannelsAll?.find(c => c.label === heartData.spo2Labels?.ir)?.samples?.length || 0})
            · RED={heartData.spo2Labels?.red || '—'} ({heartData.ppgChannelsAll?.find(c => c.label === heartData.spo2Labels?.red)?.samples?.length || 0})
            · {heartData.spo2Debug?.ok ? 'OK' : `BLOCKED (${heartData.spo2Debug?.reason || 'NO_DATA'})`}
            {heartData.spo2Debug?.piIr != null && heartData.spo2Debug?.piRed != null
              ? ` PI=${heartData.spo2Debug.piIr.toFixed(4)}/${heartData.spo2Debug.piRed.toFixed(4)}`
              : ''}
            {heartData.spo2Debug?.ratio != null ? ` R=${heartData.spo2Debug.ratio.toFixed(3)}` : ''}
          </p>
          <div className="inline-status" style={{ marginBottom: 10 }}>
            <span className="status-pill">
              Heart rate: {heartData.heartRateBpm != null ? `${heartData.heartRateBpm} bpm` : '—'}
            </span>
            <span className="status-pill">
              Pulse channel (auto): {heartData.pulseChannelLabel || '—'}
            </span>
            <span className="status-pill">
              SpO2: {heartData.spo2 != null ? `${heartData.spo2.toFixed(0)}%` : '—'}
            </span>
            <span className="status-pill">
              R (red/IR): {heartData.spo2Ratio != null ? heartData.spo2Ratio.toFixed(3) : '—'}
            </span>
            <span className="status-pill">
              PI (IR/Red): {heartData.perfusionIndexIr != null && heartData.perfusionIndexRed != null
                ? `${heartData.perfusionIndexIr.toFixed(3)} / ${heartData.perfusionIndexRed.toFixed(3)}`
                : '—'}
            </span>
            <span className="status-pill">
              PPG: {heartData.ppgChannels?.length ? heartData.ppgChannels.map(c => c.label).join(' + ') : '—'}
            </span>
            <span className="status-pill">
              SpO2 channels: {heartData.spo2Labels ? `${heartData.spo2Labels.ir} / ${heartData.spo2Labels.red}` : '—'}
            </span>
          </div>
          {heartData.combinedPpg ? (
            <>
              <div className="chart-block" style={{ marginBottom: 10 }}>
                <p className="chart-label">PPG combined</p>
                <EEGTraceChart
                  samples={heartData.combinedPpg.samples.slice(-heartObservatorySamples)}
                  height={220}
                  maxPoints={2400}
                />
              </div>
              <div className="chart-block" style={{ marginBottom: 10 }}>
                <p className="chart-label">Cardiogram (last 5 beats)</p>
                {heartData.cardiogramPpg ? (
                  <EEGTraceChart
                    samples={heartData.cardiogramPpg.samples}
                    height={180}
                    maxPoints={1800}
                  />
                ) : (
                  <p className="subdued">Waiting for cardiogram samples.</p>
                )}
              </div>
              <div className="chart-block">
                <p className="chart-label">Heart rate (15s average)</p>
                <TimeSeriesLineChart points={heartRateHistory} windowSec={HEART_OBSERVATORY_WINDOW_SEC} height={160} />
              </div>
            </>
          ) : (
            <p className="subdued">Waiting for PPG data.</p>
          )}
        </section>

        <section className={`panel ${fullscreenPanel === 'config' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Configuration" subtitle="Display windows">
            <PanelControls>
              <PanelControlButton
                pressed={fullscreenPanel === 'config'}
                ariaLabel={fullscreenPanel === 'config' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'config' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'config' ? null : 'config')}
              >
                {fullscreenPanel === 'config' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Adjust how many seconds of history are rendered for band power and spectrograms.</p>
          <div className="inline-buttons" style={{ marginBottom: 12 }}>
            <button type="button" onClick={handleSaveSettings}>Save</button>
            <button type="button" onClick={handleResetDefaults}>Defaults</button>
          </div>
          <div className="inline-buttons">
            <label className="field">
              <span>Band power window (s)</span>
              <input
                type="number"
                min="10"
                max="28800"
                value={bandWindowSec}
                onChange={(e) => setBandWindowSec(Math.max(10, Math.min(28800, Number(e.target.value))))}
              />
            </label>
            <label className="field">
              <span>Band power smoothing (s)</span>
              <input
                type="number"
                min="1"
                max={bandWindowSec}
                value={bandSmoothingSec}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(bandWindowSec, Number(e.target.value)));
                  setBandSmoothingSec(val);
                }}
              />
            </label>
            <label className="field">
              <span>Spectrogram window (s)</span>
              <input
                type="number"
                min="10"
                max="900"
                value={spectrogramWindowSec}
                onChange={(e) => setSpectrogramWindowSec(Math.max(10, Math.min(900, Number(e.target.value))))}
              />
            </label>
            <label className="field">
              <span>Training delta smoothing (s)</span>
              <input
                type="number"
                min="1"
                max="900"
                value={deltaSmoothingSec}
                onChange={(e) => setDeltaSmoothingSec(Math.max(1, Math.min(900, Number(e.target.value))))}
              />
            </label>
            <label className="field">
              <span>Notch filter Hz</span>
              <select
                value={notchHz}
                onChange={(e) => setNotchHz(Number(e.target.value))}
              >
                <option value={50}>50 Hz</option>
                <option value={60}>60 Hz</option>
              </select>
            </label>
          </div>
          <p className="subdued">Tune buffer sizes for trace rendering and FFT processing.</p>
          <div className="inline-buttons">
            <label className="field">
              <span>EEG trace window (samples)</span>
              <input
                type="number"
                min="512"
                max="16384"
                value={eegTraceWindow}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setEegTraceWindow(Math.max(eegFftWindow, Math.min(16384, val)));
                }}
              />
            </label>
            <label className="field">
              <span>EEG FFT window (samples)</span>
              <input
                type="number"
                min="256"
                max="4096"
                value={eegFftWindow}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setEegFftWindow(Math.max(256, Math.min(4096, val)));
                }}
              />
            </label>
            <label className="field">
              <span>PPG trace window (samples)</span>
              <input
                type="number"
                min="256"
                max="4096"
                value={ppgTraceWindow}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setPpgTraceWindow(Math.max(256, Math.min(4096, val)));
                }}
              />
            </label>
          </div>
          <p className="subdued">Artifact detection uses amplitude range and line-noise ratios.</p>
          <div className="inline-buttons">
            <label className="field">
              <span>Artifact window (s)</span>
              <input
                type="number"
                min="0.5"
                max="10"
                step="0.5"
                value={artifactWindowSec}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setArtifactWindowSec(Math.max(0.5, Math.min(10, val)));
                }}
              />
            </label>
            <label className="field">
              <span>Artifact step (s)</span>
              <input
                type="number"
                min="0.25"
                max="5"
                step="0.25"
                value={artifactStepSec}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setArtifactStepSec(Math.max(0.25, Math.min(5, val)));
                }}
              />
            </label>
            <label className="field">
              <span>Amplitude range threshold</span>
              <input
                type="number"
                min="10"
                max="500"
                step="5"
                value={amplitudeRangeThreshold}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setAmplitudeRangeThreshold(Math.max(10, Math.min(500, val)));
                }}
              />
            </label>
            <label className="field">
              <span>Line-noise ratio threshold</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={lineNoiseRatioThreshold}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setLineNoiseRatioThreshold(Math.max(0, Math.min(1, val)));
                }}
              />
            </label>
          </div>
          <div className="inline-buttons">
            <label className="field">
              <span>Line-noise Hz</span>
              <input
                type="number"
                min="50"
                max="70"
                step="1"
                value={lineNoiseHz}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setLineNoiseHz(Math.max(50, Math.min(70, val)));
                }}
              />
            </label>
            <label className="field">
              <span>Line-noise band (Hz)</span>
              <input
                type="number"
                min="0.5"
                max="6"
                step="0.5"
                value={lineNoiseBandHz}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setLineNoiseBandHz(Math.max(0.5, Math.min(6, val)));
                }}
              />
            </label>
            <label className="field">
              <span>Line-noise max Hz</span>
              <input
                type="number"
                min="20"
                max="120"
                step="5"
                value={lineNoiseMaxHz}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setLineNoiseMaxHz(Math.max(20, Math.min(120, val)));
                }}
              />
            </label>
          </div>
          <div className="inline-buttons">
            <label className="field">
              <span>Rejection overlay mode</span>
              <select
                value={rejectionOverlayMode}
                onChange={(e) => setRejectionOverlayMode(e.target.value)}
              >
                <option value="auto">auto</option>
                <option value="always">always</option>
                <option value="off">off</option>
              </select>
            </label>
            <label className="field">
              <span>Overlay max windows</span>
              <input
                type="number"
                min="20"
                max="1000"
                step="10"
                value={rejectionOverlayMaxWindows}
                onChange={(e) => {
                  const val = e.target.valueAsNumber;
                  if (Number.isNaN(val)) return;
                  setRejectionOverlayMaxWindows(Math.max(20, Math.min(1000, val)));
                }}
              />
            </label>
          </div>
        </section>

        <section className={`panel ${fullscreenPanel === 'periodograms' ? 'fullscreen' : ''}`}>
          <PanelHeading
            title="Band Periodograms"
            subtitle="Per-channel spectra (weighted selection)"
            indicator={(
              <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
                {lastFFT ? `${Math.round((Date.now() - lastFFT) / 1000)}s` : '—'}
              </span>
            )}
          >
            <PanelControls>
              <PanelControlButton
                pressed={showPeriodograms}
                ariaLabel={showPeriodograms ? 'Hide periodograms' : 'Show periodograms'}
                title={showPeriodograms ? 'Hide periodograms' : 'Show periodograms'}
                onClick={() => setShowPeriodograms(v => !v)}
              >
                {showPeriodograms ? controlIcons.hide : controlIcons.show}
              </PanelControlButton>
              <PanelControlButton
                pressed={fullscreenPanel === 'periodograms'}
                ariaLabel={fullscreenPanel === 'periodograms' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'periodograms' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'periodograms' ? null : 'periodograms')}
              >
                {fullscreenPanel === 'periodograms' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Live per-channel periodograms up to 50 Hz (uses selected sensors).</p>
          {showPeriodograms && (
            <BandPeriodograms eegData={filteredEegData} selectedChannels={selectedChannels} />
          )}
        </section>

        <section className={`panel tall ${fullscreenPanel === 'spectrogram' ? 'fullscreen' : ''}`}>
          <PanelHeading
            title="Spectrogram"
            subtitle="Per-channel heatmaps"
            indicator={(
              <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
                {lastFFT ? `${Math.round((Date.now() - lastFFT) / 1000)}s` : '—'}
              </span>
            )}
          >
            <PanelControls>
              <label className="panel-toggle">
                <input
                  type="checkbox"
                  checked={spectrogramUseCachedSlices}
                  onChange={(e) => setSpectrogramUseCachedSlices(e.target.checked)}
                />
                <span>Cached FFT</span>
              </label>
              <PanelControlButton
                pressed={showSpectrogram}
                ariaLabel={showSpectrogram ? 'Hide spectrogram' : 'Show spectrogram'}
                title={showSpectrogram ? 'Hide spectrogram' : 'Show spectrogram'}
                onClick={() => setShowSpectrogram(v => !v)}
              >
                {showSpectrogram ? controlIcons.hide : controlIcons.show}
              </PanelControlButton>
              <PanelControlButton
                pressed={fullscreenPanel === 'spectrogram'}
                ariaLabel={fullscreenPanel === 'spectrogram' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'spectrogram' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'spectrogram' ? null : 'spectrogram')}
              >
                {fullscreenPanel === 'spectrogram' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Live per-channel spectrograms up to 50 Hz, honoring your sensor selection.</p>
          {showSpectrogram && (
            <Spectrogram
              eegData={filteredEegData}
              selectedChannels={selectedChannels}
              windowSeconds={spectrogramWindowSec}
              preferCachedSlices={spectrogramUseCachedSlices}
            />
          )}
        </section>

        <section className={`panel ${fullscreenPanel === 'downloads' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Session Exports" subtitle="Download EEG/PPG snapshots">
            <PanelControls>
              <PanelControlButton
                pressed={fullscreenPanel === 'downloads'}
                ariaLabel={fullscreenPanel === 'downloads' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'downloads' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'downloads' ? null : 'downloads')}
              >
                {fullscreenPanel === 'downloads' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">
            Export BrainVision EEG plus BIDS sidecars (and PPG TSV when available). Auto-download runs while streaming.
          </p>
          <div className="inline-status" style={{ marginBottom: 8 }}>
            <label className="field" style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={autoDownloadEnabled}
                onChange={(e) => setAutoDownloadEnabled(e.target.checked)}
              />
              <span style={{ marginLeft: 8 }}>
                Auto-download every {Math.max(1, Math.round(autoDownloadMs / 1000))}s
              </span>
            </label>
            <span className="status-pill">
              Next export: {autoDownloadCountdownSec != null ? `${autoDownloadCountdownSec}s` : '—'}
            </span>
            <span className={`status-pill ${streamStatus.isStreaming ? '' : 'warn'}`}>
              {streamStatus.isStreaming ? 'Streaming' : 'Not streaming'}
            </span>
          </div>
          {downloadLogs.length > 0 ? (
            <div className="chart-block">
              <p className="chart-label">Export log (last 20)</p>
              <div className="inline-status" style={{ flexWrap: 'wrap' }}>
                {downloadLogs.slice().reverse().map((entry) => (
                  <span className="status-pill" key={entry.t}>
                    {new Date(entry.t).toLocaleTimeString()} · {entry.windowSec}s window
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="subdued">No exports yet.</p>
          )}
        </section>

        <section className={`panel device-debug ${fullscreenPanel === 'device-debug' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Device Debug" subtitle="Connection + telemetry log">
            <PanelControls>
              <PanelControlButton
                pressed={fullscreenPanel === 'device-debug'}
                ariaLabel={fullscreenPanel === 'device-debug' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'device-debug' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'device-debug' ? null : 'device-debug')}
              >
                {fullscreenPanel === 'device-debug' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">Full device diagnostics for troubleshooting disconnects and data flow.</p>
          {deviceDebug ? (
            <>
              {deviceDebug.eventLog?.length > 0 ? (
                <pre ref={deviceDebugPreRef} className="debug-pre">
                  {deviceDebug.eventLog
                    .map((entry) => {
                      const ts = new Date(entry.t).toISOString().split('T')[1].replace('Z', '');
                      return `${ts} | ${entry.msg}`;
                    })
                    .join('\n')}
                </pre>
              ) : (
                <p className="subdued">No connection events yet.</p>
              )}
            </>
          ) : (
            <p className="subdued">Waiting for device status.</p>
          )}
        </section>

        <section className={`panel tall ${fullscreenPanel === 'artifacts' ? 'fullscreen' : ''}`}>
          <PanelHeading title="Artifact Rejection Diagnostics" subtitle="Amplitude range + line noise">
            <PanelControls>
              <PanelControlButton
                pressed={showArtifactDiagnostics}
                ariaLabel={showArtifactDiagnostics ? 'Hide artifact diagnostics' : 'Show artifact diagnostics'}
                title={showArtifactDiagnostics ? 'Hide artifact diagnostics' : 'Show artifact diagnostics'}
                onClick={() => setShowArtifactDiagnostics(v => !v)}
              >
                {showArtifactDiagnostics ? controlIcons.hide : controlIcons.show}
              </PanelControlButton>
              <PanelControlButton
                pressed={fullscreenPanel === 'artifacts'}
                ariaLabel={fullscreenPanel === 'artifacts' ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreenPanel === 'artifacts' ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => setFullscreenPanel(prev => prev === 'artifacts' ? null : 'artifacts')}
              >
                {fullscreenPanel === 'artifacts' ? controlIcons.collapse : controlIcons.expand}
              </PanelControlButton>
            </PanelControls>
          </PanelHeading>
          <p className="subdued">
            Each trace is shaded where amplitude range or line noise exceeds the configured thresholds.
          </p>
          {showArtifactDiagnostics && (
            artifactChannels.length > 0 ? (
              <div className="channel-grid">
                {artifactChannels.map((channel) => {
                  const windows = channel.artifactWindows || [];
                  const overlayMode = String(rejectionOverlayMode || 'auto').toLowerCase();
                  const overlayOk = overlayMode === 'always'
                    || (overlayMode === 'auto' && windows.length <= rejectionOverlayMaxWindows);
                  const overlays = overlayOk
                    ? windows
                      .filter(w => w.amplitudeArtifact || w.lineNoiseArtifact)
                      .map((w) => {
                        let color = '#f97316';
                        if (w.amplitudeArtifact && w.lineNoiseArtifact) {
                          color = '#ef4444';
                        } else if (w.lineNoiseArtifact) {
                          color = '#60a5fa';
                        }
                        return {
                          start: w.startSample,
                          end: w.endSample,
                          color
                        };
                      })
                    : [];
                  const amplitudeHits = windows.filter(w => w.amplitudeArtifact).length;
                  const lineNoiseHits = windows.filter(w => w.lineNoiseArtifact).length;
                  const bothHits = windows.filter(w => w.amplitudeArtifact && w.lineNoiseArtifact).length;
                  const latest = channel.latest;
                  return (
                    <div className="channel-card" key={channel.label}>
                      <div className="channel-header">
                        <div>
                          <p className="eyebrow">{channel.label}</p>
                          <p className="channel-meta">
                            Windows: {windows.length} • amplitude hits: {amplitudeHits} • line-noise hits: {lineNoiseHits} • both: {bothHits}
                          </p>
                        </div>
                      </div>
                      <div className="inline-status">
                        <span className={`status-pill ${latest?.amplitudeArtifact ? 'warn' : ''}`}>
                          Amplitude range: {latest ? latest.amplitudeRange.toFixed(1) : '—'} (thr {amplitudeRangeThreshold})
                        </span>
                        <span className={`status-pill ${latest?.lineNoiseArtifact ? 'warn' : ''}`}>
                          Line-noise ratio: {latest ? latest.lineNoiseRatio.toFixed(3) : '—'} (thr {lineNoiseRatioThreshold})
                        </span>
                        {!overlayOk && (
                          <span className="status-pill">Overlays off (windows {windows.length})</span>
                        )}
                      </div>
                      <div className="chart-block">
                        <p className="chart-label">EEG trace (last {eegTraceWindow} samples)</p>
                        {channel.samples.length > 0 ? (
                          <EEGTraceChart
                            samples={channel.samples}
                            overlays={overlays}
                            height={140}
                            maxPoints={1200}
                          />
                        ) : (
                          <p className="subdued">No samples yet.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="subdued">Waiting for EEG samples.</p>
            )
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
