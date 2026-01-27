import { useCallback, useEffect, useRef, useState } from 'react';

const HEART_RATE_WINDOW_SEC = 8;
const HEART_RATE_MIN_BPM = 35;
const HEART_RATE_MAX_BPM = 220;
const HEART_RATE_MIN_PEAK_SPACING_SEC = 0.4;
const HEART_UPDATE_MIN_MS = 500;
const DEFAULT_RENDER_THROTTLE_MS = 200;
const PULSE_SELECTION_DEBOUNCE_MS = 10000;
const SPO2_WINDOW_SEC = 8;
const SPO2_LOWPASS_HZ = 0.5;
const SPO2_BANDPASS_LOW_HZ = 0.5;
const SPO2_BANDPASS_HIGH_HZ = 4.0;
const SPO2_MIN_PI = 0.005;
const SPO2_EMA_ALPHA = 0.2;

const DEFAULT_SENSOR_MAPPING = Object.freeze({
  irChannel: 1, // Muse S default: channel 1 (IR)
  redChannel: 2, // Muse S default: channel 2 (RED)
  greenChannel: 0 // Muse S default: channel 0 (AMBIENT)
});

function biquadCoefficients(type, cutoffHz, sampleRateHz, q = Math.SQRT1_2) {
  const omega = (2 * Math.PI * cutoffHz) / sampleRateHz;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  if (type === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  };
}

function applyBiquad(samples, coeffs) {
  const out = new Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x0 = samples[i];
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function applyLowpass4(samples, cutoffHz, sampleRateHz) {
  const coeffs = biquadCoefficients('lowpass', cutoffHz, sampleRateHz);
  return applyBiquad(applyBiquad(samples, coeffs), coeffs);
}

function applyBandpass(samples, lowHz, highHz, sampleRateHz) {
  const hp = biquadCoefficients('highpass', lowHz, sampleRateHz);
  const lp = biquadCoefficients('lowpass', highHz, sampleRateHz);
  return applyBiquad(applyBiquad(samples, hp), lp);
}

function percentile(samples, q) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function detrend(samples) {
  if (!samples.length) return samples;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return samples.map(v => v - mean);
}

function findPeaks(samples, sampleRateHz) {
  if (!samples || samples.length < 3) return [];
  const med = percentile(samples, 0.5);
  const absDev = samples.map(v => Math.abs(v - med));
  const mad = percentile(absDev, 0.5) || 1e-6;
  const threshold = med + mad * 1.25;
  const minSpacing = Math.max(1, Math.round(sampleRateHz * HEART_RATE_MIN_PEAK_SPACING_SEC));
  const peaks = [];
  let lastPeak = -Infinity;
  for (let i = 1; i < samples.length - 1; i += 1) {
    const v = samples[i];
    if (v < threshold) continue;
    if (v > samples[i - 1] && v > samples[i + 1]) {
      if (i - lastPeak >= minSpacing) {
        peaks.push(i);
        lastPeak = i;
      } else {
        const lastIdx = peaks[peaks.length - 1];
        if (lastIdx != null && v > samples[lastIdx]) {
          peaks[peaks.length - 1] = i;
          lastPeak = i;
        }
      }
    }
  }
  return peaks;
}

function computeSpO2Metrics(channels, mapping, sampleRateHz, windowSec) {
  if (!channels || channels.length === 0) return null;
  const windowSamples = Math.max(1, Math.round(windowSec * sampleRateHz));
  const ir = channels.find(c => c.ppgChannel === mapping.irChannel);
  const red = channels.find(c => c.ppgChannel === mapping.redChannel);
  if (!ir || !red) return null;
  if (ir.samples.length < windowSamples || red.samples.length < windowSamples) return null;

  const irWindow = ir.samples.slice(-windowSamples);
  const redWindow = red.samples.slice(-windowSamples);

  const irDc = applyLowpass4(irWindow, SPO2_LOWPASS_HZ, sampleRateHz);
  const redDc = applyLowpass4(redWindow, SPO2_LOWPASS_HZ, sampleRateHz);
  const irDcMean = Math.abs(irDc.reduce((a, b) => a + b, 0) / irDc.length);
  const redDcMean = Math.abs(redDc.reduce((a, b) => a + b, 0) / redDc.length);
  if (irDcMean <= 0 || redDcMean <= 0) {
    return {
      ok: false,
      reason: 'DC_ZERO',
      irLabel: ir.label,
      redLabel: red.label
    };
  }

  const irAc = applyBandpass(detrend(irWindow), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sampleRateHz);
  const redAc = applyBandpass(detrend(redWindow), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sampleRateHz);
  const irAcAmp = (percentile(irAc, 0.95) - percentile(irAc, 0.05)) / 2;
  const redAcAmp = (percentile(redAc, 0.95) - percentile(redAc, 0.05)) / 2;
  if (irAcAmp <= 0 || redAcAmp <= 0) {
    return {
      ok: false,
      reason: 'AC_ZERO',
      irLabel: ir.label,
      redLabel: red.label,
      piIr: irAcAmp / irDcMean,
      piRed: redAcAmp / redDcMean
    };
  }

  const piIr = irAcAmp / irDcMean;
  const piRed = redAcAmp / redDcMean;
  if (!Number.isFinite(piIr) || !Number.isFinite(piRed)) {
    return {
      ok: false,
      reason: 'PI_NAN',
      irLabel: ir.label,
      redLabel: red.label,
      piIr,
      piRed
    };
  }
  if (piIr <= SPO2_MIN_PI || piRed <= SPO2_MIN_PI) {
    return {
      ok: false,
      reason: 'PI_LOW',
      irLabel: ir.label,
      redLabel: red.label,
      piIr,
      piRed,
      ratio: piRed / piIr
    };
  }

  const ratio = piRed / piIr;
  let spo2 = 110 - (25 * ratio);
  spo2 = Math.max(80, Math.min(100, spo2));

  return {
    ok: true,
    spo2,
    ratio,
    piIr,
    piRed,
    irLabel: ir.label,
    redLabel: red.label
  };
}

function filterPpgForProcessing(channels, mapping) {
  if (!mapping || typeof mapping.greenChannel !== 'number') {
    return channels;
  }
  return channels.filter(c => c.ppgChannel !== mapping.greenChannel);
}

function buildCombinedPpg(ppgChannels, maxSamples) {
  const channels = ppgChannels.filter(c => c && Array.isArray(c.samples) && c.samples.length > 0);
  if (channels.length === 0) return null;
  const lengths = channels.map(c => c.samples.length);
  const windowSamples = Math.min(maxSamples || Infinity, ...lengths);
  if (!Number.isFinite(windowSamples) || windowSamples <= 0) return null;
  const combined = new Array(windowSamples);
  for (let i = 0; i < windowSamples; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels.length; c += 1) {
      const samples = channels[c].samples;
      sum += samples[samples.length - windowSamples + i];
    }
    combined[i] = sum / channels.length;
  }
  return { label: 'PPG combined', samples: combined };
}

function computeHeartRateBpm(samples, sampleRateHz) {
  if (!samples || samples.length < sampleRateHz * 3) return null;
  const filtered = applyBandpass(detrend(samples), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sampleRateHz);
  const peaks = findPeaks(filtered, sampleRateHz);
  if (peaks.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < peaks.length; i += 1) {
    intervals.push(peaks[i] - peaks[i - 1]);
  }
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const medianSamples = intervals.length % 2 === 0
    ? (intervals[mid - 1] + intervals[mid]) / 2
    : intervals[mid];
  if (!medianSamples || medianSamples <= 0) return null;
  const bpm = Math.round((60 * sampleRateHz) / medianSamples);
  if (bpm < HEART_RATE_MIN_BPM || bpm > HEART_RATE_MAX_BPM) return null;
  return bpm;
}

function computePulseQuality(samples, sampleRateHz, windowSec = HEART_RATE_WINDOW_SEC) {
  if (!samples || samples.length < sampleRateHz * 3) return null;
  const windowSamples = Math.min(samples.length, Math.round(sampleRateHz * windowSec));
  if (windowSamples <= 0) return null;
  const window = samples.slice(-windowSamples);
  const filtered = applyBandpass(detrend(window), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sampleRateHz);
  if (!filtered.length) return null;
  const p05 = percentile(filtered, 0.05);
  const p95 = percentile(filtered, 0.95);
  const quality = p95 - p05;
  return Number.isFinite(quality) && quality > 0 ? quality : null;
}

function selectPulseChannel(channels, sampleRateHz) {
  let best = null;
  let bestQuality = -Infinity;
  channels.forEach((channel) => {
    const quality = computePulseQuality(channel.samples, sampleRateHz, HEART_RATE_WINDOW_SEC);
    if (quality != null && quality > bestQuality) {
      best = channel;
      bestQuality = quality;
    }
  });
  return best ? { channel: best, quality: bestQuality } : null;
}

function resolvePulseSelection(channels, sampleRateHz, prevSelection, nowMs) {
  if (!channels || channels.length === 0) return { selection: null, next: prevSelection };
  const candidate = selectPulseChannel(channels, sampleRateHz);
  if (!candidate) return { selection: null, next: prevSelection };

  const prevChannel = prevSelection?.channelId != null
    ? channels.find(c => c.ppgChannel === prevSelection.channelId)
    : null;
  const prevValid = prevChannel && Array.isArray(prevChannel.samples) && prevChannel.samples.length > 0;

  if (!prevValid) {
    return {
      selection: candidate,
      next: {
        channelId: candidate.channel.ppgChannel,
        label: candidate.channel.label || null,
        quality: candidate.quality,
        selectedAt: nowMs
      }
    };
  }

  if (candidate.channel.ppgChannel === prevSelection.channelId) {
    return {
      selection: { channel: prevChannel, quality: candidate.quality },
      next: { ...prevSelection, label: prevChannel.label || prevSelection.label, quality: candidate.quality }
    };
  }

  if (nowMs - prevSelection.selectedAt < PULSE_SELECTION_DEBOUNCE_MS) {
    return {
      selection: { channel: prevChannel, quality: prevSelection.quality },
      next: prevSelection
    };
  }

  return {
    selection: candidate,
    next: {
      channelId: candidate.channel.ppgChannel,
      label: candidate.channel.label || null,
      quality: candidate.quality,
      selectedAt: nowMs
    }
  };
}

function buildCardiogram(samples, sampleRateHz) {
  if (!samples || samples.length < sampleRateHz * 3) return null;
  const filtered = applyBandpass(detrend(samples), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sampleRateHz);
  const peaks = findPeaks(filtered, sampleRateHz);
  if (peaks.length < 2) return null;
  const segments = [];
  const startIdx = Math.max(1, peaks.length - 5);
  for (let i = startIdx; i < peaks.length; i += 1) {
    const a = peaks[i - 1];
    const b = peaks[i];
    if (b > a) {
      segments.push(...filtered.slice(a, b));
    }
  }
  return segments.length > 0 ? { label: 'Cardiogram', samples: segments } : null;
}

function filterEnabledPpgChannels(channels, enabledLabels, mapping) {
  if (!enabledLabels || enabledLabels.length === 0) return channels;
  const enabled = new Set(enabledLabels);
  const irChannel = mapping?.irChannel;
  const redChannel = mapping?.redChannel;
  const ambientChannel = mapping?.greenChannel;
  return channels.filter((c) => {
    if (enabled.has(c.label)) return true;
    if (c.ppgChannel === irChannel && enabled.has('IR')) return true;
    if (c.ppgChannel === redChannel && enabled.has('RED')) return true;
    if (c.ppgChannel === ambientChannel && enabled.has('AMBIENT')) return true;
    return false;
  });
}

export default function usePpgProcessing({
  ppgTraceWindow,
  sampleRateHz,
  autoDownloadMs = 0,
  enabledPpgLabels = [],
  sensorMapping = DEFAULT_SENSOR_MAPPING
}) {
  const ppgChannelDataRef = useRef([]);
  const [ppgChannels, setPpgChannels] = useState([]);
  const [heartData, setHeartData] = useState({
    heartRateBpm: null,
    spo2: null,
    spo2Ratio: null,
    perfusionIndexIr: null,
    perfusionIndexRed: null,
    spo2Labels: null,
    pulseChannelLabel: null,
    pulseChannelId: null,
    pulseChannelQuality: null,
    combinedPpg: null,
    cardiogramPpg: null,
    ppgChannels: [],
    ppgChannelsAll: [],
    sampleRateHz,
    sensorMapping
  });
  const renderScheduledRef = useRef(false);
  const lastRenderAtRef = useRef(0);
  const lastHeartUpdateAtRef = useRef(0);
  const enabledLabelsRef = useRef(enabledPpgLabels);
  const spo2EmaRef = useRef(null);
  const pulseSelectionRef = useRef({
    channelId: null,
    label: null,
    quality: null,
    selectedAt: 0
  });

  useEffect(() => {
    enabledLabelsRef.current = Array.isArray(enabledPpgLabels) ? enabledPpgLabels : [];
  }, [enabledPpgLabels]);

  const scheduleRender = useCallback((minDelayMs = DEFAULT_RENDER_THROTTLE_MS) => {
    if (renderScheduledRef.current) return;
    const now = Date.now();
    const delay = Math.max(0, minDelayMs - (now - lastRenderAtRef.current));
    renderScheduledRef.current = true;
    setTimeout(() => {
      renderScheduledRef.current = false;
      lastRenderAtRef.current = Date.now();
      setPpgChannels([...ppgChannelDataRef.current.filter(Boolean)]);
    }, delay);
  }, []);

  const handlePpgPacket = useCallback((data) => {
    if (!data || typeof data.ppgChannel !== 'number') return;
    if (data.ppgChannel > 2) return;
    const idx = data.ppgChannel;
    if (!ppgChannelDataRef.current[idx]) {
      ppgChannelDataRef.current[idx] = {
        ppgChannel: idx,
        label: data.label || `PPG${idx + 1}`,
        samples: []
      };
    } else if (data.label) {
      ppgChannelDataRef.current[idx].label = data.label;
    }
    const currentChannel = ppgChannelDataRef.current[idx];
    const samples = currentChannel.samples;
    samples.push(...data.samples);
    const downloadWindowSamples = Math.ceil((autoDownloadMs / 1000) * sampleRateHz);
    const bufferSize = Math.max(ppgTraceWindow, downloadWindowSamples, sampleRateHz * HEART_RATE_WINDOW_SEC);
    if (samples.length > bufferSize) {
      samples.splice(0, samples.length - bufferSize);
    }
    currentChannel.samples = samples;
    scheduleRender();

    const now = Date.now();
    if (now - lastHeartUpdateAtRef.current < HEART_UPDATE_MIN_MS) return;
    lastHeartUpdateAtRef.current = now;
    const channels = ppgChannelDataRef.current.filter(
      c => c && c.samples.length > 0 && c.ppgChannel <= 2
    );
    const enabledChannels = filterEnabledPpgChannels(channels, enabledLabelsRef.current, sensorMapping);
    const processingChannels = filterPpgForProcessing(enabledChannels, sensorMapping);
    const pulseResolution = resolvePulseSelection(
      enabledChannels,
      sampleRateHz,
      pulseSelectionRef.current,
      now
    );
    pulseSelectionRef.current = pulseResolution.next;
    const pulseSelection = pulseResolution.selection;
    const combined = buildCombinedPpg(processingChannels, ppgTraceWindow);
    if (!combined && !pulseSelection) return;
    const pulseSamples = pulseSelection?.channel?.samples || combined?.samples || [];
    const windowSamples = Math.min(pulseSamples.length, sampleRateHz * HEART_RATE_WINDOW_SEC);
    const hrWindow = pulseSamples.slice(-windowSamples);
    const heartRateBpm = computeHeartRateBpm(hrWindow, sampleRateHz);
    const cardiogramPpg = buildCardiogram(hrWindow, sampleRateHz);
    const spo2Metrics = computeSpO2Metrics(processingChannels, sensorMapping, sampleRateHz, SPO2_WINDOW_SEC);
    const irChannel = processingChannels.find(c => c.ppgChannel === sensorMapping.irChannel);
    const redChannel = processingChannels.find(c => c.ppgChannel === sensorMapping.redChannel);
    const nextSpo2 = spo2Metrics?.ok ? spo2Metrics.spo2 : null;
    if (nextSpo2 != null) {
      spo2EmaRef.current = spo2EmaRef.current == null
        ? nextSpo2
        : (SPO2_EMA_ALPHA * nextSpo2 + (1 - SPO2_EMA_ALPHA) * spo2EmaRef.current);
    }
    setHeartData({
      heartRateBpm,
      spo2: spo2EmaRef.current ?? nextSpo2,
      spo2Ratio: spo2Metrics?.ratio ?? null,
      perfusionIndexIr: spo2Metrics?.piIr ?? null,
      perfusionIndexRed: spo2Metrics?.piRed ?? null,
      spo2Labels: {
        ir: irChannel?.label || null,
        red: redChannel?.label || null
      },
      pulseChannelLabel: pulseSelection?.channel?.label || null,
      pulseChannelId: pulseSelection?.channel?.ppgChannel ?? null,
      pulseChannelQuality: pulseSelection?.quality ?? null,
      spo2Debug: spo2Metrics?.ok
        ? { ok: true }
        : { ok: false, reason: spo2Metrics?.reason || 'NO_DATA', piIr: spo2Metrics?.piIr ?? null, piRed: spo2Metrics?.piRed ?? null, ratio: spo2Metrics?.ratio ?? null },
      combinedPpg: combined,
      cardiogramPpg,
      ppgChannels: processingChannels,
      ppgChannelsAll: enabledChannels,
      sampleRateHz,
      sensorMapping
    });
  }, [autoDownloadMs, ppgTraceWindow, sampleRateHz, scheduleRender, sensorMapping]);

  useEffect(() => {
    setHeartData((prev) => ({ ...prev, sampleRateHz, sensorMapping }));
  }, [sampleRateHz, sensorMapping]);

  useEffect(() => {
    const channels = ppgChannelDataRef.current.filter(
      c => c && c.samples.length > 0 && c.ppgChannel <= 2
    );
    const now = Date.now();
    const enabledChannels = filterEnabledPpgChannels(channels, enabledLabelsRef.current, sensorMapping);
    const processingChannels = filterPpgForProcessing(enabledChannels, sensorMapping);
    const pulseResolution = resolvePulseSelection(
      enabledChannels,
      sampleRateHz,
      pulseSelectionRef.current,
      now
    );
    pulseSelectionRef.current = pulseResolution.next;
    const pulseSelection = pulseResolution.selection;
    const combined = buildCombinedPpg(processingChannels, ppgTraceWindow);
    if (!combined && !pulseSelection) {
      pulseSelectionRef.current = {
        channelId: null,
        label: null,
        quality: null,
        selectedAt: 0
      };
      setHeartData((prev) => ({
        ...prev,
        heartRateBpm: null,
        spo2: null,
        spo2Ratio: null,
        perfusionIndexIr: null,
        perfusionIndexRed: null,
        spo2Labels: {
          ir: null,
          red: null
        },
        pulseChannelLabel: null,
        pulseChannelId: null,
        pulseChannelQuality: null,
        spo2Debug: { ok: false, reason: 'NO_SIGNAL', piIr: null, piRed: null, ratio: null },
        combinedPpg: null,
        cardiogramPpg: null,
        ppgChannels: processingChannels,
        ppgChannelsAll: enabledChannels
      }));
      spo2EmaRef.current = null;
      return;
    }
    const pulseSamples = pulseSelection?.channel?.samples || combined?.samples || [];
    const windowSamples = Math.min(pulseSamples.length, sampleRateHz * HEART_RATE_WINDOW_SEC);
    const hrWindow = pulseSamples.slice(-windowSamples);
    const heartRateBpm = computeHeartRateBpm(hrWindow, sampleRateHz);
    const cardiogramPpg = buildCardiogram(hrWindow, sampleRateHz);
    const spo2Metrics = computeSpO2Metrics(processingChannels, sensorMapping, sampleRateHz, SPO2_WINDOW_SEC);
    const irChannel = processingChannels.find(c => c.ppgChannel === sensorMapping.irChannel);
    const redChannel = processingChannels.find(c => c.ppgChannel === sensorMapping.redChannel);
    const nextSpo2 = spo2Metrics?.ok ? spo2Metrics.spo2 : null;
    if (nextSpo2 != null) {
      spo2EmaRef.current = spo2EmaRef.current == null
        ? nextSpo2
        : (SPO2_EMA_ALPHA * nextSpo2 + (1 - SPO2_EMA_ALPHA) * spo2EmaRef.current);
    }
    setHeartData({
      heartRateBpm,
      spo2: spo2EmaRef.current ?? nextSpo2,
      spo2Ratio: spo2Metrics?.ratio ?? null,
      perfusionIndexIr: spo2Metrics?.piIr ?? null,
      perfusionIndexRed: spo2Metrics?.piRed ?? null,
      spo2Labels: {
        ir: irChannel?.label || null,
        red: redChannel?.label || null
      },
      pulseChannelLabel: pulseSelection?.channel?.label || null,
      pulseChannelId: pulseSelection?.channel?.ppgChannel ?? null,
      pulseChannelQuality: pulseSelection?.quality ?? null,
      spo2Debug: spo2Metrics?.ok
        ? { ok: true }
        : { ok: false, reason: spo2Metrics?.reason || 'NO_DATA', piIr: spo2Metrics?.piIr ?? null, piRed: spo2Metrics?.piRed ?? null, ratio: spo2Metrics?.ratio ?? null },
      combinedPpg: combined,
      cardiogramPpg,
      ppgChannels: processingChannels,
      ppgChannelsAll: enabledChannels,
      sampleRateHz,
      sensorMapping
    });
  }, [enabledPpgLabels, ppgTraceWindow, sampleRateHz, sensorMapping]);

  return {
    ppgChannels,
    heartData,
    handlePpgPacket
  };
}
