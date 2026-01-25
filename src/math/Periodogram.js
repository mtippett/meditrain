import { fft, util as fftUtil } from 'fft-js';

// Basic notch filter coefficients (biquad) for 60 Hz at 256 Hz, Q ~30
function notchFilter(samples, f0 = 60, fs = 256, Q = 30) {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

// Hann window
function hannWindow(N) {
  const w = new Array(N);
  for (let n = 0; n < N; n++) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  }
  return w;
}

export function averagedPeriodogram(periodograms) {
  const averagedPeriodogram = { frequencies: periodograms[0].frequencies, magnitudes: [] };
  const numPeriodograms = periodograms.length;

  periodograms[0].magnitudes.forEach((_, index) => {
    let sum = 0;
    for (let i = 0; i < numPeriodograms; i++) {
      sum += periodograms[i].magnitudes[index];
    }
    averagedPeriodogram.magnitudes[index] = sum / numPeriodograms;
  });

  return averagedPeriodogram;
}

export function filterEEGData(eegData, notchHz = 60, samplingRate = 256) {
  if (!eegData || eegData.length === 0) return eegData;
  // Detrend (remove mean) and notch mains
  const mean = eegData.reduce((s, v) => s + v, 0) / eegData.length;
  const centered = eegData.map(v => v - mean);
  return notchFilter(centered, notchHz, samplingRate, 30);
}

// Returns one-sided PSD estimate (Welch-style single segment with Hann), units: power/bin normalized by fs
function calcPeriodogramCore(eegData, samplingRate = 256, applyNotch = true, notchHz = 60) {
  const N = eegData.length;
  if (!N) return { frequencies: [], magnitudes: [] };

  const mean = eegData.reduce((s, v) => s + v, 0) / N;
  const centered = eegData.map(v => v - mean);
  const window = hannWindow(N);
  const windowPower = window.reduce((s, v) => s + v * v, 0) / N;
  const filtered = applyNotch ? notchFilter(centered, notchHz, samplingRate, 30) : centered;
  const windowed = filtered.map((v, i) => v * window[i]);

  const phasors = fft(windowed);
  const freqs = fftUtil.fftFreq(phasors, samplingRate);
  const mags = fftUtil.fftMag(phasors);

  const psd = [];
  const freqOut = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] < 0) continue; // one-sided
    const power = (mags[i] * mags[i]) / (samplingRate * N * windowPower);
    const scale = (i === 0 || i === freqs.length - 1) ? 1 : 2; // conserve power for one-sided PSD
    psd.push(power * scale);
    freqOut.push(freqs[i]);
  }

  return { frequencies: freqOut, magnitudes: psd };
}

export function calcPeriodogram(eegData, samplingRate = 256, notchHz = 60) {
  return calcPeriodogramCore(eegData, samplingRate, true, notchHz);
}

export function calcRawPeriodogram(eegData, samplingRate = 256) {
  return calcPeriodogramCore(eegData, samplingRate, false);
}
