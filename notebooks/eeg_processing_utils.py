from __future__ import annotations

import sys
from pathlib import Path

_THIS_DIR = Path(__file__).parent
if str(_THIS_DIR) not in sys.path:
    sys.path.append(str(_THIS_DIR))

from chart_utils import _format_time_axis, to_local_datetime_index

import json
import re
import statistics
from itertools import chain
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from scipy import signal

# Defaults (callers can override module globals if desired)
DEFAULT_FS = 256
LINE_NOISE_HZ = 60
PSD_AVERAGE = "median"
NPERSEG = 1024
NOVERLAP = NPERSEG // 2
SPECTROGRAM_NFFT = 4096

BANDS = {
    "delta": {"label": "Delta", "range": (0.5, 4)},
    "theta": {"label": "Theta", "range": (4, 8)},
    "alpha": {"label": "Alpha", "range": (8, 12)},
    "beta": {"label": "Beta", "range": (12, 30)},
    "gamma": {"label": "Gamma", "range": (30, 50)},
}


def _get_time_range_str(diag_df: pd.DataFrame) -> str | None:
    if diag_df is None or "captured_at" not in diag_df.columns:
        return None
    import tzlocal

    captured_at = pd.to_datetime(diag_df["captured_at"], errors="coerce", utc=True)
    capture_ended_at = (
        pd.to_datetime(diag_df["capture_ended_at"], errors="coerce", utc=True)
        if "capture_ended_at" in diag_df.columns
        else pd.Series(pd.DatetimeIndex([], tz="UTC"))
    )
    if not captured_at.notna().any():
        return None

    local_tz = tzlocal.get_localzone()
    captured_local = captured_at.dt.tz_convert(local_tz)
    capture_ended_local = capture_ended_at.dt.tz_convert(local_tz)

    start_ts = captured_local.min()
    if capture_ended_local.notna().any():
        end_ts = capture_ended_local.max()
    else:
        end_ts = captured_local.max()

    min_ts = start_ts.strftime('%Y-%m-%d %H:%M:%S %Z')
    max_ts = end_ts.strftime('%Y-%m-%d %H:%M:%S %Z')
    return f"Data captured from {min_ts} to {max_ts}"


def notch_filter(samples: np.ndarray, f0: float = 60.0, fs: float = DEFAULT_FS, q: float = 30.0) -> np.ndarray:
    b, a = signal.iirnotch(f0, q, fs)
    try:
        return signal.filtfilt(b, a, samples)
    except ValueError:
        return signal.lfilter(b, a, samples)


def bandpass_filter(
    samples: np.ndarray,
    low_hz: float = 0.5,
    high_hz: float = 50.0,
    fs: float = DEFAULT_FS,
    order: int = 4,
) -> np.ndarray:
    nyquist = fs / 2
    high_hz = min(high_hz, nyquist * 0.99)
    low_hz = max(low_hz, 0.01)
    if not (0 < low_hz < high_hz):
        return samples
    sos = signal.butter(order, [low_hz, high_hz], btype="bandpass", fs=fs, output="sos")
    try:
        return signal.sosfiltfilt(sos, samples)
    except ValueError:
        return signal.sosfilt(sos, samples)


def compute_psd(samples: Iterable[float], fs: float = DEFAULT_FS, average: str | None = None) -> tuple[np.ndarray, np.ndarray]:
    samples = np.asarray(samples, dtype=float)
    if samples.size == 0:
        return np.array([]), np.array([])
    samples = samples - samples.mean()
    # Best-practice preprocessing for band-power estimation:
    # - remove DC (mean)
    # - zero-phase bandpass in the analysis range
    # - mains notch to reduce spectral leakage into nearby bins
    samples = bandpass_filter(samples, low_hz=0.5, high_hz=50.0, fs=fs)
    samples = notch_filter(samples, f0=LINE_NOISE_HZ, fs=fs)
    avg = average or PSD_AVERAGE
    freqs, psd = signal.welch(
        samples,
        fs=fs,
        window="hann",
        nperseg=NPERSEG,
        noverlap=NOVERLAP,
        detrend=False,
        scaling="density",
        average=avg,
    )
    mask = freqs <= 50
    return freqs[mask], psd[mask]


def _prepare_psd_samples(samples: Iterable[float], fs: float) -> np.ndarray:
    samples = np.asarray(samples, dtype=float)
    if samples.size == 0:
        return samples
    samples = samples - samples.mean()
    samples = bandpass_filter(samples, low_hz=0.5, high_hz=50.0, fs=fs)
    samples = notch_filter(samples, f0=LINE_NOISE_HZ, fs=fs)
    return samples


def compute_spectrogram_psd(
    samples: Iterable[float],
    fs: float,
    *,
    nperseg: int = NPERSEG,
    noverlap: int = NOVERLAP,
    nfft: int | None = SPECTROGRAM_NFFT,
    max_freq_hz: float = 50.0,
    apply_filters: bool = True,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    samples_arr = np.asarray(samples, dtype=float)
    if samples_arr.size < nperseg:
        return None
    if apply_filters:
        samples_arr = _prepare_psd_samples(samples_arr, fs)
    nfft_effective = None
    if nfft is not None:
        nfft_effective = int(max(nfft, nperseg))
    freqs, times, psd = signal.spectrogram(
        samples_arr,
        fs=fs,
        window="hann",
        nperseg=nperseg,
        noverlap=noverlap,
        nfft=nfft_effective,
        detrend=False,
        scaling="density",
        mode="psd",
    )
    mask = freqs <= max_freq_hz
    if not np.any(mask):
        return None
    return freqs[mask], times, psd[mask]


def band_powers(freqs: np.ndarray, psd: np.ndarray) -> dict[str, dict[str, float]]:
    totals: dict[str, dict[str, float]] = {}
    total_power = 0.0
    for key, band_info in BANDS.items():
        min_freq, max_freq = band_info["range"]
        band_mask = (freqs >= min_freq) & (freqs < max_freq)
        p = float(np.trapezoid(psd[band_mask], freqs[band_mask])) if np.any(band_mask) else 0.0
        totals[key] = {"absolute": p, "relative": 0.0}
        total_power += p
    if total_power > 0:
        for key in totals:
            totals[key]["relative"] = totals[key]["absolute"] / total_power
    return totals


def extract_target_history(exports: list[dict]) -> dict[str, dict[str, list[dict]]]:
    history: dict[str, dict[str, list[dict]]] = {}
    for export in exports or []:
        sidecar = export.get("_sidecar") or {}
        raw_history = sidecar.get("TrainingTargetHistory") or sidecar.get("TargetHistory") or {}
        if not isinstance(raw_history, dict):
            continue
        for label, band_map in raw_history.items():
            if not isinstance(band_map, dict):
                continue
            for band, entries in band_map.items():
                if not isinstance(entries, list):
                    continue
                history.setdefault(label, {}).setdefault(band, []).extend(entries)
    return history


def _normalize_target_history(entries: list[dict]) -> pd.DataFrame:
    if not entries:
        return pd.DataFrame(columns=["timestamp", "target", "tolerance", "sensitivity"])
    rows = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        t_raw = entry.get("t")
        if t_raw is None:
            continue
        if isinstance(t_raw, (int, float)) and not isinstance(t_raw, bool):
            ts = pd.to_datetime(t_raw, unit="ms", errors="coerce", utc=True)
        else:
            ts = pd.to_datetime(t_raw, errors="coerce", utc=True)
        if pd.isna(ts):
            continue
        rows.append(
            {
                "timestamp": ts,
                "target": float(entry.get("target") or 0.0),
                "tolerance": float(entry.get("tolerance") or 0.0),
                "sensitivity": float(entry.get("sensitivity") or 1.0),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["timestamp", "target", "tolerance", "sensitivity"])
    df = pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)
    return df


def compute_line_noise_ratio(
    samples: Iterable[float],
    fs: float = DEFAULT_FS,
    line_freq: float = 60.0,
    band_hz: float = 2.0,
    max_hz: float | None = 80.0,
) -> float:
    samples = np.asarray(samples, dtype=float)
    if samples.size < 8:
        return float("nan")
    samples = samples - samples.mean()
    nperseg = min(NPERSEG, samples.size)
    if nperseg < 8:
        return float("nan")
    noverlap = min(NOVERLAP, nperseg // 2)
    freqs, psd = signal.welch(
        samples,
        fs=fs,
        window="hann",
        nperseg=nperseg,
        noverlap=noverlap,
        detrend=False,
        scaling="density",
        average="mean",
    )
    if max_hz is not None:
        mask = freqs <= max_hz
        freqs = freqs[mask]
        psd = psd[mask]
    if freqs.size == 0:
        return float("nan")
    half_band = max(0.1, band_hz / 2.0)
    line_mask = (freqs >= (line_freq - half_band)) & (freqs <= (line_freq + half_band))
    total_mask = freqs >= 0.5
    total_power = float(np.trapezoid(psd[total_mask], freqs[total_mask])) if np.any(total_mask) else 0.0
    line_power = float(np.trapezoid(psd[line_mask], freqs[line_mask])) if np.any(line_mask) else 0.0
    if total_power <= 0:
        return 0.0
    return line_power / total_power


def compute_artifact_metrics(
    samples: Iterable[float],
    fs: float,
    window_sec: float = 2.0,
    step_sec: float = 1.0,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = 60.0,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
    timestamps: Iterable | None = None,
) -> pd.DataFrame:
    samples = np.asarray(samples, dtype=float)
    ts_list = None
    if timestamps is not None:
        ts_series = pd.to_datetime(pd.Series(timestamps), errors="coerce", utc=True)
        if ts_series.notna().any():
            ts_list = ts_series.reset_index(drop=True)
    window_samples = max(1, int(round(window_sec * fs)))
    step_samples = max(1, int(round(step_sec * fs)))
    if samples.size < window_samples:
        return pd.DataFrame(
            columns=[
                "t_sec",
                "timestamp",
                "amplitude_range",
                "line_noise_ratio",
                "amplitude_artifact",
                "line_noise_artifact",
                "artifact",
            ]
        )

    rows = []
    for start in range(0, samples.size - window_samples + 1, step_samples):
        window = samples[start:start + window_samples]
        amplitude_range = float(np.ptp(window))
        line_noise_ratio = compute_line_noise_ratio(
            window,
            fs=fs,
            line_freq=line_noise_hz,
            band_hz=line_noise_band_hz,
            max_hz=line_noise_max_hz,
        )
        amplitude_artifact = (
            amplitude_range_threshold is not None and amplitude_range > amplitude_range_threshold
        )
        line_noise_artifact = (
            line_noise_ratio_threshold is not None and line_noise_ratio > line_noise_ratio_threshold
        )
        mid_idx = start + (window_samples // 2)
        ts_mid = None
        if ts_list is not None and mid_idx < len(ts_list):
            ts_mid = ts_list.iloc[mid_idx]
        rows.append(
            {
                "t_sec": (start + window_samples) / fs,
                "timestamp": ts_mid,
                "amplitude_range": amplitude_range,
                "line_noise_ratio": line_noise_ratio,
                "amplitude_artifact": amplitude_artifact,
                "line_noise_artifact": line_noise_artifact,
                "artifact": amplitude_artifact or line_noise_artifact,
            }
        )
    return pd.DataFrame(rows)


def compute_artifact_metrics_for_label(
    exports: list[dict],
    target_label: str,
    window_sec: float = 2.0,
    step_sec: float = 1.0,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = 60.0,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
) -> pd.DataFrame:
    df = load_label_timeseries(exports, target_label)
    if df.empty:
        return pd.DataFrame(
            columns=[
                "t_sec",
                "timestamp",
                "amplitude_range",
                "line_noise_ratio",
                "amplitude_artifact",
                "line_noise_artifact",
                "artifact",
            ]
        )
    fs = float(df["sampling_rate_hz"].iloc[0])
    return compute_artifact_metrics(
        df["sample"].to_numpy(dtype=float),
        fs=fs,
        window_sec=window_sec,
        step_sec=step_sec,
        amplitude_range_threshold=amplitude_range_threshold,
        line_noise_ratio_threshold=line_noise_ratio_threshold,
        line_noise_hz=line_noise_hz,
        line_noise_band_hz=line_noise_band_hz,
        line_noise_max_hz=line_noise_max_hz,
        timestamps=(df["timestamp"] if "timestamp" in df.columns else None),
    )


def compute_artifact_df(
    exports: list[dict],
    diag_df: pd.DataFrame,
    *,
    labels: list[str] | None = None,
    window_sec: float = 2.0,
    step_sec: float = 1.0,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = 60.0,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
) -> tuple[pd.DataFrame, list[str], dict[str, pd.DataFrame]]:
    labels = labels or get_channel_labels(diag_df)
    artifact_frames = []
    series_by_label: dict[str, pd.DataFrame] = {}
    for label in labels:
        ts_df = load_label_timeseries(exports, label)
        if ts_df.empty:
            continue
        series_by_label[label] = ts_df
        fs = float(ts_df["sampling_rate_hz"].iloc[0])
        metrics = compute_artifact_metrics(
            ts_df["sample"].to_numpy(dtype=float),
            fs=fs,
            window_sec=window_sec,
            step_sec=step_sec,
            amplitude_range_threshold=amplitude_range_threshold,
            line_noise_ratio_threshold=line_noise_ratio_threshold,
            line_noise_hz=line_noise_hz,
            line_noise_band_hz=line_noise_band_hz,
            line_noise_max_hz=line_noise_max_hz,
            timestamps=(ts_df["timestamp"] if "timestamp" in ts_df.columns else None),
        )
        if metrics.empty:
            continue
        metrics["label"] = label
        artifact_frames.append(metrics)
    artifact_df = pd.concat(artifact_frames, ignore_index=True) if artifact_frames else pd.DataFrame()
    return artifact_df, labels, series_by_label


def plot_artifact_overlays_and_metrics(
    exports: list[dict],
    diag_df: pd.DataFrame,
    *,
    window_sec: float = 2.0,
    step_sec: float = 1.0,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = 60.0,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
    overlay_mode: str = "always",
    overlay_max_windows: int = 200,
    trace_window_sec: float | None = None,
    trace_max_points: int = 4000,
    plot_diagnostics: bool = True,
    fig_width: float = 12,
) -> pd.DataFrame:
    import matplotlib.pyplot as plt

    if diag_df is None or len(diag_df) == 0:
        print("No diagnostics available for artifact plots.")
        return pd.DataFrame()
    labels = get_channel_labels(diag_df)
    if not labels:
        print("No EEG channel labels available for artifact plots.")
        return pd.DataFrame()

    artifact_df, _labels, series_by_label = compute_artifact_df(
        exports,
        diag_df,
        labels=labels,
        window_sec=window_sec,
        step_sec=step_sec,
        amplitude_range_threshold=amplitude_range_threshold,
        line_noise_ratio_threshold=line_noise_ratio_threshold,
        line_noise_hz=line_noise_hz,
        line_noise_band_hz=line_noise_band_hz,
        line_noise_max_hz=line_noise_max_hz,
    )
    if artifact_df.empty:
        print("No artifact metrics available to plot.")
        return artifact_df

    overlay_mode = (overlay_mode or "always").lower()
    for label in sorted(artifact_df["label"].unique()):
        ts_df = series_by_label.get(label, pd.DataFrame())
        if ts_df.empty:
            continue
        # Notebook requirement: charts should use the full dataset time range.
        ts_plot = ts_df
        if ts_plot.empty:
            continue
        if len(ts_plot) > trace_max_points:
            stride = max(1, int(len(ts_plot) / trace_max_points))
            ts_plot = ts_plot.iloc[::stride]

        subset = artifact_df[artifact_df["label"] == label]
        x_is_time = "timestamp" in ts_plot.columns and ts_plot["timestamp"].notna().any()
        if x_is_time:
            plot_start = ts_plot["timestamp"].min()
            plot_end = ts_plot["timestamp"].max()
            if "timestamp" in subset.columns:
                subset = subset[(subset["timestamp"] >= plot_start) & (subset["timestamp"] <= plot_end)]
        else:
            plot_start = ts_plot["t_sec"].min()
            plot_end = ts_plot["t_sec"].max()
            subset = subset[(subset["t_sec"] >= plot_start) & (subset["t_sec"] <= plot_end)]

        amp_hits = int(subset["amplitude_artifact"].sum())
        line_hits = int(subset["line_noise_artifact"].sum())
        both_hits = int(((subset["amplitude_artifact"]) & (subset["line_noise_artifact"])).sum())

        fig, ax = plt.subplots(figsize=(fig_width, 3), constrained_layout=True)
        if x_is_time:
            import tzlocal
            ts = to_local_datetime_index(ts_plot["timestamp"]).reset_index(drop=True)
            ts_min = ts.min()
            ts_max = ts.max()
            ax.plot(ts, ts_plot["sample"], color="#38bdf8", linewidth=0.8)
            ax.set_xlabel("Local Date/Time")
            _format_time_axis(ax, x_min=ts_min, x_max=ts_max)
            span_sec = max(0, int((ts_max - ts_min).total_seconds()))
            if span_sec <= 60 * 60 * 24 * 60:
                fig.autofmt_xdate()
        else:
            ax.plot(ts_plot["t_sec"], ts_plot["sample"], color="#38bdf8", linewidth=0.8)
            ax.set_xlabel("Seconds")
        ax.set_title(f"{label} | amplitude hits={amp_hits}, line-noise hits={line_hits}, both={both_hits}")
        ax.set_ylabel("Amplitude")
        ax.grid(alpha=0.2)

        overlay_ok = overlay_mode == "always"
        if overlay_mode == "auto":
            overlay_ok = len(subset) <= overlay_max_windows
        if overlay_mode == "off":
            overlay_ok = False

        if not overlay_ok:
            ax.text(
                0.99,
                0.95,
                f"Overlays off (windows={len(subset)})",
                transform=ax.transAxes,
                ha="right",
                va="top",
                fontsize=9,
                color="#64748b",
            )
        else:
            for _, row in subset.iterrows():
                if x_is_time and "timestamp" in row and pd.notna(row["timestamp"]):
                    end = to_local_datetime_index(pd.Series([row["timestamp"]])).iloc[0]
                    start = end - pd.Timedelta(seconds=window_sec)
                else:
                    start = row["t_sec"] - window_sec
                    end = row["t_sec"]
                if row["amplitude_artifact"] and row["line_noise_artifact"]:
                    color = "#ef4444"
                elif row["amplitude_artifact"]:
                    color = "#f97316"
                elif row["line_noise_artifact"]:
                    color = "#60a5fa"
                else:
                    continue
                ax.axvspan(start, end, color=color, alpha=0.18)
        plt.show()

    summary = (
        artifact_df.groupby("label")[["amplitude_artifact", "line_noise_artifact", "artifact"]]
        .mean()
        .rename(
            columns={
                "amplitude_artifact": "amplitude_artifact_rate",
                "line_noise_artifact": "line_noise_artifact_rate",
                "artifact": "artifact_rate",
            }
        )
        .sort_values("artifact_rate", ascending=False)
    )
    print("Artifact rates by label (% of windows):")
    print((summary * 100).round(1))

    if plot_diagnostics:
        for label in labels:
            subset = artifact_df[artifact_df["label"] == label]
            if subset.empty:
                continue
            fig, axes = plt.subplots(2, 1, figsize=(fig_width, 4), sharex=True, constrained_layout=True)
            if "timestamp" in subset.columns and subset["timestamp"].notna().any():
                import tzlocal
                ts = to_local_datetime_index(subset["timestamp"]).reset_index(drop=True)
                ts_min = ts.min()
                ts_max = ts.max()
                axes[0].plot(ts, subset["amplitude_range"], color="#f97316", linewidth=1.0)
                axes[1].plot(ts, subset["line_noise_ratio"], color="#60a5fa", linewidth=1.0)
                axes[1].set_xlabel("Local Date/Time")
                _format_time_axis(axes[0], x_min=ts_min, x_max=ts_max)
                _format_time_axis(axes[1], x_min=ts_min, x_max=ts_max)
                span_sec = max(0, int((ts_max - ts_min).total_seconds()))
                if span_sec <= 60 * 60 * 24 * 60:
                    fig.autofmt_xdate()
            else:
                axes[0].plot(subset["t_sec"], subset["amplitude_range"], color="#f97316", linewidth=1.0)
                axes[1].plot(subset["t_sec"], subset["line_noise_ratio"], color="#60a5fa", linewidth=1.0)
                axes[1].set_xlabel("Seconds")
            if amplitude_range_threshold is not None:
                axes[0].axhline(amplitude_range_threshold, color="#ef4444", linestyle="--", linewidth=0.9)
            axes[0].set_ylabel("Amplitude range")
            axes[0].grid(alpha=0.2)
            if line_noise_ratio_threshold is not None:
                axes[1].axhline(line_noise_ratio_threshold, color="#ef4444", linestyle="--", linewidth=0.9)
            axes[1].set_ylabel("Line noise ratio")
            axes[1].grid(alpha=0.2)
            fig.suptitle(f"Artifact metrics: {label}")
            plt.show()

    return artifact_df


def coerce_timestamp(ts_str) -> pd.Timestamp | None:
    if not ts_str:
        return None
    parsed = pd.to_datetime(ts_str, errors="coerce", utc=True)
    if pd.isna(parsed):
        # Filename slug: YYYY-MM-DDTHH-MM-SS-sssZ
        m = re.match(r"(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)(Z?)", str(ts_str))
        if m:
            date, hh, mm, ss, frac, _z = m.groups()
            patched = f"{date}T{hh}:{mm}:{ss}.{frac}Z"
            parsed = pd.to_datetime(patched, errors="coerce", utc=True)
    return None if pd.isna(parsed) else parsed


def channel_timebase(channel: dict, capture_start: pd.Timestamp | None, sampling_rate: float | None) -> pd.Series | None:
    samples = channel.get("samples", []) or []
    ts_list = channel.get("timestamps") or []
    if len(ts_list) == len(samples) and len(ts_list) > 0:
        ts = pd.to_datetime(ts_list, errors="coerce", utc=True)
        ts = pd.Series(ts).reset_index(drop=True)
        if not ts.isna().all():
            return ts
    if capture_start is None or not sampling_rate or sampling_rate <= 0 or len(samples) == 0:
        return None
    offsets = pd.to_timedelta(np.arange(len(samples)) / sampling_rate, unit="s")
    return pd.Series(capture_start + offsets)


def list_sample_files(raw_dir: Path | str, pattern: str = "samples_*.json") -> list[Path]:
    raw_dir = Path(raw_dir)
    if not pattern:
        json_files = list(raw_dir.glob("samples_*.json"))
        bids_files = list(raw_dir.glob("*_eeg.vhdr"))
        return sorted(json_files + bids_files)
    return sorted(raw_dir.glob(pattern))


def list_ppg_files(raw_dir: Path | str, pattern: str = "*_ppg.tsv") -> list[Path]:
    raw_dir = Path(raw_dir)
    return sorted(raw_dir.glob(pattern))


def _parse_brainvision_vhdr(path: Path) -> tuple[dict, list[dict]]:
    common = {}
    channels = []
    section = None
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith(";"):
                continue
            if line.startswith("[") and line.endswith("]"):
                section = line[1:-1]
                continue
            if "=" not in line:
                continue
            key, value = [p.strip() for p in line.split("=", 1)]
            if section == "Common Infos":
                common[key] = value
            elif section == "Channel Infos":
                parts = [p.strip() for p in value.split(",")]
                label = parts[0] if parts else None
                unit = parts[2] if len(parts) > 2 else None
                channels.append({"label": label, "unit": unit})
    return common, channels


def _load_brainvision_data(vhdr_path: Path, common: dict, channel_count: int) -> np.ndarray:
    data_file = common.get("DataFile")
    if not data_file:
        raise ValueError("Missing DataFile in BrainVision header")
    data_path = vhdr_path.parent / data_file
    data = np.fromfile(data_path, dtype="<f4")
    if channel_count <= 0:
        raise ValueError("Invalid NumberOfChannels in BrainVision header")
    total = (data.size // channel_count) * channel_count
    data = data[:total]
    return data.reshape(-1, channel_count)


def _load_brainvision_sidecar(vhdr_path: Path) -> dict:
    sidecar_path = vhdr_path.with_suffix(".json")
    if not sidecar_path.exists():
        return {}
    with open(sidecar_path) as f:
        return json.load(f)


def load_brainvision_export(path: Path | str) -> dict:
    path = Path(path)
    common, channels_info = _parse_brainvision_vhdr(path)
    channel_count = int(common.get("NumberOfChannels") or len(channels_info) or 0)
    sampling_interval_us = float(common.get("SamplingInterval") or 0)
    sampling_rate_hz = 1000000.0 / sampling_interval_us if sampling_interval_us else DEFAULT_FS
    samples = _load_brainvision_data(path, common, channel_count)
    sidecar = _load_brainvision_sidecar(path)

    channel_labels = []
    for idx in range(channel_count):
        label = None
        if idx < len(channels_info):
            label = channels_info[idx].get("label")
        channel_labels.append(label or f"Ch{idx + 1}")

    channels = []
    for idx, label in enumerate(channel_labels):
        channels.append(
            {
                "label": label,
                "samples": samples[:, idx].astype(float).tolist(),
                "samplingRateHz": sampling_rate_hz,
            }
        )

    captured_at = (
        sidecar.get("AcquisitionDateTime")
        or sidecar.get("RecordingStartTime")
        or sidecar.get("CapturedAt")
    )
    capture_ended_at = None
    if captured_at:
        capture_start = coerce_timestamp(captured_at)
        if capture_start is not None and len(samples) > 0 and sampling_rate_hz:
            capture_ended_at = (
                capture_start + pd.to_timedelta((len(samples) - 1) / sampling_rate_hz, unit="s")
            ).isoformat()

    export = {
        "capturedAt": captured_at,
        "captureEndedAt": capture_ended_at,
        "samplingRateHz": sampling_rate_hz,
        "sensors": "-".join(channel_labels),
        "channels": channels,
        "_sidecar": sidecar,
    }
    export["_path"] = str(path)
    export["_file"] = path.name
    return export


def load_sample_export(path: Path | str) -> dict:
    path = Path(path)
    if path.suffix.lower() == ".vhdr":
        return load_brainvision_export(path)
    with open(path) as f:
        export = json.load(f)
    export["_path"] = str(path)
    export["_file"] = path.name
    return export


def load_sample_exports(raw_dir: Path | str, pattern: str = "samples_*.json", limit: int | None = None) -> list[dict]:
    files = list_sample_files(raw_dir, pattern=pattern)
    if not files and pattern in (None, "", "samples_*.json"):
        files = list_sample_files(raw_dir, pattern="*_eeg.vhdr")
    if limit is not None:
        files = files[: int(limit)]
    return [load_sample_export(p) for p in files]


def load_ppg_export(path: Path | str) -> dict:
    path = Path(path)
    sidecar_path = path.with_suffix(".json")
    sidecar = {}
    if sidecar_path.exists():
        with open(sidecar_path) as f:
            sidecar = json.load(f)

    sampling_rate_hz = float(sidecar.get("SamplingFrequency") or 64)
    df = pd.read_csv(path, sep="\t")
    if df.empty:
        raise ValueError(f"PPG TSV has no rows: {path}")

    columns = [c for c in df.columns if c]
    channels = []
    for col in columns:
        samples = df[col].astype(float).tolist()
        channels.append(
            {
                "label": col,
                "samples": samples,
                "samplingRateHz": sampling_rate_hz,
            }
        )

    captured_at = (
        sidecar.get("AcquisitionDateTime")
        or sidecar.get("RecordingStartTime")
        or sidecar.get("CapturedAt")
    )
    capture_ended_at = None
    if captured_at:
        capture_start = coerce_timestamp(captured_at)
        if capture_start is not None and len(df) > 0 and sampling_rate_hz:
            capture_ended_at = (
                capture_start + pd.to_timedelta((len(df) - 1) / sampling_rate_hz, unit="s")
            ).isoformat()

    export = {
        "capturedAt": captured_at,
        "captureEndedAt": capture_ended_at,
        "samplingRateHz": sampling_rate_hz,
        "sensors": "-".join(columns),
        "channels": channels,
        "_sidecar": sidecar,
    }
    export["_path"] = str(path)
    export["_file"] = path.name
    return export


def load_ppg_exports(raw_dir: Path | str, pattern: str = "*_ppg.tsv", limit: int | None = None) -> list[dict]:
    files = list_ppg_files(raw_dir, pattern=pattern)
    if limit is not None:
        files = files[: int(limit)]
    return [load_ppg_export(p) for p in files]


def combine_ppg_channels(export: dict) -> tuple[np.ndarray, float] | tuple[None, None]:
    channels = export.get("channels", []) or []
    if not channels:
        return None, None
    sampling_rate = float(export.get("samplingRateHz") or 64.0)
    series = [np.asarray(ch.get("samples", []) or [], dtype=float) for ch in channels]
    if not series or any(s.size == 0 for s in series):
        return None, None
    min_len = min(len(s) for s in series)
    aligned = [s[-min_len:] for s in series]
    standardized = []
    for s in aligned:
        mean = s.mean()
        std = s.std() or 1.0
        standardized.append((s - mean) / std)
    combined = np.mean(np.stack(standardized, axis=0), axis=0)
    return combined, sampling_rate


def _ppg_label_name(label: str) -> str:
    if not label:
        return ""
    return str(label).lower()


def infer_ppg_mapping(labels: list[str]) -> dict:
    names = {lbl: _ppg_label_name(lbl) for lbl in labels}
    if not labels:
        return {"ambient": None, "infrared": None, "red": None}
    ambient = next((lbl for lbl, name in names.items() if name in {"ambient"} or "ambient" in name or "green" in name), None)
    infrared = next((lbl for lbl, name in names.items() if name in {"ir", "infrared"} or "infrared" in name or name == "ir"), None)
    red = next((lbl for lbl, name in names.items() if name in {"red"} or "red" in name), None)
    if ambient is None and "PPG1" in labels:
        ambient = "PPG1"
    if infrared is None and "PPG2" in labels:
        infrared = "PPG2"
    if red is None and "PPG3" in labels:
        red = "PPG3"
    return {"ambient": ambient, "infrared": infrared, "red": red}


def subtract_ambient_ppg(export: dict) -> dict:
    channels = export.get("channels", []) or []
    labels = [c.get("label") for c in channels]
    mapping = infer_ppg_mapping(labels)
    ambient_label = mapping.get("ambient")
    if not ambient_label:
        return export
    ambient = next((c for c in channels if c.get("label") == ambient_label), None)
    if ambient is None:
        return export
    ambient_samples = np.asarray(ambient.get("samples", []) or [], dtype=float)
    if ambient_samples.size == 0:
        return export
    cleaned_channels = []
    for ch in channels:
        samples = np.asarray(ch.get("samples", []) or [], dtype=float)
        if ch.get("label") in (mapping.get("infrared"), mapping.get("red")):
            n = min(len(samples), len(ambient_samples))
            if n > 0:
                samples = samples[-n:] - ambient_samples[-n:]
        cleaned_channels.append({ **ch, "samples": samples.tolist() })
    return { **export, "channels": cleaned_channels }


def _biquad_coefficients(filter_type: str, cutoff_hz: float, sample_rate_hz: float, q: float = np.sqrt(0.5)):
    omega = 2 * np.pi * cutoff_hz / sample_rate_hz
    sin = np.sin(omega)
    cos = np.cos(omega)
    alpha = sin / (2 * q)
    if filter_type == "lowpass":
        b0 = (1 - cos) / 2
        b1 = 1 - cos
        b2 = (1 - cos) / 2
        a0 = 1 + alpha
        a1 = -2 * cos
        a2 = 1 - alpha
    elif filter_type == "highpass":
        b0 = (1 + cos) / 2
        b1 = -(1 + cos)
        b2 = (1 + cos) / 2
        a0 = 1 + alpha
        a1 = -2 * cos
        a2 = 1 - alpha
    else:
        raise ValueError(f"Unsupported filter_type={filter_type}")
    return {
        "b0": b0 / a0,
        "b1": b1 / a0,
        "b2": b2 / a0,
        "a1": a1 / a0,
        "a2": a2 / a0,
    }


def _apply_biquad(samples: np.ndarray, coeffs: dict) -> np.ndarray:
    out = np.zeros_like(samples, dtype=float)
    x1 = x2 = y1 = y2 = 0.0
    b0, b1, b2 = coeffs["b0"], coeffs["b1"], coeffs["b2"]
    a1, a2 = coeffs["a1"], coeffs["a2"]
    for i, x0 in enumerate(samples):
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def ppg_lowpass(samples: np.ndarray, cutoff_hz: float, sample_rate_hz: float) -> np.ndarray:
    coeffs = _biquad_coefficients("lowpass", cutoff_hz, sample_rate_hz)
    return _apply_biquad(_apply_biquad(samples, coeffs), coeffs)


def ppg_bandpass(samples: np.ndarray, low_hz: float, high_hz: float, sample_rate_hz: float) -> np.ndarray:
    hp = _biquad_coefficients("highpass", low_hz, sample_rate_hz)
    lp = _biquad_coefficients("lowpass", high_hz, sample_rate_hz)
    return _apply_biquad(_apply_biquad(samples, hp), lp)


def _percentile(samples: np.ndarray, q: float) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.percentile(samples, q * 100))


def _detrend(samples: np.ndarray) -> np.ndarray:
    if samples.size == 0:
        return samples
    return samples - np.mean(samples)


def find_ppg_peaks(samples: np.ndarray, sample_rate_hz: float, min_spacing_sec: float = 0.4) -> list[int]:
    if samples.size < 3:
        return []
    median = _percentile(samples, 0.5)
    mad = _percentile(np.abs(samples - median), 0.5) or 1e-6
    threshold = median + 1.25 * mad
    min_spacing = max(1, int(round(sample_rate_hz * min_spacing_sec)))
    peaks = []
    last_peak = -10**9
    for i in range(1, len(samples) - 1):
        v = samples[i]
        if v < threshold:
            continue
        if v > samples[i - 1] and v > samples[i + 1]:
            if i - last_peak >= min_spacing:
                peaks.append(i)
                last_peak = i
            else:
                if peaks and v > samples[peaks[-1]]:
                    peaks[-1] = i
                    last_peak = i
    return peaks


def compute_ppg_hr(samples: np.ndarray, sample_rate_hz: float, bpm_min: float = 35, bpm_max: float = 220) -> float | None:
    if samples.size < sample_rate_hz * 3:
        return None
    filtered = ppg_bandpass(_detrend(samples), 0.5, 4.0, sample_rate_hz)
    peaks = find_ppg_peaks(filtered, sample_rate_hz)
    if len(peaks) < 2:
        return None
    intervals = np.diff(peaks)
    median_samples = np.median(intervals)
    if median_samples <= 0:
        return None
    bpm = 60 * sample_rate_hz / median_samples
    if bpm < bpm_min or bpm > bpm_max:
        return None
    return float(round(bpm))


def build_ppg_cardiogram(samples: np.ndarray, sample_rate_hz: float, beats: int = 5) -> np.ndarray | None:
    if samples.size < sample_rate_hz * 3:
        return None
    filtered = ppg_bandpass(_detrend(samples), 0.5, 4.0, sample_rate_hz)
    peaks = find_ppg_peaks(filtered, sample_rate_hz)
    if len(peaks) < 2:
        return None
    segments = []
    start = max(1, len(peaks) - beats)
    for i in range(start, len(peaks)):
        a = peaks[i - 1]
        b = peaks[i]
        if b > a:
            segments.append(filtered[a:b])
    if not segments:
        return None
    return np.concatenate(segments)


def compute_spo2_metrics(ir_samples: np.ndarray, red_samples: np.ndarray, sample_rate_hz: float, window_sec: float = 8.0):
    window_samples = max(1, int(round(window_sec * sample_rate_hz)))
    if ir_samples.size < window_samples or red_samples.size < window_samples:
        return None
    ir_window = ir_samples[-window_samples:]
    red_window = red_samples[-window_samples:]
    ir_dc = ppg_lowpass(ir_window, 0.5, sample_rate_hz)
    red_dc = ppg_lowpass(red_window, 0.5, sample_rate_hz)
    ir_dc_mean = abs(np.mean(ir_dc))
    red_dc_mean = abs(np.mean(red_dc))
    if ir_dc_mean <= 0 or red_dc_mean <= 0:
        return None
    ir_ac = ppg_bandpass(_detrend(ir_window), 0.5, 4.0, sample_rate_hz)
    red_ac = ppg_bandpass(_detrend(red_window), 0.5, 4.0, sample_rate_hz)
    ir_ac_amp = (_percentile(ir_ac, 0.95) - _percentile(ir_ac, 0.05)) / 2
    red_ac_amp = (_percentile(red_ac, 0.95) - _percentile(red_ac, 0.05)) / 2
    if ir_ac_amp <= 0 or red_ac_amp <= 0:
        return None
    pi_ir = ir_ac_amp / ir_dc_mean
    pi_red = red_ac_amp / red_dc_mean
    if pi_ir <= 0 or pi_red <= 0:
        return None
    ratio = pi_red / pi_ir
    spo2 = 110 - 25 * ratio
    spo2 = float(np.clip(spo2, 80, 100))
    return {"spo2": spo2, "ratio": float(ratio), "pi_ir": float(pi_ir), "pi_red": float(pi_red)}


def compute_spo2_series(ir_samples: np.ndarray, red_samples: np.ndarray, sample_rate_hz: float,
                        window_sec: float = 8.0, step_sec: float = 1.0) -> pd.DataFrame:
    window = max(1, int(round(window_sec * sample_rate_hz)))
    step = max(1, int(round(step_sec * sample_rate_hz)))
    rows = []
    for start in range(0, min(len(ir_samples), len(red_samples)) - window + 1, step):
        ir_window = ir_samples[start:start + window]
        red_window = red_samples[start:start + window]
        metrics = compute_spo2_metrics(ir_window, red_window, sample_rate_hz, window_sec=window_sec)
        if metrics is None:
            continue
        t_sec = (start + window / 2) / sample_rate_hz
        rows.append({ "t_sec": t_sec, **metrics })
    return pd.DataFrame(rows)


def combine_ppg_exports(exports: list[dict]) -> dict | None:
    exports = [e for e in (exports or []) if e]
    if not exports:
        return None
    # Sort by capture start if available to preserve session order.
    exports_sorted = sorted(
        exports,
        key=lambda e: export_capture_start(e) or coerce_timestamp(e.get("capturedAt")) or pd.Timestamp.min
    )
    rates = [float(e.get("samplingRateHz") or 64.0) for e in exports_sorted]
    sampling_rate = rates[0] if rates else 64.0
    label_map: dict[str, list[float]] = {}
    for export in exports_sorted:
        for ch in export.get("channels", []) or []:
            label = ch.get("label")
            if not label:
                continue
            label_map.setdefault(label, []).extend(ch.get("samples", []) or [])
    channels = [
        {"label": label, "samples": samples, "samplingRateHz": sampling_rate}
        for label, samples in label_map.items()
    ]
    return {
        "capturedAt": exports_sorted[0].get("capturedAt"),
        "captureEndedAt": exports_sorted[-1].get("captureEndedAt"),
        "samplingRateHz": sampling_rate,
        "sensors": "-".join(label_map.keys()),
        "channels": channels,
        "_sidecar": {},
        "_path": None,
        "_file": None,
    }


def moving_average(samples: np.ndarray, window_size: int) -> np.ndarray:
    if window_size <= 1:
        return samples.copy()
    out = np.zeros_like(samples, dtype=float)
    acc = 0.0
    for i, v in enumerate(samples):
        acc += v
        if i >= window_size:
            acc -= samples[i - window_size]
        denom = min(i + 1, window_size)
        out[i] = acc / denom
    return out


def process_ppg_cardiogram(samples: np.ndarray, fs: float) -> np.ndarray:
    if samples.size == 0:
        return samples
    samples = bandpass_filter(samples, low_hz=0.5, high_hz=5.0, fs=fs, order=4)
    short_win = max(3, int(fs * 0.2))
    long_win = max(short_win + 1, int(fs * 1.2))
    fast = moving_average(samples, short_win)
    slow = moving_average(samples, long_win)
    band = fast - slow
    median = float(np.median(band))
    mad = float(np.median(np.abs(band - median)))
    scale = (1.4826 * mad) if mad > 0 else float(band.std() or 1.0)
    return (band - median) / scale


def estimate_hr_bpm(samples: np.ndarray, fs: float) -> float | None:
    if samples.size < fs * 2:
        return None
    mean = float(samples.mean())
    std = float(samples.std())
    threshold = mean + std * 0.5
    min_distance = max(1, int(fs * 0.35))
    peaks, _ = signal.find_peaks(samples, height=threshold, distance=min_distance)
    if len(peaks) < 2:
        return None
    intervals = np.diff(peaks) / fs
    avg_interval = float(intervals.mean()) if intervals.size else 0.0
    if avg_interval <= 0:
        return None
    bpm = 60.0 / avg_interval
    return float(np.round(bpm))


def heart_rate_series(samples: np.ndarray, fs: float, window_sec: int = 15, step_sec: int = 1) -> pd.DataFrame:
    window_samples = int(window_sec * fs)
    step_samples = max(1, int(step_sec * fs))
    if samples.size < window_samples:
        return pd.DataFrame(columns=["t_sec", "bpm"])
    rows = []
    for start in range(0, samples.size - window_samples + 1, step_samples):
        window = samples[start:start + window_samples]
        bpm = estimate_hr_bpm(window, fs)
        if bpm is None:
            continue
        t_sec = (start + window_samples) / fs
        rows.append({"t_sec": t_sec, "bpm": bpm})
    return pd.DataFrame(rows)


def plot_cardiogram(
    samples: np.ndarray,
    fs: float,
    *,
    max_points: int = 10000,
    fig_width: float = 12,
    title: str = "Cardiogram",
    ax=None,
    start_timestamp: pd.Timestamp | None = None,
):
    import matplotlib.pyplot as plt
    if ax is None:
        fig, ax = plt.subplots(figsize=(fig_width, 4), constrained_layout=True)

    t = np.arange(len(samples)) / fs
    
    stride = max(1, len(samples) // max_points)
    samples_plot = samples[::stride]
    t_plot = t[::stride]

    if start_timestamp is not None:
        ts = pd.to_datetime(start_timestamp) + pd.to_timedelta(t_plot, unit='s')
        ts = to_local_datetime_index(pd.Series(ts))
        start_ts_local = ts.min()
        end_ts_local = ts.max()
        ax.plot(ts, samples_plot, linewidth=0.8, color='#4ade80')
        ax.set_xlabel("Local Date/Time")
        _format_time_axis(ax, x_min=start_ts_local, x_max=end_ts_local)
        if ax.get_figure() is not None:
            span_sec = max(0, int((end_ts_local - start_ts_local).total_seconds()))
            if span_sec <= 60 * 60 * 24 * 60:
                ax.get_figure().autofmt_xdate()
    else:
        ax.plot(t_plot, samples_plot, linewidth=0.8, color='#4ade80')
        ax.set_xlabel("Time (s)")

    ax.set_ylabel("Amplitude")
    ax.set_title(title)
    ax.grid(True, alpha=0.2)
    if ax is None:
        plt.show()
        plt.close(fig)

def plot_heart_rate(
    hr_series: pd.DataFrame,
    *,
    fig_width: float = 12,
    title: str = "Heart Rate",
    ax=None,
    start_timestamp: pd.Timestamp | None = None,
):
    import matplotlib.pyplot as plt
    if ax is None:
        fig, ax = plt.subplots(figsize=(fig_width, 4), constrained_layout=True)
    
    if "t_sec" not in hr_series.columns or "bpm" not in hr_series.columns:
        raise ValueError("hr_series dataframe must contain 't_sec' and 'bpm' columns")

    if start_timestamp is not None:
        ts = pd.to_datetime(start_timestamp) + pd.to_timedelta(hr_series["t_sec"], unit='s')
        ts = to_local_datetime_index(pd.Series(ts))
        ts_min = ts.min()
        ts_max = ts.max()
        ax.plot(ts, hr_series["bpm"], color='#facc15', linewidth=1.4)
        ax.set_xlabel("Local Date/Time")
        _format_time_axis(ax, x_min=ts_min, x_max=ts_max)
        if ax.get_figure() is not None:
            span_sec = max(0, int((ts_max - ts_min).total_seconds()))
            if span_sec <= 60 * 60 * 24 * 60:
                ax.get_figure().autofmt_xdate()
    else:
        ax.plot(hr_series["t_sec"], hr_series["bpm"], color='#facc15', linewidth=1.4)
        ax.set_xlabel("Time (s)")

    ax.set_ylabel("BPM")
    ax.set_title(title)
    ax.grid(True, alpha=0.2)
    if ax is None:
        plt.show()
        plt.close(fig)


def export_file_sampling_rate(export: dict, default_fs: float = DEFAULT_FS) -> float:
    return export.get("samplingRateHz") or default_fs


def export_capture_start(export: dict) -> pd.Timestamp | None:
    path = export.get("_path")
    stem = Path(path).stem if path else None
    fallback = stem.replace("samples_", "") if stem else None
    return coerce_timestamp(
        export.get("capturedAt")
        or export.get("AcquisitionDateTime")
        or export.get("RecordingStartTime")
        or fallback
    )


def export_capture_end(export: dict) -> pd.Timestamp | None:
    return coerce_timestamp(export.get("captureEndedAt"))


def export_channels(export: dict) -> list[dict]:
    return export.get("channels", []) or []


def export_capture_start_for_label(exports: list[dict], target_label: str) -> pd.Timestamp | None:
    for export in exports or []:
        for ch in export_channels(export):
            if channel_label(ch) == target_label:
                capture_start = export_capture_start(export)
                if capture_start is not None:
                    return capture_start
    return None


def channel_label(channel: dict):
    return channel.get("label") or channel.get("electrode")


def channel_sampling_rate_hz(channel: dict, file_sampling_rate_hz: float, default_fs: float = DEFAULT_FS) -> float:
    return channel.get("samplingRateHz") or file_sampling_rate_hz or default_fs


def build_export_diagnostics(exports: list[dict]) -> pd.DataFrame:
    diag = []
    for export in exports:
        capture_start = export_capture_start(export)
        capture_end = export_capture_end(export)
        file_sampling_rate = export_file_sampling_rate(export)
        channels = export_channels(export)

        labels = [channel_label(c) for c in channels]
        sample_counts = [len(c.get("samples", []) or []) for c in channels]
        timestamp_counts = [len(c.get("timestamps") or []) for c in channels]
        channel_rates = [channel_sampling_rate_hz(c, file_sampling_rate) for c in channels]
        durations_sec = [
            (count / rate) if (rate and count is not None) else None for count, rate in zip(sample_counts, channel_rates)
        ]

        starts, ends = [], []
        for ch, rate in zip(channels, channel_rates):
            tbase = channel_timebase(ch, capture_start, rate)
            if tbase is not None and not tbase.isna().all():
                starts.append(tbase.iloc[0].isoformat())
                ends.append(tbase.iloc[-1].isoformat())
            else:
                starts.append(None)
                ends.append(None)

        diag.append(
            {
                "file": export.get("_file"),
                "captured_at": capture_start.isoformat() if capture_start is not None else None,
                "capture_ended_at": capture_end.isoformat() if capture_end is not None else None,
                "sampling_rate_hz": file_sampling_rate,
                "num_channels": len(channels),
                "channels": labels,
                "channel_sampling_rates_hz": channel_rates,
                "sample_counts": sample_counts,
                "timestamp_counts": timestamp_counts,
                "durations_sec": durations_sec,
                "first_ts": starts,
                "last_ts": ends,
            }
        )

    return pd.DataFrame(diag)


def print_export_summary(diag_df: pd.DataFrame, raw_dir) -> None:
    if diag_df is None or len(diag_df) == 0:
        print(f"No samples_*.json files found in RAW_DIR={raw_dir}")
        return

    sample_counts_flat = [v for v in chain.from_iterable(diag_df["sample_counts"].tolist()) if v is not None]
    durations_flat = [v for v in chain.from_iterable(diag_df["durations_sec"].tolist()) if v is not None]
    timestamp_counts_flat = [v for v in chain.from_iterable(diag_df["timestamp_counts"].tolist()) if v is not None]
    channel_rates_flat = [v for v in chain.from_iterable(diag_df["channel_sampling_rates_hz"].tolist()) if v is not None]

    total_channels = int(diag_df["num_channels"].sum())
    unique_labels = sorted({lbl for lbls in diag_df["channels"].tolist() for lbl in (lbls or []) if lbl is not None})

    captured_at = pd.to_datetime(diag_df["captured_at"], errors="coerce", utc=True)
    capture_ended_at = pd.to_datetime(diag_df["capture_ended_at"], errors="coerce", utc=True)

    print("=== Sample Export Summary ===")
    print(f"RAW_DIR: {raw_dir}")
    print(f"Files: {len(diag_df)}")
    print(f"Total channels: {total_channels}")
    print(f"Channel labels: {unique_labels}")

    if captured_at.notna().any():
        print(f"CapturedAt range: {captured_at.min().isoformat()} → {captured_at.max().isoformat()}")
    if capture_ended_at.notna().any():
        print(f"CaptureEndedAt range: {capture_ended_at.min().isoformat()} → {capture_ended_at.max().isoformat()}")

    if channel_rates_flat:
        rates_sorted = sorted(set(float(r) for r in channel_rates_flat))
        print(f"Sampling rates (Hz): {rates_sorted}")

    if sample_counts_flat:
        print(
            "Samples/channel (min/median/max): "
            f"{min(sample_counts_flat)} / {int(statistics.median(sample_counts_flat))} / {max(sample_counts_flat)}"
        )

    if durations_flat:
        print(
            "Duration/channel seconds (min/median/max): "
            f"{min(durations_flat):.2f} / {statistics.median(durations_flat):.2f} / {max(durations_flat):.2f}"
        )

    if timestamp_counts_flat and sample_counts_flat:
        channels_with_full_timestamps = 0
        channels_seen = 0
        for _, row in diag_df.iterrows():
            for sc, tc in zip(row["sample_counts"], row["timestamp_counts"]):
                channels_seen += 1
                if tc == sc and tc > 0:
                    channels_with_full_timestamps += 1
        print(f"Timestamps present (per-sample): {channels_with_full_timestamps}/{channels_seen} channels")


def find_discontinuities(df: pd.DataFrame, sampling_rate: float, threshold_sec: float | None = None) -> pd.DataFrame:
    if threshold_sec is None:
        threshold_sec = 2.0 / sampling_rate
    ts = df["timestamp"]
    diffs = ts.diff()
    gaps = diffs[diffs > pd.Timedelta(seconds=threshold_sec)]
    
    if gaps.empty:
        return pd.DataFrame(columns=["start_ts", "end_ts", "gap_sec"])

    gap_info = []
    for idx, gap in gaps.items():
        gap_info.append({
            "start_ts": ts[idx - 1],
            "end_ts": ts[idx],
            "gap_sec": gap.total_seconds(),
        })
    return pd.DataFrame(gap_info)


def load_label_timeseries(exports: list[dict], label: str) -> pd.DataFrame:
    frames = []
    for export in exports:
        capture_start = export_capture_start(export)
        file_sampling_rate = export_file_sampling_rate(export)
        for ch in export_channels(export):
            if channel_label(ch) != label:
                continue
            rate = channel_sampling_rate_hz(ch, file_sampling_rate)
            tbase = channel_timebase(ch, capture_start, rate)
            if tbase is None or tbase.isna().all():
                continue
            samples = np.asarray(ch.get("samples", []) or [], dtype=float)
            df = pd.DataFrame({"timestamp": tbase, "sample": samples})
            df["file"] = export.get("_file")
            df["label"] = label
            df["sampling_rate_hz"] = rate
            frames.append(df)

    if not frames:
        return pd.DataFrame(columns=["timestamp", "sample", "file", "label", "sampling_rate_hz", "t_sec"])

    out = pd.concat(frames, ignore_index=True)
    out = out.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    # Preserve full session coverage across exports; do not collapse same timestamps from different files.
    out = out.drop_duplicates(subset=["timestamp", "file"]).reset_index(drop=True)

    if not out.empty:
        sampling_rate = out["sampling_rate_hz"].iloc[0]
        discontinuities = find_discontinuities(out, sampling_rate)
        if not discontinuities.empty:
            print(f"WARNING: Discontinuities found in channel {label}:")
            # print(discontinuities)

    out["t_sec"] = (out["timestamp"] - out["timestamp"].iloc[0]).dt.total_seconds()
    return out


def get_channel_labels(diag_df: pd.DataFrame) -> list[str]:
    if diag_df is None or len(diag_df) == 0 or "channels" not in diag_df.columns:
        return []
    return sorted({lbl for lbls in diag_df["channels"].tolist() for lbl in (lbls or []) if lbl is not None})


def infer_hemisphere(label: str) -> str | None:
    """Infer left/right from common EEG naming (odd=left, even=right, Z=midline, AUXL/AUXR)."""
    s = str(label).strip().upper()
    if s.endswith("L") or "AUXL" in s:
        return "left"
    if s.endswith("R") or "AUXR" in s:
        return "right"
    if s.endswith("Z"):
        return None
    m = re.search(r"(\d+)$", s)
    if not m:
        return None
    try:
        n = int(m.group(1))
    except ValueError:
        return None
    return "left" if (n % 2 == 1) else "right"


def plot_raw_traces_per_label(
    exports: list[dict],
    diag_df: pd.DataFrame | None = None,
    fig_width: float = 12,
    title_prefix: str = "EEG",
    **kwargs,
):
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    import tzlocal

    max_points = kwargs.get("max_points")
    # window_sec is accepted via kwargs but not used to avoid breaking calls.

    if not exports:
        raise FileNotFoundError("No sample exports loaded")
    if diag_df is None:
        diag_df = build_export_diagnostics(exports)

    labels = get_channel_labels(diag_df)
    if not labels:
        raise ValueError("No channel labels available to plot")

    series_by_label = {lbl: load_label_timeseries(exports, lbl) for lbl in labels}
    non_empty = {lbl: df for lbl, df in series_by_label.items() if df is not None and len(df) > 0}
    if not non_empty:
        raise ValueError("No channel time series found to plot")


    # Plot all available data for each channel (full session)
    start_ts = min(df["timestamp"].min() for df in non_empty.values())
    end_ts = max(df["timestamp"].max() for df in non_empty.values())

    # Print the time window being plotted (in local time)
    start_ts_local = to_local_datetime_index(pd.Series([start_ts])).iloc[0]
    end_ts_local = to_local_datetime_index(pd.Series([end_ts])).iloc[0]
    print(f"Plotting window: {start_ts_local.strftime('%Y-%m-%d %H:%M:%S %Z')} to {end_ts_local.strftime('%Y-%m-%d %H:%M:%S %Z')}")

    fig_h = max(2.2 * len(labels), 3)
    fig, axes = plt.subplots(len(labels), 1, figsize=(fig_width, fig_h), sharex=True, constrained_layout=True)
    if len(labels) == 1:
        axes = [axes]


    for ax, lbl in zip(axes, labels):
        df = series_by_label.get(lbl)
        if df is None or len(df) == 0:
            ax.text(0.5, 0.5, f"{lbl}: no data", transform=ax.transAxes, ha="center", va="center")
            ax.set_ylabel(lbl)
            ax.grid(True, alpha=0.2)
            continue

        dfw = df[(df["timestamp"] >= start_ts) & (df["timestamp"] <= end_ts)]
        if dfw.empty:
            ax.text(0.5, 0.5, f"{lbl}: no samples in window", transform=ax.transAxes, ha="center", va="center")
            ax.set_ylabel(lbl)
            ax.grid(True, alpha=0.2)
            continue
        
        if max_points is not None and len(dfw) > max_points:
            stride = max(len(dfw) // max_points, 1)
            dfw = dfw.iloc[::stride]

        # Convert timestamps to local time
        ts = to_local_datetime_index(dfw["timestamp"]).reset_index(drop=True)
        y = dfw["sample"].to_numpy(dtype=float)
        y = y - y.mean()
        if len(ts) < 2:
            ax.plot(ts, y, linewidth=0.8, color="#38bdf8")
        else:
            # Find discontinuities (gaps > 2x median diff or > 2s if only one segment)
            diffs = ts.diff().dt.total_seconds().fillna(0)
            median_diff = diffs[diffs > 0].median() if (diffs > 0).any() else 0
            gap_threshold = 2 * median_diff if median_diff > 0 else 2
            gap_idx = diffs > gap_threshold
            segment_starts = [0] + list((gap_idx[gap_idx].index).to_list())
            segment_ends = list((gap_idx[gap_idx].index).to_list()) + [len(ts)]
            for start, end in zip(segment_starts, segment_ends):
                if end - start < 2:
                    continue
                ax.plot(ts[start:end], y[start:end], linewidth=0.8, color="#38bdf8")
        ax.set_ylabel(lbl)
        ax.grid(True, alpha=0.2)
        _format_time_axis(ax, x_min=start_ts_local, x_max=end_ts_local)

    axes[-1].set_xlabel("Local Date/Time")
    span_sec = max(0, int((end_ts_local - start_ts_local).total_seconds()))
    if span_sec <= 60 * 60 * 24 * 60:
        fig.autofmt_xdate()
    fig.suptitle(f"Raw {title_prefix} traces per channel (full session)", y=1.02)
    time_range_str = _get_time_range_str(diag_df)
    if time_range_str:
        fig.text(0.5, 0.01, time_range_str, ha='center', va='bottom', fontsize=8, color='gray')

    plt.show()
    plt.close(fig)


def plot_spectrograms_per_label(
    exports: list[dict],
    diag_df: pd.DataFrame | None = None,
    max_spectrogram_sec: int | None = None,
    max_freq_hz: int = 50,
    nfft: int | None = 4096,
    *,
    nperseg: int | None = None,
    noverlap: int | None = None,
    per_channel_height: float = 2.8,
    dpi: int = 140,
    fig_width: float = 12,
):
    import matplotlib.pyplot as plt

    if not exports:
        raise FileNotFoundError("No sample exports loaded")
    if diag_df is None:
        diag_df = build_export_diagnostics(exports)

    labels = get_channel_labels(diag_df)
    if not labels:
        raise ValueError("No channel labels available to plot")

    series_by_label = {lbl: load_label_timeseries(exports, lbl) for lbl in labels}
    non_empty = {lbl: df for lbl, df in series_by_label.items() if df is not None and len(df) > 0}
    if not non_empty:
        raise ValueError("No channel time series found to plot")

    nperseg_effective = int(NPERSEG if nperseg is None else nperseg)
    noverlap_effective = int(NOVERLAP if noverlap is None else noverlap)
    nfft_effective = None
    if nfft is not None:
        nfft_effective = int(max(nfft, nperseg_effective))

    spec: dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray, pd.Timestamp | None]]] = {}
    all_db = []
    for lbl in labels:
        df = series_by_label.get(lbl)
        if df is None or len(df) == 0:
            continue

        df = df.copy().reset_index(drop=True)
        has_ts = False
        if "timestamp" in df.columns:
            ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
            valid_ts = ts.notna()
            if valid_ts.any():
                df = df.loc[valid_ts].copy().reset_index(drop=True)
                df["timestamp"] = ts.loc[valid_ts].reset_index(drop=True)
                has_ts = True
        if df.empty:
            continue

        channel_rate = float(df["sampling_rate_hz"].mode().iloc[0]) if "sampling_rate_hz" in df else DEFAULT_FS
        if has_ts:
            df = df.sort_values("timestamp").reset_index(drop=True)

        # Notebook requirement: charts should use the full dataset time range.

        if len(df) < nperseg_effective:
            continue

        segments = []
        if has_ts:
            diffs = df["timestamp"].diff().dt.total_seconds().fillna(0)
            positive_diffs = diffs[diffs > 0]
            median_diff = positive_diffs.median() if not positive_diffs.empty else (1.0 / channel_rate)
            gap_threshold = 2 * median_diff if median_diff > 0 else (2.0 / channel_rate)
            start_idx = 0
            for idx in range(1, len(df)):
                if diffs.iloc[idx] > gap_threshold:
                    segments.append(df.iloc[start_idx:idx])
                    start_idx = idx
            segments.append(df.iloc[start_idx:])
        else:
            segments = [df]

        segment_specs = []
        for segment in segments:
            if len(segment) < nperseg_effective:
                continue
            samples = segment["sample"].to_numpy(dtype=float)
            spec_result = compute_spectrogram_psd(
                samples,
                channel_rate,
                nperseg=nperseg_effective,
                noverlap=noverlap_effective,
                nfft=nfft_effective,
                max_freq_hz=max_freq_hz,
                apply_filters=True,
            )
            if spec_result is None:
                continue
            f_masked, t, Sxx = spec_result
            Sxx_db = 10 * np.log10(np.maximum(Sxx, 1e-12))
            start_ts = segment["timestamp"].iloc[0] if has_ts else None
            segment_specs.append((f_masked, t, Sxx_db, start_ts))
            all_db.append(Sxx_db.ravel())

        if segment_specs:
            spec[lbl] = segment_specs

    if not spec:
        raise ValueError("No spectrograms computed (insufficient samples?)")

    all_db = np.concatenate(all_db)
    vmin, vmax = np.percentile(all_db, [5, 95])

    fig_h = max(per_channel_height * len(labels), 3.5)
    fig, axes = plt.subplots(len(labels), 1, figsize=(fig_width, fig_h), sharex=True, dpi=dpi, constrained_layout=True)
    if len(labels) == 1:
        axes = [axes]

    pcm = None
    import matplotlib.dates as mdates
    import tzlocal
    has_clock_time = bool(spec) and all(
        all(start_ts is not None for _, _, _, start_ts in segments)
        for segments in spec.values()
    )
    global_x_min = None
    global_x_max = None

    for ax, lbl in zip(axes, labels):
        if lbl not in spec:
            ax.text(0.5, 0.5, f"{lbl}: no data", transform=ax.transAxes, ha="center", va="center")
            ax.set_ylabel(lbl)
            ax.grid(False)
            continue

        for f_vals, t_vals, Sxx_db, start_ts in spec[lbl]:
            if start_ts is not None:
                start_ts_local = to_local_datetime_index(pd.Series([start_ts])).iloc[0]
                x_coords = pd.DatetimeIndex(start_ts_local + pd.to_timedelta(t_vals, unit="s"))
                if len(x_coords) > 0:
                    global_x_min = x_coords.min() if global_x_min is None else min(global_x_min, x_coords.min())
                    global_x_max = x_coords.max() if global_x_max is None else max(global_x_max, x_coords.max())
            else:
                x_coords = t_vals
            pcm = ax.pcolormesh(x_coords, f_vals, Sxx_db, shading="nearest", cmap="turbo", vmin=vmin, vmax=vmax, rasterized=True)
        ax.set_ylabel(lbl)
        ax.set_ylim(0.5, max_freq_hz)
        if has_clock_time:
            _format_time_axis(ax, x_min=global_x_min, x_max=global_x_max)

    if has_clock_time:
        axes[-1].set_xlabel("Local Date/Time")
        if global_x_min is not None and global_x_max is not None:
            for ax in axes:
                ax.set_xlim(global_x_min, global_x_max)
            span_sec = max(0, int((global_x_max - global_x_min).total_seconds()))
            if span_sec <= 60 * 60 * 24 * 60:
                fig.autofmt_xdate()
    else:
        axes[-1].set_xlabel("Time (s)")

    fig.suptitle("Spectrogram per channel (Welch/Hann)", y=0.99)

    if pcm is not None:
        fig.colorbar(pcm, ax=axes, label="dB", orientation="horizontal", pad=0.08, shrink=0.8)

    time_range_str = _get_time_range_str(diag_df)
    if time_range_str:
        fig.text(0.5, 0.01, time_range_str, ha='center', va='bottom', fontsize=8, color='gray')
    plt.show()
    plt.close(fig)


def compute_band_power_timeseries(
    samples: np.ndarray,
    fs: float,
    step_samples: int | None = None,
    nfft: int | None = SPECTROGRAM_NFFT,
    reject_artifacts: bool = False,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = LINE_NOISE_HZ,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
) -> pd.DataFrame:
    value_cols_abs = [f"{key}_abs" for key in BANDS.keys()]
    value_cols_rel = [f"{key}_rel" for key in BANDS.keys()]
    expected_cols = [
        "t_sec",
        "timestamp",
        "amplitude_range",
        "line_noise_ratio",
        "amplitude_artifact",
        "line_noise_artifact",
        *value_cols_abs,
        *value_cols_rel,
    ]
    if step_samples is None:
        step_samples = NPERSEG // 2
    # If samples is a pandas Series with datetime index, use it for timestamps
    is_series = hasattr(samples, 'index') and hasattr(samples.index, 'values')
    sample_index = samples.index if is_series else None
    samples_arr = samples.to_numpy(dtype=float) if is_series else np.asarray(samples, dtype=float)
    if len(samples_arr) < NPERSEG:
        return pd.DataFrame(columns=expected_cols)
    nperseg = NPERSEG
    noverlap = max(0, nperseg - step_samples)
    spec = compute_spectrogram_psd(
        samples_arr,
        fs,
        nperseg=nperseg,
        noverlap=noverlap,
        nfft=nfft,
        max_freq_hz=50.0,
        apply_filters=True,
    )
    if spec is None:
        return pd.DataFrame(columns=expected_cols)
    freqs_win, times, psd = spec

    rows = []
    for idx, start in enumerate(range(0, len(samples_arr) - nperseg + 1, step_samples)):
        if idx >= psd.shape[1]:
            break
        seg = samples_arr[start : start + nperseg]
        amplitude_range = float(np.ptp(seg))
        line_noise_ratio = compute_line_noise_ratio(
            seg,
            fs=fs,
            line_freq=line_noise_hz,
            band_hz=line_noise_band_hz,
            max_hz=line_noise_max_hz,
        )
        amplitude_artifact = (
            amplitude_range_threshold is not None and amplitude_range > amplitude_range_threshold
        )
        line_noise_artifact = (
            line_noise_ratio_threshold is not None and line_noise_ratio > line_noise_ratio_threshold
        )
        if reject_artifacts and (amplitude_artifact or line_noise_artifact):
            continue
        psd_win = psd[:, idx]
        bands = band_powers(freqs_win, psd_win)
        t_mid = float(times[idx]) if idx < len(times) else (start + (nperseg / 2)) / fs
        # UTC timestamp for the window center, from original index if available
        timestamp_utc = None
        if is_series and len(sample_index) > 0:
            idx_mid = int(start + (nperseg // 2))
            if idx_mid < len(sample_index):
                timestamp_utc = sample_index[idx_mid]
        row = {
            "t_sec": t_mid,
            "timestamp": timestamp_utc,
            "amplitude_range": amplitude_range,
            "line_noise_ratio": line_noise_ratio,
            "amplitude_artifact": amplitude_artifact,
            "line_noise_artifact": line_noise_artifact,
        }
        for key, value in bands.items():
            row[f"{key}_abs"] = value["absolute"]
            row[f"{key}_rel"] = value["relative"]
        rows.append(row)
    df = pd.DataFrame(rows, columns=expected_cols)
    # If no timestamp column, leave as None; if t_sec and base timestamp available, reconstruct
    if 'timestamp' in df.columns and df['timestamp'].isnull().all():
        df = df.drop(columns=['timestamp'])
    return df


def _band_power_value_columns(relative: bool = True) -> list[str]:
    suffix = "rel" if relative else "abs"
    return [f"{key}_{suffix}" for key in BANDS.keys()]


def _smooth_band_power_df(
    bp_ts: pd.DataFrame,
    fs: float,
    avg_sec: float | None,
    relative: bool = True,
    step_samples: int | None = None,
) -> pd.DataFrame:
    if bp_ts is None or len(bp_ts) == 0:
        return bp_ts
    if step_samples is None:
        step_samples = NPERSEG // 2
    value_cols = _band_power_value_columns(relative=relative)
    step_sec = step_samples / fs
    if avg_sec is None or avg_sec <= 0:
        return bp_ts
    smooth_windows = max(int(round(avg_sec / step_sec)), 1)
    out = bp_ts.copy()
    out[value_cols] = out[value_cols].rolling(smooth_windows, center=True, min_periods=1).mean()
    return out


def compute_band_power_timeseries_for_label(
    exports: list[dict],
    target_label: str,
    *,
    reject_artifacts: bool = False,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = LINE_NOISE_HZ,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
    nfft: int | None = SPECTROGRAM_NFFT,
) -> tuple[pd.DataFrame, float]:
    series = load_label_timeseries(exports, target_label)
    if series is None or len(series) == 0:
        raise ValueError(f"No samples found for label={target_label}")
    fs = float(series["sampling_rate_hz"].mode().iloc[0]) if "sampling_rate_hz" in series else DEFAULT_FS
    # Use pandas Series with datetime index for timestamp propagation
    if "timestamp" in series.columns:
        samples = pd.Series(series["sample"].to_numpy(dtype=float), index=series["timestamp"])
    else:
        samples = series["sample"].to_numpy(dtype=float)
    bp_ts = compute_band_power_timeseries(
        samples,
        fs,
        reject_artifacts=reject_artifacts,
        amplitude_range_threshold=amplitude_range_threshold,
        line_noise_ratio_threshold=line_noise_ratio_threshold,
        line_noise_hz=line_noise_hz,
        line_noise_band_hz=line_noise_band_hz,
        line_noise_max_hz=line_noise_max_hz,
        nfft=nfft,
    )
    # If timestamp column is missing, reconstruct from t_sec and base timestamp
    if 'timestamp' not in bp_ts.columns and "timestamp" in series.columns and len(series) > 0:
        base_ts = series["timestamp"].iloc[0]
        bp_ts["timestamp"] = pd.to_datetime(base_ts) + pd.to_timedelta(bp_ts["t_sec"], unit="s")
    if 'timestamp' not in bp_ts.columns:
        capture_start = export_capture_start_for_label(exports, target_label)
        if capture_start is not None:
            bp_ts["timestamp"] = pd.to_datetime(capture_start, utc=True) + pd.to_timedelta(bp_ts["t_sec"], unit="s")
    if bp_ts.empty:
        raise ValueError(f"Not enough samples to compute band power for label={target_label}")
    return bp_ts, fs


def compute_band_power_timeseries_combined(
    exports: list[dict],
    labels: list[str],
    *,
    reject_artifacts: bool = False,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = LINE_NOISE_HZ,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
    nfft: int | None = SPECTROGRAM_NFFT,
) -> tuple[pd.DataFrame, float]:
    labels = [l for l in (labels or []) if l is not None]
    if not labels:
        raise ValueError("No labels provided for combined band power")

    bp_list = []
    fs_values = []
    for lbl in labels:
        bp_ts, fs = compute_band_power_timeseries_for_label(
            exports,
            lbl,
            reject_artifacts=reject_artifacts,
            amplitude_range_threshold=amplitude_range_threshold,
            line_noise_ratio_threshold=line_noise_ratio_threshold,
            line_noise_hz=line_noise_hz,
            line_noise_band_hz=line_noise_band_hz,
            line_noise_max_hz=line_noise_max_hz,
            nfft=nfft,
        )
        bp_list.append(bp_ts)
        fs_values.append(fs)

    fs0 = fs_values[0]
    if any(abs(fs - fs0) > 1e-6 for fs in fs_values[1:]):
        raise ValueError(f"Mismatched sampling rates in group: {sorted(set(fs_values))}")

    if len(bp_list) == 1:
        return bp_list[0], fs0

    step_samples = NPERSEG // 2
    step_sec = step_samples / fs0
    value_cols_abs = _band_power_value_columns(relative=False)
    all_cols = ["t_sec"] + value_cols_abs
    has_timestamps = any("timestamp" in df.columns for df in bp_list)

    frames = []
    ts_frames = []
    for df in bp_list:
        d = df[all_cols].copy()
        d["t_bin"] = (d["t_sec"] / step_sec).round().astype(int)
        d = d.groupby("t_bin", as_index=True).mean(numeric_only=True)
        frames.append(d)
        if "timestamp" in df.columns:
            ts = df[["t_sec", "timestamp"]].copy()
            ts["t_bin"] = (ts["t_sec"] / step_sec).round().astype(int)
            ts = ts.dropna(subset=["timestamp"])
            if not ts.empty:
                ts = ts.groupby("t_bin", as_index=True)["timestamp"].apply(
                    lambda x: pd.to_datetime(x, errors="coerce", utc=True).dropna().mean()
                )
                ts_frames.append(ts)

    common = None
    for frame in frames:
        idx = set(frame.index)
        common = idx if common is None else common.intersection(idx)
    if not common:
        raise ValueError("No overlapping time bins across labels to combine")

    common = sorted(common)
    frames = [frame.loc[common] for frame in frames]
    avg = sum(frames) / len(frames)

    avg = avg.reset_index(drop=False)
    avg["t_sec"] = avg["t_bin"] * step_sec
    avg = avg.drop(columns=["t_bin"])

    # Derive relative powers from the combined absolute powers (avoid averaging relative across channels)
    denom = avg[value_cols_abs].sum(axis=1)
    for key in BANDS:
        abs_col = f"{key}_abs"
        rel_col = f"{key}_rel"
        avg[rel_col] = np.where(denom > 0, avg[abs_col] / denom, 0.0)

    value_cols_rel = _band_power_value_columns(relative=True)
    cols = ["t_sec"] + value_cols_abs + value_cols_rel
    if has_timestamps and ts_frames:
        ts_common = None
        for ts in ts_frames:
            idx = set(ts.index)
            ts_common = idx if ts_common is None else ts_common.intersection(idx)
        if ts_common:
            ts_common = sorted(ts_common)
            ts_values = pd.concat([ts.loc[ts_common] for ts in ts_frames], axis=1)
            ts_mean = ts_values.mean(axis=1)
            avg["timestamp"] = ts_mean.to_numpy()
            cols = ["t_sec", "timestamp"] + value_cols_abs + value_cols_rel
    return avg[cols], fs0


def plot_band_power_diagram(
    bp_ts: pd.DataFrame,
    title: str,
    avg_sec: float | None = 30,
    relative: bool = True,
    fs: float = DEFAULT_FS,
    ax=None,
    target_history: dict[str, list[dict]] | None = None,
    fig_width: float = 12,
):
    import matplotlib.pyplot as plt
    import tzlocal

    step_samples = NPERSEG // 2
    bp_plot = _smooth_band_power_df(bp_ts, fs=fs, avg_sec=avg_sec, relative=relative, step_samples=step_samples)
    value_cols = _band_power_value_columns(relative=relative)

    colors = ["#22c55e", "#facc15", "#f97316", "#06b6d4", "#8b5cf6"]
    if ax is None:
        _, ax = plt.subplots(1, 1, figsize=(fig_width, 4.6))

    # Try to use clock time if available
    import matplotlib.dates as mdates
    # Use timestamp column if available, else fall back to t_sec
    target_history = target_history or {}
    target_frames = {key: _normalize_target_history(target_history.get(key, [])) for key in BANDS}
    if "timestamp" in bp_plot.columns:
        ts = to_local_datetime_index(bp_plot["timestamp"])
        sens_axes = None
        if any(not df.empty for df in target_frames.values()):
            sens_vals = [
                v for df in target_frames.values()
                for v in df.get("sensitivity", pd.Series(dtype=float)).dropna().tolist()
            ]
            if sens_vals:
                sens_min = min(sens_vals)
                sens_max = max(sens_vals)
                sens_pad = max(0.05, (sens_max - sens_min) * 0.2)
                sens_axes = ax.twinx()
                sens_axes.set_ylim(sens_min - sens_pad, sens_max + sens_pad)
                sens_axes.set_ylabel("Sensitivity")
                sens_axes.grid(False)
        for i, (key, band) in enumerate(BANDS.items()):
            hist_df = target_frames.get(key)
            if hist_df is None or hist_df.empty:
                continue
            hist_local = to_local_datetime_index(hist_df["timestamp"])
            lower = hist_df["target"] - hist_df["tolerance"]
            upper = hist_df["target"] + hist_df["tolerance"]
            ax.fill_between(
                hist_local,
                lower,
                upper,
                color=colors[i % len(colors)],
                alpha=0.12,
                linewidth=0,
            )
            ax.plot(
                hist_local,
                hist_df["target"],
                color=colors[i % len(colors)],
                linewidth=1.0,
                alpha=0.5,
                label=f"{band['label']} target",
            )
            if sens_axes is not None and "sensitivity" in hist_df.columns:
                sens_axes.plot(
                    hist_local,
                    hist_df["sensitivity"],
                    color=colors[i % len(colors)],
                    linewidth=1.0,
                    alpha=0.7,
                    linestyle="--",
                )
        for i, (key, band) in enumerate(BANDS.items()):
            y = bp_plot[value_cols[i]].to_numpy(dtype=float)
            if len(ts) < 2:
                ax.plot(ts, y, linewidth=1.4, color=colors[i % len(colors)], label=band["label"])
            else:
                diffs = ts.diff().dt.total_seconds().fillna(0)
                median_diff = diffs[diffs > 0].median() if (diffs > 0).any() else 0
                gap_idx = diffs > (2 * median_diff if median_diff > 0 else 2)
                segment_starts = [0] + list((gap_idx[gap_idx].index).to_list())
                segment_ends = list((gap_idx[gap_idx].index).to_list()) + [len(ts)]
                for start, end in zip(segment_starts, segment_ends):
                    if end - start < 2:
                        continue
                    ax.plot(ts[start:end], y[start:end], linewidth=1.4, color=colors[i % len(colors)], label=band["label"] if start == 0 else None)
        _format_time_axis(ax, x_min=ts.min(), x_max=ts.max())
        import matplotlib.pyplot as plt
        plt.gcf().autofmt_xdate()
    else:
        t_sec = bp_plot["t_sec"]
        sens_axes = None
        if any(not df.empty for df in target_frames.values()):
            t0 = None
            for df in target_frames.values():
                if not df.empty:
                    t0 = df["timestamp"].iloc[0]
                    break
            if t0 is not None:
                sens_vals = [
                    v for df in target_frames.values()
                    for v in df.get("sensitivity", pd.Series(dtype=float)).dropna().tolist()
                ]
                if sens_vals:
                    sens_min = min(sens_vals)
                    sens_max = max(sens_vals)
                    sens_pad = max(0.05, (sens_max - sens_min) * 0.2)
                    sens_axes = ax.twinx()
                    sens_axes.set_ylim(sens_min - sens_pad, sens_max + sens_pad)
                    sens_axes.set_ylabel("Sensitivity")
                    sens_axes.grid(False)
                for i, (key, band) in enumerate(BANDS.items()):
                    hist_df = target_frames.get(key)
                    if hist_df is None or hist_df.empty:
                        continue
                    t_hist = (hist_df["timestamp"] - t0).dt.total_seconds()
                    lower = hist_df["target"] - hist_df["tolerance"]
                    upper = hist_df["target"] + hist_df["tolerance"]
                    ax.fill_between(
                        t_hist,
                        lower,
                        upper,
                        color=colors[i % len(colors)],
                        alpha=0.12,
                        linewidth=0,
                    )
                    ax.plot(
                        t_hist,
                        hist_df["target"],
                        color=colors[i % len(colors)],
                        linewidth=1.0,
                        alpha=0.5,
                        label=f"{band['label']} target",
                    )
                    if sens_axes is not None and "sensitivity" in hist_df.columns:
                        sens_axes.plot(
                            t_hist,
                            hist_df["sensitivity"],
                            color=colors[i % len(colors)],
                            linewidth=1.0,
                            alpha=0.7,
                            linestyle="--",
                        )
        for i, (key, band) in enumerate(BANDS.items()):
            ax.plot(t_sec, bp_plot[value_cols[i]], label=band["label"], linewidth=1.4, color=colors[i % len(colors)])
        ax.set_xlabel("Time (s)")
    ax.set_title(title + (f" (avg={avg_sec}s)" if (avg_sec is not None and avg_sec > 0) else ""))
    ax.set_ylabel("Relative power" if relative else "Absolute power")
    ax.grid(True, alpha=0.25)
    return ax


def plot_band_power_diagrams(
    exports: list[dict],
    diag_df: pd.DataFrame,
    avg_sec: float | None = 30,
    relative: bool = True,
    *,
    show: bool = True,
    return_fig: bool = False,
    fig_width: float = 12,
    reject_artifacts: bool = False,
    amplitude_range_threshold: float | None = None,
    line_noise_ratio_threshold: float | None = None,
    line_noise_hz: float = LINE_NOISE_HZ,
    line_noise_band_hz: float = 2.0,
    line_noise_max_hz: float | None = 80.0,
    nfft: int | None = SPECTROGRAM_NFFT,
):
    import matplotlib.pyplot as plt

    target_history_by_label = extract_target_history(exports)
    labels = get_channel_labels(diag_df)
    if not labels:
        raise ValueError("No channel labels available")

    tp_labels = [l for l in labels if str(l).startswith("TP")]
    af_labels = [l for l in labels if str(l).startswith("AF")]
    left_labels = [l for l in labels if infer_hemisphere(str(l)) == "left"]
    right_labels = [l for l in labels if infer_hemisphere(str(l)) == "right"]

    groups: list[tuple[str, list[str]]] = [(l, [l]) for l in labels]
    if tp_labels:
        groups.append(("TP Combined", tp_labels))
    if af_labels:
        groups.append(("AF Combined", af_labels))
    if left_labels:
        groups.append(("Left Combined", left_labels))
    if right_labels:
        groups.append(("Right Combined", right_labels))
    groups.append(("All Combined", labels))

    fig_h = max(2.6 * len(groups), 4)
    fig, axes = plt.subplots(len(groups), 1, figsize=(fig_width, fig_h), sharex=True, constrained_layout=True)
    if len(groups) == 1:
        axes = [axes]

    for ax, (name, group_labels) in zip(axes, groups):
        bp_ts, fs = compute_band_power_timeseries_combined(
            exports,
            group_labels,
            reject_artifacts=reject_artifacts,
            amplitude_range_threshold=amplitude_range_threshold,
            line_noise_ratio_threshold=line_noise_ratio_threshold,
            line_noise_hz=line_noise_hz,
            line_noise_band_hz=line_noise_band_hz,
            line_noise_max_hz=line_noise_max_hz,
            nfft=nfft,
        )
        # Print the time window being plotted (in local time)
        if "timestamp" in bp_ts.columns and not bp_ts["timestamp"].empty:
            ts_local = to_local_datetime_index(bp_ts["timestamp"])
            print(f"Band power plot window for {name}: {ts_local.min().strftime('%Y-%m-%d %H:%M:%S %Z')} to {ts_local.max().strftime('%Y-%m-%d %H:%M:%S %Z')}")
        target_history = None
        if len(group_labels) == 1:
            target_history = target_history_by_label.get(group_labels[0])
        plot_band_power_diagram(
            bp_ts,
            title=f"Band power — {name}" + (" (relative)" if relative else " (absolute)"),
            avg_sec=avg_sec,
            relative=relative,
            fs=fs,
            ax=ax,
            target_history=target_history,
        )

    handles, labels_legend = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels_legend, ncol=5, fontsize=9, loc="upper center", bbox_to_anchor=(0.5, 1.01))
    time_range_str = _get_time_range_str(diag_df)
    if time_range_str:
        fig.text(0.5, 0.01, time_range_str, ha='center', va='bottom', fontsize=8, color='gray')

    if show:
        plt.show()
        plt.close(fig)

    return fig if return_fig else None
