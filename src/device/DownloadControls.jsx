import React from 'react';

function DownloadControls({
  onDownload,
  isStreaming,
  autoDownloadEnabled,
  onAutoDownloadChange,
  autoDownloadMs
}) {
  const autoDownloadSeconds = Math.max(1, Math.round((autoDownloadMs || 0) / 1000));

  return (
    <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button type="button" onClick={onDownload} disabled={!isStreaming}>
        Download BIDS EEG
      </button>
      <label className="status-pill" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={autoDownloadEnabled}
          onChange={(e) => onAutoDownloadChange(e.target.checked)}
          style={{ marginRight: 6 }}
        />
        Auto-download every {autoDownloadSeconds}s
      </label>
    </div>
  );
}

export default DownloadControls;
