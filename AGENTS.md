# Agent Guide

## Purpose
This project has domain documentation that should guide your responses and edits. Use the files below as primary references before making changes or answering high-level questions.

## Key References
- `README.md`: high-level product summary and run instructions.
- `docs/architecture.md`: mermaid overview of major modules; links out to design/requirements.
- `docs/design.md`: component responsibilities, data flow, and processing details (EEG sampling, periodograms, band power computation).
- `docs/requirements.md`: functional and non-functional requirements, constraints, and open questions.

## How to Work
1) Before planning changes or answering design questions, skim `docs/design.md` and `docs/requirements.md` so your answers align with current intent.
2) When touching data flow or processing, keep `DeviceControl`, `MuseData`, and `BandPower` contracts consistent with the definitions in `docs/design.md`.
3) If you propose new features (training targets, logging, simulation), check the open questions in `docs/requirements.md` and call out any assumptions.
4) When updating documentation, keep the three docs in sync: architecture diagram → design narrative → requirements.
5) Avoid destructive git operations; do not revert user changes unless explicitly instructed.
