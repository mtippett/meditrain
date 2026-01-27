# Requirements

## Scope
- Web application that connects to a Muse EEG headband, streams real-time EEG, and helps users train toward target brain states through band power awareness and operant conditioning.
- Primary users: meditators and researchers who want live feedback on EEG band ratios; secondary users: developers extending hardware support or training strategies.

## Functional Requirements
- Device connectivity: initiate and manage Bluetooth connection to Muse; expose connect/disconnect states; enable AUX electrodes; surface available channel map to the app.
- Data acquisition: subscribe to EEG stream per electrode; keep a rolling buffer of recent samples (current code keeps ~4096); allow optional raw-signal inspection per channel.
- Signal processing: compute periodograms over recent windows (~1024 samples) at ~1 Hz; maintain a short history and averaged periodogram per electrode.
- Artifact detection: compute amplitude and line-noise artifacts over rolling windows; surface rejection windows in the UI.
- Band power analytics: calculate absolute and relative power for standard bands (delta, theta, alpha, beta, gamma); derive per-target ratios (e.g., theta/beta).
- Visualization: toggle views for raw EEG traces, per-channel periodograms, band power history, and spectrograms; keep UI responsive while processing.
- Training & feedback: provide training view and controls for selecting targets (band thresholds/ratios), per-target sensitivity adjustments, and audio feedback attenuation when targets are met.
- Heart observatory: render PPG traces, cardiogram slices, and heart rate trends when PPG channels are available.
- Logging & archiving: record session metadata (device info, channel map, timestamps), training events, band power trends, and optional raw/processed EEG for later analysis; support export with training metadata sidecars.
- Export format: session exports must use BrainVision EEG plus BIDS-compatible sidecars (`.vhdr/.eeg/.vmrk`, `*_eeg.json`, `*_channels.tsv`); include PPG TSV/sidecar when available.
- Configuration: allow users to tune processing parameters (window size, band cutoffs), visualization cadence, artifact thresholds, and training thresholds; persist reasonable defaults.
- Resilience: detect stream dropouts or device disconnects; surface status to the user and attempt clean recovery without data corruption; reuse last good data on rejected windows.
- Device Debugging: expose a unified, ordered message stream for connection logic, state changes, and reconnect attempts to facilitate troubleshooting.

### Connection Lifecycle & Recovery
1. **Idle / Disconnected**: 
   - Initial state or after explicit disconnect.
   - If a "known device" (previously paired) is detected on mount, an **automatic silent reconnect** is attempted once.
   - If silent reconnect fails (device off/out of range), the app remains in Idle state (no popup).
2. **Connecting**:
   - Transient state during GATT negotiation.
   - User can initiate a "Connect" / "Pair New" which forces the browser picker (`requestDevice`) and must be triggered by a user gesture.
   - User can initiate a "Reconnect" (known device) which is **silent only** (no popup) and uses `getDevices()` + silent GATT.
   - Silent reconnect attempts:
     - Watch advertisements with a 10-second timeout when supported.
     - Attempt silent GATT even if no advertisement is observed.
     - Retry up to 3 times with ~2 seconds backoff.
     - Use a ~12 second timeout around GATT connect attempts.
3. **Connected (Streaming)**:
   - Device is paired, GATT connected, and data is flowing.
   - Status indicator shows "Connected".
4. **Stale / Reconnecting**:
   - A grace period (~15 seconds) is applied after connection to avoid premature stale detection.
   - If no EEG data is received for ~8 seconds (current `STREAM_STALE_MS`), enter "Stale" state.
   - On stale data, trigger an **automatic silent reconnect** attempt that clears existing client state first.
   - If reconnect fails, log detailed debug steps and respect reconnect cooldown/backoff behavior.
   - If connection is lost (GATT disconnect event), trigger silent reconnect unless the user explicitly disconnected.
5. **Disconnecting**:
   - User-initiated action.
   - Clears "known device" preference for auto-connect? (Optional: No, just stop current session).
   - Stops all automatic reconnect attempts.

- Demo/offline mode (optional): simulate EEG input for development and onboarding when hardware is unavailable.

## Non-Functional Requirements
- Latency: end-to-end updates (acquire → process → render) should stay under ~1–2 seconds to feel real-time.
- Accuracy: periodogram and band calculations should be numerically stable and reproducible given the same input; document assumptions about sampling rate and filtering.
- Reliability: avoid unbounded memory growth by trimming buffers/histories; guard against crashes from missing channels or malformed data.
- UX/accessibility: controls and status should be clear; keyboard operable where reasonable; avoid blocking the main thread during heavy computation.
- Security & privacy: keep EEG data local in the browser by default; obtain consent before exporting logs; avoid leaking device identifiers.
- Maintainability: modular React components for device IO, processing, visualization, and training; add unit tests around math utilities and reducers as features solidify.
- Quality tooling: use ESLint for linting (run `npx eslint src`).
- Quality tooling: run `npx eslint src` after changes and report the result.
- Notebook quality: rerun the `notebooks/eeg_processing.ipynb` notebook to completion before considering work finished.
- Compatibility: support modern Chromium-based browsers; graceful degradation when Web Bluetooth is unavailable.

## Development Patterns (Expected)
- Route raw IO through `DeviceControl`/`MuseData` and keep signal processing in the `App`-owned hooks.
- Implement rolling windows via refs and explicit sample-rate conversions; trim buffers to prevent growth.
- Prefer shared chart components for line/time-series visuals; reserve bespoke SVG charts for trace/overlay use-cases.
- Keep data contracts consistent with `docs/design.md`; update documentation when contracts or processing windows change.

## Constraints & Assumptions
- Muse headband is the primary supported device; sample rate and channel ordering follow `muse-js`.
- Browser environment with Web Bluetooth enabled; no backend services are required for core functionality.
- Training logic and feedback channels are still evolving; initial implementations may be basic and expanded iteratively.

## Open Questions
- Which training targets and feedback modalities are highest priority (audio tones, visuals, haptics)?
- What retention policy is acceptable for storing raw EEG versus aggregated metrics?
- Should users be able to export/import processing presets and training plans?
