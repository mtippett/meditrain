import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MuseData from '../MuseData';
import ConfigWeights from '../ConfigWeights';
import { averagedPeriodogram, calcPeriodogram, calcRawPeriodogram } from '../math/Periodogram.js';
import MultiEEGTraceChart from '../ui/MultiEEGTraceChart';

const DEFAULT_SAMPLE_RATE_HZ = 256; // Muse sampling rate
const DEFAULT_AUTO_DOWNLOAD_MS = 60000;
const DEFAULT_PPG_SAMPLE_RATE_HZ = 64;
const DEFAULT_FFT_WINDOW = 1024; // samples used per FFT (~4s at 256 Hz)
const DEFAULT_TRACE_WINDOW = 4096; // visible trace window (~16s at 256 Hz)
const DEFAULT_PPG_TRACE_WINDOW = 1024; // visible trace window (~16s at 64 Hz)
const DEFAULT_SPECTROGRAM_WINDOW_SEC = 300;
const STREAM_STALE_MS = 5000;
const DEFAULT_NOTCH_HZ = 50;
const DEFAULT_ARTIFACT_WINDOW_SEC = 2;
const DEFAULT_ARTIFACT_STEP_SEC = 1;
const DEFAULT_AMPLITUDE_RANGE_THRESHOLD = 150;
const DEFAULT_LINE_NOISE_HZ = 60;
const DEFAULT_LINE_NOISE_BAND_HZ = 2;
const DEFAULT_LINE_NOISE_MAX_HZ = 80;
const DEFAULT_LINE_NOISE_RATIO_THRESHOLD = 0.2;

function computeLineNoiseRatio(samples, sampleRateHz, lineNoiseHz, bandHz, maxHz) {
  if (!samples || samples.length < 8) return 0;
  const { frequencies, magnitudes } = calcRawPeriodogram(samples, sampleRateHz);
  if (!frequencies.length) return 0;
  const halfBand = Math.max(0.1, bandHz / 2);
  let totalPower = 0;
  let linePower = 0;
  for (let i = 0; i < frequencies.length; i += 1) {
    const freq = frequencies[i];
    if (freq < 0.5) continue;
    if (maxHz != null && freq > maxHz) continue;
    const power = magnitudes[i];
    totalPower += power;
    if (Math.abs(freq - lineNoiseHz) <= halfBand) {
      linePower += power;
    }
  }
  if (totalPower <= 0) return 0;
  return linePower / totalPower;
}

function computeArtifactWindows(samples, sampleRateHz, options) {
  const {
    windowSamples,
    stepSamples,
    amplitudeRangeThreshold,
    lineNoiseRatioThreshold,
    lineNoiseHz,
    lineNoiseBandHz,
    lineNoiseMaxHz
  } = options;
  if (!samples || samples.length < windowSamples) return [];
  const windows = [];
  for (let start = 0; start + windowSamples <= samples.length; start += stepSamples) {
    const slice = samples.slice(start, start + windowSamples);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < slice.length; i += 1) {
      const v = slice[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const amplitudeRange = Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
    const lineNoiseRatio = computeLineNoiseRatio(
      slice,
      sampleRateHz,
      lineNoiseHz,
      lineNoiseBandHz,
      lineNoiseMaxHz
    );
    const amplitudeArtifact = amplitudeRangeThreshold != null && amplitudeRange > amplitudeRangeThreshold;
    const lineNoiseArtifact = lineNoiseRatioThreshold != null && lineNoiseRatio > lineNoiseRatioThreshold;
    windows.push({
      startSample: start,
      endSample: start + windowSamples,
      amplitudeRange,
      lineNoiseRatio,
      amplitudeArtifact,
      lineNoiseArtifact
    });
  }
  return windows;
}

function DeviceControl({
  onPeriodgramUpdated,
  onPpgUpdate,
  onDeviceDebug,
  selectedChannels = [],
  onToggleChannel,
  availableChannels = [],
  lastFFT: externalLastFFT = null,
  sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
  ppgSampleRateHz = DEFAULT_PPG_SAMPLE_RATE_HZ,
  fftWindow = DEFAULT_FFT_WINDOW,
  traceWindow = DEFAULT_TRACE_WINDOW,
  ppgTraceWindow = DEFAULT_PPG_TRACE_WINDOW,
  spectrogramWindowSec = DEFAULT_SPECTROGRAM_WINDOW_SEC,
  autoDownloadMs = DEFAULT_AUTO_DOWNLOAD_MS,
  notchHz = DEFAULT_NOTCH_HZ,
  downloadMetadata = null,
  artifactWindowSec = DEFAULT_ARTIFACT_WINDOW_SEC,
  artifactStepSec = DEFAULT_ARTIFACT_STEP_SEC,
  amplitudeRangeThreshold = DEFAULT_AMPLITUDE_RANGE_THRESHOLD,
  lineNoiseHz = DEFAULT_LINE_NOISE_HZ,
  lineNoiseBandHz = DEFAULT_LINE_NOISE_BAND_HZ,
  lineNoiseMaxHz = DEFAULT_LINE_NOISE_MAX_HZ,
  lineNoiseRatioThreshold = DEFAULT_LINE_NOISE_RATIO_THRESHOLD
}) {
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
  const downloadMetadataRef = useRef(downloadMetadata);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);
  const lastEegReceivedAt = useRef(null);
  const eegPacketsReceived = useRef(0);
  const lastDownloadedPacket = useRef(0);
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
  const [statusLog, setStatusLog] = useState([]);
  const museRef = useRef(null);
  const reconnectInFlightRef = useRef(false);
  const lastReconnectAtRef = useRef(0);
  const powerInterval = useRef(0);
  const ppgChannelData = useRef([]);
  const periodogramCb = useRef(onPeriodgramUpdated);
  const wakeLockRef = useRef(null);
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  // Keep callback stable for the interval
  useEffect(() => {
    periodogramCb.current = onPeriodgramUpdated;
  }, [onPeriodgramUpdated]);

  useEffect(() => {
    downloadMetadataRef.current = downloadMetadata;
  }, [downloadMetadata]);

  useEffect(() => {
    if (!channelsReady || channelMaps.current.length === 0) return;
    if (powerInterval.current === 0) {
      powerInterval.current = setInterval(() => {
        eegChannelData.current.forEach(electrode => {
          if (electrode.samples.length > fftWindow) {
            const periodogram = calcPeriodogram(electrode.samples.slice(-fftWindow), sampleRateHz, notchHz);
            const stamped = { ...periodogram, t: Date.now() };
            electrode.periodograms.push(periodogram);
            electrode.periodograms = electrode.periodograms.slice(-4);
            electrode.averagedPeriodogram = averagedPeriodogram(electrode.periodograms);
            const spectro = electrode.spectrogramSlices || [];
            spectro.push(stamped);
            const cutoff = Date.now() - Math.max(1, spectrogramWindowSec) * 1000;
            electrode.spectrogramSlices = spectro.filter(s => (s.t || 0) >= cutoff);
          }
          const traceSamples = electrode.samples.slice(-traceWindow);
          const windowSamples = Math.max(1, Math.round(artifactWindowSec * sampleRateHz));
          const stepSamples = Math.max(1, Math.round(artifactStepSec * sampleRateHz));
          if (traceSamples.length >= windowSamples) {
            const artifactWindows = computeArtifactWindows(traceSamples, sampleRateHz, {
              windowSamples,
              stepSamples,
              amplitudeRangeThreshold,
              lineNoiseRatioThreshold,
              lineNoiseHz,
              lineNoiseBandHz,
              lineNoiseMaxHz
            });
            electrode.artifactWindows = artifactWindows;
            electrode.artifactLatest = artifactWindows.length > 0
              ? artifactWindows[artifactWindows.length - 1]
              : null;
          } else {
            electrode.artifactWindows = [];
            electrode.artifactLatest = null;
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
  }, [
    channelsReady,
    fftWindow,
    traceWindow,
    artifactWindowSec,
    artifactStepSec,
    amplitudeRangeThreshold,
    lineNoiseRatioThreshold,
    lineNoiseHz,
    lineNoiseBandHz,
    lineNoiseMaxHz,
    sampleRateHz,
    notchHz,
    spectrogramWindowSec
  ]);

  useEffect(() => {
    const id = setInterval(() => {
      const last = lastEegReceivedAt.current;
      const isFresh = !!last && Date.now() - last < STREAM_STALE_MS;
      if (streamingRef.current !== isFresh) {
        streamingRef.current = isFresh;
        setIsStreaming(isFresh);
      }
      const stale = museStatus.isConnected && !isFresh;
      setDataStale(stale);
    }, 1000);
    return () => clearInterval(id);
  }, [museStatus.isConnected]);

  const attemptReconnect = useCallback((reason) => {
    if (museStatus.isConnecting) return;
    if (!museRef.current?.reconnect) return;
    const now = Date.now();
    if (reconnectInFlightRef.current) return;
    if (now - lastReconnectAtRef.current < 5000) return;
    reconnectInFlightRef.current = true;
    lastReconnectAtRef.current = now;
    setReconnectState((prev) => ({
      attempts: prev.attempts + 1,
      lastAttemptAt: now,
      status: 'attempting',
      reason
    }));
    museRef.current
      .reconnect()
      .catch((err) => {
        console.warn('Auto-reconnect failed', err);
      })
      .finally(() => {
        reconnectInFlightRef.current = false;
        setReconnectState((prev) => ({ ...prev, status: 'idle' }));
      });
  }, [museStatus.isConnecting]);

  useEffect(() => {
    if (!dataStale) return;
    if (!museStatus.isConnected) return;
    attemptReconnect('stale-data');
  }, [attemptReconnect, dataStale, museStatus.isConnected]);

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
            averagedPeriodogram: undefined,
            spectrogramSlices: [],
            artifactWindows: [],
            artifactLatest: null
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
        averagedPeriodogram: undefined,
        spectrogramSlices: [],
        artifactWindows: [],
        artifactLatest: null
      };
      currentChannel = eegChannelData.current[data.electrode];
    }

    const samples = currentChannel.samples;
    samples.push(...data.samples);
    const downloadWindowSamples = Math.ceil((autoDownloadMs / 1000) * sampleRateHz);
    const bufferSize = Math.max(traceWindow, fftWindow * 2, downloadWindowSamples + fftWindow);
    if (samples.length > bufferSize) {
      samples.splice(0, samples.length - bufferSize);
    }
    currentChannel.samples = samples;
    setRenderTick((tick) => tick + 1); // force re-render so downstream charts update
  }

  function onPpgData(data) {
    if (!data || typeof data.ppgChannel !== 'number') return;
    if (data.ppgChannel > 1) return;
    setLastPpg({ ...data, receivedAt: Date.now() });
    const idx = data.ppgChannel;
    if (!ppgChannelData.current[idx]) {
      ppgChannelData.current[idx] = {
        ppgChannel: idx,
        label: `PPG${idx + 1}`,
        samples: []
      };
    }
    const currentChannel = ppgChannelData.current[idx];
    const samples = currentChannel.samples;
    samples.push(...data.samples);
    const ppgDownloadWindowSamples = Math.ceil((autoDownloadMs / 1000) * ppgSampleRateHz);
    const ppgBufferSize = Math.max(ppgTraceWindow, ppgDownloadWindowSamples);
    if (samples.length > ppgBufferSize) {
      samples.splice(0, samples.length - ppgBufferSize);
    }
    currentChannel.samples = samples;
    setRenderTick((tick) => tick + 1);
  }

  let channelsForDisplay =
    channelMaps.current.length > 0
      ? channelMaps.current.map((label, idx) => {
          return eegChannelData.current[idx] || {
            electrode: idx,
            label,
            samples: [],
            periodograms: [],
            averagedPeriodogram: undefined,
            spectrogramSlices: [],
            artifactWindows: [],
            artifactLatest: null
          };
        })
      : eegChannelData.current.filter(Boolean);

  if (selectedChannels.length > 0) {
    channelsForDisplay = channelsForDisplay.filter(c => selectedChannels.includes(c.label || c.electrode));
  }

  const channelsForDisplayRef = useRef(channelsForDisplay);
  channelsForDisplayRef.current = channelsForDisplay;
  const ppgChannelsForDisplay = useMemo(() => {
    void renderTick;
    return ppgChannelData.current.filter(
      c => c && c.samples.length > 0 && c.ppgChannel <= 1
    );
  }, [renderTick]);
  const ppgChannelsForDisplayRef = useRef(ppgChannelsForDisplay);
  ppgChannelsForDisplayRef.current = ppgChannelsForDisplay;

  const signalQuality = useMemo(() => {
    const minSamples = Math.max(1, Math.round(artifactWindowSec * sampleRateHz));
    const active = channelsForDisplay.filter(c => c.samples && c.samples.length >= minSamples);
    if (active.length === 0) {
      return { badLabels: [], checked: 0, reasons: {} };
    }
    const reasons = {};
    const badLabels = [];
    active.forEach((c) => {
      const label = c.label || c.electrode;
      const latest = c.artifactLatest;
      if (!latest) return;
      const hits = [];
      if (latest.amplitudeArtifact) hits.push('amplitude');
      if (latest.lineNoiseArtifact) hits.push('line-noise');
      if (hits.length > 0) {
        badLabels.push(label);
        reasons[label] = hits;
      }
    });
    return { badLabels, checked: active.length, reasons };
  }, [channelsForDisplay, artifactWindowSec, sampleRateHz]);
  const signalRejectionPct = signalQuality.checked > 0
    ? Math.round((signalQuality.badLabels.length / signalQuality.checked) * 100)
    : null;

  const combinedPpg = useMemo(() => {
    const active = ppgChannelsForDisplay.filter(c => c.samples && c.samples.length > 0);
    if (active.length === 0) return null;
    const windowSamples = Math.min(ppgTraceWindow, ...active.map(c => c.samples.length));
    if (!windowSamples || windowSamples < ppgSampleRateHz * 2) return null;
    const aligned = active.map((c) => c.samples.slice(-windowSamples));
    const standardized = aligned.map((series) => {
      const mean = series.reduce((sum, v) => sum + v, 0) / series.length;
      const variance = series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length;
      const std = Math.sqrt(variance) || 1;
      return series.map(v => (v - mean) / std);
    });
    const combined = [];
    for (let i = 0; i < windowSamples; i += 1) {
      const sum = standardized.reduce((acc, series) => acc + (series[i] ?? 0), 0);
      combined.push(sum / standardized.length);
    }
    return {
      label: 'PPG (combined)',
      samples: combined
    };
  }, [ppgChannelsForDisplay, ppgTraceWindow, ppgSampleRateHz]);

  const cardiogramPpg = useMemo(() => {
    if (!combinedPpg?.samples || combinedPpg.samples.length < ppgSampleRateHz * 2) {
      return null;
    }
    const samples = combinedPpg.samples;
    const windowShort = Math.max(3, Math.round(ppgSampleRateHz * 0.2));
    const windowLong = Math.max(windowShort + 1, Math.round(ppgSampleRateHz * 1.2));

    const movingAverage = (input, windowSize) => {
      const out = new Array(input.length);
      let sum = 0;
      for (let i = 0; i < input.length; i += 1) {
        sum += input[i];
        if (i >= windowSize) {
          sum -= input[i - windowSize];
        }
        const denom = Math.min(i + 1, windowSize);
        out[i] = sum / denom;
      }
      return out;
    };

    const fast = movingAverage(samples, windowShort);
    const slow = movingAverage(samples, windowLong);
    const bandPassed = samples.map((_, i) => fast[i] - slow[i]);
    const sorted = [...bandPassed].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const deviations = bandPassed.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = deviations.length % 2 === 1
      ? deviations[mid]
      : (deviations[mid - 1] + deviations[mid]) / 2;
    const scale = (mad * 1.4826) || 1;
    const normalized = bandPassed.map(v => (v - median) / scale);

    const minIntervalSamples = Math.floor(ppgSampleRateHz * 0.35);
    const maxIntervalSamples = Math.ceil(ppgSampleRateHz * 1.6);
    const threshold = 0.6;
    const peaks = [];
    for (let i = 1; i < normalized.length - 1; i += 1) {
      if (normalized[i] > threshold && normalized[i] > normalized[i - 1] && normalized[i] > normalized[i + 1]) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minIntervalSamples) {
          peaks.push(i);
        }
      }
    }

    if (peaks.length === 0) {
      return null;
    }

    const stableSegment = (() => {
      if (peaks.length < 5) return null;
      const toleranceRatio = 0.2;
      for (let end = peaks.length - 1; end >= 4; end -= 1) {
        const windowPeaks = peaks.slice(end - 4, end + 1);
        const intervals = [];
        let valid = true;
        for (let i = 1; i < windowPeaks.length; i += 1) {
          const delta = windowPeaks[i] - windowPeaks[i - 1];
          if (delta < minIntervalSamples || delta > maxIntervalSamples) {
            valid = false;
            break;
          }
          intervals.push(delta);
        }
        if (!valid) continue;
        const sorted = [...intervals].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const maxDelta = median * toleranceRatio;
        if (intervals.every(v => Math.abs(v - median) <= maxDelta)) {
          return { start: windowPeaks[0], end: windowPeaks[windowPeaks.length - 1] };
        }
      }
      return null;
    })();

    const startIndex = stableSegment?.start ?? peaks[Math.max(0, peaks.length - 5)];
    const endIndex = stableSegment?.end ?? peaks[peaks.length - 1];
    const trimmed = normalized.slice(startIndex, endIndex + 1);

    return { label: 'PPG cardiogram', samples: trimmed };
  }, [combinedPpg, ppgSampleRateHz]);

  const heartRateBpm = useMemo(() => {
    const windowSec = 15;
    if (!combinedPpg || !combinedPpg.samples || combinedPpg.samples.length < ppgSampleRateHz * 4) {
      return null;
    }
    const windowSamples = Math.min(
      combinedPpg.samples.length,
      Math.round(ppgSampleRateHz * windowSec)
    );
    const recent = combinedPpg.samples.slice(-windowSamples);
    const mean = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + (v - mean) ** 2, 0) / recent.length;
    const std = Math.sqrt(variance);
    const threshold = mean + std * 0.5;
    const peaks = [];
    const minIntervalSamples = Math.floor(ppgSampleRateHz * 0.35);
    for (let i = 1; i < recent.length - 1; i += 1) {
      if (recent[i] > threshold && recent[i] > recent[i - 1] && recent[i] > recent[i + 1]) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minIntervalSamples) {
          peaks.push(i);
        }
      }
    }
    if (peaks.length < 2) return null;
    const intervals = [];
    for (let i = 1; i < peaks.length; i += 1) {
      intervals.push((peaks[i] - peaks[i - 1]) / ppgSampleRateHz);
    }
    const avgInterval = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
    if (!avgInterval || avgInterval <= 0) return null;
    const bpm = 60 / avgInterval;
    return Number.isFinite(bpm) ? Math.round(bpm) : null;
  }, [combinedPpg, ppgSampleRateHz]);

  useEffect(() => {
    if (!onPpgUpdate) return;
    onPpgUpdate({
      heartRateBpm,
      combinedPpg,
      cardiogramPpg,
      ppgChannels: ppgChannelsForDisplay,
      sampleRateHz: ppgSampleRateHz
    });
  }, [onPpgUpdate, heartRateBpm, combinedPpg, cardiogramPpg, ppgChannelsForDisplay, ppgSampleRateHz]);

  const latestAccel = lastAccel?.samples?.[lastAccel.samples.length - 1];
  const latestGyro = lastGyro?.samples?.[lastGyro.samples.length - 1];
  const ppgAge = lastPpg?.receivedAt ? Math.round((Date.now() - lastPpg.receivedAt) / 1000) : null;
  const telemetryAge = telemetry?.receivedAt ? Math.round((Date.now() - telemetry.receivedAt) / 1000) : null;
  const lastEegReceivedAtMs = lastEegReceivedAt.current;
  const lastSampleAt = useMemo(() => (
    lastEegReceivedAtMs ? new Date(lastEegReceivedAtMs) : null
  ), [lastEegReceivedAtMs]);
  const statusLabel = museStatus.isConnecting
    ? 'Connecting'
    : museStatus.isConnected
      ? 'Connected'
      : 'Disconnected';
  const statusMessage = museStatus.error
    ? (museStatus.error.message || String(museStatus.error))
    : (dataStale ? 'No recent EEG samples; attempting reconnect.' : 'Awaiting device data.');

  const diag = {
    mapped: channelMaps.current.length,
    withSamples: channelsForDisplay.filter(c => c.samples.length > 0).length,
    withFFT: channelsForDisplay.filter(c => c.averagedPeriodogram).length,
    belowThreshold: channelsForDisplay.filter(c => c.samples.length > 0 && c.samples.length < fftWindow).length,
    totalPeriodograms: channelsForDisplay.reduce((sum, c) => sum + c.periodograms.length, 0),
    lastFFT: externalLastFFT || lastFFT
  };

  const fftBeat = diag.lastFFT ? Math.round((Date.now() - diag.lastFFT) / 1000) : null;
  useEffect(() => {
    const entry = {
      t: Date.now(),
      status: statusLabel,
      message: statusMessage
    };
    setStatusLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.status === entry.status && last.message === entry.message) {
        return prev;
      }
      const next = [...prev, entry];
      return next.slice(-5);
    });
  }, [statusLabel, statusMessage]);

  const debugDetails = useMemo(() => ({
    device: {
      status: statusLabel,
      message: statusMessage,
      museStatus,
      reconnectState,
      dataStale,
      isStreaming,
      lastSampleAt: lastSampleAt ? lastSampleAt.toISOString() : null,
      lastEegReceivedAtMs: lastEegReceivedAt.current,
      packetsReceived: eegPacketsReceived.current,
      lastDownloadedPacket: lastDownloadedPacket.current
    },
    config: {
      sampleRateHz,
      ppgSampleRateHz,
      fftWindow,
      traceWindow,
      ppgTraceWindow,
      spectrogramWindowSec,
      notchHz,
      artifactWindowSec,
      artifactStepSec,
      amplitudeRangeThreshold,
      lineNoiseHz,
      lineNoiseBandHz,
      lineNoiseMaxHz,
      lineNoiseRatioThreshold
    },
    telemetry: {
      telemetryAgeSec: telemetryAge,
      lastTelemetry: telemetry
    },
    sensors: {
      lastPpg,
      ppgAgeSec: ppgAge,
      lastAccel,
      lastGyro
    },
    buffers: {
      channelsMapped: diag.mapped,
      channelsWithSamples: diag.withSamples,
      fftReady: diag.withFFT,
      belowThreshold: diag.belowThreshold,
      totalPeriodograms: diag.totalPeriodograms
    },
    artifacts: {
      badLabels: signalQuality.badLabels,
      checked: signalQuality.checked,
      reasons: signalQuality.reasons
    },
    statusLog
  }), [
    statusLabel,
    statusMessage,
    museStatus,
    reconnectState,
    dataStale,
    isStreaming,
    lastSampleAt,
    telemetryAge,
    telemetry,
    lastPpg,
    ppgAge,
    lastAccel,
    lastGyro,
    diag.mapped,
    diag.withSamples,
    diag.withFFT,
    diag.belowThreshold,
    diag.totalPeriodograms,
    signalQuality.badLabels,
    signalQuality.checked,
    signalQuality.reasons,
    statusLog,
    sampleRateHz,
    ppgSampleRateHz,
    fftWindow,
    traceWindow,
    ppgTraceWindow,
    spectrogramWindowSec,
    notchHz,
    artifactWindowSec,
    artifactStepSec,
    amplitudeRangeThreshold,
    lineNoiseHz,
    lineNoiseBandHz,
    lineNoiseMaxHz,
    lineNoiseRatioThreshold
  ]);

  useEffect(() => {
    if (!onDeviceDebug) return;
    onDeviceDebug(debugDetails);
  }, [onDeviceDebug, debugDetails]);

  const downloadSamples = useCallback(({ requireFullWindow = false } = {}) => {
    const last = lastEegReceivedAt.current;
    if (!last || Date.now() - last > STREAM_STALE_MS) return;
    if (eegPacketsReceived.current <= lastDownloadedPacket.current) return;
    const downloadWindowSamples = Math.ceil((autoDownloadMs / 1000) * sampleRateHz);
    let active = (channelsForDisplayRef.current || []).filter(c => c.samples.length > 0);
    if (requireFullWindow) {
      active = active.filter(c => c.samples.length >= downloadWindowSamples);
    }
    if (active.length === 0) return;

    const samplePeriodMs = 1000 / sampleRateHz;
    const captureEndedAt = new Date(last);
    const availableCounts = active.map(c => c.samples.length);
    const windowSamples = requireFullWindow
      ? downloadWindowSamples
      : Math.min(...availableCounts);
    if (!windowSamples || windowSamples <= 0) return;

    const captureStartedAtIso = new Date(
      captureEndedAt.getTime() - Math.max(windowSamples - 1, 0) * samplePeriodMs
    ).toISOString();

    const channelLabels = active.map(c => c.label || c.electrode);
    const tsSlug = captureStartedAtIso.replace(/[:.]/g, '-');
    const baseName = `sub-01_ses-01_task-meditrain_run-${tsSlug}_eeg`;
    const ppgBaseName = baseName.replace('_eeg', '_ppg');
    const dataFile = `${baseName}.eeg`;
    const headerFile = `${baseName}.vhdr`;
    const markerFile = `${baseName}.vmrk`;
    const channelsFile = `${baseName.replace('_eeg', '_channels')}.tsv`;
    const sidecarFile = `${baseName}.json`;
    const ppgDataFile = `${ppgBaseName}.tsv`;
    const ppgSidecarFile = `${ppgBaseName}.json`;

    const triggerDownload = (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    const alignedSamples = active.map(c => c.samples.slice(-windowSamples));
    const channelCount = alignedSamples.length;
    const interleaved = new Float32Array(windowSamples * channelCount);
    for (let i = 0; i < windowSamples; i += 1) {
      for (let ch = 0; ch < channelCount; ch += 1) {
        interleaved[i * channelCount + ch] = alignedSamples[ch][i] || 0;
      }
    }

    const headerLines = [
      'Brain Vision Data Exchange Header File Version 1.0',
      '; Generated by meditrain',
      '',
      '[Common Infos]',
      `DataFile=${dataFile}`,
      `MarkerFile=${markerFile}`,
      'DataFormat=BINARY',
      'DataOrientation=MULTIPLEXED',
      'DataType=FLOAT32',
      `NumberOfChannels=${channelCount}`,
      `SamplingInterval=${Math.round(1000000 / sampleRateHz)}`,
      '',
      '[Channel Infos]',
      ...channelLabels.map((label, idx) => `Ch${idx + 1}=${label},,uV`)
    ];

    const markerLines = [
      'Brain Vision Data Exchange Marker File, Version 1.0',
      '; Generated by meditrain',
      '',
      '[Common Infos]',
      `DataFile=${dataFile}`,
      '',
      '[Marker Infos]',
      'Mk1=New Segment,,1,1,0,0'
    ];

    const sidecar = {
      SamplingFrequency: sampleRateHz,
      PowerLineFrequency: 60,
      EEGReference: 'unknown',
      EEGGround: 'unknown',
      SoftwareFilters: 'none',
      RecordingType: 'continuous',
      TaskName: 'meditrain',
      AcquisitionDateTime: captureStartedAtIso,
      NotchHz: notchHz
    };
    const metadata = downloadMetadataRef.current;
    if (metadata) {
      sidecar.TrainingTargets = metadata.trainingTargets || [];
      sidecar.TrainingTargetMetrics = metadata.targetMetrics || {};
      sidecar.TrainingTargetHistory = metadata.targetHistory || {};
      sidecar.TrainingTargetReadings = metadata.targetReadings || [];
      sidecar.Config = metadata.config || {};
    }

    const channelHeader = [
      'name',
      'type',
      'units',
      'sampling_frequency',
      'low_cutoff',
      'high_cutoff',
      'reference'
    ].join('\t');
    const channelLines = channelLabels.map(label =>
      [
        label,
        'EEG',
        'uV',
        sampleRateHz,
        'n/a',
        'n/a',
        'unknown'
      ].join('\t')
    );

    triggerDownload(new Blob([interleaved.buffer], { type: 'application/octet-stream' }), dataFile);
    triggerDownload(new Blob([headerLines.join('\n')], { type: 'text/plain' }), headerFile);
    triggerDownload(new Blob([markerLines.join('\n')], { type: 'text/plain' }), markerFile);
    triggerDownload(new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' }), sidecarFile);
    triggerDownload(new Blob([[channelHeader, ...channelLines].join('\n')], { type: 'text/tab-separated-values' }), channelsFile);

    const ppgActive = ppgChannelsForDisplayRef.current || [];
    if (ppgActive.length > 0) {
      const windowDurationSec = windowSamples / sampleRateHz;
      const ppgWindowSamples = Math.min(
        Math.round(windowDurationSec * ppgSampleRateHz),
        ...ppgActive.map(c => c.samples.length)
      );
      if (ppgWindowSamples > 0) {
        const ppgAligned = ppgActive.map(c => c.samples.slice(-ppgWindowSamples));
        const ppgHeader = ppgActive.map(c => c.label).join('\t');
        const ppgRows = [];
        for (let i = 0; i < ppgWindowSamples; i += 1) {
          ppgRows.push(ppgAligned.map(ch => ch[i] ?? '').join('\t'));
        }
        const ppgSidecar = {
          SamplingFrequency: ppgSampleRateHz,
          PowerLineFrequency: 60,
          RecordingType: 'continuous',
          TaskName: 'meditrain',
          AcquisitionDateTime: captureStartedAtIso,
          Columns: ppgActive.map(c => c.label)
        };
        triggerDownload(new Blob([[ppgHeader, ...ppgRows].join('\n')], { type: 'text/tab-separated-values' }), ppgDataFile);
        triggerDownload(new Blob([JSON.stringify(ppgSidecar, null, 2)], { type: 'application/json' }), ppgSidecarFile);
      }
    }

    lastDownloadedPacket.current = eegPacketsReceived.current;
  }, [autoDownloadMs, ppgSampleRateHz, sampleRateHz, notchHz]);

  // auto-download every 60s when enabled
  useEffect(() => {
    if (!autoDownloadEnabled || !isStreaming) {
      clearInterval(downloadTimer.current);
      return undefined;
    }
    downloadTimer.current = setInterval(() => downloadSamples({ requireFullWindow: true }), autoDownloadMs);
    return () => clearInterval(downloadTimer.current);
  }, [autoDownloadEnabled, isStreaming, downloadSamples, autoDownloadMs]);

  return (
    <div className="device-panel" data-render={renderTick}>
      <div className="device-status">
        <MuseData
          ref={museRef}
          onNewData={onNewData}
          updateChannelMaps={updateChannelMaps}
          onTelemetry={(t) => setTelemetry({ ...t, receivedAt: Date.now() })}
          onPpg={onPpgData}
          onAccelerometer={(a) => setLastAccel({ ...a, receivedAt: Date.now() })}
          onGyro={(g) => setLastGyro({ ...g, receivedAt: Date.now() })}
          onStatusChange={setMuseStatus}
        />
        <div className="inline-status">
          <span className={`status-pill ${museStatus.isConnected ? '' : 'warn'}`}>
            Device: {statusLabel}
          </span>
          <span className="status-pill">
            Status: {statusMessage}
          </span>
        </div>
        {channelMaps.current.length > 0 && (
          <p className="subdued">Channels detected: {channelMaps.current.join(' • ')}</p>
        )}
        <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={downloadSamples} disabled={!isStreaming}>
            Download BIDS EEG
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
          <span className="status-pill">
            Signal rejected: {signalQuality.checked > 0
              ? `${signalQuality.badLabels.length}/${signalQuality.checked} (${signalRejectionPct}%)`
              : '—'}
          </span>
          <span className="status-pill">Below {fftWindow} samples: {diag.belowThreshold}</span>
          <span className="status-pill">Periodograms stored: {diag.totalPeriodograms}</span>
          <span className={`status-pill heartbeat ${fftBeat !== null && fftBeat < 5 ? 'alive' : ''}`}>
            Last FFT: {diag.lastFFT ? `${fftBeat}s ago` : '—'}
          </span>
          {dataStale && (
            <span className="status-pill" style={{ background: '#6d2828', color: '#fff' }}>
              Data stale, reconnecting{reconnectState.attempts > 0 ? ` (${reconnectState.attempts})` : ''}
            </span>
          )}
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
          <span className="status-pill">
            Last sample: {lastSampleAt ? lastSampleAt.toLocaleString() : '—'}
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
      <div className="chart-block chart-fill" style={{ marginTop: 10 }}>
        <p className="chart-label">
          Combined EEG traces (per sensor, last {traceWindow} samples)
          {signalQuality.badLabels.length > 0 ? ` · bad: ${signalQuality.badLabels.join(', ')}` : ''}
        </p>
        <div className="chart-frame">
          <MultiEEGTraceChart
            channels={channelsForDisplay.filter(c => c.samples.length > 0)}
            badLabels={signalQuality.badLabels}
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
