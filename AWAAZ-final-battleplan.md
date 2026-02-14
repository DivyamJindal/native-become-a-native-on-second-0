# AWAAZ — Final Battle Plan
## "See. Hear. Understand. Anywhere."
### Gemini 3 Bengaluru Hackathon | Feb 14, 2026

---

## THE 0→1 IDEA

AWAAZ is the first app that combines seeing + hearing + searching + reasoning + speaking
in real-time to make any Indian function as a local, anywhere in India, in any language.

It's not a translator. It's not a chatbot. It's a **multimodal language companion** that
continuously sees what you see, hears what you hear, and makes you understand everything
around you — in your language.

### What Exists Today (and Why It's Not This)

| Product | What it does | What it CAN'T do |
|---------|-------------|-------------------|
| Google Lens | Point → translate text in image | Can't hear. Can't reason. Can't converse. Single shot. |
| Google Translate | Speech OR text, turn-by-turn | Can't see. Can't combine vision+audio. Not continuous. |
| YouTube Dubbing | Dubs pre-recorded videos | Not real-time. Not consumer-controlled. One platform. |
| ChatGPT/Gemini chat | Reason over images/text | Not real-time streaming. No continuous camera/audio. |
| **AWAAZ** | **Sees + Hears + Searches + Reasons + Speaks — all at once, continuously, in real-time** | **Nothing like this exists.** |

### Track Coverage
- **Multilinguality** ✅ — Every interaction crosses language boundaries in real-time
- **Consumer** ✅ — Genuinely missing app for 300M+ migrant Indians
- **Localization** ✅ — Location-aware (reads local signs, local forms, local announcements)

---

## THE FOUR DEMO SCENES

These four scenes ARE the product. Each demonstrates a different multimodal combination
that no existing product can do. Practice them in this order.

### Scene 1: SEE (Camera + Vision + Speech) — 45 sec
**"AWAAZ can read the world for you."**

Point phone/laptop camera at printed text in Kannada (newspaper, menu, sign).
Without pressing anything, AWAAZ reads it aloud in Hindi.

> Demo setup: Print a Kannada restaurant menu. Point camera at it.
> AWAAZ: (in Hindi) "This is a restaurant menu. The first item is Masala Dosa 
> for 80 rupees, the second is Bisi Bele Bath for 100 rupees..."

Then point at a government form in English/Kannada.
> AWAAZ: (in Hindi) "This is an application form for ration card. 
> You need to fill in your name, Aadhaar number, and address..."

**Why this is 0→1:** Google Lens translates text visually (overlays text on screen). 
AWAAZ *speaks* the translation to you while you're looking at it. Hands-free. Eyes-free. 
For someone who can't read, visual translation is useless. Voice is everything.

### Scene 2: HEAR (Mic + Audio Translation + Emotion) — 45 sec
**"AWAAZ can translate the world around you."**

Teammate makes a "hospital announcement" in Tamil (or play a pre-recorded clip).
You're wearing headphones. You hear it in Hindi, with the urgency/tone preserved.

> Teammate: (Tamil, urgently) "Ward number 4 patients please come to 
> the reception immediately for your reports..."
> You hear (Hindi): Same content, same urgency, same pace.

Switch language to English mid-stream. Audio changes.

**Why this is 0→1:** Google Translate does turn-by-turn conversation translation.
This is CONTINUOUS ambient translation — the world around you, always translated.

### Scene 3: SEE + HEAR + SEARCH (The Full Stack) — 60 sec  
**"AWAAZ can help you navigate anything."**

This is the killer scene. Point camera at a government document/form while asking
a question in Hindi about it.

> You: (Hindi, while pointing camera at a printed PM Awas Yojana form) 
> "Yeh form kaise bharein? Mujhe kya kya chahiye?"
> ("How do I fill this form? What all do I need?")

AWAAZ *sees* the form through the camera, *hears* your Hindi question, 
*searches Google* for current eligibility info, and responds:

> AWAAZ: (Hindi) "This is the Pradhan Mantri Awas Yojana application form. 
> To fill this, you need: your Aadhaar card, income certificate, and 
> a photograph. Step 1: Write your full name here at the top. Step 2: 
> Your Aadhaar number goes in this box. The current deadline for 
> applications is March 2026. You can submit this at your nearest 
> Gram Panchayat office."

**Why this is 0→1:** This is vision + audio + search + reasoning + multilingual speech
ALL happening simultaneously through ONE model in ONE connection. No product on Earth 
does this. The form is in English/Kannada, the user speaks Hindi, the search happens 
in English, and the response comes back in Hindi. Four languages, one interaction.

### Scene 4: CONVERSE (Bidirectional Translation) — 45 sec
**"AWAAZ lets you talk to anyone."**

Two people face each other. One speaks Hindi, one speaks Tamil.
Each hears the other in their own language.

> Person A (Hindi): "Mera beta beemar hai, doctor sahab kab milenge?"
> ("My son is sick, when can I meet the doctor?")
> Person B hears this in Tamil.
> 
> Person B (Tamil): "Doctor 3 mani-kku varuvaaru, report kondu vaanga"
> ("Doctor will come at 3, bring the reports")
> Person A hears this in Hindi.

**Why this is 0→1:** Google Translate Live does this through headphones between
two languages. But AWAAZ does it AS PART of the same app that also sees, reads, 
searches, and reasons. The value is the INTEGRATION — one app for everything.

### Close — 30 sec
> "300 million Indians live in states where they don't speak the local language.
> Every hospital visit, every government office, every parent-teacher meeting is 
> a language barrier. AWAAZ makes them native. Everywhere.
>
> Powered by Gemini's Live API — the only model that can see, hear, search, reason, 
> and speak simultaneously in real-time. This is not an incremental improvement. 
> This is 0 to 1."

**Total demo: ~4 minutes**

---

## PLATFORM: WEB APP (React)

### Why Web
- Google's official React starter has EVERYTHING: mic, webcam, screen capture, 
  audio playback, WebSocket to Gemini Live API, Google Search grounding, function calling
- Vibe-codeable — you're re-skinning and re-prompting, not building infrastructure
- No install needed — works on any laptop with Chrome
- Camera access via browser `getUserMedia()` is reliable and well-tested

### Your Foundation

**Primary: Google's React starter**
```bash
git clone https://github.com/google-gemini/live-api-web-console.git
cd live-api-web-console
npm install
# Create .env with REACT_APP_GEMINI_API_KEY=your_key
npm start
# Opens at http://localhost:3000
```

What it already gives you:
```
✅ WebSocket connection to Gemini Live API
✅ Microphone capture → PCM 16kHz streaming  
✅ Webcam video capture → frame streaming (1 FPS)
✅ Screen capture (can capture other tabs)
✅ Audio playback from Gemini responses (24kHz)
✅ Google Search grounding (tools: [{ googleSearch: {} }])
✅ Function calling infrastructure
✅ Event logging for debugging
✅ React component structure ready to reskin
```

**Backup: Vanilla JS version (if React is too heavy to vibe-code)**
```bash
git clone https://github.com/ViaAnthroposBenevolentia/gemini-2-live-api-demo.git
cd gemini-2-live-api-demo
python -m http.server 8000
# Opens at http://localhost:8000
```

### Architecture (you're modifying, not building)

```
┌──────────────────────────────────────────────────────┐
│                    BROWSER (Chrome)                    │
│                                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │   CAMERA     │  │  MICROPHONE  │  │   SPEAKER   │  │
│  │  (getUserMe- │  │  (PCM 16kHz) │  │  (PCM 24kHz)│  │
│  │   dia)       │  │              │  │             │  │
│  └──────┬───────┘  └──────┬───────┘  └──────▲──────┘  │
│         │                 │                 │          │
│         │ frames (1FPS)   │ audio chunks    │ audio    │
│         │                 │                 │          │
│  ┌──────▼─────────────────▼─────────────────┤          │
│  │              WebSocket (direct to Gemini)│          │
│  │              wss://generativelanguage... │          │
│  └──────────────────┬──────────────────────┘          │
│                     │                                  │
│  ┌──────────────────▼──────────────────────────────┐  │
│  │  MODE SELECTOR         LANGUAGE SELECTOR         │  │
│  │  [SEE] [HEAR] [ASK] [TALK]   [Hindi] [Kannada]  │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │   GEMINI LIVE API     │
         │   Native Audio Model  │
         │                       │
         │   Sees: camera frames │
         │   Hears: mic audio    │
         │   Searches: Google    │
         │   Speaks: translated  │
         │          audio back   │
         └───────────────────────┘
```

**KEY INSIGHT: No backend needed.** The React starter connects DIRECTLY to Gemini 
via WebSocket using an API key (fine for hackathon). This eliminates an entire layer 
of complexity. For production you'd use ephemeral tokens, but for a demo, direct 
connection is perfect.

---

## SYSTEM PROMPTS

### Master System Prompt (always active)
```
You are AWAAZ (आवाज़), a real-time multimodal language companion for India.

You can SEE (through the camera), HEAR (through the microphone), SEARCH (Google), 
and SPEAK (in any Indian language). You use ALL of these simultaneously.

CORE BEHAVIOR:
- The user's preferred language is {TARGET_LANGUAGE}. 
- ALWAYS respond in {TARGET_LANGUAGE}, regardless of what language you see or hear.
- You process the world around the user: signs they're looking at, audio they're 
  hearing, documents they're pointing at, people they're talking to.
- Be proactive: if you see text in the camera, read and translate it without 
  being asked.
- If you hear speech in another language, translate it immediately.
- Use Google Search when the user asks about government schemes, processes, 
  eligibility, or current information.

PERSONALITY:
- Warm, patient, and reassuring — many users are first-time tech users.
- Concise — speak in short, clear sentences. No jargon.
- Action-oriented — always end with "what to do next" when relevant.
- You are an invisible helper, not a chatbot. Don't introduce yourself 
  or ask "how can I help." Just help.

WHAT YOU DO:
1. SEE: When camera shows text (signs, menus, forms, documents, newspapers), 
   read it aloud in {TARGET_LANGUAGE}. Be proactive.
2. HEAR: When mic picks up speech in another language, translate it to 
   {TARGET_LANGUAGE} preserving emotion and tone.
3. ASK: When user asks a question while pointing at something, combine what 
   you see + what they asked + Google Search to give a complete answer.
4. TALK: When facilitating conversation between two people in different 
   languages, translate bidirectionally.

LANGUAGE RULES:
- Use simple, everyday {TARGET_LANGUAGE}. No English words unless they're 
  commonly used (like "form", "office", "report").
- For government/medical terms, say the official term AND explain it simply.
- Numbers: say them clearly and repeat important ones.
```

### Mode-Specific Overrides

When user selects a mode, APPEND these to the master prompt:

**SEE Mode (Camera focus):**
```
CURRENT MODE: SEE
Focus on the camera input. Proactively read and translate any text you see.
Describe important visual elements (like which box to fill on a form).
If the user asks about what they're showing you, combine your visual 
understanding with Google Search for the most current information.
```

**HEAR Mode (Audio translation focus):**
```
CURRENT MODE: HEAR  
Focus on translating incoming audio. When you hear speech in any language 
other than {TARGET_LANGUAGE}, immediately translate it to {TARGET_LANGUAGE}.
CRITICAL RULES FOR THIS MODE:
- Output ONLY the translation. No commentary. No "the speaker said."
- Match emotion, pace, energy, and tone exactly.
- During silence, stay silent. Do NOT fill gaps.
- If you hear music or non-speech sounds, stay silent.
- You are invisible. The user should feel like the original speaker 
  IS speaking in {TARGET_LANGUAGE}.
```

**ASK Mode (Camera + Search):**
```
CURRENT MODE: ASK
Combine camera vision with Google Search to answer user questions.
When the user shows you a document/form/notice and asks about it:
1. Read what you see in the camera
2. Search Google for current, accurate information
3. Give a clear answer in {TARGET_LANGUAGE}
4. End with simple steps: "Step 1... Step 2... Step 3..."
Always verify government info through search. Never make up details.
```

**TALK Mode (Bidirectional conversation):**
```
CURRENT MODE: TALK
Two people are having a conversation in different languages.
Auto-detect which language is being spoken.
Translate to the OTHER language immediately.
ONLY output the translation — no commentary, no "they said."
Preserve tone and emotion exactly.
Be instantaneous. You are an invisible bridge.
```

---

## 7-HOUR BUILD TIMELINE

### Tonight (Feb 13) — DO THIS BEFORE SLEEPING

**Setup (1 hour):**
```bash
# 1. Get Gemini API key
# Go to https://aistudio.google.com/apikey
# Create key, save it

# 2. Clone the starter
git clone https://github.com/google-gemini/live-api-web-console.git
cd live-api-web-console
npm install

# 3. Create .env
echo "REACT_APP_GEMINI_API_KEY=your_key_here" > .env

# 4. Run it
npm start
# Opens http://localhost:3000
```

**Validate (30 min) — CRITICAL, DO NOT SKIP:**
```
Test 1: Click mic → speak → confirm you hear Gemini respond
Test 2: Click webcam → point at text → ask "what do you see?"
Test 3: Enable Google Search → ask "what is PM Awas Yojana?"
Test 4: Change system prompt to include "always respond in Hindi"
        → speak English → confirm response comes in Hindi
Test 5: Point camera at English text → confirm Gemini reads it in Hindi
```

If tests 1-5 pass, you have EVERYTHING you need. The rest is UI and prompts.

**Prepare demo props (20 min):**
```
Print or prepare on a tablet:
□ Kannada restaurant menu (2-3 items with prices)
□ Government form (PM Awas Yojana or ration card application)
□ English newspaper headline
□ Road sign or hospital sign in Kannada/Tamil

Audio clips (backup if live mic demo fails):
□ Tamil hospital announcement (record a friend or use TTS)
□ Hindi news clip (60 sec)
□ Kannada instructions (60 sec)
```

**Sleep by midnight.**

---

### Hackathon Day: Hour-by-Hour

#### Hour 0-1 (9AM-10AM): Core Working
**Goal: Gemini sees camera + hears mic + responds in target language**

- [ ] Set up at venue, connect WiFi, verify API works
- [ ] Modify system prompt to AWAAZ master prompt
- [ ] Test: point camera at English text → response in Hindi ✓
- [ ] Test: speak in English → response in Hindi ✓  
- [ ] Test: point camera at Kannada text → reads aloud in Hindi ✓
- [ ] Enable Google Search grounding in config
- [ ] **MILESTONE: Core multimodal loop working**

#### Hour 1-3 (10AM-12PM): Four Modes Working
**Goal: All four demo scenes functional**

- [ ] SEE mode: camera → proactive text reading → Hindi speech
- [ ] HEAR mode: mic audio → translation with emotion preservation
  - Test: play Tamil audio → hear Hindi translation
  - Tune prompt to prevent commentary (just translate)
- [ ] ASK mode: camera + voice question + Google Search
  - Test: show form + ask "how to fill?" → gets searched answer
- [ ] TALK mode: bidirectional conversation translation
  - Test with teammate: Hindi ↔ Tamil
- [ ] Language selector: switch between Hindi, Kannada, Tamil, Telugu, English
  - On switch: update system prompt with new TARGET_LANGUAGE
  - Reconnect session (or send text update mid-session)
- [ ] **MILESTONE: All four scenes demo-able**

#### Hour 3-5 (12PM-2PM): UI Transformation
**Goal: Looks like a real product, not a starter template**

This is where vibe coding shines. Take the Google starter UI and transform it.

- [ ] Remove all Google starter branding/debug logs
- [ ] Add AWAAZ branding: name, tagline, logo
- [ ] Mode selector: 4 large buttons (SEE / HEAR / ASK / TALK) with icons
- [ ] Language selector: pill buttons with native script
  ```
  हिन्दी  ಕನ್ನಡ  தமிழ்  తెలుగు  English  বাংলা
  ```
- [ ] Camera feed display: show what the camera sees (already in starter)
- [ ] Status indicator: "Listening..." "Seeing..." "Searching..." "Speaking..."
- [ ] Waveform or pulse animation during active translation
- [ ] Dark theme (projector-friendly, looks premium)
- [ ] Clean layout:
  ```
  ┌────────────────────────────────────────┐
  │  AWAAZ आवाज़                           │
  │  See. Hear. Understand. Anywhere.      │
  │                                        │
  │  ┌──────────────────────────────────┐  │
  │  │                                  │  │
  │  │        📷 Camera Feed            │  │
  │  │        (what AWAAZ sees)         │  │
  │  │                                  │  │
  │  └──────────────────────────────────┘  │
  │                                        │
  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐         │
  │  │👁 │ │👂 │ │❓ │ │💬 │         │
  │  │SEE │ │HEAR│ │ASK │ │TALK│         │
  │  └────┘ └────┘ └────┘ └────┘         │
  │                                        │
  │  I speak: [Hindi हिन्दी    ▼]          │
  │                                        │
  │  ● LIVE  Seeing + Hearing + Searching  │
  └────────────────────────────────────────┘
  ```
- [ ] **MILESTONE: Looks professional**

#### Hour 5-6 (2PM-3PM): Demo Polish + Edge Cases
**Goal: Bulletproof demo, no surprises**

- [ ] Rehearse all 4 scenes end-to-end, 3 times
- [ ] Test on external speaker (audience needs to hear output)
- [ ] Handle audio feedback: use headphones for HEAR mode output
- [ ] Handle session drops: quick reconnect logic
- [ ] Test with pre-printed demo props (Kannada menu, govt form)
- [ ] Test language switching speed
- [ ] Record backup video of entire demo working (insurance policy)
- [ ] If teammate: rehearse TALK mode conversation
- [ ] **MILESTONE: Demo is rehearsed and reliable**

#### Hour 6-7 (3PM-4PM): Pitch + Submit
**Goal: Submitted before 5PM deadline**

- [ ] Build 5-slide pitch deck (see below)
- [ ] Write project description for submission form
- [ ] Final end-to-end test
- [ ] Submit by 4:30PM (30-min buffer)
- [ ] **MILESTONE: Submitted**

---

## PITCH DECK (5 Slides)

### Slide 1: The Problem
**"300 million Indians are strangers in their own country"**
- 300M internal migrants live where they don't speak the local language
- Hospital visit → can't understand the doctor
- Government office → can't read the forms
- Child's school → can't attend parent-teacher meeting
- Google Lens reads text. Google Translate hears speech. 
  Nothing does BOTH. Nothing does it CONTINUOUSLY. Nothing REASONS.

### Slide 2: AWAAZ
**"See. Hear. Understand. Anywhere."**
- First multimodal language companion
- SEE: Point camera at any text → hear it in your language
- HEAR: Ambient audio → live translation with emotion
- ASK: Show a document + ask a question → get answers + steps
- TALK: Speak to anyone in any language → real-time interpretation
- One app. One model. Every Indian language.

### Slide 3: Why This Is 0→1
**"The first app that sees, hears, searches, reasons, and speaks — simultaneously"**
- Show the comparison table (Lens vs Translate vs AWAAZ)
- Camera + Mic + Search + Reasoning + Speech = never been done before
- Not an incremental improvement to translation. A new product category.

### Slide 4: Powered by Gemini
**"Only possible with Gemini Live API"**
- Single WebSocket: camera frames + audio + Google Search + native audio output
- No other model can process vision + audio + search + speak in real-time
- Native speech-to-speech: emotion, tone, pace preserved (not STT→translate→TTS)
- 70+ languages, 2000+ pairs
- This is the BEST possible showcase of Gemini's unique capabilities

### Slide 5: Impact + Vision
**"Making every Indian native, everywhere"**
- 300M migrants, day one addressable users
- Expand to: tourists, businesses, healthcare, education, government services
- Revenue: ₹149/month consumer subscription, B2G (hospitals, courts, offices)
- Vision: the app that makes language barriers extinct

---

## TECHNICAL IMPLEMENTATION DETAILS

### Model Configuration
```javascript
// In the React starter's config
const config = {
  model: "models/gemini-2.5-flash-native-audio-preview-12-2025", 
  // OR latest available — check AI Studio on hackathon day
  
  generationConfig: {
    responseModalities: ["AUDIO"],  // Native audio output
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: "Kore" }  
        // Test different voices: Puck, Charon, Kore, Fenrir, Aoede
      }
    }
  },
  
  systemInstruction: {
    parts: [{ text: AWAAZ_SYSTEM_PROMPT }]
  },
  
  tools: [
    { googleSearch: {} }  // Enable Google Search grounding
  ]
};
```

### Language Switching Implementation
```javascript
// When user taps a new language:
function switchLanguage(newLanguage) {
  // Option 1: Reconnect with new prompt (more reliable)
  client.disconnect();
  const newPrompt = MASTER_PROMPT.replace('{TARGET_LANGUAGE}', newLanguage);
  client.connect({ 
    ...config, 
    systemInstruction: { parts: [{ text: newPrompt }] }
  });
  
  // Option 2: Send text mid-session (faster, less reliable)
  // client.send({ text: `Switch: now respond only in ${newLanguage}` });
}
```

### Mode Switching Implementation
```javascript
// When user taps a mode button:
function switchMode(mode) {
  const modePrompts = {
    SEE: SEE_PROMPT_ADDON,
    HEAR: HEAR_PROMPT_ADDON,
    ASK: ASK_PROMPT_ADDON,
    TALK: TALK_PROMPT_ADDON
  };
  
  // Reconnect with mode-specific prompt
  const fullPrompt = MASTER_PROMPT + "\n\n" + modePrompts[mode];
  client.disconnect();
  client.connect({
    ...config,
    systemInstruction: { parts: [{ text: fullPrompt.replace('{TARGET_LANGUAGE}', currentLanguage) }] },
    tools: mode === 'ASK' ? [{ googleSearch: {} }] : []
    // Only enable search in ASK mode to reduce noise in other modes
  });
}
```

### Camera Frame Handling
The starter already captures webcam at 1 FPS and sends frames.
For AWAAZ, this is perfect — you need Gemini to see signs/documents, 
not fast-moving video. 1 FPS is ideal for reading text.

### Audio Format
- **Input from mic:** PCM 16-bit, 16kHz, mono (starter handles this)
- **Output from Gemini:** PCM 24kHz (starter handles playback)
- **No conversion needed** — the starter app manages all audio processing

---

## RISK MITIGATION

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemini adds commentary in HEAR mode | High | Aggressive prompt. Test tonight. "Output ONLY translation, nothing else." |
| Audio feedback loop (output played back into mic) | High | Headphones for output. OR implement mic-mute during Gemini speech playback. The starter may already handle this with VAD. |
| Camera text recognition fails (blurry, poor lighting) | Medium | Use printed text with good contrast. Hold camera steady. Use screen capture as backup (show document on screen). |
| Latency >3 sec feels bad | Medium | Accept 1-2s delay. In demo, frame as "near real-time." The VISION is the wow, not the speed. |
| Session timeout (10 min limit) | Medium | Reconnect between demo scenes. Each scene is <60 sec. |
| Venue WiFi unreliable | High | Mobile hotspot as primary. Pre-test API at venue. All demo props are physical (printed). |
| Kannada/Tamil text recognition weak | Medium | Test tonight. If weak, use Hindi/English text and translate to other languages (still impressive). |
| Google Search grounding slow | Low | Pre-test ASK mode. If slow, have the answer in prompt context as fallback. |
| Judges say "this is just Project Astra" | Medium | AWAAZ is specifically for India's language problem. Project Astra is a general assistant. AWAAZ solves the #1 barrier for 300M migrants. Specificity > generality. |

---

## TEAM STRATEGY

### With 2-3 Teammates
| Role | Person | Focus |
|------|--------|-------|
| **Lead (you)** | Gemini integration, system prompts, mode logic, demo script | 
| **Frontend** | UI transformation, mode selector, language pills, animations |
| **Demo partner** | Prepare props, be the "Tamil speaker" in TALK demo, build pitch deck, handle submission |

### Solo
- Hours 0-3: Get all 4 modes working with default UI
- Hours 3-5: Minimal UI reskin (AWAAZ branding, mode buttons, language pills)
- Hours 5-7: Demo prep, pitch, submit
- **Cut ASK mode if running behind.** SEE + HEAR + TALK is enough to win.

---

## TONIGHT'S CHECKLIST (Feb 13)

### MUST DO (in this order)
```
□ Get Gemini API key from AI Studio
□ Clone google-gemini/live-api-web-console
□ npm install && npm start — confirm it runs
□ Test mic → audio response works
□ Test webcam → Gemini describes what it sees
□ Test Google Search grounding → current info returned
□ Change system prompt to AWAAZ prompt
□ Test: speak English → response in Hindi
□ Test: point camera at English text → reads aloud in Hindi
□ Test: point camera at non-English text → reads in Hindi
□ Prepare/print demo props (Kannada menu, govt form)
```

### NICE TO HAVE
```
□ Test HEAR mode: play Tamil audio → Hindi translation
□ Test latency across different language pairs
□ Start UI reskin (just colors + title)
□ Test different voice options (Kore, Puck, Aoede, etc.)
□ Test which voice sounds best for Hindi output
```

### DO NOT DO TONIGHT
```
□ Don't perfect the UI (tomorrow hours 3-5)
□ Don't build the pitch deck (tomorrow hour 6)
□ Don't optimize anything (working > perfect)
□ Don't try to build a backend (direct WebSocket is fine)
```

---

## THE WINNING INSIGHT

Every other team will use Gemini for ONE thing:
- A team will use the camera.
- A team will use audio.
- A team will use search.
- A team will use multilingual.

You're using **ALL OF THEM. SIMULTANEOUSLY. IN REAL-TIME. ON ONE CONNECTION.**

That's not just a hackathon project. That's the most complete demonstration of 
Gemini Live API's capabilities that Google's judges will see all day.

And it solves a real problem for 300 million real people.

See. Hear. Understand. Anywhere. 

Go build it. 🔥
