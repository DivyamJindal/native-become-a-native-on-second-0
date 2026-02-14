# HANDOVER

This file is the operational handover for continuing `native` in another AI IDE.

## Project Snapshot

- Project: `native`
- Purpose: India-first realtime app to help people become local anywhere.
- Hackathon: Gemini 3 Bengaluru Hackathon (Saturday, February 14, 2026)
- Current branch: `main`
- Primary repo: `origin` -> `https://github.com/DivyamJindal/native-deepmind-hackathon.git`
- Starter upstream: `upstream` -> `https://github.com/google-gemini/live-api-web-console.git`

## What Is Already Implemented

1. Four working modes:
   - `Spot` (camera-first reading)
   - `Echo` (ambient translation)
   - `Guide` (camera + question + search grounding)
   - `Bridge` (bidirectional interpretation)
2. User toggles:
   - session
   - mic
   - vision (camera/screen)
   - search
3. Deterministic demo presets:
   - Scene A: Form Help (Guide)
   - Scene B: Announcement (Echo)
   - Scene C: Conversation (Bridge Hindi <-> Kannada)
4. Reliability features:
   - permission status indicators
   - reconnect flow + retry button
   - session error visibility
5. Safety prompt constraints:
   - no medical/legal diagnosis output
   - explain official instructions only
6. Hackathon documentation:
   - compliance file
   - demo runbook
   - submission guide

## Core Files To Know First

- Main app logic: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/src/App.tsx`
- Main styling: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/src/App.scss`
- Live client event handling: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/src/lib/genai-live-client.ts`
- Live hook defaults: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/src/hooks/use-live-api.ts`
- Compliance: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/HACKATHON_COMPLIANCE.md`
- Demo flow: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/DEMO_RUNBOOK.md`
- Submission prep: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/SUBMISSION.md`

## Environment Setup

Add to `.env`:

```bash
REACT_APP_GEMINI_API_KEY=your_api_key
# Optional:
# REACT_APP_GEMINI_MODEL=models/gemini-2.5-flash-native-audio-preview-12-2025
# REACT_APP_DEFAULT_SOURCE_LANG=kn-IN
# REACT_APP_DEFAULT_TARGET_LANG=hi-IN
```

## Verify App Locally

```bash
npm install
npm start
```

Local URL:

- `http://localhost:3000`

Build/test checks:

```bash
npm run build
CI=true npm test -- --watch=false
```

## Remaining Work (High Priority)

1. Fill final demo video link in:
   - `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/SUBMISSION.md`
2. Run full rehearsal cycle:
   - 3 full live runs
   - 1 fallback run with backup audio/retry flow
3. Final submission form completion before deadline.
4. Optional polish for judging:
   - minor UI text polish
   - reduce verbosity in Bridge outputs if needed

## Known Non-Blocking Warnings

1. CRA/Webpack deprecation warnings during `npm start`.
2. Browserslist data update warning.
3. React test-utils warning in unit tests.

These do not currently block build or demo.

## Safety and Privacy Notes

1. Do not commit `.env`.
2. Do not expose API keys in docs or logs.
3. Keep open-source licensing and attribution intact.

## Next AI IDE Entry Point

Start with:

- `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/AI_IDE_HANDOFF.md`

It contains copy-paste task prompts and acceptance checks.
