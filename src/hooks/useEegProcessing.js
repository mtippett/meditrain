import { useCallback, useEffect, useRef, useState } from 'react';
import { averagedPeriodogram, calcPeriodogram, calcRawPeriodogram } from '../math/Periodogram.js';

const DEFAULT_RENDER_THROTTLE_MS = 200;

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

function ensureChannel(channelDataRef, channelMapsRef, electrode) {
  if (!channelDataRef.current[electrode]) {
    const label = channelMapsRef.current[electrode] || `CH ${electrode}`;
    channelDataRef.current[electrode] = {
      electrode,
      label,
      samples: [],
      periodograms: [],
      averagedPeriodogram: undefined,
      spectrogramSlices: [],
      artifactWindows: [],
      artifactLatest: null
    };
  } else if (channelMapsRef.current[electrode]) {
    channelDataRef.current[electrode].label = channelMapsRef.current[electrode];
  }
  return channelDataRef.current[electrode];
}

export default function useEegProcessing({
  sampleRateHz,
  fftWindow,
  traceWindow,
  notchHz,
  spectrogramWindowSec,
  artifactWindowSec,
  artifactStepSec,
  amplitudeRangeThreshold,
  lineNoiseHz,
  lineNoiseBandHz,
  lineNoiseMaxHz,
  lineNoiseRatioThreshold,
  autoDownloadMs = 0
}) {
  const channelMapsRef = useRef([]);
  const channelDataRef = useRef([]);
  const [channelMaps, setChannelMaps] = useState([]);
  const [eegData, setEegData] = useState([]);
  const [lastFFT, setLastFFT] = useState(null);
  const renderScheduledRef = useRef(false);
  const lastRenderAtRef = useRef(0);

  const scheduleRender = useCallback((minDelayMs = DEFAULT_RENDER_THROTTLE_MS) => {
    if (renderScheduledRef.current) return;
    const now = Date.now();
    const delay = Math.max(0, minDelayMs - (now - lastRenderAtRef.current));
    renderScheduledRef.current = true;
    setTimeout(() => {
      renderScheduledRef.current = false;
      lastRenderAtRef.current = Date.now();
      setEegData([...channelDataRef.current.filter(Boolean)]);
    }, delay);
  }, []);

  const handleChannelMaps = useCallback((maps) => {
    if (!Array.isArray(maps) || maps.length === 0) return;
    channelMapsRef.current = [...maps];
    setChannelMaps([...maps]);
    maps.forEach((label, idx) => {
      if (!channelDataRef.current[idx]) {
        channelDataRef.current[idx] = {
          electrode: idx,
          label,
          samples: [],
          periodograms: [],
          averagedPeriodogram: undefined,
          spectrogramSlices: [],
          artifactWindows: [],
          artifactLatest: null
        };
      } else {
        channelDataRef.current[idx].label = label;
      }
    });
    scheduleRender(0);
  }, [scheduleRender]);

  const handleEegPacket = useCallback((data) => {
    if (!data || typeof data.electrode !== 'number') return;
    const channel = ensureChannel(channelDataRef, channelMapsRef, data.electrode);
    const samples = channel.samples;
    samples.push(...data.samples);
    const downloadWindowSamples = Math.ceil((autoDownloadMs / 1000) * sampleRateHz);
    const bufferSize = Math.max(traceWindow, fftWindow * 2, downloadWindowSamples + fftWindow);
    if (samples.length > bufferSize) {
      samples.splice(0, samples.length - bufferSize);
    }
    channel.samples = samples;
    scheduleRender();
  }, [autoDownloadMs, fftWindow, sampleRateHz, traceWindow, scheduleRender]);

  useEffect(() => {
    const interval = setInterval(() => {
      channelDataRef.current.forEach((electrode) => {
        if (!electrode || !electrode.samples) return;
        if (electrode.samples.length > fftWindow) {
          const periodogram = calcPeriodogram(electrode.samples.slice(-fftWindow), sampleRateHz, notchHz);
          const stamped = { ...periodogram, t: Date.now() };
          electrode.periodograms = [...(electrode.periodograms || []), periodogram].slice(-4);
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
      setEegData([...channelDataRef.current.filter(Boolean)]);
      setLastFFT(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [
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

  return {
    eegData,
    lastFFT,
    channelMaps,
    handleChannelMaps,
    handleEegPacket
  };
}
