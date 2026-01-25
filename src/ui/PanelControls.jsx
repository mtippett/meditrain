import React from 'react';

function PanelHeading({ title, subtitle, indicator, children }) {
  return (
    <div className="panel-heading">
      <div className="panel-title">
        <h3>{title}</h3>
        {subtitle ? <span>{subtitle}</span> : null}
        {indicator}
      </div>
      {children}
    </div>
  );
}

function PanelControls({ children }) {
  return (
    <div className="panel-controls">
      {children}
    </div>
  );
}

function PanelControlButton({ pressed = false, onClick, ariaLabel, title, children }) {
  return (
    <button
      type="button"
      className="panel-button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export { PanelHeading, PanelControls, PanelControlButton };
