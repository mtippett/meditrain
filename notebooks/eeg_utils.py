from __future__ import annotations

# EEG-focused facade over the existing notebook utilities.

from eeg_processing_utils import (  # noqa: F401
    BANDS,
    compute_spectrogram_psd,
    compute_band_power_timeseries,
    compute_band_power_timeseries_for_label,
    compute_band_power_timeseries_combined,
    plot_artifact_overlays_and_metrics,
    plot_band_power_diagram,
    plot_band_power_diagrams,
    plot_raw_traces_per_label,
    plot_spectrograms_per_label,
)
