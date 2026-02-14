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
const CONTRACT_FUNCTION_NAME = "emit_contract_term";

/* ─── Types ─── */

type NativeMode = "GUIDE" | "SPOT" | "BAKSHI";
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

type ContractTerm = {
  id: string;
  type: string;
  parties: string;
  summary: string;
  amount?: string;
  obligation?: string;
  deadline?: string;
  confidence: number;
};

type UserLocation = {
  latitude: number;
  longitude: number;
  city: string;
  area: string;
  state: string;
  country: string;
  localTime: string;
  fetchedAt: number;
} | null;

type PromptContext = {
  mode: NativeMode;
  targetLanguage: LanguageChoice;
  userLocation: UserLocation;
  cameraOn: boolean;
};

type RiskSignal = {
  id: string;
  type: RiskType;
  level: RiskLevel;
  cue: string;
  reason: string;
  action: string;
  confidence: number;
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

const MODE_DETAILS: Record<NativeMode, { title: string; blurb: string }> = {
  GUIDE: {
    title: "Guide",
    blurb: "Voice-first translation and guidance.",
  },
  SPOT: {
    title: "Spot",
    blurb: "Camera companion — reads signs and menus.",
  },
  BAKSHI: {
    title: "Bakshi",
    blurb: "Digital contract witness.",
  },
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
    "Emit a risk signal when actionable risk is detected for price gouging, misinformation, or urgency/pressure.",
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
    "Emit a structured markdown breakdown of complex visual content (menus, documents, forms, signs, tables). Use alongside a spoken summary.",
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
        description: "Short title for the content.",
      },
      markdown: {
        type: Type.STRING,
        description: "Detailed markdown breakdown translated into the target language. Use tables, bullet lists, headers.",
      },
      language: {
        type: Type.STRING,
        description: "The language the markdown is written in.",
      },
    },
    required: ["contentType", "title", "markdown", "language"],
  },
};

const CONTRACT_FUNCTION_DECLARATION: FunctionDeclaration = {
  name: CONTRACT_FUNCTION_NAME,
  description:
    "Extract a structured contract term from the oral agreement being discussed.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, description: "Type of term (payment, service, penalty, duration, etc.)." },
      parties: { type: Type.STRING, description: "Names or roles of the parties involved." },
      summary: { type: Type.STRING, description: "Concise summary of the agreed term." },
      amount: { type: Type.STRING, description: "Monetary amount if applicable." },
      obligation: { type: Type.STRING, description: "What is owed or required." },
      deadline: { type: Type.STRING, description: "Due date or timeframe." },
      confidence: { type: Type.NUMBER, description: "Confidence in this extraction from 0.0 to 1.0." },
    },
    required: ["type", "parties", "summary", "confidence"],
  },
};

const LANGUAGE_BY_ID = LANGUAGES.reduce<Record<string, LanguageChoice>>(
  (map, l) => { map[l.id] = l; return map; },
  {},
);

const DEFAULT_TARGET_LANGUAGE =
  LANGUAGE_BY_ID[process.env.REACT_APP_DEFAULT_TARGET_LANG || ""] ||
  LANGUAGE_BY_ID["hi-IN"] ||
  LANGUAGES[0];

/* ─── Helpers ─── */

function getLanguage(id: string, fallback: LanguageChoice) {
  return LANGUAGE_BY_ID[id] || fallback;
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isPermissionDeniedError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

function clampConfidence(v: number) {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function createRiskId() {
  return `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseRiskLevel(raw: unknown): RiskLevel | null {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "low" || v === "medium" || v === "high") return v;
  return null;
}

function parseRiskType(raw: unknown): RiskType | null {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "price" || v === "misinformation" || v === "urgency") return v;
  return null;
}

function parseRiskSignalFromArgs(
  args: Record<string, unknown> | undefined,
  targetLanguage: LanguageChoice,
): RiskSignal | null {
  if (!args) return null;
  const type = parseRiskType(args.type);
  const level = parseRiskLevel(args.level);
  const cue = String(args.cue || "").trim();
  const reason = String(args.reason || "").trim();
  const action = String(args.action || "").trim();
  const confidence = clampConfidence(Number(args.confidence || 0));
  const baselineReference = String(args.baselineReference || "").trim();
  if (!type || !level || !cue || !reason || !action) return null;
  return {
    id: createRiskId(), type, level, cue, reason, action, confidence,
    targetLanguage: targetLanguage.id,
    timestamp: new Date().toISOString(),
    baselineReference: baselineReference || undefined,
    source: "model",
  };
}

function detectHeuristicRisk(
  transcript: string,
  targetLanguage: LanguageChoice,
): RiskSignal | null {
  const text = transcript.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const urgency = ["immediately", "urgent", "fine", "penalty", "police", "last warning", "deadline", "jaldi", "tatkal"];
  const misinfo = ["agent", "shortcut", "sign quickly", "don't read", "different office", "extra charge for form", "commission", "broker"];
  const priceHints = /(₹|rs\.?|rupees|fare|charge|fees|price|rate|cost|ticket|rent)/i;
  const highAmt = /\b([5-9]\d{2}|\d{4,})\b/;

  if (urgency.some(k => lower.includes(k))) {
    return { id: createRiskId(), type: "urgency", level: "medium", cue: text.slice(0, 110), reason: "Urgent enforcement or deadline language detected.", action: "Pause, verify with official staff before acting.", confidence: 0.66, targetLanguage: targetLanguage.id, timestamp: new Date().toISOString(), source: "heuristic" };
  }
  if (misinfo.some(k => lower.includes(k))) {
    return { id: createRiskId(), type: "misinformation", level: "medium", cue: text.slice(0, 110), reason: "Potential misleading instruction detected.", action: "Ask for written proof and confirm at official counter.", confidence: 0.64, targetLanguage: targetLanguage.id, timestamp: new Date().toISOString(), source: "heuristic" };
  }
  if (priceHints.test(lower) && highAmt.test(lower)) {
    return { id: createRiskId(), type: "price", level: "low", cue: text.slice(0, 110), reason: "Price mention detected. Overcharge check recommended.", action: "Ask for printed rate or compare with local fare.", confidence: 0.56, targetLanguage: targetLanguage.id, timestamp: new Date().toISOString(), baselineReference: "Context estimate; confirm with local posted rates.", source: "heuristic" };
  }
  return null;
}

/* ─── Prompt Building ─── */

function buildModeInstruction(
  mode: NativeMode,
  targetLanguage: LanguageChoice,
) {
  if (mode === "GUIDE") {
    return `CURRENT MODE: GUIDE (Voice-First Translation & Guidance)

You are translating and explaining what the user hears around them. The microphone picks up speech from people talking to the user, announcements, conversations, vendors, etc.

CRITICAL RULE -- TRANSLATE FIRST, NEVER ANSWER AS YOURSELF:
- You are NOT a chatbot. You are a translator and guide.
- When you hear speech in ANY language, your FIRST job is to TRANSLATE it into ${targetLanguage.label}.
- Do NOT interpret questions as being asked to you. They are being spoken BY someone else TO the user.
- Example: if you hear "aapka naam kya hai?" in Hindi, you must translate it as: "They are asking: What is your name?" -- do NOT reply with your own name.
- Example: if you hear "yeh kitne ka hai?" you translate: "They are asking: How much does this cost?"
- Only provide guidance/answers when the user EXPLICITLY addresses you (e.g. "Hey Native, what should I do?").

YOUR JOB:
1. AUTO-DETECT the language of incoming speech every turn. Do not assume -- detect from the audio/text.
2. If the detected language DIFFERS from ${targetLanguage.label}: translate it accurately into ${targetLanguage.label}, then briefly explain the intent and suggest what the user should do or say back.
3. If the detected language IS ${targetLanguage.label}: provide a concise interpretation and actionable next step. Do not re-translate.
4. Use Google Search grounding when the context involves local information: bus routes, train timings, government office procedures, local prices, customs, or anything you are not 100% certain about.
5. If the user describes a situation (e.g. "someone is asking me to pay 500 for a form"), proactively assess whether it sounds legitimate and advise accordingly.

PRICING RULES (STRICT -- NEVER VIOLATE):
- NEVER invent, guess, or hallucinate a specific price. If you don't have grounded search data, say "I'm not sure of the exact price" and use Google Search.
- ALWAYS use Google Search grounding BEFORE quoting any price, fare, fee, or cost.
- Only quote prices that come directly from search results.
- Prefer price RANGES over exact numbers (e.g. "typically 50-100 rupees" not "75 rupees").
- Always add a disclaimer: "prices may vary" or "based on search results".
- If search returns no price data, say so honestly: "I couldn't find current pricing -- ask the vendor directly and check posted rates."
- When someone quotes a price to the user, compare it against search-grounded data. If no data exists, say "I can't verify this -- ask for a printed rate card."

BEHAVIORAL RULES:
- Stay silent during silence. Do not narrate or fill gaps.
- Keep responses under 3-4 sentences unless the user asks for more detail.
- If you hear ambient noise that is not speech, ignore it.
- Always respond in ${targetLanguage.label}.
- Structure: first speak the translation (1 line), then briefly explain meaning and suggest next action.`;
  }

  if (mode === "SPOT") {
    return `CURRENT MODE: SPOT (Camera Companion)

You have access to both the user's microphone and camera. You can see what they see and hear what they say.

YOUR JOB:
1. PROACTIVE VISUAL READING: When you see text, signs, labels, menus, notices, timetables, or documents in the camera -- read them aloud and explain what they mean and what the user should do, all in ${targetLanguage.label}.
2. COMPLEX CONTENT -> FORMATTED OUTPUT: When you see content with more than 3 items or structured data (menus with prices, timetables, forms with fields, multi-line notices), do BOTH:
   a. Speak a brief audio summary (2-3 sentences, key points only).
   b. Call the ${FORMATTED_CONTENT_FUNCTION_NAME} function with a full markdown breakdown translated into ${targetLanguage.label}. Use tables for prices, bullet lists for items, and headers for sections.
3. CONVERSATIONAL: The user can also ask you questions about what they see or about anything else. Answer in ${targetLanguage.label} with step-by-step guidance. Use Google Search grounding for local facts.
4. RISK DETECTION: If you see or hear pricing that seems inflated, a suspicious sign, or a misleading notice -- flag it via ${RISK_FUNCTION_NAME}.
5. AUTO-DETECT any language visible in the camera. Translate naturally into ${targetLanguage.label}.

PRICING RULES (STRICT -- NEVER VIOLATE):
- NEVER invent, guess, or hallucinate a specific price. If you don't have grounded search data, say "I'm not sure of the exact price" and use Google Search.
- ALWAYS use Google Search grounding BEFORE quoting any price, fare, fee, or cost.
- Only quote prices that come directly from search results.
- Prefer price RANGES over exact numbers.
- Always add a disclaimer: "prices may vary" or "based on search results".

BEHAVIORAL RULES:
- When nothing new is visible, stay silent. Do not narrate the same scene repeatedly.
- Prioritize what's most actionable: prices, directions, deadlines, warnings.
- When reading a sign in another language, translate it naturally -- don't read the original aloud unless the user asks.
- For documents and forms: explain each field's purpose and what the user should fill in.`;
  }

  // BAKSHI mode
  return `CURRENT MODE: BAKSHI (Digital Contract Witness)

You are BAKSHI -- an oral contract witness and structuring assistant.

YOUR JOB:
- Listen to two-party agreement discussions and capture each concrete term.
- For each commitment, amount, obligation, or deadline mentioned, call ${CONTRACT_FUNCTION_NAME} to extract and record it.
- Ask concise clarifying questions if essential fields are missing (e.g. amount, deadline, parties).
- When asked for a summary, provide a clear, structured overview of all captured terms.
- Output in ${targetLanguage.label} (${targetLanguage.display}).

RULES:
- Be neutral and factual. You are a witness, not an advisor.
- Do NOT provide legal advice or opinions on fairness.
- Do NOT take sides between parties.
- Capture terms exactly as stated. If something is ambiguous, flag it explicitly.
- Stay silent when parties are not discussing terms.
- When a party makes a commitment, immediately extract it via ${CONTRACT_FUNCTION_NAME}.`;
}

function buildLocationBlock(location: UserLocation): string {
  if (!location) return "";
  const parts = [location.area, location.city, location.state, location.country].filter(Boolean);
  return `
USER LOCATION:
- Place: ${parts.join(", ")}
- GPS: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}
- Local time: ${location.localTime}
- Use this location for all context: price comparisons, directions, local customs, nearby landmarks, time-appropriate suggestions. If the user asks "where" or "how to get to", use their GPS as starting point.`;
}

function buildSystemPrompt({ mode, targetLanguage, userLocation }: PromptContext) {
  return `You are native -- a realtime voice companion for travellers and migrants in India.

IDENTITY:
- You are a trusted local companion. Speak clearly and simply.
- Always respond in ${targetLanguage.label} (${targetLanguage.display}).
- Be concise and actionable. No filler phrases.
- Auto-detect the language of incoming speech every turn.
- NEVER answer questions as if they are directed at you. Translate them for the user instead (unless user explicitly addresses you).

${buildModeInstruction(mode, targetLanguage)}

SAFETY:
- No medical diagnoses, legal verdicts, or prescriptions.
- You may translate and explain official documents and notices in plain language.
- If unsure, say so. Do not fabricate information.
- NEVER fabricate prices, fares, fees, or costs. Use Google Search grounding for ALL price/cost queries. If grounding returns no data, tell the user you cannot confirm the price.

RISK AWARENESS (always active in GUIDE and SPOT modes):
- Monitor for: price gouging, misinformation, urgency/pressure tactics.
- When detected, call ${RISK_FUNCTION_NAME} with type, level, cue, reason, action, confidence.
- For price risks: ALWAYS use Google Search grounding to find real local rates before comparing. Never compare against a made-up baseline. If no grounding data exists, tell the user to verify with official/posted rates.
${buildLocationBlock(userLocation)}`;
}

/* ─── Config Builder ─── */

function buildConfig(
  promptContext: PromptContext,
  voiceName: string,
): LiveConnectConfig {
  const tools: Tool[] = [];

  if (promptContext.mode === "GUIDE" || promptContext.mode === "SPOT") {
    tools.push({ googleSearch: {} });
  }

  const fnDeclarations: FunctionDeclaration[] = [];

  if (promptContext.mode === "GUIDE" || promptContext.mode === "SPOT") {
    fnDeclarations.push(RISK_FUNCTION_DECLARATION);
  }
  if (promptContext.mode === "SPOT") {
    fnDeclarations.push(FORMATTED_CONTENT_DECLARATION);
  }
  if (promptContext.mode === "BAKSHI") {
    fnDeclarations.push(CONTRACT_FUNCTION_DECLARATION);
  }

  if (fnDeclarations.length > 0) {
    tools.push({ functionDeclarations: fnDeclarations });
  }

  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName } },
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

function NativeConsole() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const reconnectGuardRef = useRef<string>("");
  const riskCooldownByType = useRef<Record<RiskType, number>>({
    price: 0, misinformation: 0, urgency: 0,
  });

  const webcam = useWebcam();
  const screenCapture = useScreenCapture();

  const [activeMode, setActiveMode] = useState<NativeMode>("GUIDE");
  const [targetLanguage, setTargetLanguage] = useState<LanguageChoice>(DEFAULT_TARGET_LANGUAGE);
  const [activeVoice] = useState<string>(VOICES[0]);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const [currentRisk, setCurrentRisk] = useState<RiskSignal | null>(null);
  const [formattedContents, setFormattedContents] = useState<FormattedContent[]>([]);
  const [contractTerms, setContractTerms] = useState<ContractTerm[]>([]);

  const [inputDraft, setInputDraft] = useState("");
  const [lastInputTranscript, setLastInputTranscript] = useState("");
  const [lastOutputTranscript, setLastOutputTranscript] = useState("");

  const [sessionHealth, setSessionHealth] = useState<SessionHealth>({
    permissions: { mic: "unknown", vision: "unknown" },
    connected: false, reconnecting: false, lastError: null,
  });

  const [audioRecorder] = useState(() => new AudioRecorder());

  const { client, connected, connect, disconnect, volume, setConfig, setModel } =
    useLiveAPIContext();

  /* ─── Location ─── */

  useEffect(() => {
    if (!locationEnabled) { setUserLocation(null); return; }

    let cancelled = false;
    setLocationLoading(true);

    const fetchLocation = async () => {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 60000,
          }),
        );
        const { latitude, longitude } = pos.coords;

        let city = "Unknown", area = "", state = "", country = "India";
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en`,
            { headers: { "User-Agent": "native-app/1.0" } },
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            city = addr.city || addr.town || addr.village || addr.county || "Unknown";
            area = addr.suburb || addr.neighbourhood || addr.road || "";
            state = addr.state || "";
            country = addr.country || "India";
          }
        } catch { /* GPS still usable */ }

        const localTime = new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata", weekday: "long", year: "numeric",
          month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
        });

        if (!cancelled) {
          setUserLocation({ latitude, longitude, city, area, state, country, localTime, fetchedAt: Date.now() });
          setLocationLoading(false);
        }
      } catch {
        if (!cancelled) { setLocationLoading(false); setLocationEnabled(false); setUserLocation(null); }
      }
    };

    void fetchLocation();
    const id = window.setInterval(() => void fetchLocation(), 300000);
    return () => { cancelled = true; clearInterval(id); };
  }, [locationEnabled]);

  /* ─── Config ─── */

  const promptContext = useMemo<PromptContext>(() => ({
    mode: activeMode,
    targetLanguage,
    userLocation: locationEnabled ? userLocation : null,
    cameraOn,
  }), [activeMode, targetLanguage, locationEnabled, userLocation, cameraOn]);

  const sessionConfig = useMemo(() => buildConfig(promptContext, activeVoice), [promptContext, activeVoice]);
  const sessionSignature = useMemo(() => JSON.stringify(sessionConfig), [sessionConfig]);

  /* ─── State helpers ─── */

  const setLastError = useCallback((msg: string | null) => {
    setSessionHealth(p => ({ ...p, lastError: msg }));
  }, []);

  const setPermission = useCallback((kind: "mic" | "vision", value: PermissionFlag) => {
    setSessionHealth(p => ({ ...p, permissions: { ...p.permissions, [kind]: value } }));
  }, []);

  const setReconnecting = useCallback((v: boolean) => {
    setSessionHealth(p => ({ ...p, reconnecting: v }));
  }, []);

  const shouldReplaceRisk = useCallback((prev: RiskSignal | null, next: RiskSignal) => {
    if (!prev) return true;
    if (prev.source === "model" && next.source === "heuristic" && RISK_LEVEL_PRIORITY[prev.level] >= RISK_LEVEL_PRIORITY.medium) {
      if (Date.now() - new Date(prev.timestamp).getTime() < 45000) return false;
    }
    if (next.source === "model" && prev.source === "heuristic") return true;
    return RISK_LEVEL_PRIORITY[next.level] >= RISK_LEVEL_PRIORITY[prev.level];
  }, []);

  const applyRiskSignal = useCallback((signal: RiskSignal) => {
    if (!RISK_POLICY.enabledTypes.includes(signal.type)) return false;
    if (signal.level === "medium" && signal.confidence < RISK_POLICY.minConfidenceForMedium) return false;
    if (signal.level === "high" && signal.confidence < RISK_POLICY.minConfidenceForHigh) return false;
    const now = Date.now();
    if (now - riskCooldownByType.current[signal.type] < RISK_POLICY.cooldownMs) return false;
    riskCooldownByType.current[signal.type] = now;
    setCurrentRisk(p => (shouldReplaceRisk(p, signal) ? signal : p));
    return true;
  }, [shouldReplaceRisk]);

  const maybeApplyHeuristicRisk = useCallback((transcript: string) => {
    const sig = detectHeuristicRisk(transcript, targetLanguage);
    if (sig) void applyRiskSignal(sig);
  }, [applyRiskSignal, targetLanguage]);

  /* ─── Session lifecycle ─── */

  useEffect(() => { setModel(MODEL_NAME); setConfig(sessionConfig); }, [sessionConfig, setConfig, setModel]);
  useEffect(() => { setSessionHealth(p => ({ ...p, connected })); }, [connected]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => setLastError(e.message || "Session error.");
    client.on("error", onError);
    return () => { client.off("error", onError); };
  }, [client, setLastError]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    (async () => {
      try {
        const mic = await navigator.permissions.query({ name: "microphone" as PermissionName });
        const cam = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (!cancelled) { setPermission("mic", mic.state as PermissionFlag); setPermission("vision", cam.state as PermissionFlag); }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [setPermission]);

  useEffect(() => {
    if (!reconnectGuardRef.current) { reconnectGuardRef.current = sessionSignature; return; }
    const prev = reconnectGuardRef.current;
    reconnectGuardRef.current = sessionSignature;
    if (!connected || prev === sessionSignature) return;
    let cancelled = false;
    setReconnecting(true); setLastError(null);
    (async () => {
      try { await disconnect(); if (!cancelled) await connect(); }
      catch (e) { if (!cancelled) setLastError(toErrorMessage(e, "Failed to refresh session.")); }
      finally { if (!cancelled) setReconnecting(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionSignature, connected, connect, disconnect, setLastError, setReconnecting]);

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = activeStream; }, [activeStream]);

  /* ─── Mic ─── */

  const enableMic = useCallback(async () => {
    if (sessionHealth.permissions.mic === "granted") { setMicEnabled(true); return true; }
    if (!navigator.mediaDevices?.getUserMedia) { setLastError("Mic not supported."); return false; }
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(t => t.stop());
      setPermission("mic", "granted"); setLastError(null); setMicEnabled(true);
      return true;
    } catch (e) {
      if (isPermissionDeniedError(e)) setPermission("mic", "denied");
      setMicEnabled(false); setLastError(toErrorMessage(e, "Mic permission blocked."));
      return false;
    }
  }, [sessionHealth.permissions.mic, setLastError, setPermission]);

  useEffect(() => {
    let cancelled = false;
    const onData = (b64: string) => { client.sendRealtimeInput([{ mimeType: "audio/pcm;rate=16000", data: b64 }]); };
    const start = async () => {
      try { audioRecorder.on("data", onData); await audioRecorder.start(); if (!cancelled) setPermission("mic", "granted"); }
      catch (e) { if (isPermissionDeniedError(e)) setPermission("mic", "denied"); if (!cancelled) { setMicEnabled(false); setLastError(toErrorMessage(e, "Could not start mic.")); } }
    };
    if (connected && micEnabled) void start(); else audioRecorder.stop();
    return () => { cancelled = true; audioRecorder.off("data", onData); };
  }, [audioRecorder, client, connected, micEnabled, setLastError, setPermission]);

  /* ─── Camera ─── */

  const turnOnCamera = useCallback(async () => {
    try {
      const stream = await webcam.start();
      screenCapture.stop();
      setActiveStream(stream); setCameraOn(true);
      setPermission("vision", "granted"); setLastError(null);
      return true;
    } catch (e) {
      if (isPermissionDeniedError(e)) setPermission("vision", "denied");
      setCameraOn(false); setLastError(toErrorMessage(e, "Could not start camera."));
      return false;
    }
  }, [webcam, screenCapture, setLastError, setPermission]);

  const turnOffCamera = useCallback(() => {
    webcam.stop(); screenCapture.stop();
    setActiveStream(null); setCameraOn(false);
  }, [screenCapture, webcam]);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) turnOffCamera(); else await turnOnCamera();
  }, [cameraOn, turnOffCamera, turnOnCamera]);

  /* ─── Frame capture ─── */

  useEffect(() => {
    let tid = -1;
    const send = () => {
      const v = videoRef.current, c = frameCanvasRef.current;
      if (!v || !c || !connected || !cameraOn) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      c.width = Math.max(1, Math.floor(v.videoWidth * 0.33));
      c.height = Math.max(1, Math.floor(v.videoHeight * 0.33));
      if (c.width > 1 && c.height > 1) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/jpeg", 0.9);
        client.sendRealtimeInput([{ mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) }]);
      }
      tid = window.setTimeout(send, 1000);
    };
    if (connected && cameraOn && activeStream) requestAnimationFrame(send);
    return () => clearTimeout(tid);
  }, [connected, cameraOn, activeStream, client]);

  /* ─── Tool calls ─── */

  useEffect(() => {
    const onToolCall = (toolCall: LiveServerToolCall) => {
      if (!toolCall.functionCalls?.length) return;
      const responses = toolCall.functionCalls.map(fc => {
        if (fc.name === RISK_FUNCTION_NAME) {
          const parsed = parseRiskSignalFromArgs(fc.args, targetLanguage);
          if (!parsed) return { id: fc.id, name: fc.name, response: { output: { accepted: false, reason: "Malformed." } } };
          const accepted = applyRiskSignal(parsed);
          return { id: fc.id, name: fc.name, response: { output: { accepted, reason: accepted ? "Recorded." : "Filtered." } } };
        }
        if (fc.name === FORMATTED_CONTENT_FUNCTION_NAME) {
          const a = fc.args || {};
          const ct = String(a.contentType || "general").trim() as FormattedContentType;
          const title = String(a.title || "").trim();
          const md = String(a.markdown || "").trim();
          const lang = String(a.language || "").trim();
          if (!["menu", "document", "form", "sign", "table", "general"].includes(ct) || !title || !md) {
            return { id: fc.id, name: fc.name, response: { output: { accepted: false, reason: "Malformed." } } };
          }
          setFormattedContents(p => [{ id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, contentType: ct, title, markdown: md, language: lang, timestamp: new Date().toISOString() }, ...p].slice(0, 10));
          return { id: fc.id, name: fc.name, response: { output: { accepted: true, reason: "Recorded." } } };
        }
        if (fc.name === CONTRACT_FUNCTION_NAME) {
          const a = fc.args || {};
          const term: ContractTerm = {
            id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: String(a.type || "general"),
            parties: String(a.parties || ""),
            summary: String(a.summary || ""),
            amount: a.amount ? String(a.amount) : undefined,
            obligation: a.obligation ? String(a.obligation) : undefined,
            deadline: a.deadline ? String(a.deadline) : undefined,
            confidence: clampConfidence(Number(a.confidence || 0.5)),
          };
          if (term.summary) {
            setContractTerms(p => [term, ...p].slice(0, 40));
          }
          return { id: fc.id, name: fc.name, response: { output: { accepted: true, reason: "Contract term recorded." } } };
        }
        return { id: fc.id, name: fc.name, response: { output: { accepted: false, reason: "Unknown." } } };
      });
      if (responses.length) client.sendToolResponse({ functionResponses: responses });
    };
    client.on("toolcall", onToolCall);
    return () => { client.off("toolcall", onToolCall); };
  }, [applyRiskSignal, client, targetLanguage]);

  /* ─── Content ─── */

  useEffect(() => {
    const onContent = (content: LiveServerContent) => {
      if (content.inputTranscription?.text) { setLastInputTranscript(content.inputTranscription.text); maybeApplyHeuristicRisk(content.inputTranscription.text); }
      if (content.outputTranscription?.text) { setLastOutputTranscript(content.outputTranscription.text); maybeApplyHeuristicRisk(content.outputTranscription.text); }
      const text = content.modelTurn?.parts?.map(p => (typeof p.text === "string" ? p.text : "")).join("\n").trim() || "";
      if (text) maybeApplyHeuristicRisk(text);
    };
    client.on("content", onContent);
    return () => { client.off("content", onContent); };
  }, [client, maybeApplyHeuristicRisk]);

  /* ─── Actions ─── */

  const switchMode = useCallback(async (mode: NativeMode) => {
    setActiveMode(mode);
    setLastError(null);
    setFormattedContents([]);

    // SPOT mode: auto-start camera
    if (mode === "SPOT") {
      if (!cameraOn) await turnOnCamera();
    } else {
      // Other modes: turn off camera
      if (cameraOn) turnOffCamera();
    }

    // Always need mic
    if (!micEnabled) await enableMic();
  }, [cameraOn, turnOffCamera, turnOnCamera, enableMic, micEnabled, setLastError]);

  const toggleConnection = useCallback(async () => {
    setLastError(null); setReconnecting(true);
    try {
      if (connected) { await disconnect(); }
      else { if (!micEnabled) await enableMic(); await connect(); }
    } catch (e) { setLastError(toErrorMessage(e, "Connection failed.")); }
    finally { setReconnecting(false); }
  }, [connected, connect, disconnect, setLastError, setReconnecting, enableMic, micEnabled]);

  const retrySession = useCallback(async () => {
    setLastError(null); setReconnecting(true);
    try { if (connected) await disconnect(); await connect(); }
    catch (e) { setLastError(toErrorMessage(e, "Retry failed.")); }
    finally { setReconnecting(false); }
  }, [connected, connect, disconnect, setLastError, setReconnecting]);

  const submitTextPrompt = useCallback((e: FormEvent) => {
    e.preventDefault();
    const t = inputDraft.trim();
    if (!t || !connected) return;
    client.send([{ text: t }]);
    setInputDraft("");
  }, [client, connected, inputDraft]);

  const runBakshiAction = useCallback((kind: "start" | "clarify" | "summary") => {
    if (!connected) return;
    const prompts = {
      start: "Begin as BAKSHI witness. Ask both parties to state names and first agreed term clearly.",
      clarify: "Ask clarifying questions for missing amounts, obligations, deadlines, and penalties.",
      summary: "Provide concise final agreement summary and list missing or ambiguous terms.",
    };
    client.send([{ text: `[BAKSHI_ACTION:${kind.toUpperCase()}] ${prompts[kind]}` }]);
  }, [client, connected]);

  /* ─── Render ─── */

  return (
    <div className="native-app">
      <canvas ref={frameCanvasRef} className="hidden-canvas" />

      <header className="top-bar">
        <h1 className="brand">native</h1>
        <div className="top-actions">
          <button
            className={cn("pill-btn", { active: locationEnabled })}
            onClick={() => setLocationEnabled(v => !v)}
            disabled={locationLoading}
          >
            {locationLoading
              ? "locating..."
              : locationEnabled && userLocation
                ? `${userLocation.city}`
                : "location"}
          </button>
        </div>
      </header>

      <nav className="mode-bar">
        {(Object.keys(MODE_DETAILS) as NativeMode[]).map(mode => (
          <button
            key={mode}
            className={cn("mode-btn", { active: activeMode === mode })}
            onClick={() => void switchMode(mode)}
          >
            {MODE_DETAILS[mode].title}
          </button>
        ))}
      </nav>

      <div className="lang-row">
        <label htmlFor="target-lang">I speak</label>
        <select
          id="target-lang"
          value={targetLanguage.id}
          onChange={e => setTargetLanguage(getLanguage(e.target.value, targetLanguage))}
        >
          {LANGUAGES.map(l => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>

      <main className="main-area">
        {cameraOn && activeMode === "SPOT" ? (
          <div className="camera-feed">
            <video ref={videoRef} autoPlay playsInline className={cn("stream", { hidden: !activeStream })} />
            {!activeStream && <div className="placeholder"><span>Camera starting...</span></div>}
          </div>
        ) : activeMode === "BAKSHI" ? (
          <div className="bakshi-area">
            <div className="bakshi-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className="area-label">
              {connected ? "listening for agreement" : "tap start to begin"}
            </span>
          </div>
        ) : (
          <div className={cn("audio-area", { pulsing: connected && volume > 0.02 })}>
            <div className="ring r1" />
            <div className="ring r2" />
            <span className="area-label">
              {connected ? "listening" : "tap start"}
            </span>
          </div>
        )}
      </main>

      {activeMode === "SPOT" && (
        <button
          className={cn("pill-btn camera-toggle", { active: cameraOn })}
          onClick={() => void toggleCamera()}
        >
          {cameraOn ? "camera on" : "camera off"}
        </button>
      )}

      {activeMode === "BAKSHI" && connected && (
        <div className="bakshi-actions">
          <button className="pill-btn" onClick={() => runBakshiAction("start")}>
            Start Agreement
          </button>
          <button className="pill-btn" onClick={() => runBakshiAction("clarify")}>
            Clarify Terms
          </button>
          <button className="pill-btn" onClick={() => runBakshiAction("summary")}>
            Generate Summary
          </button>
        </div>
      )}

      <div className="transcript">
        <div className="t-cell">
          <span className="t-label">heard</span>
          <p className="t-text">{lastInputTranscript || "\u2014"}</p>
        </div>
        <div className="t-cell">
          <span className="t-label">native</span>
          <p className="t-text">{lastOutputTranscript || "\u2014"}</p>
        </div>
      </div>

      {currentRisk && (
        <div className={cn("risk-toast", currentRisk.level)} onClick={() => setCurrentRisk(null)}>
          <p className="rt-head">{currentRisk.level} — {currentRisk.type}</p>
          <p className="rt-cue">{currentRisk.cue}</p>
          <p className="rt-action">{currentRisk.action}</p>
        </div>
      )}

      {formattedContents.length > 0 && (
        <section className="fc-panel">
          <div className="fc-head">
            <strong>Content</strong>
            <button className="pill-btn sm" onClick={() => setFormattedContents([])}>clear</button>
          </div>
          {formattedContents.map(fc => (
            <div key={fc.id} className="fc-card">
              <p className="fc-title">{fc.title}</p>
              <pre className="fc-md">{fc.markdown}</pre>
            </div>
          ))}
        </section>
      )}

      {contractTerms.length > 0 && (
        <section className="contract-panel">
          <div className="contract-head">
            <strong>Contract Terms</strong>
            <button className="pill-btn sm" onClick={() => setContractTerms([])}>clear</button>
          </div>
          {contractTerms.map(ct => (
            <div key={ct.id} className="contract-card">
              <div className="ct-top">
                <span className="ct-type">{ct.type}</span>
                <span className="ct-conf">{Math.round(ct.confidence * 100)}%</span>
              </div>
              <p className="ct-parties">{ct.parties}</p>
              <p className="ct-summary">{ct.summary}</p>
              {ct.amount && <p className="ct-detail">Amount: {ct.amount}</p>}
              {ct.obligation && <p className="ct-detail">Obligation: {ct.obligation}</p>}
              {ct.deadline && <p className="ct-detail">Deadline: {ct.deadline}</p>}
            </div>
          ))}
        </section>
      )}

      {connected && (
        <form onSubmit={submitTextPrompt} className="ask-bar">
          <input value={inputDraft} onChange={e => setInputDraft(e.target.value)} placeholder="type a question" disabled={!connected} />
          <button type="submit" disabled={!connected || !inputDraft.trim()}>send</button>
        </form>
      )}

      <button
        className={cn("fab", { connected, disabled: sessionHealth.reconnecting })}
        onClick={() => void toggleConnection()}
        disabled={sessionHealth.reconnecting}
      >
        {sessionHealth.reconnecting ? "..." : connected ? "pause" : "start"}
      </button>

      {sessionHealth.lastError && (
        <div className="err-bar">
          <p>{sessionHealth.lastError}</p>
          <button onClick={() => void retrySession()}>retry</button>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <LiveAPIProvider options={apiOptions}>
      <NativeConsole />
    </LiveAPIProvider>
  );
}

export default App;
