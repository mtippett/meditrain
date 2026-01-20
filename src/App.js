import React, { useEffect } from 'react';
import DeviceControl from './device/DeviceControl';
import BandPower from './BandPower';
import TrainingControl from './TrainingControl';
import TrainingView from './TrainingView';
import BrainView from './BrainView';
import Spectrogram from './Spectrogram';
import BandPeriodograms from './BandPeriodograms';

import { useState } from 'react';
import './App.css';


function App() {
  const [eegData, setEEGData] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [lastFFT, setLastFFT] = useState(null);


  function onPeriodgramUpdated(updatedEEGData) {
    setEEGData([...updatedEEGData]); // Likely too much data is copied
    setLastFFT(Date.now());
  }

  function onBandPowerUpdated(bandPowerData) {
    // console.log("obpu", bandPowerData)
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

  const filteredEegData =
    selectedChannels.length === 0
      ? eegData
      : eegData.filter(c => selectedChannels.includes(c.label || c.electrode));

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
        <section className="panel tall">
          <div className="panel-heading">
            <h3>Band Power Observatory</h3>
            <span>Alpha / Beta / Gamma with regional deltas</span>
            <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
              {lastFFT ? `${Math.round((Date.now() - lastFFT)/1000)}s` : '—'}
            </span>
          </div>
          <p className="subdued">Toggle into band views to compare electrodes, see averaged periodograms, and spot left/right imbalances.</p>
          <BandPower onBandPowerUpdated={onBandPowerUpdated} eegData={filteredEegData} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h3>Brain View</h3>
            <span>Spatial intuition</span>
          </div>
          <p className="subdued">Visualize regions and synchrony cues. Enrich this with new layers as training logic matures.</p>
          <BrainView eegData={filteredEegData} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h3>Training Console</h3>
            <span>Targets & feedback</span>
          </div>
          <p className="subdued">Select targets, pick a feedback mode, and monitor how often you stay in the pocket.</p>
          <div className="inline-buttons">
            <TrainingControl />
            <TrainingView />
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h3>Band Periodograms</h3>
            <span>Per-channel spectra (weighted selection)</span>
            <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
              {lastFFT ? `${Math.round((Date.now() - lastFFT)/1000)}s` : '—'}
            </span>
          </div>
          <p className="subdued">Live per-channel periodograms up to 50 Hz (uses selected sensors).</p>
          <BandPeriodograms eegData={filteredEegData} selectedChannels={selectedChannels} />
        </section>

        <section className="panel tall">
          <div className="panel-heading">
            <h3>Spectrogram</h3>
            <span>Per-channel heatmaps</span>
            <span className={`heartbeat-dot ${lastFFT && (Date.now() - lastFFT) < 5000 ? 'alive' : ''}`}>
              {lastFFT ? `${Math.round((Date.now() - lastFFT)/1000)}s` : '—'}
            </span>
          </div>
          <p className="subdued">Live per-channel spectrograms up to 50 Hz, honoring your sensor selection.</p>
          <Spectrogram eegData={filteredEegData} selectedChannels={selectedChannels} />
        </section>
      </main>
    </div>
  );
}

export default App;
