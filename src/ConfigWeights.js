import React from 'react';

function ConfigWeights({
  title,
  helperText = 'Selected sensors contribute to averaged views and the spectrogram.',
  emptyText = 'No channels detected yet.',
  availableChannels,
  selectedChannels,
  onToggleChannel
}) {
  return (
    <div className="config-weights">
      {title ? <p className="chart-label">{title}</p> : null}
      <div className="config-list">
        {availableChannels.map((ch) => (
          <label key={ch} className="config-option">
            <input
              type="checkbox"
              checked={selectedChannels.includes(ch)}
              onChange={() => onToggleChannel(ch)}
            />
            <span>{ch}</span>
          </label>
        ))}
        {availableChannels.length === 0 && <p className="subdued">{emptyText}</p>}
      </div>
      {helperText ? <p className="subdued">{helperText}</p> : null}
    </div>
  );
}

export default ConfigWeights;
