# AI_IDE_HANDOFF

Use this file to continue development in another AI IDE quickly.

## Working Agreement For Next Agent

1. Keep mode names fixed: Spot, Echo, Guide, Bridge.
2. Keep demo strategy reliability-first (3 scenes, not feature bloat).
3. Keep bridge pair default as Hindi <-> Kannada.
4. Do not remove safety constraints around medical/legal diagnosis.
5. Do not commit `.env`.

## Copy-Paste Prompt 1 (Demo Stability Sweep)

```text
You are working on /Users/divyamjindal/Desktop/zucks/deepmind hackathon/native.
Stabilize the 3 demo scenes without changing product scope:
- Scene A (Guide)
- Scene B (Echo)
- Scene C (Bridge Hindi<->Kannada)
Tasks:
1) Ensure each preset sets all required toggles deterministically.
2) Prevent stale state during rapid preset switching.
3) Improve retry/session error UX if reconnect fails.
4) Keep existing safety guardrails intact.
Run npm run build and CI=true npm test -- --watch=false and fix any issues.
```

## Copy-Paste Prompt 2 (Submission Finalization)

```text
You are working on /Users/divyamjindal/Desktop/zucks/deepmind hackathon/native.
Finalize hackathon submission docs and checklist:
1) Update docs/SUBMISSION.md with final video URL and exact final pitch lines.
2) Add a final pre-submit checklist with checkboxes for repo/video/form.
3) Ensure README links to all docs and handover files.
Do not alter core app behavior.
```

## Copy-Paste Prompt 3 (Judge Pitch Script Polish)

```text
You are working on /Users/divyamjindal/Desktop/zucks/deepmind hackathon/native.
Create concise final scripts in docs/:
1) 3-minute live judging script (40s context, 2m demo, 20s close).
2) 1-minute video narration script (15s problem, 35s product, 10s impact).
3) Q/A sheet with strong answers for differentiation and technical depth.
Keep language direct and high confidence.
```

## Quick File Map

- Main behavior: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/src/App.tsx`
- Styling: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/src/App.scss`
- Demo runbook: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/DEMO_RUNBOOK.md`
- Submission doc: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/docs/SUBMISSION.md`
- Compliance doc: `/Users/divyamjindal/Desktop/zucks/deepmind hackathon/native/HACKATHON_COMPLIANCE.md`

## Final Acceptance Checklist

- [ ] App runs at `http://localhost:3000`.
- [ ] `npm run build` passes.
- [ ] `CI=true npm test -- --watch=false` passes.
- [ ] 3 scene presets work back-to-back without manual state repair.
- [ ] Submission doc includes final video URL.
- [ ] `.env` is not staged.
