# Design

## Overview
- React single-page app that connects to a Muse EEG headband via `muse-js`, processes streaming EEG in-browser, and visualizes band power and training status.
- Core domains: device IO (connect, stream, channel map), signal processing (periodograms and band powers), visualization (EEG traces, power charts, regional comparisons), and training/feedback (currently stubs ready for extension).
- Architecture diagram lives in `docs/architecture.md`; this document expands component responsibilities and data contracts.

## Data Flow
- Device connection: `DeviceControl` owns EEG sampling lifecycle. It instructs `MuseData` to connect, starts the stream, and collects channel metadata (`["TP9","AF7","AF8","TP10","AUXL","AUXR"]` today).
- Sampling pipeline: `MuseData` publishes `{ electrode, samples[] }` objects; `DeviceControl` appends samples to a rolling buffer per electrode (trimmed to ~4096 samples).
- Periodogram generation: once channel maps are known, `DeviceControl` runs a 1-second interval that slices the latest 1024 samples per electrode, computes a periodogram, maintains a short history (last 4), and produces an averaged periodogram for stability.
- Processing consumption: `BandPower` receives the full electrode array (with `averagedPeriodogram` if available) and calculates band metrics; `App` can reuse the same data for other visualizations.
- Rendering: `EEGChannels`/`EEGChannel` expose toggles for raw traces and periodograms; `BandPower` renders per-electrode and relative/aggregate charts; `BrainView`, `TrainingView`, and `TrainingControl` are placeholders for richer training feedback.

## Data Shapes
- EEG sample: `{ electrode: number, samples: number[] }` as emitted by `muse-js`.
- Channel map: `["TP9","AF7","AF8","TP10","AUXL","AUXR"]` (Muse ordering), stored alongside channel indices for UI labels.
- Periodogram: `{ frequencies: number[], magnitudes: number[] }` produced by `math/Periodogram.js` helpers (`calcPeriodogram`, `averagedPeriodogram`).
- Band power: `{ [bandName]: { absolute: number, relative: number } }` with bands defined by transitions `[0.5–4, 4–8, 8–12, 12–30, 30+ Hz]`.
- Aggregates: `BandPower` computes left/right/front/back collections when electrode metadata is available and derives relative differences (e.g., `left-right.theta`).

## Component Responsibilities
- `App`: top-level composition; holds EEG data state and passes update callbacks into children.
- `DeviceControl`: lifecycle of channel buffers, periodic processing, and optional live EEG inspection; delegates hardware IO to `MuseData`.
- `MuseData`: Web Bluetooth handshake via `muse-js`; subscribes to EEG readings and forwards them upstream; manages connection status UI.
- `EEGChannels`/`EEGChannel`: per-electrode inspection with toggles for raw signal and periodogram history rendering.
- `BandPower`: transforms averaged periodograms into band power metrics, computes regional comparisons, and surfaces them via charts.
- `TrainingView` / `TrainingControl`: shells for selecting training modes and presenting feedback; currently minimal but serve as integration points for operant conditioning logic.
- `BrainView`: placeholder for spatial/regional visualization of band power and synchrony.

## Processing Details
- Windows: 1024-sample FFT windows with the last 4 periodograms averaged for smoothing; channel buffers capped to avoid memory growth.
- Bands: delta/theta/alpha/beta/gamma boundaries are configurable in code; design allows exposing these as user settings later.
- Update cadence: processing interval set to ~1 second; UI toggles prevent unnecessary rendering when charts are hidden.
- Performance: heavy calculations are isolated from rendering; future optimizations include moving FFT work to Web Workers if UI drops frames.

## Training & Feedback Direction
- Inputs: selected band targets (absolute or relative), channel/region focus, sensitivity thresholds, and feedback modality (audio/visual).
- Logic: evaluate band power streams against targets on the same cadence as processing, emit events when entering/leaving target zones, and debounce to avoid flicker.
- Outputs: drive `TrainingView` visuals or trigger sounds; log milestone events for session review.
- Extensibility: encapsulate training strategies as pluggable modules so new reward rules can be added without touching device/processing code.

## Logging & Observability
- Minimum: connection state changes, processing errors, and training events; optional session summary (min/avg/max per band and ratio trends).
- Storage: start with in-memory/session export (download JSON/CSV); future: toggle to persist to browser storage with retention limits.
- Telemetry hooks: guard math utilities with tests; add console-warn on missing channels or insufficient samples.

## Failure Handling
- Connection issues: surface status, allow retry, and avoid crashing if Bluetooth is unavailable; expose a simulated source for development if desired.
- Data gaps: skip processing when a channel lacks enough samples; keep prior averages instead of emitting empty data to charts.
- UI resilience: clear intervals on unmount/toggle; avoid state updates after unmount via defensive cleanup in hooks.

## Future Considerations
- Multi-device support and dynamic channel maps.
- User-facing configuration UI for band boundaries, window sizes, and aggregation regions.
- Background/offline training with recorded sessions.
- Accessibility: keyboard navigation for controls and WCAG-friendly color choices in charts.
