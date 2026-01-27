import React from 'react';
function DeviceStatusPanel({
  museIsConnected,
  statusLabel,
  statusMessage,
  channelsDetected,
  diag,
  fftWindow,
  fftBeat,
  dataStale,
  reconnectAttempts,
  telemetry,
  telemetryAge,
  lastSampleAt,
  lastPpg,
  ppgAge,
  latestAccel,
  latestGyro
}) {
  return (
    <>
      <div className="inline-status">
        <span className={`status-pill ${museIsConnected ? '' : 'warn'}`}>
          Device: {statusLabel}
        </span>
        <span className="status-pill">
          Status: {statusMessage}
        </span>
      </div>
      {channelsDetected.length > 0 && (
        <p className="subdued">Channels detected: {channelsDetected.join(' • ')}</p>
      )}
      <div className="inline-status">
        <span className="status-pill">Mapped: {diag.mapped}</span>
        <span className="status-pill">With samples: {diag.withSamples}</span>
        <span className="status-pill">FFT ready: {diag.withFFT}</span>
        <span className="status-pill">Below {fftWindow} samples: {diag.belowThreshold}</span>
        <span className="status-pill">Periodograms stored: {diag.totalPeriodograms}</span>
        <span className={`status-pill heartbeat ${fftBeat !== null && fftBeat < 5 ? 'alive' : ''}`}>
          Last FFT: {diag.lastFFT ? `${fftBeat}s ago` : '—'}
        </span>
        {dataStale && (
          <span className="status-pill" style={{ background: '#6d2828', color: '#fff' }}>
            Data stale, reconnecting{reconnectAttempts > 0 ? ` (${reconnectAttempts})` : ''}
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
          Accel: {Number.isFinite(latestAccel?.x) && Number.isFinite(latestAccel?.y) && Number.isFinite(latestAccel?.z)
            ? `${latestAccel.x.toFixed(2)}, ${latestAccel.y.toFixed(2)}, ${latestAccel.z.toFixed(2)}`
            : '—'}
        </span>
        <span className="status-pill">
          Gyro: {Number.isFinite(latestGyro?.x) && Number.isFinite(latestGyro?.y) && Number.isFinite(latestGyro?.z)
            ? `${latestGyro.x.toFixed(2)}, ${latestGyro.y.toFixed(2)}, ${latestGyro.z.toFixed(2)}`
            : '—'}
        </span>
      </div>
    </>
  );
}

export default DeviceStatusPanel;
