import React, { useState, useEffect } from 'react';
import { BAND_KEYS } from './constants/bands';
import LineChart from './ui/LineChart';

function TrainingControl({ availableChannels = [], selectedTargets = [], bandSnapshots = [], bandHistory = {}, targetHistoryById = {}, deltaSmoothingSec = 10, onSaveTarget, onDeleteTarget, audioEnabled, onToggleAudio, presets = [], presetsLoading = false, presetsError = null, onApplyPreset, onClearTargets, targetMetrics = {} }) {
  const [form, setForm] = useState({
    id: null,
    label: [],
    model: 'relative',
    band: 'alpha',
    numeratorBand: 'theta',
    denominatorBand: 'beta',
    target: 0.3,
    tolerance: 0.05
  });
  const [selectedPreset, setSelectedPreset] = useState('');

  // Format preset name for display (snake_case -> Title Case)
  function formatPresetName(name, model) {
    const title = name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    const label = model === 'ratio' ? 'Ratio' : 'Relative';
    return `${title} (${label})`;
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
    const model = form.model || 'relative';
    // prevent duplicate target for same label+metric
    const exists = selectedTargets.some((t) => {
      const tModel = t.model || 'relative';
      if (t.label !== form.label[0] || tModel !== model || t.id === form.id) return false;
      if (model === 'ratio') {
        return t.numeratorBand === form.numeratorBand && t.denominatorBand === form.denominatorBand;
      }
      return t.band === form.band;
    });
    if (exists) return;
    const id = form.id || Date.now().toString();
    onSaveTarget({
      id,
      label: form.label[0],
      model,
      band: model === 'relative' ? form.band : null,
      numeratorBand: model === 'ratio' ? form.numeratorBand : null,
      denominatorBand: model === 'ratio' ? form.denominatorBand : null,
      target: Number(form.target),
      tolerance: Number(form.tolerance)
    });
    setForm({
      id: null,
      label: form.label,
      model,
      band: form.band,
      numeratorBand: form.numeratorBand,
      denominatorBand: form.denominatorBand,
      target: form.target,
      tolerance: form.tolerance
    });
  }

  function startEdit(target) {
    setForm({
      id: target.id,
      label: [target.label],
      model: target.model || 'relative',
      band: target.band || 'alpha',
      numeratorBand: target.numeratorBand || 'theta',
      denominatorBand: target.denominatorBand || 'beta',
      target: target.target,
      tolerance: target.tolerance
    });
  }

  function averageSeries(series, cutoffMs) {
    const filtered = series.filter(p => p.t >= cutoffMs);
    if (filtered.length === 0) return null;
    return filtered.reduce((sum, p) => sum + p.v, 0) / filtered.length;
  }

  function getSmoothedValue(target, now, smoothMs) {
    const model = target.model || 'relative';
    if (model === 'ratio') {
      if (!target.numeratorBand || !target.denominatorBand) return null;
      const numerator = bandHistory?.[target.label]?.[target.numeratorBand] || [];
      const denominator = bandHistory?.[target.label]?.[target.denominatorBand] || [];
      const numAvg = averageSeries(numerator, now - smoothMs);
      const denAvg = averageSeries(denominator, now - smoothMs);
      if (typeof numAvg !== 'number' || typeof denAvg !== 'number' || denAvg === 0) return null;
      return numAvg / denAvg;
    }
    const series = bandHistory?.[target.label]?.[target.band] || [];
    return averageSeries(series, now - smoothMs);
  }

  function buildSparklineSeries(target, now, windowMs) {
    const model = target.model || 'relative';
    if (model === 'ratio') {
      if (!target.numeratorBand || !target.denominatorBand) return [];
      const numerator = bandHistory?.[target.label]?.[target.numeratorBand] || [];
      const denominator = bandHistory?.[target.label]?.[target.denominatorBand] || [];
      const denomByTime = new Map(denominator.map(p => [p.t, p.v]));
      return numerator
        .filter(p => p.t >= now - windowMs)
        .map(p => {
          const denom = denomByTime.get(p.t);
          if (typeof denom !== 'number' || denom === 0) return null;
          return { t: p.t, v: p.v / denom };
        })
        .filter(Boolean);
    }
    const series = bandHistory?.[target.label]?.[target.band] || [];
    return series.filter(p => p.t >= now - windowMs);
  }

  function buildTargetSeries(target, now, windowMs) {
    const series = targetHistoryById?.[target.id] || [];
    return series.filter(p => p.t >= now - windowMs);
  }

  function renderSparkline(points, targetSeries) {
    const chartWidth = 140;
    const chartHeight = 140;
    const paddingTop = 10;
    const paddingBottom = 14;
    const hasSignal = points && points.length > 1;
    const hasTargets = targetSeries && targetSeries.length > 0;
    if (!hasSignal && !hasTargets) {
      return (
        <LineChart
          height={chartHeight}
          width={chartWidth}
          padding={{ left: 0, right: 0, top: paddingTop, bottom: paddingBottom }}
          series={[]}
          bands={[]}
          showAxes={false}
          showLabels={false}
          emptyLabel="No recent data"
          emptyLabelX={8}
          emptyLabelY={chartHeight / 2}
        />
      );
    }
    const timePoints = [...(points || []), ...(targetSeries || [])].filter(p => p && p.t != null);
    const times = timePoints.map(p => p.t);
    const start = Math.min(...times);
    const end = Math.max(...times);
    const signalValues = (points || []).map(p => p.v);
    const targetValues = (targetSeries || []).flatMap(p => {
      const tol = p.tolerance || 0;
      return [p.target - tol, p.target, p.target + tol];
    });
    const values = [...signalValues, ...targetValues].filter(v => typeof v === 'number');
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sortedTargets = (targetSeries || []).slice().sort((a, b) => a.t - b.t);
    const targetBandPoints = sortedTargets.length > 0
      ? [
        ...sortedTargets.map((p) => ({
          x: p.t,
          y: p.target + (p.tolerance || 0)
        })),
        ...sortedTargets.slice().reverse().map((p) => ({
          x: p.t,
          y: p.target - (p.tolerance || 0)
        }))
      ]
      : [];
    const series = [];
    if (sortedTargets.length > 0) {
      series.push({
        id: 'target',
        points: sortedTargets.map(p => ({ x: p.t, y: p.target })),
        stroke: 'rgba(248, 113, 113, 0.85)',
        strokeWidth: 1.5,
        extend: sortedTargets.length === 1 ? 'x' : undefined
      });
    }
    if (sortedTargets.length <= 1 && targetBandPoints.length > 0) {
      series.push({
        id: 'target-band',
        points: [{ x: targetBandPoints[0].x, y: targetBandPoints[0].y }],
        stroke: 'rgba(248, 113, 113, 0.4)',
        strokeWidth: 1,
        strokeDasharray: '3 2',
        extend: 'x'
      });
    }
    if (hasSignal) {
      series.push({
        id: 'signal',
        points: (points || []).map(p => ({ x: p.t, y: p.v })),
        stroke: 'rgba(96, 165, 250, 0.9)',
        strokeWidth: 2
      });
    }

    return (
      <LineChart
        height={chartHeight}
        width={chartWidth}
        padding={{ left: 0, right: 0, top: paddingTop, bottom: paddingBottom }}
        series={series}
        bands={targetBandPoints.length > 2 ? [{
          id: 'target-band-fill',
          points: targetBandPoints,
          fill: 'rgba(248, 113, 113, 0.18)'
        }] : []}
        xDomain={{ min: start, max: end }}
        yDomain={{ min, max }}
        showAxes={false}
        showLabels={false}
      />
    );
  }

  function formatTargetMetric(target) {
    const model = target.model || 'relative';
    if (model === 'ratio') {
      if (!target.numeratorBand || !target.denominatorBand) return 'ratio';
      return `${target.numeratorBand}/${target.denominatorBand} ratio`;
    }
    return target.band;
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
                  <option key={p.name} value={p.name}>{formatPresetName(p.name, p.model)}</option>
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
          <label>Metric</label>
          <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
            <option value="relative">Relative band power</option>
            <option value="ratio">Band ratio</option>
          </select>
        </div>
        <div className="field">
          <label>{form.model === 'ratio' ? 'Ratio' : 'Band'}</label>
          {form.model === 'ratio' ? (
            <div className="ratio-fields">
              <select
                value={form.numeratorBand}
                onChange={(e) => setForm({ ...form, numeratorBand: e.target.value })}
              >
                {BAND_KEYS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <span className="ratio-sep">/</span>
              <select
                value={form.denominatorBand}
                onChange={(e) => setForm({ ...form, denominatorBand: e.target.value })}
              >
                {BAND_KEYS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          ) : (
            <select value={form.band} onChange={(e) => setForm({ ...form, band: e.target.value })}>
              {BAND_KEYS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>
        <div className="field">
          <label>{form.model === 'ratio' ? 'Target (ratio)' : 'Target (relative 0-1)'}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max={form.model === 'ratio' ? undefined : 1}
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
          />
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
          const now = Date.now();
          const smoothMs = deltaSmoothingSec * 1000;
          const windowMs = Math.max(5, deltaSmoothingSec) * 1000;
          const avg = getSmoothedValue(target, now, smoothMs);
          const delta = typeof avg === 'number' ? avg - target.target : null;
          const metric = targetMetrics[target.id];
          const effectiveTol = metric?.effectiveTolerance ?? target.tolerance;
          const sparkline = buildSparklineSeries(target, now, windowMs);
          const targetSeries = buildTargetSeries(target, now, windowMs);
          return (
            <div key={target.id} className="target-item">
              <div>
                <strong>{target.label}</strong> • {formatTargetMetric(target)} • target {target.target} ± {target.tolerance}
                {typeof avg === 'number' && (
                  <span className="target-delta">
                    {' '}| avg {avg.toFixed(3)} | Δ {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                  </span>
                )}
                {metric && (
                  <span className="target-delta">
                    {' '}| sensitivity {metric.sensitivity.toFixed(2)}x • effective ± {effectiveTol.toFixed(3)}
                  </span>
                )}
              </div>
              <div className="chart-block" style={{ marginTop: 6 }}>
                <p className="chart-label" style={{ marginBottom: 4 }}>Signal vs target band</p>
                {renderSparkline(sparkline, targetSeries)}
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
    prev.targetMetrics === next.targetMetrics &&
    prev.deltaSmoothingSec === next.deltaSmoothingSec &&
    prev.bandSnapshots === next.bandSnapshots &&
    prev.bandHistory === next.bandHistory &&
    prev.targetHistoryById === next.targetHistoryById &&
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

  const prevTargets = prev.selectedTargets.map(t => `${t.id}-${t.label}-${t.model}-${t.band}-${t.numeratorBand}-${t.denominatorBand}-${t.target}-${t.tolerance}`).join('|');
  const nextTargets = next.selectedTargets.map(t => `${t.id}-${t.label}-${t.model}-${t.band}-${t.numeratorBand}-${t.denominatorBand}-${t.target}-${t.tolerance}`).join('|');
  return prevTargets === nextTargets;
}

export default React.memo(TrainingControl, areEqual);
