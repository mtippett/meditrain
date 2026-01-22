from __future__ import annotations


def to_local_datetime_index(ts):
    """Convert a pandas Series or DatetimeIndex to local timezone and return as DatetimeIndex."""
    import tzlocal
    local_tz = tzlocal.get_localzone()
    ts = pd.to_datetime(ts)
    if ts.dt.tz is None:
        ts = ts.dt.tz_localize('UTC')
    return ts.dt.tz_convert(local_tz)

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
NPERSEG = 1024
NOVERLAP = NPERSEG // 2

BANDS = [
    {"key": "delta", "label": "Delta", "min": 0.5, "max": 4},
    {"key": "theta", "label": "Theta", "min": 4, "max": 8},
    {"key": "alpha", "label": "Alpha", "min": 8, "max": 12},
    {"key": "beta", "label": "Beta", "min": 12, "max": 30},
    {"key": "gamma", "label": "Gamma", "min": 30, "max": 50},
]


def _get_time_range_str(diag_df: pd.DataFrame) -> str | None:
    if diag_df is None or "captured_at" not in diag_df.columns:
        return None
    captured_at = pd.to_datetime(diag_df["captured_at"], errors="coerce", utc=True)
    if captured_at.notna().any():
        min_ts = captured_at.min().strftime('%Y-%m-%d %H:%M:%S UTC')
        max_ts = captured_at.max().strftime('%Y-%m-%d %H:%M:%S UTC')
        return f"Data captured from {min_ts} to {max_ts}"
    return None


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


def compute_psd(samples: Iterable[float], fs: float = DEFAULT_FS) -> tuple[np.ndarray, np.ndarray]:
    samples = np.asarray(samples, dtype=float)
    if samples.size == 0:
        return np.array([]), np.array([])
    samples = samples - samples.mean()
    # Best-practice preprocessing for band-power estimation:
    # - remove DC (mean)
    # - zero-phase bandpass in the analysis range
    # - mains notch to reduce spectral leakage into nearby bins
    samples = bandpass_filter(samples, low_hz=0.5, high_hz=50.0, fs=fs)
    samples = notch_filter(samples, fs=fs)
    freqs, psd = signal.welch(
        samples,
        fs=fs,
        window="hann",
        nperseg=NPERSEG,
        noverlap=NOVERLAP,
        detrend=False,
        scaling="density",
        average="mean",
    )
    mask = freqs <= 50
    return freqs[mask], psd[mask]


def band_powers(freqs: np.ndarray, psd: np.ndarray) -> dict[str, dict[str, float]]:
    totals: dict[str, dict[str, float]] = {}
    total_power = 0.0
    for band in BANDS:
        band_mask = (freqs >= band["min"]) & (freqs < band["max"])
        p = float(np.trapezoid(psd[band_mask], freqs[band_mask])) if np.any(band_mask) else 0.0
        totals[band["key"]] = {"absolute": p, "relative": 0.0}
        total_power += p
    if total_power > 0:
        for key in totals:
            totals[key]["relative"] = totals[key]["absolute"] / total_power
    return totals


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
    return sorted(raw_dir.glob(pattern))


def load_sample_export(path: Path | str) -> dict:
    path = Path(path)
    with open(path) as f:
        export = json.load(f)
    export["_path"] = str(path)
    export["_file"] = path.name
    return export


def load_sample_exports(raw_dir: Path | str, pattern: str = "samples_*.json", limit: int | None = None) -> list[dict]:
    files = list_sample_files(raw_dir, pattern=pattern)
    if limit is not None:
        files = files[: int(limit)]
    return [load_sample_export(p) for p in files]


def export_file_sampling_rate(export: dict, default_fs: float = DEFAULT_FS) -> float:
    return export.get("samplingRateHz") or default_fs


def export_capture_start(export: dict) -> pd.Timestamp | None:
    path = export.get("_path")
    stem = Path(path).stem if path else None
    fallback = stem.replace("samples_", "") if stem else None
    return coerce_timestamp(export.get("capturedAt") or fallback)


def export_capture_end(export: dict) -> pd.Timestamp | None:
    return coerce_timestamp(export.get("captureEndedAt"))


def export_channels(export: dict) -> list[dict]:
    return export.get("channels", []) or []


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
    out = out.drop_duplicates(subset=["timestamp"]).reset_index(drop=True)

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
    window_sec: int = 10,
    max_points: int = 3000,
):
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

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


    # Plot all available data for each channel
    start_ts = min(df["timestamp"].min() for df in non_empty.values())
    end_ts = max(df["timestamp"].max() for df in non_empty.values())

    # Print the time window being plotted (in local time)
    import tzlocal
    local_tz = tzlocal.get_localzone()
    start_ts_obj = pd.to_datetime(start_ts)
    end_ts_obj = pd.to_datetime(end_ts)
    if start_ts_obj.tzinfo is None:
        start_ts_local = start_ts_obj.tz_localize('UTC').tz_convert(local_tz)
    else:
        start_ts_local = start_ts_obj.tz_convert(local_tz)
    if end_ts_obj.tzinfo is None:
        end_ts_local = end_ts_obj.tz_localize('UTC').tz_convert(local_tz)
    else:
        end_ts_local = end_ts_obj.tz_convert(local_tz)
    print(f"Plotting window: {start_ts_local.strftime('%Y-%m-%d %H:%M:%S %Z')} to {end_ts_local.strftime('%Y-%m-%d %H:%M:%S %Z')}")

    fig_h = max(2.2 * len(labels), 3)
    fig, axes = plt.subplots(len(labels), 1, figsize=(12, fig_h), sharex=True)
    if len(labels) == 1:
        axes = [axes]


    import pytz
    import tzlocal
    local_tz = tzlocal.get_localzone()
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

        stride = max(len(dfw) // max_points, 1)
        dfw = dfw.iloc[::stride]

        # Convert timestamps to local time
        ts = pd.to_datetime(dfw["timestamp"]).dt.tz_convert(local_tz)
        ts = ts.reset_index(drop=True)
        print(ts)
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

    axes[-1].set_xlabel("Clock Time")
    axes[-1].xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    fig.autofmt_xdate()
    fig.suptitle(f"Raw EEG traces per channel (last {window_sec}s)", y=1.02)
    # Show local time range at the bottom
    captured_at = pd.to_datetime(diag_df["captured_at"], errors="coerce", utc=True)
    if captured_at.notna().any():
        min_ts = captured_at.min().tz_convert(local_tz).strftime('%Y-%m-%d %H:%M:%S %Z')
        max_ts = captured_at.max().tz_convert(local_tz).strftime('%Y-%m-%d %H:%M:%S %Z')
        fig.text(0.5, 0.01, f"Data captured from {min_ts} to {max_ts}", ha='center', va='bottom', fontsize=8, color='gray')

    plt.tight_layout(rect=[0, 0.03, 1, 1])
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

    spec = {}
    all_db = []
    for lbl in labels:
        df = series_by_label.get(lbl)
        if df is None or len(df) == 0:
            continue

        channel_rate = float(df["sampling_rate_hz"].mode().iloc[0]) if "sampling_rate_hz" in df else DEFAULT_FS
        samples = df["sample"].to_numpy(dtype=float)

        # Plot all available data if max_spectrogram_sec is None
        if max_spectrogram_sec is not None:
            max_samples = int(max_spectrogram_sec * channel_rate)
            if len(samples) > max_samples:
                samples = samples[-max_samples:]

        samples = samples - samples.mean()

        nperseg_effective = int(NPERSEG if nperseg is None else nperseg)
        noverlap_effective = int(NOVERLAP if noverlap is None else noverlap)
        nfft_effective = None
        if nfft is not None:
            nfft_effective = int(max(nfft, nperseg_effective))

        f, t, Sxx = signal.spectrogram(
            samples,
            fs=channel_rate,
            window="hann",
            nperseg=nperseg_effective,
            noverlap=noverlap_effective,
            nfft=nfft_effective,
            detrend=False,
            scaling="density",
        )
        mask = f <= max_freq_hz
        f = f[mask]
        Sxx = Sxx[mask]
        Sxx_db = 10 * np.log10(np.maximum(Sxx, 1e-12))

        spec[lbl] = (f, t, Sxx_db)
        all_db.append(Sxx_db.ravel())

    if not spec:
        raise ValueError("No spectrograms computed (insufficient samples?)")

    all_db = np.concatenate(all_db)
    vmin, vmax = np.percentile(all_db, [5, 95])

    fig_h = max(per_channel_height * len(labels), 3.5)
    fig, axes = plt.subplots(len(labels), 1, figsize=(12, fig_h), sharex=True, dpi=dpi, constrained_layout=True)
    if len(labels) == 1:
        axes = [axes]

    pcm = None
    import matplotlib.dates as mdates

    import tzlocal
    local_tz = tzlocal.get_localzone()
    for ax, lbl in zip(axes, labels):
        if lbl not in spec:
            ax.text(0.5, 0.5, f"{lbl}: no data", transform=ax.transAxes, ha="center", va="center")
            ax.set_ylabel(lbl)
            ax.grid(False)
            continue

        f, t, Sxx_db = spec[lbl]
        df = series_by_label.get(lbl)
        if df is not None and len(df) > 0:
            t0 = df["timestamp"].iloc[0]
            t_clock = (pd.to_datetime(t0) + pd.to_timedelta(t, unit="s")).tz_convert(local_tz)
            # Handle discontinuities: split t_clock into continuous segments
            if len(t_clock) < 2:
                pcm = ax.pcolormesh(t_clock, f, Sxx_db, shading="nearest", cmap="turbo", vmin=vmin, vmax=vmax, rasterized=True)
            else:
                diffs = pd.Series(t_clock).diff().dt.total_seconds().fillna(0)
                median_diff = diffs[diffs > 0].median() if (diffs > 0).any() else 0
                gap_idx = diffs > (2 * median_diff if median_diff > 0 else 2)
                segment_starts = [0] + list((gap_idx[gap_idx].index).to_list())
                segment_ends = list((gap_idx[gap_idx].index).to_list()) + [len(t_clock)]
                for start, end in zip(segment_starts, segment_ends):
                    if end - start < 2:
                        continue
                    pcm = ax.pcolormesh(t_clock[start:end], f, Sxx_db[:, start:end], shading="nearest", cmap="turbo", vmin=vmin, vmax=vmax, rasterized=True)
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
        else:
            pcm = ax.pcolormesh(t, f, Sxx_db, shading="nearest", cmap="turbo", vmin=vmin, vmax=vmax, rasterized=True)
        ax.set_ylabel(lbl)
        ax.set_ylim(0.5, max_freq_hz)

    axes[-1].set_xlabel("Clock Time")
    fig.autofmt_xdate()
    fig.suptitle("Spectrogram per channel (Welch/Hann)", y=0.99)

    if pcm is not None:
        fig.colorbar(pcm, ax=axes, label="dB", shrink=0.6)

    time_range_str = _get_time_range_str(diag_df)
    if time_range_str:
        fig.text(0.5, 0.01, time_range_str, ha='center', va='bottom', fontsize=8, color='gray')
    plt.show()
    plt.close(fig)


def compute_band_power_timeseries(samples: np.ndarray, fs: float, step_samples: int | None = None) -> pd.DataFrame:
    if step_samples is None:
        step_samples = NPERSEG // 2
    rows = []
    # If samples is a pandas Series with datetime index, use it for timestamps
    is_series = hasattr(samples, 'index') and hasattr(samples.index, 'values')
    sample_index = samples.index if is_series else None
    for start in range(0, len(samples) - NPERSEG + 1, step_samples):
        seg = samples[start : start + NPERSEG]
        freqs_win, psd_win = compute_psd(seg, fs=fs)
        bands = band_powers(freqs_win, psd_win)
        t_mid = (start + (NPERSEG / 2)) / fs
        # UTC timestamp for the window center, from original index if available
        timestamp_utc = None
        if is_series and len(sample_index) > 0:
            idx = int(start + (NPERSEG // 2))
            if idx < len(sample_index):
                timestamp_utc = sample_index[idx]
        row = {"t_sec": t_mid, "timestamp": timestamp_utc}
        for key, value in bands.items():
            row[f"{key}_abs"] = value["absolute"]
            row[f"{key}_rel"] = value["relative"]
        rows.append(row)
    df = pd.DataFrame(rows)
    # If no timestamp column, leave as None; if t_sec and base timestamp available, reconstruct
    if 'timestamp' in df.columns and df['timestamp'].isnull().all():
        df = df.drop(columns=['timestamp'])
    return df


def _band_power_value_columns(relative: bool = True) -> list[str]:
    suffix = "rel" if relative else "abs"
    return [f"{b['key']}_{suffix}" for b in BANDS]


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


def compute_band_power_timeseries_for_label(exports: list[dict], target_label: str) -> tuple[pd.DataFrame, float]:
    series = load_label_timeseries(exports, target_label)
    if series is None or len(series) == 0:
        raise ValueError(f"No samples found for label={target_label}")
    fs = float(series["sampling_rate_hz"].mode().iloc[0]) if "sampling_rate_hz" in series else DEFAULT_FS
    # Use pandas Series with datetime index for timestamp propagation
    if "timestamp" in series.columns:
        samples = pd.Series(series["sample"].to_numpy(dtype=float), index=series["timestamp"])
    else:
        samples = series["sample"].to_numpy(dtype=float)
    bp_ts = compute_band_power_timeseries(samples, fs)
    # If timestamp column is missing, reconstruct from t_sec and base timestamp
    if 'timestamp' not in bp_ts.columns and "timestamp" in series.columns and len(series) > 0:
        base_ts = series["timestamp"].iloc[0]
        bp_ts["timestamp"] = pd.to_datetime(base_ts) + pd.to_timedelta(bp_ts["t_sec"], unit="s")
    if bp_ts.empty:
        raise ValueError(f"Not enough samples to compute band power for label={target_label}")
    return bp_ts, fs


def compute_band_power_timeseries_combined(exports: list[dict], labels: list[str]) -> tuple[pd.DataFrame, float]:
    labels = [l for l in (labels or []) if l is not None]
    if not labels:
        raise ValueError("No labels provided for combined band power")

    bp_list = []
    fs_values = []
    for lbl in labels:
        bp_ts, fs = compute_band_power_timeseries_for_label(exports, lbl)
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

    frames = []
    for df in bp_list:
        d = df[all_cols].copy()
        d["t_bin"] = (d["t_sec"] / step_sec).round().astype(int)
        d = d.groupby("t_bin", as_index=True).mean(numeric_only=True)
        frames.append(d)

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
    for band in BANDS:
        abs_col = f"{band['key']}_abs"
        rel_col = f"{band['key']}_rel"
        avg[rel_col] = np.where(denom > 0, avg[abs_col] / denom, 0.0)

    value_cols_rel = _band_power_value_columns(relative=True)
    cols = ["t_sec"] + value_cols_abs + value_cols_rel
    return avg[cols], fs0


def plot_band_power_diagram(
    bp_ts: pd.DataFrame,
    title: str,
    avg_sec: float | None = 30,
    relative: bool = True,
    fs: float = DEFAULT_FS,
    ax=None,
):
    import matplotlib.pyplot as plt

    step_samples = NPERSEG // 2
    bp_plot = _smooth_band_power_df(bp_ts, fs=fs, avg_sec=avg_sec, relative=relative, step_samples=step_samples)
    value_cols = _band_power_value_columns(relative=relative)

    colors = ["#22c55e", "#facc15", "#f97316", "#06b6d4", "#8b5cf6"]
    if ax is None:
        _, ax = plt.subplots(1, 1, figsize=(12, 4.6))

    # Try to use clock time if available
    import matplotlib.dates as mdates
    # Use timestamp column if available, else fall back to t_sec
    if "timestamp" in bp_plot.columns:
        ts = to_local_datetime_index(bp_plot["timestamp"])
        for i, band in enumerate(BANDS):
            y = bp_plot[value_cols[i]].to_numpy(dtype=float)
            if len(ts) < 2:
                ax.plot(ts, y, linewidth=1.4, color=colors[i % len(colors)], label=band["label"])
            else:
                diffs = ts.to_series().diff().dt.total_seconds().fillna(0)
                median_diff = diffs[diffs > 0].median() if (diffs > 0).any() else 0
                gap_idx = diffs > (2 * median_diff if median_diff > 0 else 2)
                segment_starts = [0] + list((gap_idx[gap_idx].index).to_list())
                segment_ends = list((gap_idx[gap_idx].index).to_list()) + [len(ts)]
                for start, end in zip(segment_starts, segment_ends):
                    if end - start < 2:
                        continue
                    ax.plot(ts[start:end], y[start:end], linewidth=1.4, color=colors[i % len(colors)], label=band["label"] if start == 0 else None)
        ax.set_xlabel("Local Date/Time")
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d %H:%M:%S'))
        import matplotlib.pyplot as plt
        plt.gcf().autofmt_xdate()
    else:
        t_sec = bp_plot["t_sec"]
        for i, band in enumerate(BANDS):
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
):
    import matplotlib.pyplot as plt

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
    fig, axes = plt.subplots(len(groups), 1, figsize=(12, fig_h), sharex=True)
    if len(groups) == 1:
        axes = [axes]

    import tzlocal
    local_tz = tzlocal.get_localzone()
    for ax, (name, group_labels) in zip(axes, groups):
        bp_ts, fs = compute_band_power_timeseries_combined(exports, group_labels)
        # Print the time window being plotted (in local time)
        if "timestamp" in bp_ts.columns and not bp_ts["timestamp"].empty:
            ts_local = to_local_datetime_index(bp_ts["timestamp"])
            print(f"Band power plot window for {name}: {ts_local.min().strftime('%Y-%m-%d %H:%M:%S %Z')} to {ts_local.max().strftime('%Y-%m-%d %H:%M:%S %Z')}")
        plot_band_power_diagram(
            bp_ts,
            title=f"Band power — {name}" + (" (relative)" if relative else " (absolute)"),
            avg_sec=avg_sec,
            relative=relative,
            fs=fs,
            ax=ax,
        )

    handles, labels_legend = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels_legend, ncol=5, fontsize=9, loc="upper center", bbox_to_anchor=(0.5, 1.01))
    # Show local time range at the bottom
    captured_at = pd.to_datetime(diag_df["captured_at"], errors="coerce", utc=True)
    if captured_at.notna().any():
        min_ts = captured_at.min().tz_convert(local_tz).strftime('%Y-%m-%d %H:%M:%S %Z')
        max_ts = captured_at.max().tz_convert(local_tz).strftime('%Y-%m-%d %H:%M:%S %Z')
        fig.text(0.5, 0.01, f"Data captured from {min_ts} to {max_ts}", ha='center', va='bottom', fontsize=8, color='gray')

    plt.tight_layout(rect=[0, 0.03, 1, 1])
    if show:
        plt.show()
        plt.close(fig)

    return fig if return_fig else None