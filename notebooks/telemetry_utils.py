from __future__ import annotations

# Telemetry/IO facade plus shared telemetry chart helpers.

import pandas as pd

import chart_utils as charts
from eeg_processing_utils import (  # noqa: F401
    channel_timebase,
    list_ppg_files,
    list_sample_files,
    load_brainvision_export,
    load_ppg_export,
    load_ppg_exports,
    load_sample_export,
    load_sample_exports,
)


def _iter_sidecars(exports_or_sidecar):
  if isinstance(exports_or_sidecar, list):
    for exp in exports_or_sidecar:
      if not isinstance(exp, dict):
        continue
      yield exp.get("_sidecar") or {}
  elif isinstance(exports_or_sidecar, dict):
    yield exports_or_sidecar


def extract_telemetry_history(exports_or_sidecar) -> pd.DataFrame:
  rows = []
  for sidecar in _iter_sidecars(exports_or_sidecar):
    telemetry_hist = sidecar.get("TelemetryHistory", {}) if isinstance(sidecar, dict) else {}
    for item in telemetry_hist.get("battery", []) or []:
      if item.get("t") is not None and item.get("v") is not None:
        rows.append({"t": item["t"], "v": item["v"], "metric": "battery"})
    for item in telemetry_hist.get("temperature", []) or []:
      if item.get("t") is not None and item.get("v") is not None:
        rows.append({"t": item["t"], "v": item["v"], "metric": "temperature"})
  if not rows:
    return pd.DataFrame(columns=["t", "v", "metric", "timestamp", "ts_local"])
  df = pd.DataFrame(rows)
  df["timestamp"] = pd.to_datetime(df["t"], unit="ms", utc=True)
  df["ts_local"] = charts.to_local_datetime_index(df["timestamp"])
  return df.sort_values("timestamp").drop_duplicates(subset=["t", "metric"], keep="last")


def plot_telemetry_history(telemetry_df: pd.DataFrame, *, fig_width: float = 12):
  import matplotlib.pyplot as plt

  if telemetry_df is None or telemetry_df.empty:
    print("No telemetry history found in exports.")
    return

  fig, axes = plt.subplots(2, 1, figsize=(fig_width, 6), sharex=True, constrained_layout=True)
  metrics = ["battery", "temperature"]
  colors = {"battery": "#22c55e", "temperature": "#f97316"}

  t_min = telemetry_df["ts_local"].min()
  t_max = telemetry_df["ts_local"].max()

  tick_count = 4
  tick_positions = [t_min + (t_max - t_min) * (i / tick_count) for i in range(tick_count + 1)]
  tick_labels = [t.strftime("%Y-%m-%d %H:%M:%S") for t in tick_positions]

  for ax, metric in zip(axes, metrics):
    subset = telemetry_df[telemetry_df["metric"] == metric].sort_values("ts_local")
    if subset.empty:
      ax.text(0.01, 0.5, f"No {metric} telemetry", transform=ax.transAxes, va="center", ha="left", color="gray")
      ax.set_ylabel(metric.capitalize())
      continue
    ax.plot(subset["ts_local"], subset["v"], color=colors[metric], linewidth=1.6)
    ax.set_ylabel("Battery (%)" if metric == "battery" else "Temp (°C)")
    ax.grid(alpha=0.2)
    charts._format_time_axis(ax, x_min=t_min, x_max=t_max)

  axes[-1].set_xticks(tick_positions)
  axes[-1].set_xticklabels(tick_labels)
  axes[-1].set_xlabel("Local Date/Time")
  fig.autofmt_xdate()
  plt.show()


def extract_motion_history(exports_or_sidecar) -> pd.DataFrame:
  rows = []

  def _add_rows(hist: dict, sensor: str):
    for axis in ("x", "y", "z"):
      for item in (hist.get(axis, []) or []):
        if item.get("t") is None or item.get("v") is None:
          continue
        rows.append({"t": item["t"], "v": item["v"], "sensor": sensor, "axis": axis})

  for sidecar in _iter_sidecars(exports_or_sidecar):
    accel_hist = sidecar.get("AccelerometerHistory", {}) if isinstance(sidecar, dict) else {}
    gyro_hist = sidecar.get("GyroscopeHistory", {}) if isinstance(sidecar, dict) else {}
    _add_rows(accel_hist, "accel")
    _add_rows(gyro_hist, "gyro")

  if not rows:
    return pd.DataFrame(columns=["t", "v", "sensor", "axis", "timestamp", "ts_local"])

  df = pd.DataFrame(rows)
  df["timestamp"] = pd.to_datetime(df["t"], unit="ms", utc=True)
  df["ts_local"] = charts.to_local_datetime_index(df["timestamp"])
  return df.sort_values("timestamp").drop_duplicates(subset=["t", "sensor", "axis"], keep="last")


def plot_motion_history(motion_df: pd.DataFrame, *, fig_width: float = 12):
  import matplotlib.pyplot as plt

  if motion_df is None or motion_df.empty:
    print("No accelerometer/gyroscope history found in exports.")
    return

  fig, axes = plt.subplots(2, 1, figsize=(fig_width, 6), sharex=True, constrained_layout=True)
  sensors = ["accel", "gyro"]
  axis_colors = {"x": "#60a5fa", "y": "#34d399", "z": "#f97316"}

  t_min = motion_df["ts_local"].min()
  t_max = motion_df["ts_local"].max()
  tick_count = 4
  tick_positions = [t_min + (t_max - t_min) * (i / tick_count) for i in range(tick_count + 1)]
  rel_labels = []
  for t in tick_positions:
    remaining = max(0, int((t_max - t).total_seconds()))
    rel_labels.append("now" if remaining == 0 else f"-{remaining}s")

  for ax, sensor in zip(axes, sensors):
    subset = motion_df[motion_df["sensor"] == sensor].sort_values("ts_local")
    if subset.empty:
      ax.text(0.01, 0.5, f"No {sensor} telemetry", transform=ax.transAxes, va="center", ha="left", color="gray")
      ax.set_ylabel(sensor.capitalize())
      continue
    for axis in ("x", "y", "z"):
      axis_df = subset[subset["axis"] == axis]
      if axis_df.empty:
        continue
      ax.plot(axis_df["ts_local"], axis_df["v"], color=axis_colors[axis], linewidth=1.4, label=axis.upper())
    ax.set_ylabel("Accel (g)" if sensor == "accel" else "Gyro (deg/s)")
    ax.grid(alpha=0.2)
    charts._format_time_axis(ax, x_min=t_min, x_max=t_max)
    ax.legend(loc="upper right", frameon=False)

  axes[-1].set_xticks(tick_positions)
  axes[-1].set_xticklabels(rel_labels)
  axes[-1].set_xlabel("Time (relative)")
  fig.autofmt_xdate()
  plt.show()
