# General Overview

Supplementary documents: see `docs/design.md` for component responsibilities and data contracts, and `docs/requirements.md` for functional and non-functional goals.
```mermaid
---
title: Architecture
---
graph TB
    App --> DeviceControl
    App --> BandPower
    App --> BandPeriodograms
    App --> Spectrogram
    App --> TrainingControl
    App --> TrainingView
    App --> HeartObservatory
    App --> ArtifactsPanel
    App --> ExportDownload

    subgraph Device
        DeviceControl --> MuseData
    end

    subgraph Processing
        DeviceControl --> Periodograms
        DeviceControl --> ArtifactDetection
    end

    MuseData -.-> |RawEEG/PPG|DeviceControl
    DeviceControl -.-> |EEG/PPG buffers, periodograms, artifacts|App
    App -.-> |Band snapshots & targets|BandPower
    App -.-> |Target metrics|TrainingView
    App -.-> |Exports|ExportDownload
```

## Key Components & APIs

All components have a visual component unless noted.

### Device
**Device** components abstract and configure the hardware.

The visual components allow for device configuration and connection.

Device configuration is passed up on configuration change.
```json
{
  "deviceType": "<deviceinfo>",
  "locations": ["<location>", "<location>"],
  "sampleRate": "<samplerate>"
}
```

Raw EEG/PPG data is passed up regularly (typically once a second). This data is as raw as
possible; artifact detection happens during processing.
```json
[
  {
    "location": "<location>",
    "eegData": [...]
  }
]
```

### Processing
`DeviceControl` converts raw samples into FFT periodograms and computes artifact windows.
Artifacts are reported per electrode so UI overlays can indicate rejection windows.

### Band Power
`App` derives band snapshots from periodograms and `BandPower` visualizes the results with
target overlays and history.

```json
{
  "label": "<location>",
  "bands": {
    "alpha": { "absolute": 0.0, "relative": 0.0 }
  },
  "timestamp": 0
}
```

### Training
`TrainingControl` manages targets (relative or ratio), and `TrainingView` displays training state.
Audio feedback uses target distance and sensitivity to attenuate output.

```json
{
  "id": "<target-id>",
  "label": "<location|group>",
  "model": "relative|ratio",
  "target": 0.0,
  "tolerance": 0.0
}
```

### Logging/Archiving
Exports include raw EEG/PPG data plus sidecar JSON that captures targets, target history, and
processing configuration for session analysis.
