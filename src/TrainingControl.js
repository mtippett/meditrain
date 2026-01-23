import React, { useState, useEffect } from 'react';
import { BAND_KEYS } from './constants/bands';

function TrainingControl({ availableChannels = [], selectedTargets = [], bandSnapshots = [], bandHistory = {}, deltaSmoothingSec = 10, onSaveTarget, onDeleteTarget, audioEnabled, audioSensitivity = null, audioSensitivityHistory = [], onToggleAudio, presets = [], presetsLoading = false, presetsError = null, onApplyPreset, onClearTargets }) {
  const [form, setForm] = useState({
    id: null,
    label: [],
    band: 'alpha',
    target: 0.3,
    tolerance: 0.05
  });
  const [selectedPreset, setSelectedPreset] = useState('');

  // Format preset name for display (snake_case -> Title Case)
  function formatPresetName(name) {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function handlePresetChange(e) {
    const presetName = e.target.value;
    setSelectedPreset(presetName);
    if (presetName && onApplyPreset) {
      onApplyPreset(presetName);
    }
  }

  useEffect(() => {
    if (form.id !== null) return;
    if (form.label.length === 0) {
      if (availableChannels.length > 0) {
        setForm(f => ({ ...f, label: [availableChannels[0]] }));
      } else {
        setForm(f => ({ ...f, label: ['ALL'] }));
      }
    }
  }, [availableChannels, form.id, form.label.length]);

  function handleSubmit(e) {
    e.preventDefault();
    if (form.label.length === 0) return;
    // prevent duplicate target for same label+band
    const exists = selectedTargets.some(t => t.label === form.label[0] && t.band === form.band && t.id !== form.id);
    if (exists) return;
    const id = form.id || Date.now().toString();
    onSaveTarget({
      id,
      label: form.label[0],
      band: form.band,
      target: Number(form.target),
      tolerance: Number(form.tolerance)
    });
    setForm({ id: null, label: form.label, band: form.band, target: form.target, tolerance: form.tolerance });
  }

  function startEdit(target) {
    setForm({
      id: target.id,
      label: [target.label],
      band: target.band,
      target: target.target,
      tolerance: target.tolerance
    });
  }

  return (
    <div className="training-control">
      {/* Preset Selector */}
      <div className="preset-selector">
        <div className="field">
          <label>Load Preset Profile</label>
          <select 
            value={selectedPreset} 
            onChange={handlePresetChange}
            disabled={presetsLoading || presets.length === 0}
          >
            {presetsLoading ? (
              <option value="">Loading presets...</option>
            ) : presets.length === 0 ? (
              <option value="">{presetsError ? 'Failed to load presets' : 'No presets available'}</option>
            ) : (
              <>
                <option value="">-- Select a preset ({presets.length} available) --</option>
                {presets.map(p => (
                  <option key={p.name} value={p.name}>{formatPresetName(p.name)}</option>
                ))}
              </>
            )}
          </select>
          {presetsError && (
            <span className="preset-error">Error: {presetsError}</span>
          )}
        </div>
        {selectedTargets.length > 0 && onClearTargets && (
          <button type="button" className="clear-btn" onClick={onClearTargets}>
            Clear All Targets
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="training-form">
        <div className="field">
          <label>Electrode</label>
          <select
            value={form.label[0] || ''}
            onChange={(e) => setForm({ ...form, label: [e.target.value] })}
          >
            <option value="ALL">All electrodes</option>
            <option value="PAIR_TP9_10">Paired TP9/TP10</option>
            <option value="PAIR_AF7_8">Paired AF7/AF8</option>
            {availableChannels.map(ch => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Band</label>
          <select value={form.band} onChange={(e) => setForm({ ...form, band: e.target.value })}>
            {BAND_KEYS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Target (relative 0-1)</label>
          <input type="number" step="0.01" min="0" max="1" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
        </div>
        <div className="field">
          <label>Tolerance (±)</label>
          <input type="number" step="0.01" min="0" max="1" value={form.tolerance} onChange={(e) => setForm({ ...form, tolerance: e.target.value })} />
        </div>
        <div className="inline-buttons">
          <button type="submit">{form.id ? 'Update Target' : 'Add Target'}</button>
          <button type="button" onClick={() => onToggleAudio(!audioEnabled)}>
            {audioEnabled ? 'Disable' : 'Enable'} Audio Feedback
          </button>
        </div>
      </form>

      {typeof audioSensitivity === 'number' && (
        <p className="subdued">Sensitivity: {audioSensitivity.toFixed(2)}</p>
      )}

      {typeof audioSensitivity === 'number' && (
        <div className="chart-block" style={{ marginTop: 8 }}>
          <p className="chart-label" style={{ marginBottom: 6 }}>Sensitivity history</p>
          <svg width="100%" height="80" viewBox="0 0 300 80" preserveAspectRatio="none">
            {(() => {
              const history = audioSensitivityHistory.length > 0
                ? audioSensitivityHistory
                : [{ t: Date.now(), v: audioSensitivity }];
              const values = history.map(p => p.v);
              const minV = Math.min(...values);
              const maxV = Math.max(...values);
              const range = Math.max(0.001, maxV - minV);
              const denom = Math.max(1, history.length - 1);
              const points = history.map((p, idx) => {
                const x = (idx / denom) * 300;
                const y = 70 - ((p.v - minV) / range) * 60;
                return `${x},${y}`;
              });
              return (
                <>
                  <line x1="0" y1="0" x2="0" y2="70" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                  <line x1="0" y1="70" x2="300" y2="70" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                  <text x="2" y="10" fill="rgba(255,255,255,0.6)" fontSize="9">{maxV.toFixed(2)}</text>
                  <text x="2" y="68" fill="rgba(255,255,255,0.6)" fontSize="9">{minV.toFixed(2)}</text>
                  <polyline
                    fill="none"
                    stroke="rgba(74, 222, 128, 0.9)"
                    strokeWidth="2"
                    points={points.join(' ')}
                  />
                </>
              );
            })()}
          </svg>
        </div>
      )}

      <div className="target-list">
        {selectedTargets.length === 0 && <p className="subdued">No targets yet.</p>}
        {selectedTargets.map(target => {
          const series = bandHistory?.[target.label]?.[target.band] || [];
          const now = Date.now();
          const smoothMs = deltaSmoothingSec * 1000;
          const filtered = series.filter(p => p.t >= now - smoothMs);
          const avg = filtered.length ? filtered.reduce((sum, p) => sum + p.v, 0) / filtered.length : null;
          const delta = typeof avg === 'number' ? avg - target.target : null;
          return (
            <div key={target.id} className="target-item">
              <div>
                <strong>{target.label}</strong> • {target.band} • target {target.target} ± {target.tolerance}
                {typeof avg === 'number' && (
                  <span className="target-delta">
                    {' '}| avg {avg.toFixed(3)} | Δ {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                  </span>
                )}
              </div>
              <div className="inline-buttons">
                <button type="button" onClick={() => startEdit(target)}>Edit</button>
                <button type="button" onClick={() => onDeleteTarget(target.id)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function areEqual(prev, next) {
  const simple =
    prev.audioEnabled === next.audioEnabled &&
    prev.audioSensitivity === next.audioSensitivity &&
    prev.audioSensitivityHistory === next.audioSensitivityHistory &&
    prev.deltaSmoothingSec === next.deltaSmoothingSec &&
    prev.bandSnapshots === next.bandSnapshots &&
    prev.bandHistory === next.bandHistory &&
    prev.onSaveTarget === next.onSaveTarget &&
    prev.onDeleteTarget === next.onDeleteTarget &&
    prev.onToggleAudio === next.onToggleAudio &&
    prev.onApplyPreset === next.onApplyPreset &&
    prev.onClearTargets === next.onClearTargets &&
    prev.presetsLoading === next.presetsLoading &&
    prev.presetsError === next.presetsError;

  if (!simple) return false;

  if (prev.availableChannels.length !== next.availableChannels.length) return false;
  if (prev.selectedTargets.length !== next.selectedTargets.length) return false;
  if ((prev.presets?.length || 0) !== (next.presets?.length || 0)) return false;

  const prevCh = prev.availableChannels.join('|');
  const nextCh = next.availableChannels.join('|');
  if (prevCh !== nextCh) return false;

  const prevPresets = (prev.presets || []).map(p => p.name).join('|');
  const nextPresets = (next.presets || []).map(p => p.name).join('|');
  if (prevPresets !== nextPresets) return false;

  const prevTargets = prev.selectedTargets.map(t => `${t.id}-${t.label}-${t.band}-${t.target}-${t.tolerance}`).join('|');
  const nextTargets = next.selectedTargets.map(t => `${t.id}-${t.label}-${t.band}-${t.target}-${t.tolerance}`).join('|');
  return prevTargets === nextTargets;
}

export default React.memo(TrainingControl, areEqual);
