# DEMO_RUNBOOK

## Goal

Deliver a reliable 3-scene live demo in under 3 minutes that proves `native` is not just translation, but **local risk-aware guidance**.

## Pre-demo checklist (2 minutes)

1. Confirm Wi-Fi and Gemini API key are active.
2. Open app and click `Start`.
3. Validate mic and camera permissions are granted.
4. Confirm `Risk Guard` is `On`.
5. Keep backup Kannada announcement audio clip ready.

## Scene sequence

## Scene A: Form Help (Guide) - ~60 seconds

1. Select preset `Scene A: Form Help`.
2. Confirm state:
   - Mode = `Guide`
   - Search = `On`
   - Vision = `On`
3. Point camera at form.
4. Say: `Yeh form kaise bharein? Mujhe kya chahiye?`
5. Expected output:
   - Hindi explanation with Step 1 / Step 2 / Step 3
   - Misinformation risk cue if contradictory process language appears

Risk moment to call out:
- `native` can flag suspicious process instructions and suggest official verification.

Fallback:
- If camera OCR is weak, open form on screen and switch source to `Screen`.

## Scene B: Announcement (Echo) - ~45 seconds

1. Select preset `Scene B: Announcement`.
2. Confirm state:
   - Mode = `Echo`
   - Vision = `Off`
3. Play Kannada announcement (or teammate speaks live).
4. Expected output:
   - Hindi translation only
   - Urgency risk cue if fine/penalty/deadline language is detected

Risk moment to call out:
- `native` extracts urgency and gives one immediate action.

Fallback:
- Use pre-recorded backup clip if live speech is unclear.

## Scene C: Conversation (Bridge) - ~60 seconds

1. Select preset `Scene C: Conversation`.
2. Confirm state:
   - Mode = `Bridge`
   - Pair = Hindi <-> Kannada
3. Person A speaks Hindi, Person B replies Kannada.
4. Expected output:
   - Bidirectional translation with minimal delay
   - Price risk cue when overcharge-like phrases are detected

Risk moment to call out:
- `native` can catch possible rip-off language during negotiation.

Fallback:
- Keep scripted short dialogue and repeat slowly with short sentences.

## Operator controls during failures

- Session drop: press `Retry Session`.
- Mic blocked: enable permission in browser settings, then toggle mic on.
- Vision blocked: switch to screen source if camera permission fails.

## Suggested short dialogue for Scene C

- Hindi: `Auto ka kitna loge Majestic tak?`
- Kannada: `1500 rupayi kodi, traffic ide.`
- Hindi: `Itna zyada kyu? Meter se chalo.`
- Kannada: `Sari, meter haakona.`

## Judging one-liner

`native` is a realtime multilingual local risk guard: it sees, hears, translates, and warns users what to do next.
