# BLIND_MODE_ROADMAP

## Status

- Feature flag hook exists in app architecture.
- Blind Mode is **not enabled** in production path yet.

## Objective

Design a voice-first experience for users with low/no vision where `native` can continuously interpret surroundings, conversations, and potential exploitation risk.

## Planned Modules

## 1) Surroundings Scanner

- Inputs: camera frames + ambient audio.
- Output: concise spatial/environment narration.
- Expected behavior:
  - identify entrances/exits/queues/counters
  - announce obstacles and directional cues
  - summarize scene changes without spam

## 2) Conversation Risk Interpreter

- Inputs: live conversation transcription.
- Output: confidence-scored safety cues.
- Risk categories:
  - rip-off/overcharge cues
  - misleading process cues
  - pressure/urgency cues

## 3) Safe Movement Guidance

- Inputs: surroundings + user intent.
- Output: short movement instructions.
- Examples:
  - `two steps left, queue ahead`
  - `counter is 4 meters in front`
  - `pause, moving vehicle nearby`

## 4) Rip-off Protection Narration

- Inputs: price mentions, requests for cash, contradictory instructions.
- Output: one-line recommended action.
- Examples:
  - `ask for printed rate card`
  - `verify with official desk`
  - `do not hand over originals yet`

## Architecture Hooks Already Added

- `FEATURE_FLAGS.blindMode` in app logic.
- Future-facing interfaces:
  - `BlindInsight`
  - `NavigationCue`
  - `ConversationSafetyCue`

## Proposed Future Interfaces (v2)

- `blindStreamMode`: toggles voice-first narration.
- `blindPace`: controls narration verbosity/rate.
- `blindSafetyThreshold`: controls risk sensitivity.

## Rollout Strategy (future)

1. Private prototype with simulator clips.
2. Controlled user tests with volunteers.
3. Tune latency, confidence thresholds, and narration cadence.
4. Add accessibility QA checklist before public rollout.

## Non-goals for current hackathon build

- No active blind mode UI toggle.
- No production behavior changes yet.
- No additional backend service.
