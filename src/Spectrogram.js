import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fft, util as fftUtil } from 'fft-js';
import { interpolateTurbo, rgb as d3Rgb } from 'd3';

function hannWindow(N) {
  const w = new Array(N);
  for (let n = 0; n < N; n += 1) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  }
  return w;
}

function nextPow2(value) {
  let v = Math.max(1, Math.floor(value));
  let p = 1;
  while (p < v) p *= 2;
  return p;
}

function computeSpectrogram(samples, fs, nperseg, noverlap, nfft, maxFreq) {
  if (!samples || samples.length < nperseg) return null;
  const step = Math.max(1, nperseg - noverlap);
  const window = hannWindow(nperseg);
  const windowPower = window.reduce((s, v) => s + v * v, 0) / nperseg;
  const times = [];
  const slices = [];
  let freqOut = null;

  for (let start = 0; start + nperseg <= samples.length; start += step) {
    const segment = samples.slice(start, start + nperseg);
    const padded = new Array(nfft).fill(0);
    for (let i = 0; i < nperseg; i += 1) {
      padded[i] = segment[i] * window[i];
    }
    const phasors = fft(padded);
    const freqs = fftUtil.fftFreq(phasors, fs);
    const mags = fftUtil.fftMag(phasors);

    const psd = [];
    const freqsFiltered = [];
    const nyquistIdx = Math.floor(nfft / 2);
    for (let i = 0; i < freqs.length; i += 1) {
      if (freqs[i] < 0) continue;
      if (freqs[i] > maxFreq) continue;
      const power = (mags[i] * mags[i]) / (fs * nperseg * windowPower);
      const scale = (i === 0 || i === nyquistIdx) ? 1 : 2;
      psd.push(power * scale);
      freqsFiltered.push(freqs[i]);
    }
    if (!freqOut) {
      freqOut = freqsFiltered;
    }
    const tMid = (start + nperseg / 2) / fs;
    times.push(tMid);
    slices.push(psd);
  }
  if (!slices.length || !freqOut || !freqOut.length) return null;
  return { freqs: freqOut, times, slices };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function Spectrogram({ eegData, selectedChannels, windowSeconds = 300, preferCachedSlices = true }) {
  const maxFreq = 50; // align with notebook spectrogram range
  const sampleRate = 256;
  const maxSamples = Math.round(windowSeconds * sampleRate);
  const nperseg = Math.max(256, Math.min(2048, maxSamples));
  const timeStep = Math.max(32, Math.floor(nperseg / 16));
  const noverlap = Math.max(0, nperseg - timeStep);
  const nfft = Math.max(8192, nextPow2(nperseg * 4));
  const canvasRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(500);

  const channelsWithSpectra = useMemo(() => {
    const targets = selectedChannels.length ? selectedChannels : eegData.map(c => c.label || c.electrode);
    return eegData
      .filter((c) => targets.includes(c.label || c.electrode))
      .filter((c) => c.samples && c.samples.length >= nperseg);
  }, [eegData, selectedChannels, nperseg]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const measuredWidth = canvasRef.current.parentElement?.clientWidth || plotWidth;
    if (measuredWidth !== plotWidth) {
      setPlotWidth(measuredWidth);
    }
  }, [plotWidth]);

  const spectrograms = useMemo(() => {
    if (!channelsWithSpectra.length) return [];
    const cutoffMs = Date.now() - windowSeconds * 1000;
    return channelsWithSpectra.map((channel) => {
      const label = channel.label || channel.electrode;
      const slices = Array.isArray(channel.spectrogramSlices) ? channel.spectrogramSlices : [];
      const usable = slices.filter(s => (s.t || 0) >= cutoffMs);
      if (preferCachedSlices && usable.length >= 2) {
        const freqs = usable[0].frequencies || [];
        const freqMask = freqs.map((f) => f <= maxFreq);
        const times = usable.map(s => (s.t - usable[0].t) / 1000);
        const EPS = 1e-12;
        const dbSlices = usable.map((s) => {
          const mags = s.magnitudes || [];
          const filtered = mags.filter((_, idx) => freqMask[idx]);
          return filtered.map(v => 10 * Math.log10(Math.max(v, EPS)));
        });
        const freqsFiltered = freqs.filter((_, idx) => freqMask[idx]);
        return { label, freqs: freqsFiltered, times, dbSlices };
      }

      const samples = channel.samples || [];
      const clipped = maxSamples > 0 ? samples.slice(-maxSamples) : samples.slice();
      if (clipped.length < nperseg) return null;
      const mean = clipped.reduce((s, v) => s + v, 0) / clipped.length;
      const centered = clipped.map(v => v - mean);
      const spec = computeSpectrogram(centered, sampleRate, nperseg, noverlap, nfft, maxFreq);
      if (!spec) return null;
      const EPS = 1e-12;
      const dbSlices = spec.slices.map(slice => slice.map(v => 10 * Math.log10(Math.max(v, EPS))));
      return { label, freqs: spec.freqs, times: spec.times, dbSlices };
    }).filter(Boolean);
  }, [channelsWithSpectra, maxFreq, maxSamples, nfft, noverlap, nperseg, sampleRate, windowSeconds, preferCachedSlices]);

  const labels = spectrograms.map(s => s.label);
  const rowHeight = 180;
  const axisHeight = 20;
  const height = Math.max(axisHeight, labels.length * rowHeight + axisHeight);

  const allDbValues = spectrograms.flatMap(spec => spec.dbSlices.flat());
  let vmin = percentile(allDbValues, 5);
  let vmax = percentile(allDbValues, 95);
  if (!isFinite(vmin) || !isFinite(vmax) || vmin === vmax) {
    vmin = -120;
    vmax = -40;
  }

  const palette = useMemo(() => {
    const colors = [];
    for (let i = 0; i < 256; i += 1) {
      const c = d3Rgb(interpolateTurbo(i / 255));
      colors.push([c.r, c.g, c.b]);
    }
    return colors;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(plotWidth * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${plotWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, plotWidth, height);

    spectrograms.forEach((spec, idx) => {
      const { label, dbSlices } = spec;
      if (!dbSlices || dbSlices.length === 0) return;

      const slicesCount = dbSlices.length;
      const freqBins = dbSlices[0].length || 1;
      const offscreen = document.createElement('canvas');
      offscreen.width = slicesCount;
      offscreen.height = freqBins;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;
      const image = offCtx.createImageData(slicesCount, freqBins);
      const data = image.data;

      for (let x = 0; x < slicesCount; x += 1) {
        const slice = dbSlices[x];
        for (let y = 0; y < freqBins; y += 1) {
          const vDb = slice[y];
          const t = Math.max(0, Math.min(1, (vDb - vmin) / (vmax - vmin)));
          const c = palette[Math.min(255, Math.max(0, Math.round(t * 255)))];
          const yFlip = freqBins - 1 - y;
          const idxPix = (yFlip * slicesCount + x) * 4;
          data[idxPix] = c[0];
          data[idxPix + 1] = c[1];
          data[idxPix + 2] = c[2];
          data[idxPix + 3] = 255;
        }
      }
      offCtx.putImageData(image, 0, 0);

      const rowTop = idx * rowHeight;
      ctx.drawImage(offscreen, 0, rowTop, plotWidth, rowHeight);

      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, rowTop);
      ctx.lineTo(0, rowTop + rowHeight);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, rowTop + rowHeight);
      ctx.lineTo(plotWidth, rowTop + rowHeight);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([4, 4]);
      [{ name: 'delta', f: 0.5 }, { name: 'theta', f: 4 }, { name: 'alpha', f: 8 }, { name: 'beta', f: 12 }, { name: 'gamma', f: 30 }].forEach((band) => {
        const y = rowTop + rowHeight - (band.f / maxFreq) * rowHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '12px sans-serif';
      ctx.fillText(label, 8, rowTop + 16);
      ctx.fillText(`${maxFreq} Hz`, 8, rowTop + 30);
      ctx.fillText('0 Hz', 8, rowTop + rowHeight - 6);
    });

    if (labels.length > 0 && spectrograms[0]?.dbSlices?.length > 1) {
      const durationSec = Math.max(1, Math.round(windowSeconds));
      const ticks = 4;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '10px sans-serif';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(0, height - axisHeight);
      ctx.lineTo(plotWidth, height - axisHeight);
      ctx.stroke();
      for (let i = 0; i <= ticks; i += 1) {
        const t = i / ticks;
        const x = t * plotWidth;
        const label = i === ticks ? '0s' : `-${Math.round((1 - t) * durationSec)}s`;
        const textWidth = ctx.measureText(label).width;
        let textX = x;
        if (i === ticks) textX = x - textWidth;
        if (i === 0) textX = x;
        if (i > 0 && i < ticks) textX = x - textWidth / 2;
        ctx.fillText(label, textX, height - 4);
      }
    }
  }, [height, labels, palette, plotWidth, spectrograms, vmax, vmin, windowSeconds, maxFreq]);

  if (labels.length === 0) {
    return <p className="subdued">Waiting for per-channel spectrograms.</p>;
  }

  return (
    <canvas ref={canvasRef} className="spectrogram" />
  );
}

export default Spectrogram;
