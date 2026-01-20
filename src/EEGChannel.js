import EEGTraceChart from './ui/EEGTraceChart';
import EEGPeriodogramChart from './ui/EEGPeriodogramChart';

function EEGChannel({ channel, showPeriodograms = true }) {
  const hasPeriodograms = channel.periodograms && channel.periodograms.length > 0;
  const fftReady = channel.samples.length >= 1024;
  const traceWindow = channel.samples.slice(-4096);

  return (
    <div className="channel-card" id={channel.electrode}>
      <div className="channel-header">
        <div>
          <p className="eyebrow">{channel.label || channel.electrode}</p>
          <h4 className="channel-title">Samples: {channel.samples.length}</h4>
          <p className="channel-meta">
            FFT ready: {fftReady ? 'yes' : 'waiting'} • Periodograms: {channel.periodograms.length} • Averaged: {channel.averagedPeriodogram ? 'yes' : 'no'}
          </p>
        </div>
        <div className="channel-meta">
          <span>{hasPeriodograms ? `${channel.periodograms.length} spectra` : 'Waiting for spectra'}</span>
        </div>
      </div>

      <div className="channel-visuals">
        {channel.samples.length > 0 ? (
          <div className="chart-block">
            <p className="chart-label">EEG Trace</p>
            <EEGTraceChart samples={traceWindow} />
          </div>
        ) : (
          <p className="subdued">No samples yet.</p>
        )}

        {showPeriodograms && hasPeriodograms && (
          <div className="chart-block">
            <p className="chart-label">Periodogram</p>
            <EEGPeriodogramChart periodograms={channel.periodograms} averagedPeriodogram={channel.averagedPeriodogram} />
          </div>
        )}
      </div>
    </div>
  );
}

export default EEGChannel;
