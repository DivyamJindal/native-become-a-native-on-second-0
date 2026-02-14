import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityHandling,
  EndSensitivity,
  FunctionDeclaration,
  LiveConnectConfig,
  LiveServerContent,
  LiveServerToolCall,
  Modality,
  StartSensitivity,
  Tool,
  TurnCoverage,
  Type,
} from "@google/genai";
import cn from "classnames";
import "./App.scss";
import { LiveAPIProvider, useLiveAPIContext } from "./contexts/LiveAPIContext";
import { LiveClientOptions, StreamingLog } from "./types";
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

type PermissionFlag = "unknown" | "granted" | "denied" | "prompt";
type RiskType = "price" | "misinformation" | "urgency";
type RiskLevel = "low" | "medium" | "high";
export type AutoIntent =
  | "announcement"
  | "commute_help"
  | "conversation"
  | "risk_alert"
  | "unknown";
type SpeechHealth = "audio_streaming" | "fallback_tts" | "silent";
type GroundingAction = "fare_check" | "rule_check" | "station_help";

type LanguageChoice = {
  id: string;
  label: string;
  display: string;
};

type DetectedLanguage = {
  id: string;
  label: string;
  confidence: number;
  source: "script" | "keyword" | "fallback";
};

type TranscriptEntry = {
  id: string;
  speaker: "native" | "you";
  text: string;
};

type SafetyProfile = {
  disallowMedicalLegalAdvice: boolean;
  explainOfficialInstructionsOnly: boolean;
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

type PromptContext = {
  homeLanguage: LanguageChoice;
  autoIntent: AutoIntent;
  safetyProfile: SafetyProfile;
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

type RiskGuardState = {
  enabled: boolean;
  currentRisk: RiskSignal | null;
  history: RiskSignal[];
};

export type ResponseCard = {
  heard: string;
  meaning: string;
  action: string;
  raw: string;
};

type LogLevel = "debug" | "info" | "warn" | "error";

type AppLog = {
  id: string;
  timestamp: string;
  level: LogLevel;
  event: string;
  details?: string;
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

const SAFETY_PROFILE: SafetyProfile = {
  disallowMedicalLegalAdvice: true,
  explainOfficialInstructionsOnly: true,
};

const RISK_POLICY: RiskPolicy = {
  enabledTypes: ["price", "misinformation", "urgency"],
  minConfidenceForMedium: 0.62,
  minConfidenceForHigh: 0.78,
  cooldownMs: 18000,
};

const LANGUAGE_BY_ID = LANGUAGES.reduce<Record<string, LanguageChoice>>((map, language) => {
  map[language.id] = language;
  return map;
}, {});

const DEFAULT_HOME_LANGUAGE =
  LANGUAGE_BY_ID[process.env.REACT_APP_DEFAULT_TARGET_LANG || ""] ||
  LANGUAGE_BY_ID["hi-IN"] ||
  LANGUAGES[0];

const EMPTY_RESPONSE_CARD: ResponseCard = {
  heard: "",
  meaning: "",
  action: "",
  raw: "",
};

const MAX_APP_LOGS = 240;

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
  sourceLanguage: string,
  targetLanguage: string,
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
    sourceLanguage,
    targetLanguage,
    timestamp: new Date().toISOString(),
    baselineReference: baselineReference || undefined,
    source: "model",
  };
}

function countKeywordHits(text: string, keywords: string[]) {
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

function extractLineValue(raw: string, label: string) {
  const expression = new RegExp(
    `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[:：-]\\s*(.+)`,
    "i",
  );
  const match = raw.match(expression);
  return match?.[1]?.trim() || "";
}

function cleanForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[>*_#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateForLog(text: string, maxChars = 220) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function serializeLogDetails(details: unknown): string {
  if (details == null) {
    return "";
  }

  if (typeof details === "string") {
    return truncateForLog(details);
  }

  try {
    const json = JSON.stringify(
      details,
      (_, value) => {
        if (value instanceof Date) {
          return value.toISOString();
        }
        return value;
      },
      2,
    );
    return truncateForLog(json);
  } catch {
    return truncateForLog(String(details));
  }
}

export function parseResponseCard(raw: string, heardFallback: string): ResponseCard {
  const trimmed = raw.trim();
  if (!trimmed) {
    return EMPTY_RESPONSE_CARD;
  }

  const heard = extractLineValue(trimmed, "Heard") || heardFallback || "";
  const meaning =
    extractLineValue(trimmed, "Meaning") ||
    trimmed.split("\n").map((line) => line.trim()).filter(Boolean)[0] ||
    "";
  const action = extractLineValue(trimmed, "What to do now") || "";

  return {
    heard,
    meaning,
    action,
    raw: trimmed,
  };
}

function detectHeuristicRisk(
  transcript: string,
  sourceLanguageId: string,
  targetLanguageId: string,
): RiskSignal | null {
  const text = transcript.trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  const urgencyKeywords = [
    "immediately",
    "urgent",
    "fine",
    "penalty",
    "police",
    "deadline",
    "last warning",
    "jaldi",
    "tatkal",
    "ತಕ್ಷಣ",
    "ದಂಡ",
  ];

  const misinformationKeywords = [
    "agent",
    "shortcut",
    "sign quickly",
    "don't read",
    "different office",
    "extra charge for form",
    "commission",
    "broker",
  ];

  const scamPressureKeywords = [
    "pay now",
    "cash only",
    "or police",
    "double fare",
    "special fee",
    "agent fee",
    "service fee now",
    "right now or",
    "last chance pay",
  ];

  const priceHints = /(₹|rs\.?|rupees|fare|charge|fees|price|rate|cost|ticket|rent)/i;
  const highAmount = /\b([5-9]\d{2}|\d{4,})\b/;

  if (scamPressureKeywords.some((keyword) => lower.includes(keyword))) {
    return {
      id: createRiskId(),
      type: "urgency",
      level: "high",
      cue: text.slice(0, 120),
      reason: "Possible coercive payment pressure detected.",
      action: "Do not pay yet. Ask for official ID and verify at station counter.",
      confidence: 0.81,
      sourceLanguage: sourceLanguageId,
      targetLanguage: targetLanguageId,
      timestamp: new Date().toISOString(),
      source: "heuristic",
    };
  }

  if (urgencyKeywords.some((keyword) => lower.includes(keyword))) {
    return {
      id: createRiskId(),
      type: "urgency",
      level: "medium",
      cue: text.slice(0, 120),
      reason: "Urgent enforcement or deadline language detected.",
      action: "Pause and verify with official signage or staff before acting.",
      confidence: 0.67,
      sourceLanguage: sourceLanguageId,
      targetLanguage: targetLanguageId,
      timestamp: new Date().toISOString(),
      source: "heuristic",
    };
  }

  if (misinformationKeywords.some((keyword) => lower.includes(keyword))) {
    return {
      id: createRiskId(),
      type: "misinformation",
      level: "medium",
      cue: text.slice(0, 120),
      reason: "Potential misleading instruction pattern detected.",
      action: "Confirm process at official help desk before submitting payment/docs.",
      confidence: 0.65,
      sourceLanguage: sourceLanguageId,
      targetLanguage: targetLanguageId,
      timestamp: new Date().toISOString(),
      source: "heuristic",
    };
  }

  if (priceHints.test(lower) && highAmount.test(lower)) {
    return {
      id: createRiskId(),
      type: "price",
      level: "low",
      cue: text.slice(0, 120),
      reason: "Price mention detected. Overcharge check recommended.",
      action: "Ask for fare chart/receipt or verify via Fare Check.",
      confidence: 0.57,
      sourceLanguage: sourceLanguageId,
      targetLanguage: targetLanguageId,
      timestamp: new Date().toISOString(),
      baselineReference: "Context estimate; confirm using official posted rates.",
      source: "heuristic",
    };
  }

  return null;
}

export function detectIncomingLanguage(
  transcript: string,
  fallbackLanguage: LanguageChoice,
): DetectedLanguage | null {
  const text = transcript.trim();
  if (!text) {
    return null;
  }

  if (/[\u0C80-\u0CFF]/.test(text)) {
    return { id: "kn-IN", label: "Kannada", confidence: 0.96, source: "script" };
  }

  if (/[\u0C00-\u0C7F]/.test(text)) {
    return { id: "te-IN", label: "Telugu", confidence: 0.95, source: "script" };
  }

  if (/[\u0B80-\u0BFF]/.test(text)) {
    return { id: "ta-IN", label: "Tamil", confidence: 0.95, source: "script" };
  }

  if (/[\u0980-\u09FF]/.test(text)) {
    return { id: "bn-IN", label: "Bengali", confidence: 0.95, source: "script" };
  }

  if (/[\u0900-\u097F]/.test(text)) {
    const marathiMarkers = ["आहे", "काय", "तुम्हाला", "पाहिजे", "करायचे", "झाले"];
    const marathiHits = marathiMarkers.filter((marker) => text.includes(marker)).length;
    return {
      id: marathiHits >= 2 ? "mr-IN" : "hi-IN",
      label: marathiHits >= 2 ? "Marathi" : "Hindi",
      confidence: marathiHits >= 2 ? 0.82 : 0.78,
      source: "script",
    };
  }

  const lower = text.toLowerCase();
  const englishHits = countKeywordHits(lower, [
    "the",
    "please",
    "where",
    "how",
    "help",
    "station",
    "ticket",
    "price",
    "platform",
    "metro",
  ]);
  const hindiRomanHits = countKeywordHits(lower, [
    "kya",
    "kaise",
    "kitna",
    "jaldi",
    "nahi",
    "haan",
    "bhai",
    "paisa",
    "madad",
    "kahan",
  ]);
  const kannadaRomanHits = countKeywordHits(lower, [
    "elli",
    "beku",
    "swalpa",
    "banni",
    "illa",
    "yaake",
    "hogi",
    "anna",
  ]);

  if (englishHits >= 2 && englishHits > hindiRomanHits && englishHits > kannadaRomanHits) {
    return { id: "en-IN", label: "English", confidence: 0.63, source: "keyword" };
  }

  if (hindiRomanHits >= 2 && hindiRomanHits >= kannadaRomanHits) {
    return { id: "hi-IN", label: "Hindi", confidence: 0.59, source: "keyword" };
  }

  if (kannadaRomanHits >= 2) {
    return { id: "kn-IN", label: "Kannada", confidence: 0.58, source: "keyword" };
  }

  return {
    id: fallbackLanguage.id,
    label: fallbackLanguage.label,
    confidence: 0.36,
    source: "fallback",
  };
}

export function classifyAutoIntent(
  transcript: string,
  visionEnabled: boolean = false,
): AutoIntent {
  const text = transcript.trim().toLowerCase();
  if (!text) {
    return visionEnabled ? "commute_help" : "unknown";
  }

  const announcementKeywords = [
    "platform",
    "arriving",
    "departing",
    "next station",
    "train",
    "metro",
    "coach",
    "announcement",
    "bus stop",
    "gate number",
  ];

  const commuteHelpKeywords = [
    "ticket",
    "route",
    "where should i go",
    "which bus",
    "which train",
    "station",
    "counter",
    "line",
    "queue",
    "map",
  ];

  const riskKeywords = [
    "pay now",
    "fine",
    "penalty",
    "agent",
    "double fare",
    "cash only",
    "urgent",
    "police",
    "shortcut",
  ];

  if (announcementKeywords.some((keyword) => text.includes(keyword))) {
    return "announcement";
  }

  if (riskKeywords.some((keyword) => text.includes(keyword))) {
    return "risk_alert";
  }

  if (commuteHelpKeywords.some((keyword) => text.includes(keyword))) {
    return "commute_help";
  }

  return "conversation";
}

export function shouldTranslate(
  detectedLanguageId: string | null,
  homeLanguageId: string,
): boolean {
  if (!detectedLanguageId) {
    return true;
  }
  return detectedLanguageId !== homeLanguageId;
}

function buildSystemPrompt({ homeLanguage, autoIntent, safetyProfile }: PromptContext) {
  const safetyLines = [
    safetyProfile.disallowMedicalLegalAdvice
      ? "SAFETY: Never provide medical or legal diagnosis, prescriptions, verdicts, or legal strategy."
      : "",
    safetyProfile.explainOfficialInstructionsOnly
      ? "SAFETY: You may translate and explain official instructions from documents, announcements, forms, and staff communication in plain language."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `You are native, a realtime commute copilot for newcomers in India.

PRIMARY USE CASE:
- Help users handle station/bus/metro announcements, transit instructions, fare confusion, and risky pressure situations.

RESPONSE CONTRACT:
- Always respond in ${homeLanguage.label} (${homeLanguage.display}) unless user explicitly requests another language.
- Keep response concise and practical.
- Use markdown bullets exactly in this shape for important outputs:
  - Heard: ...
  - Meaning: ...
  - What to do now: ...
- Do not produce verbose chain-of-thought or meta commentary.

TRANSLATION POLICY:
- Auto-detect incoming language from user speech and visible text.
- If detected language differs from home language, translate meaning into home language.
- If detected language equals home language, avoid redundant translation and provide concise interpretation/action.
- Still speak concise output in both cases.

INTENT CONTEXT:
- Current detected context: ${autoIntent}.
- If context is announcement, prioritize urgency and next movement guidance.
- If context is commute_help, prioritize route/queue/counter instructions.
- If context is risk_alert, prioritize safety verification and refusal scripts.

GROUNDING POLICY:
- You may use web grounding only when the user message includes a token like [GROUNDING_ACTION:...].
- If grounding token is absent, do not use search.

LOCAL RISK GUARD:
- If actionable risk is detected, call ${RISK_FUNCTION_NAME} with type, level, cue, reason, action, and confidence.
- Risk types: price, misinformation, urgency.
- Scam pressure cues include coercive payment demands, fake penalty pressure, or agent shortcuts.

${safetyLines}`;
}

function buildConfig(
  promptContext: PromptContext,
  voiceName: string,
  riskGuardEnabled: boolean,
): LiveConnectConfig {
  const tools: Tool[] = [{ googleSearch: {} }];

  if (riskGuardEnabled) {
    tools.push({ functionDeclarations: [RISK_FUNCTION_DECLARATION] });
  }

  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    },
    realtimeInputConfig: {
      activityHandling: ActivityHandling.NO_INTERRUPTION,
      turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
      automaticActivityDetection: {
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
        prefixPaddingMs: 240,
        silenceDurationMs: 900,
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

function NativeConsole() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const reconnectGuardRef = useRef<string>("");
  const riskCooldownByType = useRef<Record<RiskType, number>>({
    price: 0,
    misinformation: 0,
    urgency: 0,
  });
  const fallbackTimerRef = useRef<number | null>(null);
  const lastAudioPacketAtRef = useRef<number>(0);
  const lastAudioDebugLogAtRef = useRef<number>(0);
  const lastTtsAtRef = useRef<number>(0);
  const lastFallbackTextRef = useRef<string>("");
  const intentContextRef = useRef<AutoIntent>("unknown");

  const webcam = useWebcam();
  const screenCapture = useScreenCapture();

  const [homeLanguage, setHomeLanguage] = useState<LanguageChoice>(DEFAULT_HOME_LANGUAGE);
  const [activeVoice, setActiveVoice] = useState<string>(VOICES[0]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visualSource, setVisualSource] = useState<"camera" | "screen">("camera");
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const [riskGuardEnabled, setRiskGuardEnabled] = useState(false);
  const [currentRisk, setCurrentRisk] = useState<RiskSignal | null>(null);
  const [riskHistory, setRiskHistory] = useState<RiskSignal[]>([]);

  const [inputDraft, setInputDraft] = useState("");
  const [lastInputTranscript, setLastInputTranscript] = useState("");
  const [lastOutputTranscript, setLastOutputTranscript] = useState("");
  const [detectedIncomingLanguage, setDetectedIncomingLanguage] =
    useState<DetectedLanguage | null>(null);
  const [autoIntent, setAutoIntent] = useState<AutoIntent>("unknown");
  const [responseCard, setResponseCard] = useState<ResponseCard>(EMPTY_RESPONSE_CARD);
  const [speechHealth, setSpeechHealth] = useState<SpeechHealth>("silent");
  const [activeGroundingAction, setActiveGroundingAction] =
    useState<GroundingAction | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [appLogs, setAppLogs] = useState<AppLog[]>([]);
  const [verboseLogging, setVerboseLogging] = useState(true);

  const [sessionHealth, setSessionHealth] = useState<SessionHealth>({
    permissions: { mic: "unknown", vision: "unknown" },
    connected: false,
    reconnecting: false,
    lastError: null,
  });

  const [audioRecorder] = useState(() => new AudioRecorder());

  const { client, connected, connect, disconnect, volume, setConfig, setModel } =
    useLiveAPIContext();

  const logEvent = useCallback((level: LogLevel, event: string, details?: unknown) => {
    const normalizedDetails = serializeLogDetails(details);
    const timestamp = new Date().toISOString();

    setAppLogs((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        level,
        event,
        details: normalizedDetails || undefined,
      },
      ...previous,
    ].slice(0, MAX_APP_LOGS));

    if (process.env.NODE_ENV === "test") {
      return;
    }

    const message = `[native:${level}] ${event}`;
    if (level === "error") {
      console.error(message, details ?? "");
      return;
    }
    if (level === "warn") {
      console.warn(message, details ?? "");
      return;
    }
    console.log(message, details ?? "");
  }, []);

  const promptContext = useMemo<PromptContext>(
    () => ({
      homeLanguage,
      autoIntent,
      safetyProfile: SAFETY_PROFILE,
    }),
    [autoIntent, homeLanguage],
  );

  const sessionConfig = useMemo(
    () => buildConfig(promptContext, activeVoice, riskGuardEnabled),
    [promptContext, activeVoice, riskGuardEnabled],
  );

  const reconnectSignature = useMemo(
    () =>
      JSON.stringify({
        homeLanguage: homeLanguage.id,
        voice: activeVoice,
        riskGuardEnabled,
      }),
    [homeLanguage.id, activeVoice, riskGuardEnabled],
  );

  const riskGuardState = useMemo<RiskGuardState>(
    () => ({
      enabled: riskGuardEnabled,
      currentRisk,
      history: riskHistory,
    }),
    [riskGuardEnabled, currentRisk, riskHistory],
  );

  const translationRequired = useMemo(
    () => shouldTranslate(detectedIncomingLanguage?.id || null, homeLanguage.id),
    [detectedIncomingLanguage, homeLanguage.id],
  );

  const setLastError = useCallback((message: string | null) => {
    setSessionHealth((previous) => ({
      ...previous,
      lastError: message,
    }));
  }, []);

  const setPermission = useCallback((kind: "mic" | "vision", value: PermissionFlag) => {
    setSessionHealth((previous) => ({
      ...previous,
      permissions: {
        ...previous.permissions,
        [kind]: value,
      },
    }));
  }, []);

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
      if (!riskGuardEnabled) {
        return false;
      }

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
      setRiskHistory((previous) => [signal, ...previous].slice(0, 24));
      return true;
    },
    [riskGuardEnabled, shouldReplaceRisk],
  );

  const maybeApplyHeuristicRisk = useCallback(
    (transcript: string, sourceLanguageId: string) => {
      if (!riskGuardEnabled) {
        return;
      }

      const heuristicSignal = detectHeuristicRisk(
        transcript,
        sourceLanguageId,
        homeLanguage.id,
      );

      if (heuristicSignal) {
        void applyRiskSignal(heuristicSignal);
      }
    },
    [applyRiskSignal, homeLanguage.id, riskGuardEnabled],
  );

  const setIntentFromTranscript = useCallback(
    (transcript: string) => {
      const nextIntent = classifyAutoIntent(transcript, visionEnabled);
      setAutoIntent((previous) => (previous === nextIntent ? previous : nextIntent));
    },
    [visionEnabled],
  );

  const scheduleFallbackSpeech = useCallback(
    (text: string) => {
      if (!text.trim()) {
        return;
      }

      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }

      fallbackTimerRef.current = window.setTimeout(() => {
        const now = Date.now();
        const noRecentAudio = now - lastAudioPacketAtRef.current > 850;
        const speechSynth = typeof window !== "undefined" ? window.speechSynthesis : null;
        if (!noRecentAudio || !speechSynth || !text.trim()) {
          return;
        }

        const speakText = cleanForSpeech(text);
        if (!speakText || speakText === lastFallbackTextRef.current) {
          return;
        }

        lastFallbackTextRef.current = speakText;
        speechSynth.cancel();

        const utterance = new SpeechSynthesisUtterance(speakText);
        utterance.lang = homeLanguage.id;
        utterance.rate = 1;
        utterance.pitch = 1;
        speechSynth.speak(utterance);

        lastTtsAtRef.current = Date.now();
        setSpeechHealth("fallback_tts");
      }, 900);
    },
    [homeLanguage.id],
  );

  useEffect(() => {
    setModel(MODEL_NAME);
    setConfig(sessionConfig);
    logEvent("info", "session.config_updated", {
      model: MODEL_NAME,
      homeLanguage: homeLanguage.id,
      voice: activeVoice,
      riskGuardEnabled,
    });
  }, [activeVoice, homeLanguage.id, logEvent, riskGuardEnabled, sessionConfig, setConfig, setModel]);

  useEffect(() => {
    setSessionHealth((previous) => ({
      ...previous,
      connected,
    }));
    logEvent("info", "session.connection_state", { connected });
  }, [connected, logEvent]);

  useEffect(() => {
    const onError = (error: ErrorEvent) => {
      setLastError(error.message || "Live session reported an error.");
      logEvent("error", "session.error_event", error.message || "Unknown live API error.");
    };

    client.on("error", onError);
    return () => {
      client.off("error", onError);
    };
  }, [client, logEvent, setLastError]);

  useEffect(() => {
    const onClientLog = (eventLog: StreamingLog) => {
      if (!verboseLogging && eventLog.type === "client.realtimeInput") {
        return;
      }
      logEvent("debug", `client.${eventLog.type}`, eventLog.message);
    };

    client.on("log", onClientLog);
    return () => {
      client.off("log", onClientLog);
    };
  }, [client, logEvent, verboseLogging]);

  useEffect(() => {
    const onAudioPacket = () => {
      lastAudioPacketAtRef.current = Date.now();
      setSpeechHealth("audio_streaming");
      if (Date.now() - lastAudioDebugLogAtRef.current > 2000) {
        lastAudioDebugLogAtRef.current = Date.now();
        logEvent("debug", "audio.packet_received");
      }
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };

    client.on("audio", onAudioPacket);
    return () => {
      client.off("audio", onAudioPacket);
    };
  }, [client, logEvent]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const lastSpokenAt = Math.max(lastAudioPacketAtRef.current, lastTtsAtRef.current);
      if (!lastSpokenAt) {
        return;
      }
      if (Date.now() - lastSpokenAt > 5000) {
        setSpeechHealth("silent");
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    logEvent("info", "audio.speech_health_changed", { speechHealth });
  }, [logEvent, speechHealth]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    if (intentContextRef.current === autoIntent) {
      return;
    }

    intentContextRef.current = autoIntent;
    client.send(
      [
        {
          text:
            `[INTENT_CONTEXT:${autoIntent}] Treat this as runtime context. ` +
            "Do not explicitly mention this token.",
        },
      ],
      false,
    );
    logEvent("debug", "intent.context_sent", { autoIntent });
  }, [autoIntent, client, connected, logEvent]);

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

  useEffect(() => {
    if (!reconnectGuardRef.current) {
      reconnectGuardRef.current = reconnectSignature;
      return;
    }

    const previous = reconnectGuardRef.current;
    reconnectGuardRef.current = reconnectSignature;

    if (!connected || previous === reconnectSignature) {
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
  }, [reconnectSignature, connected, connect, disconnect, setLastError, setReconnecting]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeStream;
    }
  }, [activeStream]);

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
        toErrorMessage(error, "Microphone permission is blocked. Enable it and retry."),
      );
      return false;
    }
  }, [sessionHealth.permissions.mic, setLastError, setPermission]);

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

  const startVisionStream = useCallback(
    async (source: "camera" | "screen") => {
      const selected = source === "camera" ? webcam : screenCapture;
      const alternate = source === "camera" ? screenCapture : webcam;

      const stream = await selected.start();
      alternate.stop();

      setActiveStream(stream);
      setVisionEnabled(true);
      setVisualSource(source);
      setPermission("vision", "granted");
      setLastError(null);
      return stream;
    },
    [screenCapture, setLastError, setPermission, webcam],
  );

  const turnOnVision = useCallback(
    async (source: "camera" | "screen" = visualSource) => {
      try {
        await startVisionStream(source);
        return true;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          setPermission("vision", "denied");
        }
        setVisionEnabled(false);
        setLastError(toErrorMessage(error, "Could not start visual capture."));
        return false;
      }
    },
    [setLastError, setPermission, startVisionStream, visualSource],
  );

  const turnOffVision = useCallback(() => {
    webcam.stop();
    screenCapture.stop();
    setActiveStream(null);
    setVisionEnabled(false);
  }, [screenCapture, webcam]);

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

  useEffect(() => {
    const onToolCall = (toolCall: LiveServerToolCall) => {
      if (!riskGuardEnabled || !toolCall.functionCalls?.length) {
        return;
      }

      const functionResponses = toolCall.functionCalls.map((functionCall) => {
        if (functionCall.name !== RISK_FUNCTION_NAME) {
          return {
            id: functionCall.id,
            name: functionCall.name,
            response: {
              output: {
                accepted: false,
                reason: "Unsupported function.",
              },
            },
          };
        }

        const parsed = parseRiskSignalFromArgs(
          functionCall.args,
          detectedIncomingLanguage?.id || "auto",
          homeLanguage.id,
        );

        if (!parsed) {
          return {
            id: functionCall.id,
            name: functionCall.name,
            response: {
              output: {
                accepted: false,
                reason: "Malformed risk signal payload.",
              },
            },
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
      });

      if (functionResponses.length) {
        client.sendToolResponse({ functionResponses });
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [applyRiskSignal, client, detectedIncomingLanguage, homeLanguage.id, riskGuardEnabled]);

  useEffect(() => {
    const onTurnComplete = () => {
      setActiveGroundingAction(null);
    };

    client.on("turncomplete", onTurnComplete);
    return () => {
      client.off("turncomplete", onTurnComplete);
    };
  }, [client]);

  useEffect(() => {
    const onContent = (content: LiveServerContent) => {
      if (content.inputTranscription?.text) {
        const inputText = content.inputTranscription.text;
        setLastInputTranscript(inputText);

        const detected = detectIncomingLanguage(inputText, homeLanguage);
        if (detected) {
          setDetectedIncomingLanguage(detected);
          maybeApplyHeuristicRisk(inputText, detected.id);
        } else {
          maybeApplyHeuristicRisk(inputText, "auto");
        }

        setIntentFromTranscript(inputText);
      }

      const outputTranscript = content.outputTranscription?.text?.trim() || "";
      if (outputTranscript) {
        setLastOutputTranscript(outputTranscript);
        const cardFromTranscript = parseResponseCard(outputTranscript, lastInputTranscript);
        setResponseCard((previous) => ({
          ...previous,
          meaning: cardFromTranscript.meaning || previous.meaning,
          action: cardFromTranscript.action || previous.action,
          raw: cardFromTranscript.raw || previous.raw,
        }));
        maybeApplyHeuristicRisk(outputTranscript, detectedIncomingLanguage?.id || "auto");
        scheduleFallbackSpeech(outputTranscript);
      }

      const modelText =
        content.modelTurn?.parts
          ?.map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("\n")
          .trim() || "";

      if (modelText) {
        setEntries((previous) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            speaker: "native" as const,
            text: modelText,
          },
          ...previous,
        ].slice(0, 24));

        const parsedCard = parseResponseCard(modelText, lastInputTranscript);
        setResponseCard(parsedCard);
        setLastOutputTranscript(parsedCard.meaning || modelText);
        maybeApplyHeuristicRisk(modelText, detectedIncomingLanguage?.id || "auto");
        scheduleFallbackSpeech(parsedCard.action || parsedCard.meaning || modelText);
      }
    };

    client.on("content", onContent);
    return () => {
      client.off("content", onContent);
    };
  }, [
    client,
    detectedIncomingLanguage,
    homeLanguage,
    lastInputTranscript,
    maybeApplyHeuristicRisk,
    scheduleFallbackSpeech,
    setIntentFromTranscript,
  ]);

  const toggleConnection = useCallback(async () => {
    setLastError(null);
    setReconnecting(true);

    try {
      if (connected) {
        await disconnect();
      } else {
        await connect();
      }
    } catch (error) {
      setLastError(toErrorMessage(error, "Failed to update session state."));
    } finally {
      setReconnecting(false);
    }
  }, [connected, connect, disconnect, setLastError, setReconnecting]);

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

  const onMicToggle = useCallback(async () => {
    if (micEnabled) {
      setMicEnabled(false);
      return;
    }
    await enableMic();
  }, [enableMic, micEnabled]);

  const onVisualToggle = useCallback(async () => {
    if (visionEnabled) {
      turnOffVision();
      return;
    }
    await turnOnVision(visualSource);
  }, [turnOffVision, turnOnVision, visionEnabled, visualSource]);

  const onVisualSourceChange = useCallback(
    async (source: "camera" | "screen") => {
      setVisualSource(source);
      if (!visionEnabled) {
        return;
      }
      await turnOnVision(source);
    },
    [turnOnVision, visionEnabled],
  );

  const logUserEntry = useCallback((text: string) => {
    setEntries((previous) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        speaker: "you" as const,
        text,
      },
      ...previous,
    ].slice(0, 24));
  }, []);

  const clearDebugLogs = useCallback(() => {
    setAppLogs([]);
  }, []);

  const copyDebugLogs = useCallback(async () => {
    try {
      const payload = appLogs
        .slice()
        .reverse()
        .map((item) => {
          const details = item.details ? ` | ${item.details}` : "";
          return `${item.timestamp} [${item.level}] ${item.event}${details}`;
        })
        .join("\n");
      if (!payload) {
        logEvent("warn", "debug.copy_skipped", "No logs available to copy.");
        return;
      }
      await navigator.clipboard.writeText(payload);
      logEvent("info", "debug.copy_success", { count: appLogs.length });
    } catch (error) {
      logEvent("error", "debug.copy_failed", toErrorMessage(error, "Clipboard copy failed."));
    }
  }, [appLogs, logEvent]);

  const runGroundingAction = useCallback(
    (action: GroundingAction) => {
      if (!connected) {
        return;
      }

      setActiveGroundingAction(action);

      const actionPrompts: Record<GroundingAction, string> = {
        fare_check:
          "[GROUNDING_ACTION:FARE_CHECK] Verify local fare/range for current route or station and return concise guidance.",
        rule_check:
          "[GROUNDING_ACTION:RULE_CHECK] Check latest station/transport rule relevant to current context and return concise guidance.",
        station_help:
          "[GROUNDING_ACTION:STATION_HELP] Fetch practical station help context for navigation, queue, and counter flow.",
      };

      const prompt = actionPrompts[action];
      client.send([{ text: prompt }]);
      logUserEntry(prompt);
    },
    [client, connected, logUserEntry],
  );

  const submitTextPrompt = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = inputDraft.trim();
      if (!trimmed || !connected) {
        return;
      }

      client.send([{ text: trimmed }]);
      logUserEntry(trimmed);
      setInputDraft("");
    },
    [client, connected, inputDraft, logUserEntry],
  );

  const liveStatuses = [
    { label: "Listening", active: connected && micEnabled },
    { label: "Seeing", active: connected && visionEnabled },
    { label: "Grounding", active: connected && !!activeGroundingAction },
    { label: "Speaking", active: connected && volume > 0.05 },
  ];

  const speechHealthLabel =
    speechHealth === "audio_streaming"
      ? "audio streaming"
      : speechHealth === "fallback_tts"
      ? "fallback tts"
      : "silent";

  return (
    <div className="native-app">
      <canvas ref={frameCanvasRef} className="hidden-canvas" />

      <header className="top-rail">
        <div className="brand-block">
          <p className="eyebrow">Commute Copilot</p>
          <h1>native</h1>
          <p className="tagline">Understand announcements, avoid scams, move like a local.</p>
        </div>

        <div className="rail-controls">
          <div className="home-row">
            <label htmlFor="home-language">Home Language</label>
            <select
              id="home-language"
              value={homeLanguage.id}
              onChange={(event) =>
                setHomeLanguage(getLanguage(event.target.value, homeLanguage))
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>

          <div className="action-row">
            <button
              className={cn("control-chip", "primary", {
                connected,
                disabled: sessionHealth.reconnecting,
              })}
              onClick={() => void toggleConnection()}
              disabled={sessionHealth.reconnecting}
            >
              {sessionHealth.reconnecting ? "Reconnecting..." : connected ? "Pause" : "Start"}
            </button>

            <button
              className={cn("control-chip", { active: micEnabled })}
              onClick={() => void onMicToggle()}
            >
              Mic {micEnabled ? "On" : "Off"}
            </button>

            <button
              className={cn("control-chip", { active: visionEnabled })}
              onClick={() => void onVisualToggle()}
            >
              Vision {visionEnabled ? "On" : "Off"}
            </button>

            <button
              className={cn("control-chip", { active: riskGuardState.enabled })}
              onClick={() => setRiskGuardEnabled((value) => !value)}
            >
              Risk Guard {riskGuardState.enabled ? "On" : "Off"}
            </button>
          </div>

          <div className="intent-row">
            <span className="info-pill">
              Intent: {autoIntent.replace("_", " ")}
            </span>
            <span className="info-pill">
              Detected: {detectedIncomingLanguage
                ? `${detectedIncomingLanguage.label} (${Math.round(
                    detectedIncomingLanguage.confidence * 100,
                  )}%)`
                : "Waiting"}
            </span>
            <span className={cn("info-pill", { accent: translationRequired })}>
              {translationRequired
                ? `Translating to ${homeLanguage.label}`
                : `Same language (${homeLanguage.label})`}
            </span>
            <span className={cn("info-pill", "speech")}>Speech: {speechHealthLabel}</span>
          </div>
        </div>
      </header>

      <main className="command-main">
        <section className="vision-panel">
          <div className="panel-head">
            <strong>Live Input</strong>
            <div className="source-switch">
              <button
                className={cn({ active: visualSource === "camera" })}
                onClick={() => void onVisualSourceChange("camera")}
              >
                Camera
              </button>
              <button
                className={cn({ active: visualSource === "screen" })}
                onClick={() => void onVisualSourceChange("screen")}
              >
                Screen
              </button>
            </div>
          </div>

          <div className="video-wrap">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={cn("stream", { hidden: !activeStream })}
            />
            {!activeStream && (
              <div className="empty-state">
                <p>Visual input is off</p>
                <span>Enable Camera or Screen for station boards and signs.</span>
              </div>
            )}
          </div>

          <div className="input-card">
            <span>You hear</span>
            <p>{lastInputTranscript || "Listening for announcement/conversation..."}</p>
          </div>
        </section>

        <section className="assistant-panel">
          <div className="panel-head">
            <strong>native response</strong>
            <span className="mode-tag">Auto Flow</span>
          </div>

          <div className="response-card">
            <p>
              <strong>Heard:</strong> {responseCard.heard || lastInputTranscript || "..."}
            </p>
            <p>
              <strong>Meaning:</strong> {responseCard.meaning || lastOutputTranscript || "..."}
            </p>
            <p>
              <strong>What to do now:</strong> {responseCard.action || "Waiting for actionable cue."}
            </p>
          </div>

          <div
            className={cn("risk-banner", {
              low: riskGuardState.currentRisk?.level === "low",
              medium: riskGuardState.currentRisk?.level === "medium",
              high: riskGuardState.currentRisk?.level === "high",
              neutral: !riskGuardState.currentRisk,
            })}
          >
            {!riskGuardState.currentRisk ? (
              <>
                <p className="risk-level">No active risk signal</p>
                <p className="risk-line">Scam pressure, misinformation, and overcharge cues are monitored.</p>
              </>
            ) : (
              <>
                <p className="risk-level">
                  {riskGuardState.currentRisk.level.toUpperCase()} {" "}
                  {riskGuardState.currentRisk.type}
                </p>
                <p className="risk-cue">"{riskGuardState.currentRisk.cue}"</p>
                <p className="risk-line">Why: {riskGuardState.currentRisk.reason}</p>
                <p className="risk-line strong">What next: {riskGuardState.currentRisk.action}</p>
              </>
            )}
          </div>

          <div className="status-grid">
            {liveStatuses.map((status) => (
              <div key={status.label} className={cn("status-chip", { active: status.active })}>
                {status.label}
              </div>
            ))}
          </div>
        </section>
      </main>

      <section className="grounding-strip">
        <button
          className={cn("grounding-button", { active: activeGroundingAction === "fare_check" })}
          onClick={() => runGroundingAction("fare_check")}
          disabled={!connected}
        >
          Fare Check
        </button>
        <button
          className={cn("grounding-button", { active: activeGroundingAction === "rule_check" })}
          onClick={() => runGroundingAction("rule_check")}
          disabled={!connected}
        >
          Rule Check
        </button>
        <button
          className={cn("grounding-button", { active: activeGroundingAction === "station_help" })}
          onClick={() => runGroundingAction("station_help")}
          disabled={!connected}
        >
          Station Help
        </button>
      </section>

      <details
        className="advanced-drawer"
        open={advancedOpen}
        onToggle={(event) =>
          setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>Advanced controls and history</summary>
        <div className="advanced-content">
          <div className="advanced-row">
            <label htmlFor="voice-select">Voice</label>
            <select
              id="voice-select"
              value={activeVoice}
              onChange={(event) => setActiveVoice(event.target.value)}
            >
              {VOICES.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
            <span className="debug-pill">Speech health: {speechHealthLabel}</span>
          </div>

          <div className="permission-row">
            <div
              className={cn("permission-chip", {
                active: sessionHealth.permissions.mic === "granted",
                blocked: sessionHealth.permissions.mic === "denied",
              })}
            >
              Mic permission: {sessionHealth.permissions.mic}
            </div>
            <div
              className={cn("permission-chip", {
                active: sessionHealth.permissions.vision === "granted",
                blocked: sessionHealth.permissions.vision === "denied",
              })}
            >
              Vision permission: {sessionHealth.permissions.vision}
            </div>
          </div>

          {(sessionHealth.lastError || sessionHealth.reconnecting) && (
            <div className="session-alert">
              <p>{sessionHealth.lastError || "Reconnecting live session..."}</p>
              <button onClick={() => void retrySession()}>Retry Session</button>
            </div>
          )}

          <div className="entries">
            {entries.length === 0 && <p className="empty-log">No messages yet.</p>}
            {entries.map((entry) => (
              <div key={entry.id} className={cn("entry", entry.speaker)}>
                <span>{entry.speaker === "you" ? "You" : "native"}</span>
                <p>{entry.text}</p>
              </div>
            ))}
          </div>

          <form onSubmit={submitTextPrompt} className="quick-ask">
            <input
              value={inputDraft}
              onChange={(event) => setInputDraft(event.target.value)}
              placeholder="Type a quick question or instruction"
              disabled={!connected}
            />
            <button type="submit" disabled={!connected || !inputDraft.trim()}>
              Send
            </button>
          </form>
        </div>
      </details>
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
