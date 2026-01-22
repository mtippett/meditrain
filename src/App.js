import React, { useEffect, useRef, useState } from 'react';
import DeviceControl from './device/DeviceControl';
import BandPower from './BandPower';
import TrainingControl from './TrainingControl';
import TrainingView from './TrainingView';
import Spectrogram from './Spectrogram';
import BandPeriodograms from './BandPeriodograms';

import './App.css';
import { STANDARD_BANDS } from './constants/bands';

function App() {
  const [eegData, setEEGData] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [trainingTargets, setTrainingTargets] = useState([]);
  const [bandSnapshots, setBandSnapshots] = useState([]);
  const [bandHistory, setBandHistory] = useState({});
  const [bandWindowSec, setBandWindowSec] = useState(120);
  const [spectrogramWindowSec, setSpectrogramWindowSec] = useState(300);
  const [bandSmoothingSec, setBandSmoothingSec] = useState(10);
  const [deltaSmoothingSec, setDeltaSmoothingSec] = useState(10);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [lastFFT, setLastFFT] = useState(null);
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const noiseRef = useRef(null);
  const lastBandSigRef = useRef({});
  const [showBandPower, setShowBandPower] = useState(true);
  const [showPeriodograms, setShowPeriodograms] = useState(true);
  const [showSpectrogram, setShowSpectrogram] = useState(true);
  const [fullscreenPanel, setFullscreenPanel] = useState(null);


  function onPeriodgramUpdated(updatedEEGData) {
    setEEGData([...updatedEEGData]); // Likely too much data is copied
    setLastFFT(Date.now());
  }

  const activeElectrodes = eegData.length;
  const totalSamples = eegData.reduce((sum, channel) => sum + (channel.samples?.length || 0), 0);
  const totalPeriodograms = eegData.reduce((sum, channel) => sum + (channel.periodograms?.length || 0), 0);

  const availableChannels = Array.from(
    new Set(
      eegData.map((c) => c.label || c.electrode)
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

  // Default to all non-AUX channels once they appear
  useEffect(() => {
    if (availableChannels.length > 0 && selectedChannels.length === 0) {
      const defaultEnabled = availableChannels.filter(ch => ch !== 'AUXL' && ch !== 'AUXR');
      setSelectedChannels(defaultEnabled);
    }
  }, [availableChannels, selectedChannels.length]);

  // Load persisted settings
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('meditrain-settings') || '{}');
      if (stored.selectedChannels) setSelectedChannels(stored.selectedChannels);
      if (stored.trainingTargets) setTrainingTargets(stored.trainingTargets);
      if (stored.bandWindowSec) setBandWindowSec(stored.bandWindowSec);
      if (stored.spectrogramWindowSec) setSpectrogramWindowSec(stored.spectrogramWindowSec);
      if (stored.bandSmoothingSec) setBandSmoothingSec(stored.bandSmoothingSec);
      if (stored.deltaSmoothingSec) setDeltaSmoothingSec(stored.deltaSmoothingSec);
      if (typeof stored.showBandPower === 'boolean') setShowBandPower(stored.showBandPower);
      if (typeof stored.showPeriodograms === 'boolean') setShowPeriodograms(stored.showPeriodograms);
      if (typeof stored.showSpectrogram === 'boolean') setShowSpectrogram(stored.showSpectrogram);
    } catch (e) {
      // ignore parse errors
    }
  }, []);

  // Persist settings
  useEffect(() => {
    const payload = {
      selectedChannels,
      trainingTargets,
      bandWindowSec,
      spectrogramWindowSec,
      bandSmoothingSec,
      deltaSmoothingSec,
      showBandPower,
      showPeriodograms,
      showSpectrogram
    };
    localStorage.setItem('meditrain-settings', JSON.stringify(payload));
  }, [
    selectedChannels,
    trainingTargets,
    bandWindowSec,
    spectrogramWindowSec,
    bandSmoothingSec,
    deltaSmoothingSec,
    showBandPower,
    showPeriodograms,
    showSpectrogram
  ]);

  const filteredEegData =
    selectedChannels.length === 0
      ? eegData
      : eegData.filter(c => selectedChannels.includes(c.label || c.electrode));

  // Always compute band snapshots from incoming FFTs, regardless of which panels are visible
  useEffect(() => {
    const channelList =
      selectedChannels.length === 0
        ? eegData
        : eegData.filter(c => selectedChannels.includes(c.label || c.electrode));

    const snapshots = [];
    const now = Date.now();
    channelList.forEach(electrode => {
      if (!electrode?.averagedPeriodogram) return;
      const bandTotals = {};
      let totalPower = 0;
      STANDARD_BANDS.forEach(({ key }) => {
        bandTotals[key] = 0;
      });
      const freqs = electrode.averagedPeriodogram.frequencies;
      const mags = electrode.averagedPeriodogram.magnitudes;
      const binWidth = freqs.length > 1 ? Math.abs(freqs[1] - freqs[0]) : 1;
      freqs.forEach((freq, idx) => {
        const power = mags[idx] * binWidth; // integrate PSD over bin width
        const band = STANDARD_BANDS.find(b => freq >= b.min && freq < b.max);
        if (band) {
          bandTotals[band.key] += power;
          totalPower += power;
        }
      });
      const bands = {};
      STANDARD_BANDS.forEach(({ key }) => {
        const absolute = bandTotals[key];
        bands[key] = {
          absolute,
          relative: totalPower > 0 ? absolute / totalPower : 0
        };
      });
      snapshots.push({ label: electrode.label || electrode.electrode, bands, timestamp: now });
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
  }, [eegData, selectedChannels]);

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

  // Simple audio white noise driven by distance from targets
  useEffect(() => {
    if (!audioEnabled || trainingTargets.length === 0) {
      return;
    }

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
    if (!audioEnabled || !gainRef.current || trainingTargets.length === 0) {
      if (gainRef.current) gainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
      return;
    }
    // compute max distance outside target ranges
    let maxDistance = 0;
    trainingTargets.forEach(target => {
      const snapshot = bandSnapshots.find(s => s.label === target.label);
      const current = snapshot?.bands?.[target.band]?.relative;
      if (typeof current !== 'number') return;
      const diff = Math.abs(current - target.target);
      const over = Math.max(0, diff - target.tolerance);
      if (over > maxDistance) maxDistance = over;
    });

    const norm = Math.max(0, Math.min(1, maxDistance * 5)); // scale sensitivity
    if (gainRef.current) {
      gainRef.current.gain.setTargetAtTime(norm * 0.2, audioCtxRef.current.currentTime, 0.05);
    }
  }, [audioEnabled, trainingTargets, bandSnapshots]);

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
            onPeriodgramUpdated={onPeriodgramUpdated}
            selectedChannels={selectedChannels}
            onToggleChannel={onToggleChannel}
            availableChannels={availableChannels}
            lastFFT={lastFFT}
          />
        </div>
      </header>

      <main className="content-grid">
        <section className={`panel tall ${fullscreenPanel === 'bandpower' ? 'fullscreen' : ''}`}>
          <div className="panel-heading">
            <h3>Band Power Observatory</h3>
            <span>Alpha / Beta / Gamma with regional deltas</span>
            <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
              {lastFFT ? `${Math.round((Date.now() - lastFFT)/1000)}s` : '—'}
            </span>
            <div className="panel-controls">
              <button type="button" onClick={() => setShowBandPower(v => !v)}>
                {showBandPower ? 'Hide' : 'Show'}
              </button>
              <button type="button" onClick={() => setFullscreenPanel(prev => prev === 'bandpower' ? null : 'bandpower')}>
                {fullscreenPanel === 'bandpower' ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <p className="subdued">
            Toggle into band views to compare electrodes, see averaged periodograms, and spot left/right imbalances.
            Targets (if defined) are shaded on each band line; a preview appears when no live data is available.
          </p>
          {showBandPower && (
            <BandPower
              bandHistory={bandHistory}
              trainingTargets={trainingTargets}
              windowSeconds={bandWindowSec}
            />
          )}
        </section>

        <section className={`panel ${fullscreenPanel === 'training' ? 'fullscreen' : ''}`}>
          <div className="panel-heading">
            <h3>Training Console</h3>
            <span>Targets & feedback</span>
            <div className="panel-controls">
              <button type="button" onClick={() => setFullscreenPanel(prev => prev === 'training' ? null : 'training')}>
                {fullscreenPanel === 'training' ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <p className="subdued">Select targets, pick a feedback mode, and monitor how often you stay in the pocket.</p>
          <TrainingControl
            availableChannels={availableChannels}
            selectedTargets={trainingTargets}
            bandSnapshots={bandSnapshots}
            bandHistory={bandHistory}
            deltaSmoothingSec={deltaSmoothingSec}
            onSaveTarget={upsertTarget}
            onDeleteTarget={deleteTarget}
            audioEnabled={audioEnabled}
            onToggleAudio={setAudioEnabled}
          />
          <TrainingView />
        </section>

        <section className={`panel ${fullscreenPanel === 'config' ? 'fullscreen' : ''}`}>
          <div className="panel-heading">
            <h3>Configuration</h3>
            <span>Display windows</span>
            <div className="panel-controls">
              <button type="button" onClick={() => setFullscreenPanel(prev => prev === 'config' ? null : 'config')}>
                {fullscreenPanel === 'config' ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <p className="subdued">Adjust how many seconds of history are rendered for band power and spectrograms.</p>
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
          </div>
        </section>

        <section className={`panel ${fullscreenPanel === 'periodograms' ? 'fullscreen' : ''}`}>
          <div className="panel-heading">
            <h3>Band Periodograms</h3>
            <span>Per-channel spectra (weighted selection)</span>
            <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
              {lastFFT ? `${Math.round((Date.now() - lastFFT)/1000)}s` : '—'}
            </span>
            <div className="panel-controls">
              <button type="button" onClick={() => setShowPeriodograms(v => !v)}>
                {showPeriodograms ? 'Hide' : 'Show'}
              </button>
              <button type="button" onClick={() => setFullscreenPanel(prev => prev === 'periodograms' ? null : 'periodograms')}>
                {fullscreenPanel === 'periodograms' ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <p className="subdued">Live per-channel periodograms up to 50 Hz (uses selected sensors).</p>
          {showPeriodograms && (
            <BandPeriodograms eegData={filteredEegData} selectedChannels={selectedChannels} />
          )}
        </section>

        <section className={`panel tall ${fullscreenPanel === 'spectrogram' ? 'fullscreen' : ''}`}>
          <div className="panel-heading">
            <h3>Spectrogram</h3>
            <span>Per-channel heatmaps</span>
            <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
              {lastFFT ? `${Math.round((Date.now() - lastFFT)/1000)}s` : '—'}
            </span>
            <div className="panel-controls">
              <button type="button" onClick={() => setShowSpectrogram(v => !v)}>
                {showSpectrogram ? 'Hide' : 'Show'}
              </button>
              <button type="button" onClick={() => setFullscreenPanel(prev => prev === 'spectrogram' ? null : 'spectrogram')}>
                {fullscreenPanel === 'spectrogram' ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <p className="subdued">Live per-channel spectrograms up to 50 Hz, honoring your sensor selection.</p>
          {showSpectrogram && (
            <Spectrogram eegData={filteredEegData} selectedChannels={selectedChannels} windowSeconds={spectrogramWindowSec} />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
