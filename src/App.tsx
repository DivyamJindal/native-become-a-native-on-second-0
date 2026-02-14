import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FunctionDeclaration,
  LiveConnectConfig,
  LiveServerContent,
  LiveServerToolCall,
  Modality,
  Tool,
  Type,
} from "@google/genai";
import cn from "classnames";
import "./App.scss";
import { LiveAPIProvider, useLiveAPIContext } from "./contexts/LiveAPIContext";
import { LiveClientOptions } from "./types";
import { AudioRecorder } from "./lib/audio-recorder";
import { useWebcam } from "./hooks/use-webcam";
import { useScreenCapture } from "./hooks/use-screen-capture";

const API_KEY = process.env.REACT_APP_GEMINI_API_KEY;
if (!API_KEY && process.env.NODE_ENV !== "test") {
  throw new Error("set REACT_APP_GEMINI_API_KEY in .env");
}

const apiOptions: LiveClientOptions = {
  apiKey: API_KEY || "test-api-key",
};

const MODEL_NAME =
  process.env.REACT_APP_GEMINI_MODEL ||
  "models/gemini-2.5-flash-native-audio-preview-12-2025";

const RISK_FUNCTION_NAME = "emit_risk_signal";
const FORMATTED_CONTENT_FUNCTION_NAME = "emit_formatted_content";

/* ─── Types ─── */

type NativeMode = "GUIDE" | "SPOT" | "BRIDGE";
type PermissionFlag = "unknown" | "granted" | "denied" | "prompt";
type RiskType = "price" | "misinformation" | "urgency";
type RiskLevel = "low" | "medium" | "high";

type LanguageChoice = {
  id: string;
  label: string;
  display: string;
};

type FormattedContentType = "menu" | "document" | "form" | "sign" | "table" | "general";

type FormattedContent = {
  id: string;
  contentType: FormattedContentType;
  title: string;
  markdown: string;
  language: string;
  timestamp: string;
};

type UserLocation = {
  latitude: number;
  longitude: number;
  city: string;
  area: string;
  state: string;
  localTime: string;
  fetchedAt: number;
} | null;

type PromptContext = {
  mode: NativeMode;
  sourceLanguage: LanguageChoice;
  targetLanguage: LanguageChoice;
  userLocation: UserLocation;
};

type RiskSignal = {
  id: string;
  type: RiskType;
  level: RiskLevel;
  cue: string;
  reason: string;
  action: string;
  confidence: number;
  sourceLanguage: string;
  targetLanguage: string;
  timestamp: string;
  baselineReference?: string;
  source: "model" | "heuristic";
};

type SessionHealth = {
  permissions: {
    mic: PermissionFlag;
    vision: PermissionFlag;
  };
  connected: boolean;
  reconnecting: boolean;
  lastError: string | null;
};

type RiskPolicy = {
  enabledTypes: RiskType[];
  minConfidenceForMedium: number;
  minConfidenceForHigh: number;
  cooldownMs: number;
};

/* ─── Constants ─── */

const LANGUAGES: LanguageChoice[] = [
  { id: "hi-IN", label: "Hindi", display: "हिन्दी" },
  { id: "kn-IN", label: "Kannada", display: "ಕನ್ನಡ" },
  { id: "en-IN", label: "English", display: "English" },
  { id: "bn-IN", label: "Bengali", display: "বাংলা" },
  { id: "mr-IN", label: "Marathi", display: "मराठी" },
  { id: "ta-IN", label: "Tamil", display: "தமிழ்" },
  { id: "te-IN", label: "Telugu", display: "తెలుగు" },
];

const VOICES = ["Kore", "Aoede", "Puck", "Charon"];

const MODE_DETAILS: Record<NativeMode, { title: string; icon: string; blurb: string }> = {
  GUIDE: {
    title: "Guide",
    icon: "🗣️",
    blurb: "Ask anything — voice-first personal assistant.",
  },
  SPOT: {
    title: "Spot",
    icon: "📷",
    blurb: "Point your camera — reads signs, menus \u0026 documents.",
  },
  BRIDGE: {
    title: "Bridge",
    icon: "🌉",
    blurb: "Translates what's happening around you.",
  },
};

const MODE_PRESETS: Record<NativeMode, { mic: boolean; camera: boolean; search: boolean }> = {
  GUIDE: { mic: true, camera: false, search: true },
  SPOT: { mic: true, camera: true, search: true },
  BRIDGE: { mic: true, camera: false, search: false },
};

const RISK_POLICY: RiskPolicy = {
  enabledTypes: ["price", "misinformation", "urgency"],
  minConfidenceForMedium: 0.62,
  minConfidenceForHigh: 0.78,
  cooldownMs: 18000,
};

const RISK_LEVEL_PRIORITY: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const RISK_FUNCTION_DECLARATION: FunctionDeclaration = {
  name: RISK_FUNCTION_NAME,
  description:
    "Emit a local risk guard signal when actionable risk is detected for price, misinformation, or urgency.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        enum: ["price", "misinformation", "urgency"],
        description: "The risk category.",
      },
      level: {
        type: Type.STRING,
        enum: ["low", "medium", "high"],
        description: "Risk severity level.",
      },
      cue: {
        type: Type.STRING,
        description: "Short quote or cue that triggered this risk.",
      },
      reason: {
        type: Type.STRING,
        description: "Why this is potentially risky.",
      },
      action: {
        type: Type.STRING,
        description: "Immediate next step for user.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Model confidence from 0.0 to 1.0.",
      },
      baselineReference: {
        type: Type.STRING,
        description: "Optional benchmark or grounding reference for price risk.",
      },
    },
    required: ["type", "level", "cue", "reason", "action", "confidence"],
  },
};

const FORMATTED_CONTENT_DECLARATION: FunctionDeclaration = {
  name: FORMATTED_CONTENT_FUNCTION_NAME,
  description:
    "Emit a rich formatted breakdown of complex visual content such as menus, documents, forms, signs, or tables. Use this when the camera shows content that benefits from structured text representation alongside the spoken audio summary.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      contentType: {
        type: Type.STRING,
        enum: ["menu", "document", "form", "sign", "table", "general"],
        description: "The type of content detected.",
      },
      title: {
        type: Type.STRING,
        description: "Short title describing the content, e.g. 'Restaurant Menu' or 'Bus Timetable'.",
      },
      markdown: {
        type: Type.STRING,
        description: "Detailed markdown-formatted breakdown of the content. Use headers, bullet lists, tables, bold for prices/key info. Translate all text into the target language.",
      },
      language: {
        type: Type.STRING,
        description: "The language the markdown is written in.",
      },
    },
    required: ["contentType", "title", "markdown", "language"],
  },
};

const LANGUAGE_BY_ID = LANGUAGES.reduce<Record<string, LanguageChoice>>(
  (map, language) => {
    map[language.id] = language;
    return map;
  },
  {},
);

const DEFAULT_TARGET_LANGUAGE =
  LANGUAGE_BY_ID[process.env.REACT_APP_DEFAULT_TARGET_LANG || ""] ||
  LANGUAGE_BY_ID["hi-IN"] ||
  LANGUAGES[0];

const DEFAULT_SOURCE_LANGUAGE =
  LANGUAGE_BY_ID[process.env.REACT_APP_DEFAULT_SOURCE_LANG || ""] ||
  LANGUAGE_BY_ID["kn-IN"] ||
  LANGUAGES[0];

/* ─── Helpers ─── */

function getLanguage(id: string, fallback: LanguageChoice) {
  return LANGUAGE_BY_ID[id] || fallback;
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function isPermissionDeniedError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

function clampConfidence(value: number) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function createRiskId() {
  return `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseRiskLevel(raw: unknown): RiskLevel | null {
  const value = String(raw || "").toLowerCase().trim();
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return null;
}

function parseRiskType(raw: unknown): RiskType | null {
  const value = String(raw || "").toLowerCase().trim();
  if (value === "price" || value === "misinformation" || value === "urgency") {
    return value;
  }
  return null;
}

function parseRiskSignalFromArgs(
  args: Record<string, unknown> | undefined,
  sourceLanguage: LanguageChoice,
  targetLanguage: LanguageChoice,
): RiskSignal | null {
  if (!args) {
    return null;
  }

  const type = parseRiskType(args.type);
  const level = parseRiskLevel(args.level);
  const cue = String(args.cue || "").trim();
  const reason = String(args.reason || "").trim();
  const action = String(args.action || "").trim();
  const confidence = clampConfidence(Number(args.confidence || 0));
  const baselineReference = String(args.baselineReference || "").trim();

  if (!type || !level || !cue || !reason || !action) {
    return null;
  }

  return {
    id: createRiskId(),
    type,
    level,
    cue,
    reason,
    action,
    confidence,
    sourceLanguage: sourceLanguage.id,
    targetLanguage: targetLanguage.id,
    timestamp: new Date().toISOString(),
    baselineReference: baselineReference || undefined,
    source: "model",
  };
}

function detectHeuristicRisk(
  transcript: string,
  sourceLanguage: LanguageChoice,
  targetLanguage: LanguageChoice,
): RiskSignal | null {
  const text = transcript.trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  const urgencyKeywords = [
    "immediately", "urgent", "fine", "penalty", "police",
    "last warning", "deadline", "jaldi", "tatkal", "ತಕ್ಷಣ", "ದಂಡ",
  ];

  const misinformationKeywords = [
    "agent", "shortcut", "sign quickly", "don't read",
    "different office", "extra charge for form", "commission", "broker",
  ];

  const priceHints = /(₹|rs\.?|rupees|fare|charge|fees|price|rate|cost|ticket|rent)/i;
  const highAmount = /\b([5-9]\d{2}|\d{4,})\b/;

  if (urgencyKeywords.some((keyword) => lower.includes(keyword))) {
    return {
      id: createRiskId(),
      type: "urgency",
      level: "medium",
      cue: text.slice(0, 110),
      reason: "Urgent enforcement or deadline language detected.",
      action: "Pause, verify with official staff/signage before acting.",
      confidence: 0.66,
      sourceLanguage: sourceLanguage.id,
      targetLanguage: targetLanguage.id,
      timestamp: new Date().toISOString(),
      source: "heuristic",
    };
  }

  if (misinformationKeywords.some((keyword) => lower.includes(keyword))) {
    return {
      id: createRiskId(),
      type: "misinformation",
      level: "medium",
      cue: text.slice(0, 110),
      reason: "Potential misleading instruction pattern detected.",
      action: "Ask for written proof and confirm at official counter.",
      confidence: 0.64,
      sourceLanguage: sourceLanguage.id,
      targetLanguage: targetLanguage.id,
      timestamp: new Date().toISOString(),
      source: "heuristic",
    };
  }

  if (priceHints.test(lower) && highAmount.test(lower)) {
    return {
      id: createRiskId(),
      type: "price",
      level: "low",
      cue: text.slice(0, 110),
      reason: "Price mention detected. Overcharge check recommended.",
      action: "Ask for printed rate list or compare with known local fare.",
      confidence: 0.56,
      sourceLanguage: sourceLanguage.id,
      targetLanguage: targetLanguage.id,
      timestamp: new Date().toISOString(),
      baselineReference: "Context estimate; confirm using local posted rates.",
      source: "heuristic",
    };
  }

  return null;
}

/* ─── Prompt Building ─── */

function buildModeInstruction(
  mode: NativeMode,
  sourceLanguage: LanguageChoice,
  targetLanguage: LanguageChoice,
) {
  const prompts: Record<NativeMode, string> = {
    GUIDE: `CURRENT MODE: GUIDE (Voice Assistant)

You are having a direct voice conversation with the user. They will speak to you through their microphone and you respond in audio.

YOUR JOB:
- Listen to the user's questions and requests.
- Answer clearly in ${targetLanguage.label} with practical, step-by-step guidance.
- Use Google Search grounding when the question involves local information: bus routes, train timings, government office procedures, local prices, customs, or anything you are not 100% certain about.
- Always structure complex answers as numbered steps: "Step 1… Step 2… Step 3…"
- If the user describes a situation (e.g. "someone is asking me to pay ₹500 for a form"), proactively assess whether it sounds legitimate and advise accordingly.

BEHAVIORAL RULES:
- Stay silent during silence. Do not narrate or fill gaps.
- Keep responses under 3–4 sentences unless the user asks for more detail.
- If you hear ambient noise that is not directed at you, ignore it.
- If the user switches to a different language, still respond in ${targetLanguage.label}.`,

    SPOT: `CURRENT MODE: SPOT (Camera Companion)

You have access to both the user's microphone and camera. You can see what they see and hear what they say.

YOUR JOB:
1. PROACTIVE VISUAL READING: When you see text, signs, labels, menus, notices, timetables, or documents in the camera — read them aloud and explain what they mean and what the user should do, all in ${targetLanguage.label}.
2. COMPLEX CONTENT → FORMATTED OUTPUT: When you see content with more than 3 items or structured data (menus with prices, timetables, forms with fields, multi-line notices), do BOTH:
   a. Speak a brief audio summary (2–3 sentences, key points only).
   b. Call the ${FORMATTED_CONTENT_FUNCTION_NAME} function with a full markdown breakdown translated into ${targetLanguage.label}. Use tables for prices, bullet lists for items, and headers for sections.
3. CONVERSATIONAL: The user can also ask you questions about what they see or about anything else. Answer in ${targetLanguage.label} with step-by-step guidance. Use Google Search grounding for local facts.
4. RISK DETECTION: If you see or hear pricing that seems inflated, a suspicious sign, or a misleading notice — flag it via ${RISK_FUNCTION_NAME}.

BEHAVIORAL RULES:
- When nothing new is visible, stay silent. Do not narrate the same scene repeatedly.
- Prioritize what's most actionable: prices, directions, deadlines, warnings.
- When reading a sign in ${sourceLanguage.label}, translate it naturally — don't read the original aloud unless the user asks.
- For documents and forms: explain each field's purpose and what the user should fill in.`,

    BRIDGE: `CURRENT MODE: BRIDGE (Ambient Interpreter)

You are a passive listener translating the world around the user. The user's microphone picks up ambient speech — announcements, conversations, vendor calls, PA systems — and your job is to translate them into ${targetLanguage.label} so the user understands what is happening around them.

YOUR JOB:
- Listen to all incoming speech. Identify the language being spoken.
- If the speech is in ${sourceLanguage.label} or any language other than ${targetLanguage.label}, translate it into ${targetLanguage.label} and speak the translation.
- Preserve the tone, urgency, and intent of the original speech.
- For announcements (train, bus, PA systems): extract the key information (platform, time, destination, action required) and state it clearly.
- For conversations: provide a brief summary of what was said, not a word-for-word relay.
- If someone speaks directly TO the user in ${sourceLanguage.label}, translate what they said and then suggest a response the user could give back.

BEHAVIORAL RULES:
- Output ONLY translations and summaries. Do not add commentary, analysis, or opinions.
- Stay completely silent during silence or non-speech noise (traffic, music, etc.).
- When multiple people are speaking, focus on the loudest or most relevant speaker.
- Keep translations short and natural — aim for how a friend sitting next to you would whisper "they said…"
- If you detect urgency in an announcement (e.g. "last call", "platform change"), emphasize it in your translation.
- If you detect risk in what's being said (overcharge, scam, pressure), flag it via ${RISK_FUNCTION_NAME} but still translate the content.`,
  };

  return prompts[mode];
}

function buildLocationBlock(location: UserLocation): string {
  if (!location) return "";
  return `\nUSER LOCATION (live):
- City/Area: ${location.area}, ${location.city}, ${location.state}
- GPS: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}
- Local time: ${location.localTime}
- IMPORTANT: Factor the user's location and local time into ALL responses. Use location for price comparisons, directions, local customs, safety context, nearby landmarks, and time-appropriate suggestions. If the user asks "where" or "how to get to", use their GPS as the starting point.`;
}

function buildSystemPrompt({
  mode,
  sourceLanguage,
  targetLanguage,
  userLocation,
}: PromptContext) {
  const locationBlock = buildLocationBlock(userLocation);

  return `You are Awaaz — a realtime voice-first companion for migrants and travellers in India.

IDENTITY & TONE:
- You are a trusted local friend who speaks clearly and simply.
- Always respond in ${targetLanguage.label} (${targetLanguage.display}) unless BRIDGE mode requires the opposite direction.
- Be warm but concise. Prefer short, actionable sentences over long explanations.
- Never use filler phrases like "Sure!", "Of course!", "Great question!" — just answer.

${buildModeInstruction(mode, sourceLanguage, targetLanguage)}

SAFETY RULES:
- Never provide medical diagnoses, legal verdicts, or prescriptions.
- You may translate and explain official documents, notices, and forms in plain language.
- If you are unsure about something, say so honestly. Do not make up facts.

LOCAL RISK AWARENESS (always active):
- Continuously monitor for these risk types in what you hear and see: price gouging, misinformation, urgency/pressure tactics.
- When you detect actionable risk, call the ${RISK_FUNCTION_NAME} function with: type, level (low/medium/high), cue (the trigger), reason, action (one-line next step for user), and confidence (0.0–1.0).
- For price risks, compare stated amounts against local context or grounding data.
- For misinformation, flag contradictions with official processes.
- For urgency, flag pressure language (deadlines, fines, threats).
${locationBlock}

LIVE CONTEXT:
- Local language: ${sourceLanguage.label} — this is the language spoken in the user's surroundings.
- User's language: ${targetLanguage.label} — this is the language the user understands and wants to hear.`;
}

/* ─── Config Builder ─── */

function buildConfig(
  promptContext: PromptContext,
  voiceName: string,
): LiveConnectConfig {
  const presets = MODE_PRESETS[promptContext.mode];
  const tools: Tool[] = [];

  if (presets.search) {
    tools.push({ googleSearch: {} });
  }

  const fnDeclarations: FunctionDeclaration[] = [RISK_FUNCTION_DECLARATION];

  if (promptContext.mode === "SPOT") {
    fnDeclarations.push(FORMATTED_CONTENT_DECLARATION);
  }

  tools.push({ functionDeclarations: fnDeclarations });

  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    },
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(promptContext) }],
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools,
  };
}

/* ─── Main Component ─── */

function AwaazConsole() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const reconnectGuardRef = useRef<string>("");
  const riskCooldownByType = useRef<Record<RiskType, number>>({
    price: 0,
    misinformation: 0,
    urgency: 0,
  });

  const webcam = useWebcam();
  const screenCapture = useScreenCapture();

  const [activeMode, setActiveMode] = useState<NativeMode>("GUIDE");
  const [sourceLanguage, setSourceLanguage] =
    useState<LanguageChoice>(DEFAULT_SOURCE_LANGUAGE);
  const [targetLanguage, setTargetLanguage] =
    useState<LanguageChoice>(DEFAULT_TARGET_LANGUAGE);
  const [activeVoice] = useState<string>(VOICES[0]);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const [currentRisk, setCurrentRisk] = useState<RiskSignal | null>(null);
  const [formattedContents, setFormattedContents] = useState<FormattedContent[]>([]);

  const [inputDraft, setInputDraft] = useState("");
  const [lastInputTranscript, setLastInputTranscript] = useState("");
  const [lastOutputTranscript, setLastOutputTranscript] = useState("");

  const [sessionHealth, setSessionHealth] = useState<SessionHealth>({
    permissions: { mic: "unknown", vision: "unknown" },
    connected: false,
    reconnecting: false,
    lastError: null,
  });

  const [audioRecorder] = useState(() => new AudioRecorder());

  const { client, connected, connect, disconnect, volume, setConfig, setModel } =
    useLiveAPIContext();

  /* ─── Location fetch ─── */

  useEffect(() => {
    if (!locationEnabled) {
      setUserLocation(null);
      return;
    }

    let cancelled = false;
    setLocationLoading(true);

    const fetchLocation = async () => {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          }),
        );

        const { latitude, longitude } = pos.coords;

        let city = "Unknown";
        let area = "";
        let state = "";
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en`,
            { headers: { "User-Agent": "awaaz-app/1.0" } },
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            city = addr.city || addr.town || addr.village || addr.county || "Unknown";
            area = addr.suburb || addr.neighbourhood || addr.road || "";
            state = addr.state || "";
          }
        } catch {
          // Reverse geocode failed — GPS still usable
        }

        const localTime = new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        if (!cancelled) {
          setUserLocation({
            latitude,
            longitude,
            city,
            area,
            state,
            localTime,
            fetchedAt: Date.now(),
          });
          setLocationLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLocationLoading(false);
          setLocationEnabled(false);
          setUserLocation(null);
        }
      }
    };

    void fetchLocation();

    const intervalId = window.setInterval(() => void fetchLocation(), 300000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [locationEnabled]);

  /* ─── Prompt context & config ─── */

  const promptContext = useMemo<PromptContext>(
    () => ({
      mode: activeMode,
      sourceLanguage,
      targetLanguage,
      userLocation: locationEnabled ? userLocation : null,
    }),
    [activeMode, sourceLanguage, targetLanguage, locationEnabled, userLocation],
  );

  const sessionConfig = useMemo(
    () => buildConfig(promptContext, activeVoice),
    [promptContext, activeVoice],
  );

  const sessionSignature = useMemo(() => JSON.stringify(sessionConfig), [sessionConfig]);

  /* ─── Helpers ─── */

  const setLastError = useCallback((message: string | null) => {
    setSessionHealth((previous) => ({
      ...previous,
      lastError: message,
    }));
  }, []);

  const setPermission = useCallback(
    (kind: "mic" | "vision", value: PermissionFlag) => {
      setSessionHealth((previous) => ({
        ...previous,
        permissions: {
          ...previous.permissions,
          [kind]: value,
        },
      }));
    },
    [],
  );

  const setReconnecting = useCallback((value: boolean) => {
    setSessionHealth((previous) => ({
      ...previous,
      reconnecting: value,
    }));
  }, []);

  const shouldReplaceRisk = useCallback((previous: RiskSignal | null, next: RiskSignal) => {
    if (!previous) {
      return true;
    }

    if (
      previous.source === "model" &&
      next.source === "heuristic" &&
      RISK_LEVEL_PRIORITY[previous.level] >= RISK_LEVEL_PRIORITY.medium
    ) {
      const previousTime = new Date(previous.timestamp).getTime();
      if (Date.now() - previousTime < 45000) {
        return false;
      }
    }

    if (next.source === "model" && previous.source === "heuristic") {
      return true;
    }

    return RISK_LEVEL_PRIORITY[next.level] >= RISK_LEVEL_PRIORITY[previous.level];
  }, []);

  const applyRiskSignal = useCallback(
    (signal: RiskSignal) => {
      if (!RISK_POLICY.enabledTypes.includes(signal.type)) {
        return false;
      }

      if (
        signal.level === "medium" &&
        signal.confidence < RISK_POLICY.minConfidenceForMedium
      ) {
        return false;
      }

      if (signal.level === "high" && signal.confidence < RISK_POLICY.minConfidenceForHigh) {
        return false;
      }

      const now = Date.now();
      if (now - riskCooldownByType.current[signal.type] < RISK_POLICY.cooldownMs) {
        return false;
      }

      riskCooldownByType.current[signal.type] = now;

      setCurrentRisk((previous) => (shouldReplaceRisk(previous, signal) ? signal : previous));
      return true;
    },
    [shouldReplaceRisk],
  );

  const maybeApplyHeuristicRisk = useCallback(
    (transcript: string) => {
      const heuristicSignal = detectHeuristicRisk(
        transcript,
        sourceLanguage,
        targetLanguage,
      );
      if (!heuristicSignal) {
        return;
      }
      void applyRiskSignal(heuristicSignal);
    },
    [applyRiskSignal, sourceLanguage, targetLanguage],
  );

  /* ─── Session setup ─── */

  useEffect(() => {
    setModel(MODEL_NAME);
    setConfig(sessionConfig);
  }, [sessionConfig, setConfig, setModel]);

  useEffect(() => {
    setSessionHealth((previous) => ({
      ...previous,
      connected,
    }));
  }, [connected]);

  useEffect(() => {
    const onError = (error: ErrorEvent) => {
      setLastError(error.message || "Live session reported an error.");
    };

    client.on("error", onError);
    return () => {
      client.off("error", onError);
    };
  }, [client, setLastError]);

  useEffect(() => {
    if (!navigator.permissions?.query) {
      return;
    }

    let cancelled = false;

    const readPermissions = async () => {
      try {
        const microphone = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        const camera = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });

        if (!cancelled) {
          setPermission("mic", microphone.state as PermissionFlag);
          setPermission("vision", camera.state as PermissionFlag);
        }
      } catch {
        // ignore unsupported permissions API behavior
      }
    };

    void readPermissions();

    return () => {
      cancelled = true;
    };
  }, [setPermission]);

  /* ─── Auto-reconnect on config change ─── */

  useEffect(() => {
    if (!reconnectGuardRef.current) {
      reconnectGuardRef.current = sessionSignature;
      return;
    }

    const previous = reconnectGuardRef.current;
    reconnectGuardRef.current = sessionSignature;

    if (!connected || previous === sessionSignature) {
      return;
    }

    let cancelled = false;
    setReconnecting(true);
    setLastError(null);

    (async () => {
      try {
        await disconnect();
        if (!cancelled) {
          await connect();
        }
      } catch (error) {
        if (!cancelled) {
          setLastError(toErrorMessage(error, "Failed to refresh live session."));
        }
      } finally {
        if (!cancelled) {
          setReconnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionSignature, connected, connect, disconnect, setLastError, setReconnecting]);

  /* ─── Video stream binding ─── */

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeStream;
    }
  }, [activeStream]);

  /* ─── Mic + Vision controls ─── */

  const enableMic = useCallback(async () => {
    if (sessionHealth.permissions.mic === "granted") {
      setMicEnabled(true);
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setLastError("Microphone access is not supported in this browser.");
      return false;
    }

    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      setPermission("mic", "granted");
      setLastError(null);
      setMicEnabled(true);
      return true;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setPermission("mic", "denied");
      }
      setMicEnabled(false);
      setLastError(
        toErrorMessage(
          error,
          "Microphone permission is blocked. Enable it and retry.",
        ),
      );
      return false;
    }
  }, [sessionHealth.permissions.mic, setLastError, setPermission]);

  /* ─── Audio recorder streaming ─── */

  useEffect(() => {
    let cancelled = false;

    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: "audio/pcm;rate=16000",
          data: base64,
        },
      ]);
    };

    const startRecorder = async () => {
      try {
        audioRecorder.on("data", onData);
        await audioRecorder.start();
        if (!cancelled) {
          setPermission("mic", "granted");
        }
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          setPermission("mic", "denied");
        }
        if (!cancelled) {
          setMicEnabled(false);
          setLastError(toErrorMessage(error, "Could not start microphone capture."));
        }
      }
    };

    if (connected && micEnabled) {
      void startRecorder();
    } else {
      audioRecorder.stop();
    }

    return () => {
      cancelled = true;
      audioRecorder.off("data", onData);
    };
  }, [audioRecorder, client, connected, micEnabled, setLastError, setPermission]);

  /* ─── Vision stream ─── */

  const startVisionStream = useCallback(
    async () => {
      const stream = await webcam.start();
      screenCapture.stop();
      setActiveStream(stream);
      setVisionEnabled(true);
      setPermission("vision", "granted");
      setLastError(null);
      return stream;
    },
    [screenCapture, setLastError, setPermission, webcam],
  );

  const turnOnVision = useCallback(
    async () => {
      try {
        await startVisionStream();
        return true;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          setPermission("vision", "denied");
        }
        setVisionEnabled(false);
        setLastError(toErrorMessage(error, "Could not start camera."));
        return false;
      }
    },
    [setLastError, setPermission, startVisionStream],
  );

  const turnOffVision = useCallback(() => {
    webcam.stop();
    screenCapture.stop();
    setActiveStream(null);
    setVisionEnabled(false);
  }, [screenCapture, webcam]);

  /* ─── Frame capture ─── */

  useEffect(() => {
    let timeoutId = -1;

    const sendFrame = () => {
      const video = videoRef.current;
      const canvas = frameCanvasRef.current;
      if (!video || !canvas || !connected || !visionEnabled) {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      canvas.width = Math.max(1, Math.floor(video.videoWidth * 0.33));
      canvas.height = Math.max(1, Math.floor(video.videoHeight * 0.33));

      if (canvas.width > 1 && canvas.height > 1) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        const data = dataUrl.slice(dataUrl.indexOf(",") + 1);

        client.sendRealtimeInput([
          {
            mimeType: "image/jpeg",
            data,
          },
        ]);
      }

      timeoutId = window.setTimeout(sendFrame, 1000);
    };

    if (connected && visionEnabled && activeStream) {
      requestAnimationFrame(sendFrame);
    }

    return () => {
      clearTimeout(timeoutId);
    };
  }, [connected, visionEnabled, activeStream, client]);

  /* ─── Tool call handler ─── */

  useEffect(() => {
    const onToolCall = (toolCall: LiveServerToolCall) => {
      if (!toolCall.functionCalls?.length) {
        return;
      }

      const functionResponses = toolCall.functionCalls.map((functionCall) => {
        if (functionCall.name === RISK_FUNCTION_NAME) {
          const parsed = parseRiskSignalFromArgs(
            functionCall.args,
            sourceLanguage,
            targetLanguage,
          );

          if (!parsed) {
            return {
              id: functionCall.id,
              name: functionCall.name,
              response: { output: { accepted: false, reason: "Malformed risk signal payload." } },
            };
          }

          const accepted = applyRiskSignal(parsed);
          return {
            id: functionCall.id,
            name: functionCall.name,
            response: {
              output: {
                accepted,
                reason: accepted ? "Risk signal recorded." : "Filtered by policy/cooldown.",
              },
            },
          };
        }

        if (functionCall.name === FORMATTED_CONTENT_FUNCTION_NAME) {
          const args = functionCall.args || {};
          const contentType = String(args.contentType || "general").trim() as FormattedContentType;
          const title = String(args.title || "").trim();
          const markdown = String(args.markdown || "").trim();
          const language = String(args.language || "").trim();

          const validTypes: FormattedContentType[] = ["menu", "document", "form", "sign", "table", "general"];
          if (!validTypes.includes(contentType) || !title || !markdown) {
            return {
              id: functionCall.id,
              name: functionCall.name,
              response: { output: { accepted: false, reason: "Malformed formatted content payload." } },
            };
          }

          const content: FormattedContent = {
            id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            contentType,
            title,
            markdown,
            language,
            timestamp: new Date().toISOString(),
          };

          setFormattedContents((prev) => [content, ...prev].slice(0, 10));
          return {
            id: functionCall.id,
            name: functionCall.name,
            response: { output: { accepted: true, reason: "Formatted content recorded." } },
          };
        }

        return {
          id: functionCall.id,
          name: functionCall.name,
          response: { output: { accepted: false, reason: "Unsupported function." } },
        };
      });

      if (functionResponses.length) {
        client.sendToolResponse({ functionResponses });
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [
    applyRiskSignal,
    client,
    sourceLanguage,
    targetLanguage,
  ]);

  /* ─── Content handler ─── */

  useEffect(() => {
    const onContent = (content: LiveServerContent) => {
      if (content.inputTranscription?.text) {
        setLastInputTranscript(content.inputTranscription.text);
        maybeApplyHeuristicRisk(content.inputTranscription.text);
      }

      if (content.outputTranscription?.text) {
        setLastOutputTranscript(content.outputTranscription.text);
        maybeApplyHeuristicRisk(content.outputTranscription.text);
      }

      const text =
        content.modelTurn?.parts
          ?.map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("\n")
          .trim() || "";

      if (text) {
        maybeApplyHeuristicRisk(text);
      }
    };

    client.on("content", onContent);
    return () => {
      client.off("content", onContent);
    };
  }, [client, maybeApplyHeuristicRisk]);

  /* ─── Mode switching with preset inputs ─── */

  const switchMode = useCallback(
    async (mode: NativeMode) => {
      setActiveMode(mode);
      setLastError(null);
      setFormattedContents([]);

      const presets = MODE_PRESETS[mode];

      // Always enable mic
      if (presets.mic && !micEnabled) {
        await enableMic();
      }

      // Camera control
      if (presets.camera && !visionEnabled) {
        await turnOnVision();
      } else if (!presets.camera && visionEnabled) {
        turnOffVision();
      }
    },
    [enableMic, micEnabled, turnOffVision, turnOnVision, visionEnabled, setLastError],
  );

  /* ─── Connection ─── */

  const toggleConnection = useCallback(async () => {
    setLastError(null);
    setReconnecting(true);

    try {
      if (connected) {
        await disconnect();
      } else {
        // Enable mic before connecting
        if (!micEnabled) {
          await enableMic();
        }
        // Enable camera if mode requires it
        const presets = MODE_PRESETS[activeMode];
        if (presets.camera && !visionEnabled) {
          await turnOnVision();
        }
        await connect();
      }
    } catch (error) {
      setLastError(toErrorMessage(error, "Failed to update session state."));
    } finally {
      setReconnecting(false);
    }
  }, [connected, connect, disconnect, setLastError, setReconnecting, enableMic, micEnabled, activeMode, turnOnVision, visionEnabled]);

  const retrySession = useCallback(async () => {
    setLastError(null);
    setReconnecting(true);

    try {
      if (connected) {
        await disconnect();
      }
      await connect();
    } catch (error) {
      setLastError(toErrorMessage(error, "Retry failed. Check API key and network."));
    } finally {
      setReconnecting(false);
    }
  }, [connected, connect, disconnect, setLastError, setReconnecting]);

  const submitTextPrompt = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = inputDraft.trim();
      if (!trimmed || !connected) {
        return;
      }

      client.send([{ text: trimmed }]);
      setInputDraft("");
    },
    [client, connected, inputDraft],
  );

  /* ─── Derived state ─── */

  const showCamera = activeMode === "SPOT";

  /* ─── Render ─── */

  return (
    <div className="awaaz-app">
      <canvas ref={frameCanvasRef} className="hidden-canvas" />

      {/* ─── Header ─── */}
      <header className="top-bar">
        <h1 className="brand">awaaz</h1>
        <button
          className={cn("gps-toggle", { active: locationEnabled })}
          onClick={() => setLocationEnabled((v) => !v)}
          disabled={locationLoading}
        >
          📍{" "}
          {locationLoading
            ? "..."
            : locationEnabled && userLocation
              ? `${userLocation.area ? `${userLocation.area}, ` : ""}${userLocation.city}`
              : "Location"}
        </button>
      </header>

      {/* ─── Mode selector ─── */}
      <nav className="mode-selector">
        {(Object.keys(MODE_DETAILS) as NativeMode[]).map((mode) => (
          <button
            key={mode}
            className={cn("mode-pill", { active: activeMode === mode })}
            onClick={() => void switchMode(mode)}
          >
            <span className="mode-icon">{MODE_DETAILS[mode].icon}</span>
            <span className="mode-title">{MODE_DETAILS[mode].title}</span>
          </button>
        ))}
      </nav>

      <p className="mode-blurb">{MODE_DETAILS[activeMode].blurb}</p>

      {/* ─── Language pair ─── */}
      <div className="lang-pair">
        <div className="lang-picker">
          <label htmlFor="source-lang">Local</label>
          <select
            id="source-lang"
            value={sourceLanguage.id}
            onChange={(e) =>
              setSourceLanguage(getLanguage(e.target.value, sourceLanguage))
            }
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.display} ({l.label})
              </option>
            ))}
          </select>
        </div>
        <span className="lang-arrow">→</span>
        <div className="lang-picker">
          <label htmlFor="target-lang">You</label>
          <select
            id="target-lang"
            value={targetLanguage.id}
            onChange={(e) =>
              setTargetLanguage(getLanguage(e.target.value, targetLanguage))
            }
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.display} ({l.label})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Main area ─── */}
      <main className="main-area">
        {showCamera ? (
          <div className="camera-feed">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={cn("stream", { hidden: !activeStream })}
            />
            {!activeStream && (
              <div className="camera-placeholder">
                <p>📷</p>
                <span>Camera will activate when you connect</span>
              </div>
            )}
          </div>
        ) : (
          <div className={cn("audio-viz", { pulsing: connected && volume > 0.02 })}>
            <div className="viz-ring" />
            <div className="viz-ring ring-2" />
            <div className="viz-ring ring-3" />
            <span className="viz-label">
              {connected
                ? activeMode === "BRIDGE"
                  ? "Listening to surroundings..."
                  : "Listening..."
                : "Tap Start to begin"}
            </span>
          </div>
        )}
      </main>

      {/* ─── Risk toast ─── */}
      {currentRisk && (
        <div
          className={cn("risk-toast", currentRisk.level)}
          onClick={() => setCurrentRisk(null)}
        >
          <span className="risk-badge">
            {currentRisk.level === "high" ? "🚨" : currentRisk.level === "medium" ? "⚠️" : "💡"}{" "}
            {currentRisk.level.toUpperCase()} {currentRisk.type}
          </span>
          <p className="risk-cue">"{currentRisk.cue}"</p>
          <p className="risk-reason">{currentRisk.reason}</p>
          <p className="risk-action"><strong>→</strong> {currentRisk.action}</p>
        </div>
      )}

      {/* ─── Formatted content panel (SPOT mode) ─── */}
      {activeMode === "SPOT" && formattedContents.length > 0 && (
        <section className="fc-panel">
          <div className="fc-panel-head">
            <strong>📄 Visual Content</strong>
            <button
              className="fc-clear"
              onClick={() => setFormattedContents([])}
            >
              Clear
            </button>
          </div>
          <div className="fc-list">
            {formattedContents.map((fc) => (
              <div key={fc.id} className="fc-card">
                <div className="fc-card-head">
                  <span className="fc-type-badge">
                    {fc.contentType === "menu" && "🍽️"}
                    {fc.contentType === "document" && "📃"}
                    {fc.contentType === "form" && "📝"}
                    {fc.contentType === "sign" && "🪧"}
                    {fc.contentType === "table" && "📊"}
                    {fc.contentType === "general" && "📄"}
                    {" "}{fc.contentType}
                  </span>
                  <span className="fc-time">
                    {new Date(fc.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="fc-title">{fc.title}</p>
                <div className="fc-markdown">
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
                    {fc.markdown}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Transcript strip ─── */}
      <section className="transcript-strip">
        <div className="transcript-cell">
          <span>You hear</span>
          <p>{lastInputTranscript || "..."}</p>
        </div>
        <div className="transcript-cell">
          <span>Awaaz says</span>
          <p>{lastOutputTranscript || "..."}</p>
        </div>
      </section>

      {/* ─── Quick ask (visible when connected) ─── */}
      {connected && (
        <form onSubmit={submitTextPrompt} className="quick-ask">
          <input
            value={inputDraft}
            onChange={(e) => setInputDraft(e.target.value)}
            placeholder="Type a question..."
            disabled={!connected}
          />
          <button type="submit" disabled={!connected || !inputDraft.trim()}>
            Send
          </button>
        </form>
      )}

      {/* ─── Connect FAB ─── */}
      <button
        className={cn("connect-fab", {
          connected,
          disabled: sessionHealth.reconnecting,
        })}
        onClick={() => void toggleConnection()}
        disabled={sessionHealth.reconnecting}
      >
        {sessionHealth.reconnecting
          ? "..."
          : connected
            ? "⏸ Pause"
            : "▶ Start"}
      </button>

      {/* ─── Error banner ─── */}
      {(sessionHealth.lastError || sessionHealth.reconnecting) && (
        <div className="error-banner">
          <p>{sessionHealth.lastError || "Reconnecting..."}</p>
          <button onClick={() => void retrySession()}>Retry</button>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <LiveAPIProvider options={apiOptions}>
      <AwaazConsole />
    </LiveAPIProvider>
  );
}

export default App;
