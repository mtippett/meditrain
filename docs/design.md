# Design

## Overview
- React single-page app that connects to a Muse EEG headband via `muse-js`, processes streaming EEG and PPG in-browser, and visualizes band power, artifacts, and training feedback.
- Core domains: device IO (connect, stream, channel map, capture/export), signal processing (periodograms, artifacts, band power), visualization (EEG traces, power charts, spectrograms, PPG), and training/feedback (targets, sensitivity, audio cues).
- Architecture diagram lives in `docs/architecture.md`; this document expands component responsibilities and data contracts.

## Data Flow
- Device connection: `DeviceControl` owns EEG/PPG sampling lifecycle. It instructs `MuseData` to connect, starts the stream, and collects channel metadata (`["TP9","AF7","AF8","TP10","AUXL","AUXR"]` today).
- Sampling pipeline: `MuseData` publishes `{ electrode, samples[] }` objects; `DeviceControl` appends samples to a rolling buffer per electrode (trimmed to ~4096 samples).
- Periodogram generation: `DeviceControl` runs a 1-second interval that slices the latest 1024 samples per electrode, computes a periodogram, maintains a short history (last 4), and produces an averaged periodogram for stability.
- Artifact detection: `DeviceControl` computes amplitude/line-noise artifacts over rolling windows and publishes artifact windows + latest flags.
- Band snapshots: `App` builds band power snapshots from periodograms, skips artifacted windows, and reuses the last good snapshot during rejection.
- Training feedback: `App` evaluates targets (relative bands or ratios), tracks per-target sensitivity, and drives audio feedback attenuation.
- Rendering: `EEGChannels`/`EEGChannel` show traces and periodograms; `BandPower` charts relative power history; `Spectrogram` and `BandPeriodograms` expose FFT views; `TrainingControl` lists targets and history; `TrainingView` provides live feedback; PPG is charted in the Heart Observatory.

## Data Shapes
- EEG sample: `{ electrode: number, samples: number[] }` as emitted by `muse-js`.
- Channel map: `["TP9","AF7","AF8","TP10","AUXL","AUXR"]` (Muse ordering), stored alongside channel indices for UI labels.
- Periodogram: `{ frequencies: number[], magnitudes: number[] }` produced by `math/Periodogram.js` helpers (`calcPeriodogram`, `averagedPeriodogram`).
- Artifact window: `{ tStart, tEnd, amplitudeArtifact, lineNoiseArtifact }` (stored per electrode).
- Band snapshot: `{ label, bands, timestamp }` where `bands` is `{ [bandName]: { absolute, relative } }` and bands use `[0.5–4, 4–8, 8–12, 12–30, 30+ Hz]`.
- Training target: `{ id, label, model, band|numeratorBand|denominatorBand, target, tolerance }` with `model` = `relative` or `ratio`.
- Target metric: `{ sensitivity, effectiveTolerance, inZone }` derived per target.
- PPG: `{ label, samples: number[] }` with a combined trace and derived heart rate history.

## Component Responsibilities
- `App`: top-level composition; holds EEG data state and passes update callbacks into children.
- `DeviceControl`: lifecycle of channel buffers, periodic FFT processing, artifact detection, capture/export; delegates hardware IO to `MuseData`.
- `MuseData`: Web Bluetooth handshake via `muse-js`; subscribes to EEG/PPG readings and forwards them upstream; manages connection status UI.
- `EEGChannels`/`EEGChannel`: per-electrode inspection with toggles for raw signal and periodogram history rendering.
- `BandPower`: renders per-electrode band power history with target overlays.
- `BandPeriodograms`: renders averaged periodograms over time for selected channels.
- `Spectrogram`: renders time-frequency spectrograms from recent windows.
- `TrainingControl`: CRUD for targets, presets, target history sparklines, and audio toggle.
- `TrainingView`: live summary of target adherence and sensitivity.
- `Heart Observatory`: combined PPG trace, cardiogram slices, and heart rate trend charts.

## Processing Details
- Windows: 1024-sample FFT windows with the last 4 periodograms averaged for smoothing; channel buffers capped to avoid memory growth.
- Artifacts: amplitude range and line-noise ratio windows are computed on rolling slices; artifact windows are stored for diagnostics and overlays.
- Bands: delta/theta/alpha/beta/gamma boundaries are configurable in code; design allows exposing these as user settings later.
- Update cadence: processing interval set to ~1 second; UI toggles prevent unnecessary rendering when charts are hidden.
- Performance: heavy calculations are isolated from rendering; future optimizations include moving FFT work to Web Workers if UI drops frames.

## Training & Feedback Direction
- Inputs: selected targets (relative band power or ratios), channel/region focus, sensitivity thresholds, and audio feedback toggles.
- Logic: evaluate band power streams against targets, track per-target sensitivity (adjusted tolerance), and adapt audio feedback intensity to distance from target.
- Outputs: drive `TrainingView` visuals, draw target history overlays, and drive white-noise feedback gain.
- Extensibility: encapsulate training strategies as pluggable modules so new reward rules can be added without touching device/processing code.

## Logging & Observability
- Minimum: connection state changes, processing errors, and training events; optional session summary (min/avg/max per band and ratio trends).
- Storage: exports include EEG TSV/JSON sidecars plus training targets/metrics/history and config; optional PPG export when present.
- Telemetry hooks: guard math utilities with tests; add console-warn on missing channels or insufficient samples.

## Failure Handling
- Connection issues: surface status, allow retry, and avoid crashing if Bluetooth is unavailable; expose a simulated source for development if desired.
- Data gaps: skip processing when a channel lacks enough samples; keep prior averages instead of emitting empty data to charts.
- Artifacts: reuse last good snapshots when current window is rejected to avoid flicker.
- UI resilience: clear intervals on unmount/toggle; avoid state updates after unmount via defensive cleanup in hooks.

## Future Considerations
- Multi-device support and dynamic channel maps.
- User-facing configuration UI for band boundaries, window sizes, and aggregation regions.
- Background/offline training with recorded sessions.
- Accessibility: keyboard navigation for controls and WCAG-friendly color choices in charts.
