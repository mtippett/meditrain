from __future__ import annotations

# PPG-focused facade over the existing notebook utilities.
# This keeps notebooks readable while we incrementally split the large module.

import numpy as np

from eeg_processing_utils import (  # noqa: F401
    build_ppg_cardiogram,
    combine_ppg_channels,
    combine_ppg_exports,
    compute_ppg_hr,
    compute_spo2_metrics,
    compute_spo2_series,
    find_ppg_peaks,
    infer_ppg_mapping,
    list_ppg_files,
    load_ppg_export,
    load_ppg_exports,
    ppg_bandpass,
    ppg_lowpass,
    plot_cardiogram,
    plot_heart_rate,
    process_ppg_cardiogram,
    subtract_ambient_ppg,
)

SPO2_LOWPASS_HZ = 0.5
SPO2_BANDPASS_LOW_HZ = 0.5
SPO2_BANDPASS_HIGH_HZ = 4.0
SPO2_MIN_PI = 0.005


def _detrend(x: np.ndarray) -> np.ndarray:
  return x - np.mean(x) if x.size else x


def _percentile_amp(x: np.ndarray, lo: float = 5.0, hi: float = 95.0) -> float:
  if x.size == 0:
    return 0.0
  p_lo = np.percentile(x, lo)
  p_hi = np.percentile(x, hi)
  return max(0.0, (p_hi - p_lo) / 2.0)


def _lowpass_fft(x: np.ndarray, cutoff_hz: float, sample_rate_hz: float) -> np.ndarray:
  if x.size == 0:
    return x
  freqs = np.fft.rfftfreq(x.size, d=1.0 / sample_rate_hz)
  spec = np.fft.rfft(x)
  spec[freqs > cutoff_hz] = 0
  return np.fft.irfft(spec, n=x.size)


def _bandpass_fft(x: np.ndarray, low_hz: float, high_hz: float, sample_rate_hz: float) -> np.ndarray:
  if x.size == 0:
    return x
  freqs = np.fft.rfftfreq(x.size, d=1.0 / sample_rate_hz)
  spec = np.fft.rfft(x)
  mask = (freqs >= low_hz) & (freqs <= high_hz)
  spec[~mask] = 0
  return np.fft.irfft(spec, n=x.size)


def spo2_ratio_of_ratios(ir: np.ndarray, red: np.ndarray, sample_rate_hz: float):
  ir = np.asarray(ir, dtype=float)
  red = np.asarray(red, dtype=float)
  n = min(ir.size, red.size)
  if n < sample_rate_hz * 3:
    return {"ok": False, "reason": "NO_SIGNAL"}
  ir = ir[-n:]
  red = red[-n:]

  ir_dc = _lowpass_fft(ir, SPO2_LOWPASS_HZ, sample_rate_hz)
  red_dc = _lowpass_fft(red, SPO2_LOWPASS_HZ, sample_rate_hz)
  ir_dc_mean = float(abs(np.mean(ir_dc)))
  red_dc_mean = float(abs(np.mean(red_dc)))
  if ir_dc_mean <= 0 or red_dc_mean <= 0:
    return {"ok": False, "reason": "DC_ZERO"}

  ir_ac = _bandpass_fft(_detrend(ir), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sample_rate_hz)
  red_ac = _bandpass_fft(_detrend(red), SPO2_BANDPASS_LOW_HZ, SPO2_BANDPASS_HIGH_HZ, sample_rate_hz)
  ir_ac_amp = _percentile_amp(ir_ac)
  red_ac_amp = _percentile_amp(red_ac)
  if ir_ac_amp <= 0 or red_ac_amp <= 0:
    return {"ok": False, "reason": "AC_ZERO"}

  pi_ir = ir_ac_amp / ir_dc_mean
  pi_red = red_ac_amp / red_dc_mean
  if not np.isfinite(pi_ir) or not np.isfinite(pi_red):
    return {"ok": False, "reason": "PI_NAN", "pi_ir": pi_ir, "pi_red": pi_red}
  if pi_ir <= SPO2_MIN_PI or pi_red <= SPO2_MIN_PI:
    return {"ok": False, "reason": "PI_LOW", "pi_ir": pi_ir, "pi_red": pi_red, "ratio": pi_red / pi_ir}

  ratio = pi_red / pi_ir
  spo2_linear = float(np.clip(110.0 - 25.0 * ratio, 80.0, 100.0))
  spo2_quadratic = float(np.clip(-45.06 * ratio * ratio + 30.354 * ratio + 94.845, 80.0, 100.0))
  return {
    "ok": True,
    "ratio": float(ratio),
    "pi_ir": float(pi_ir),
    "pi_red": float(pi_red),
    "spo2_linear": spo2_linear,
    "spo2_quadratic": spo2_quadratic,
  }
