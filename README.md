# native

`native` is an India-first realtime multimodal app built for Gemini 3 Bengaluru Hackathon (Saturday, February 14, 2026).

The app helps people become locals faster in unfamiliar places by combining what they see, hear, and ask in one live experience.

## Hackathon provenance

- Built during event hours for Gemini 3 Bengaluru Hackathon.
- Based on the official Google Gemini Live web starter as a foundation.
- This repository contains only open-source code and assets.

## Features

- `Spot` mode: camera-first live reading and translation.
- `Echo` mode: ambient speech translation with translation-only output behavior.
- `Guide` mode: camera + voice + Google Search grounding with stepwise outputs.
- `Bridge` mode: bidirectional live interpretation (primary demo pair Hindi <-> Kannada).
- User toggles for every core feature: session, mic, vision input, search, and mode.
- Deterministic 3-scene demo presets with in-app script hints.
- Live transcript panel with input and output transcription.
- Reliability states for permission issues, reconnect flow, and retry action.

## Language coverage (current UI)

- Hindi (`hi-IN`)
- Kannada (`kn-IN`)
- English (`en-IN`)
- Bengali (`bn-IN`)
- Marathi (`mr-IN`)
- Tamil (`ta-IN`)
- Telugu (`te-IN`)

## Quick start

1. Create `.env` in project root:

```bash
REACT_APP_GEMINI_API_KEY=your_api_key

# Optional model override
# REACT_APP_GEMINI_MODEL=models/gemini-2.5-flash-native-audio-preview-12-2025

# Optional default language pair for startup
# REACT_APP_DEFAULT_SOURCE_LANG=kn-IN
# REACT_APP_DEFAULT_TARGET_LANG=hi-IN
```

2. Install and run:

```bash
npm install
npm start
```

3. Open [http://localhost:3000](http://localhost:3000)

## Reliability and safety defaults

- Search grounding is only enabled in `Guide` mode.
- Mode/language/voice/preset changes auto-refresh the live session.
- Prompt safety constraints block diagnosis-style medical/legal advice.
- App behavior focuses on translation and explanation of official instructions.

## Project docs

- `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/HACKATHON_COMPLIANCE.md`
- `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/HANDOVER.md`
- `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/DEMO_RUNBOOK.md`
- `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/SUBMISSION.md`
- `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/AI_IDE_HANDOFF.md`
