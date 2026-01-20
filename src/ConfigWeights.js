import React from 'react';

function ConfigWeights({ availableChannels, selectedChannels, onToggleChannel }) {
  return (
    <div className="config-weights">
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
        {availableChannels.length === 0 && <p className="subdued">No channels detected yet.</p>}
      </div>
      <p className="subdued">Selected sensors contribute to averaged views and the spectrogram.</p>
    </div>
  );
}

export default ConfigWeights;
