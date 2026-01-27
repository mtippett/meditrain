import { useMemo } from 'react';

function useDeviceDiagnostics({
  channelMaps = [],
  eegData = [],
  channelsForDisplay = [],
  fftWindow,
  lastFFT,
  telemetry,
  lastEegReceivedAt,
  lastPpg,
  lastAccel,
  lastGyro,
  museStatus,
  dataStale,
  isStreaming
}) {
  const statusLabel = museStatus.isConnected
    ? 'Connected'
    : museStatus.isConnecting
      ? 'Connecting'
      : 'Disconnected';

  const statusMessage = museStatus.error
    ? museStatus.error
    : dataStale
      ? 'Stale data'
      : isStreaming
        ? 'Streaming'
        : 'Idle';

  const diag = useMemo(() => {
    const mapped = channelMaps.length;
    const channels = (eegData || []).filter(Boolean);
    const withSamples = channels.filter(c => (c.samples?.length || 0) > 0).length;
    const withFFT = channels.filter(c => (c.samples?.length || 0) >= fftWindow).length;
    const belowThreshold = channels.filter(c => (c.samples?.length || 0) > 0 && c.samples.length < fftWindow).length;
    const totalPeriodograms = channels.reduce((sum, c) => sum + (c.periodograms?.length || 0), 0);
    return {
      mapped,
      withSamples,
      withFFT,
      belowThreshold,
      totalPeriodograms,
      lastFFT
    };
  }, [channelMaps, eegData, fftWindow, lastFFT]);

  const signalQuality = useMemo(() => {
    const checked = (channelsForDisplay || []).length;
    const badLabels = (channelsForDisplay || [])
      .filter(c => c?.artifactLatest?.amplitudeArtifact || c?.artifactLatest?.lineNoiseArtifact)
      .map(c => c.label || `CH ${c.electrode}`);
    return { checked, badLabels };
  }, [channelsForDisplay]);

  const signalRejectionPct = signalQuality.checked > 0
    ? Math.round((signalQuality.badLabels.length / signalQuality.checked) * 100)
    : 0;

  const fftBeat = diag.lastFFT ? Math.max(0, Math.round((Date.now() - diag.lastFFT) / 1000)) : null;
  const telemetryAge = telemetry?.receivedAt ? Math.max(0, Math.round((Date.now() - telemetry.receivedAt) / 1000)) : null;
  const lastSampleAt = lastEegReceivedAt.current ? new Date(lastEegReceivedAt.current) : null;
  const ppgAge = lastPpg?.receivedAt ? Math.max(0, Math.round((Date.now() - lastPpg.receivedAt) / 1000)) : null;
  const latestAccel = lastAccel;
  const latestGyro = lastGyro;

  return {
    statusLabel,
    statusMessage,
    diag,
    signalQuality,
    signalRejectionPct,
    fftBeat,
    telemetryAge,
    lastSampleAt,
    ppgAge,
    latestAccel,
    latestGyro
  };
}

export default useDeviceDiagnostics;
