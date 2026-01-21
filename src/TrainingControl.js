import React, { useState, useEffect, useMemo } from 'react';
import { BAND_KEYS } from './constants/bands';

function TrainingControl({ availableChannels = [], selectedTargets = [], bandSnapshots = [], bandHistory = {}, deltaSmoothingSec = 10, onSaveTarget, onDeleteTarget, audioEnabled, onToggleAudio }) {
  const [form, setForm] = useState({
    id: null,
    label: [],
    band: 'alpha',
    target: 0.3,
    tolerance: 0.05
  });

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
    prev.deltaSmoothingSec === next.deltaSmoothingSec &&
    prev.bandSnapshots === next.bandSnapshots &&
    prev.bandHistory === next.bandHistory &&
    prev.onSaveTarget === next.onSaveTarget &&
    prev.onDeleteTarget === next.onDeleteTarget &&
    prev.onToggleAudio === next.onToggleAudio;

  if (!simple) return false;

  if (prev.availableChannels.length !== next.availableChannels.length) return false;
  if (prev.selectedTargets.length !== next.selectedTargets.length) return false;

  const prevCh = prev.availableChannels.join('|');
  const nextCh = next.availableChannels.join('|');
  if (prevCh !== nextCh) return false;

  const prevTargets = prev.selectedTargets.map(t => `${t.id}-${t.label}-${t.band}-${t.target}-${t.tolerance}`).join('|');
  const nextTargets = next.selectedTargets.map(t => `${t.id}-${t.label}-${t.band}-${t.target}-${t.tolerance}`).join('|');
  return prevTargets === nextTargets;
}

export default React.memo(TrainingControl, areEqual);
