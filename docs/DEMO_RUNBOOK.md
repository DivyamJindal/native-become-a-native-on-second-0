# DEMO_RUNBOOK

## Goal

Deliver a reliable 3-scene live demo in under 3 minutes for judges.

## Pre-demo checklist (2 minutes)

1. Confirm Wi-Fi and Gemini API key are active.
2. Open app and click `Start Session`.
3. Validate mic and camera permissions are granted.
4. Set laptop volume for room audibility.
5. Keep backup Kannada announcement audio clip ready.

## Scene sequence

## Scene A: Form Help (Guide) - ~60 seconds

1. Tap preset `Scene A: Form Help`.
2. Confirm state:
   - Mode = `Guide`
   - Search = `On`
   - Vision = `On`
3. Point camera at form.
4. Say: `Yeh form kaise bharein? Mujhe kya chahiye?`
5. Expected output:
   - Hindi explanation
   - Step 1 / Step 2 / Step 3 structure

Fallback:
- If camera OCR is weak, open form on screen and switch source to `Screen`.

## Scene B: Announcement (Echo) - ~45 seconds

1. Tap preset `Scene B: Announcement`.
2. Confirm state:
   - Mode = `Echo`
   - Vision = `Off`
3. Play Kannada announcement (or teammate speaks live).
4. Expected output:
   - Hindi translation only
   - No assistant commentary

Fallback:
- Use pre-recorded backup clip if live speech is unclear.

## Scene C: Conversation (Bridge) - ~60 seconds

1. Tap preset `Scene C: Conversation`.
2. Confirm state:
   - Mode = `Bridge`
   - Pair = Hindi <-> Kannada
3. Person A speaks Hindi, Person B replies Kannada.
4. Expected output:
   - Bidirectional translation with minimal delay

Fallback:
- Keep scripted short dialogue and repeat slowly with short sentences.

## Operator controls during failures

- Session drop: press `Retry Session`.
- Mic blocked: enable permission in browser settings, then toggle mic on.
- Vision blocked: switch to screen source if camera permission fails.

## Suggested short dialogue for Scene C

- Hindi: `Mujhe yahan bus pass ka form kaha milega?`
- Kannada: `Bus stand office alli sigutte, ID card tagond banni.`
- Hindi: `Dhanyavaad, kitne baje band hota hai?`
- Kannada: `Sanjhe 6 baje close agutte.`
