# Requirements

## Scope
- Web application that connects to a Muse EEG headband, streams real-time EEG, and helps users train toward target brain states through band power awareness and operant conditioning.
- Primary users: meditators and researchers who want live feedback on EEG band ratios; secondary users: developers extending hardware support or training strategies.

## Functional Requirements
- Device connectivity: initiate and manage Bluetooth connection to Muse; expose connect/disconnect states; enable AUX electrodes; surface available channel map to the app.
- Data acquisition: subscribe to EEG stream per electrode; keep a rolling buffer of recent samples (current code keeps ~4096); allow optional raw-signal inspection per channel.
- Signal processing: compute periodograms over recent windows (~1024 samples) at ~1 Hz; maintain a short history and averaged periodogram per electrode.
- Band power analytics: calculate absolute and relative power for standard bands (delta, theta, alpha, beta, gamma); derive regional aggregates (left/right, front/back) and comparative ratios (e.g., left-right deltas).
- Visualization: toggle views for raw EEG traces, per-channel periodograms, per-channel band power, and regional/relative band power comparisons; keep UI responsive while processing.
- Training & feedback: provide training view and controls for selecting targets (band thresholds/ratios) and delivering feedback (audio/visual cues) when targets are met.
- Logging & archiving: record session metadata (device info, channel map, timestamps), training events, band power trends, and optional raw/processed EEG for later analysis.
- Configuration: allow users to tune processing parameters (window size, band cutoffs), visualization cadence, and training thresholds; persist reasonable defaults.
- Resilience: detect stream dropouts or device disconnects; surface status to the user and attempt clean recovery without data corruption.
- Demo/offline mode (optional): simulate EEG input for development and onboarding when hardware is unavailable.

## Non-Functional Requirements
- Latency: end-to-end updates (acquire → process → render) should stay under ~1–2 seconds to feel real-time.
- Accuracy: periodogram and band calculations should be numerically stable and reproducible given the same input; document assumptions about sampling rate and filtering.
- Reliability: avoid unbounded memory growth by trimming buffers/histories; guard against crashes from missing channels or malformed data.
- UX/accessibility: controls and status should be clear; keyboard operable where reasonable; avoid blocking the main thread during heavy computation.
- Security & privacy: keep EEG data local in the browser by default; obtain consent before exporting logs; avoid leaking device identifiers.
- Maintainability: modular React components for device IO, processing, visualization, and training; add unit tests around math utilities and reducers as features solidify.
- Compatibility: support modern Chromium-based browsers; graceful degradation when Web Bluetooth is unavailable.

## Constraints & Assumptions
- Muse headband is the primary supported device; sample rate and channel ordering follow `muse-js`.
- Browser environment with Web Bluetooth enabled; no backend services are required for core functionality.
- Training logic and feedback channels are still evolving; initial implementations may be basic and expanded iteratively.

## Open Questions
- Which training targets and feedback modalities are highest priority (audio tones, visuals, haptics)?
- What retention policy is acceptable for storing raw EEG versus aggregated metrics?
- Should users be able to export/import processing presets and training plans?
