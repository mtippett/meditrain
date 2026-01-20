import React, { useEffect, useRef, useState } from 'react';
import MuseData from '../MuseData';
import ConfigWeights from '../ConfigWeights';
import { averagedPeriodogram, calcPeriodogram } from '../math/Periodogram.js';
import MultiEEGTraceChart from '../ui/MultiEEGTraceChart';

function DeviceControl({ onPeriodgramUpdated, selectedChannels = [], onToggleChannel, availableChannels = [], lastFFT: externalLastFFT = null }) {
  const BUFFER_SIZE = 20000; // keep a longer rolling window so streaming never stalls at 4096
  const eegChannelData = useRef([]);
  const channelMaps = useRef([]);
  const [channelsReady, setChannelsReady] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [lastFFT, setLastFFT] = useState(null);
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
          if (electrode.samples.length > 1024) {
            electrode.periodograms.push(calcPeriodogram(electrode.samples.slice(-1024)));
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

  const diag = {
    mapped: channelMaps.current.length,
    withSamples: channelsForDisplay.filter(c => c.samples.length > 0).length,
    withFFT: channelsForDisplay.filter(c => c.averagedPeriodogram).length,
    belowThreshold: channelsForDisplay.filter(c => c.samples.length > 0 && c.samples.length < 1024).length,
    totalPeriodograms: channelsForDisplay.reduce((sum, c) => sum + c.periodograms.length, 0),
    lastFFT: externalLastFFT || lastFFT
  };

  const fftBeat = diag.lastFFT ? Math.round((Date.now() - diag.lastFFT) / 1000) : null;

  return (
    <div className="device-panel" data-render={renderTick}>
      <div className="device-status">
        <MuseData onNewData={onNewData} updateChannelMaps={updateChannelMaps} />
        {channelMaps.current.length > 0 && (
          <p className="subdued">Channels detected: {channelMaps.current.join(' • ')}</p>
        )}
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
    </div>
  );
}

export default DeviceControl;
