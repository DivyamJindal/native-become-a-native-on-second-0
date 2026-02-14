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
const SUGGESTION_FUNCTION_NAME = "emit_suggestion";
const MODE_SIGNAL_FUNCTION_NAME = "emit_mode_signal";
const FORMATTED_CONTENT_FUNCTION_NAME = "emit_formatted_content";

type NativeMode = "SPOT" | "ECHO" | "GUIDE" | "BRIDGE" | "SHIELD" | "AUTO";
type PermissionFlag = "unknown" | "granted" | "denied" | "prompt";
type RiskType = "price" | "misinformation" | "urgency";
type RiskLevel = "low" | "medium" | "high";
type SuggestionCategory = "overspend" | "scam" | "safety" | "negotiation" | "general";

type SmartSuggestion = {
  id: string;
  category: SuggestionCategory;
  title: string;
  detail: string;
  action: string;
  confidence: number;
  timestamp: string;
  source: "model" | "heuristic";
};

type LanguageChoice = {
  id: string;
  label: string;
  display: string;
};

type TranscriptEntry = {
  id: string;
  speaker: "native" | "you";
  text: string;
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

type SafetyProfile = {
  disallowMedicalLegalAdvice: boolean;
  explainOfficialInstructionsOnly: boolean;
};

type DemoScene = {
  id: string;
  label: string;
  mode: NativeMode;
  sourceLanguage: string;
  targetLanguage: string;
  requiresSearch: boolean;
  requiresVision: boolean;
  scriptHint: string;
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
  useSearchForPriceBaseline: boolean;
};

type ProactivityPolicy = {
  style: "contextual-assist";
  speakOnlyOnHighConfidenceRisk: boolean;
  avoidNarrationSpam: boolean;
};

type PromptContext = {
  mode: NativeMode | null;
  sourceLanguage: LanguageChoice;
  targetLanguage: LanguageChoice;
  safetyProfile: SafetyProfile;
  sceneContext: string;
  riskPolicy: RiskPolicy;
  proactivityPolicy: ProactivityPolicy;
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

// Architecture hooks for future Blind Mode implementation.
export type BlindInsight = {
  id: string;
  summary: string;
  confidence: number;
  timestamp: string;
};

export type NavigationCue = {
  direction: string;
  hazard: string;
  action: string;
};

export type ConversationSafetyCue = {
  cue: string;
  riskType: "ripoff" | "misleading" | "urgency";
  recommendation: string;
};

const FEATURE_FLAGS = {
  blindMode: false,
} as const;

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

const SUGGESTION_FUNCTION_DECLARATION: FunctionDeclaration = {
  name: SUGGESTION_FUNCTION_NAME,
  description:
    "Emit a proactive suggestion when you detect an opportunity to help the user save money, avoid scams, stay safe, or negotiate better.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      category: {
        type: Type.STRING,
        enum: ["overspend", "scam", "safety", "negotiation", "general"],
        description: "The suggestion category.",
      },
      title: {
        type: Type.STRING,
        description: "Short one-line title summarizing the suggestion.",
      },
      detail: {
        type: Type.STRING,
        description: "2-3 sentence explanation of what was detected and why it matters.",
      },
      action: {
        type: Type.STRING,
        description: "Concrete next step the user should take.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Model confidence from 0.0 to 1.0.",
      },
    },
    required: ["category", "title", "detail", "action", "confidence"],
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
  SPOT: {
    title: "Spot",
    blurb: "Camera-first local reading and translation.",
  },
  ECHO: {
    title: "Echo",
    blurb: "Ambient listening with live translation.",
  },
  GUIDE: {
    title: "Guide",
    blurb: "What you see + what you ask + live grounding.",
  },
  BRIDGE: {
    title: "Bridge",
    blurb: "Two-way live conversation interpreter.",
  },
  SHIELD: {
    title: "Shield",
    blurb: "Proactive guardian — analyses surroundings to keep you safe & savvy.",
  },
  AUTO: {
    title: "Auto",
    blurb: "Adapts to your situation automatically — no manual switching needed.",
  },
};

const SAFETY_PROFILE: SafetyProfile = {
  disallowMedicalLegalAdvice: true,
  explainOfficialInstructionsOnly: true,
};

const RISK_POLICY: RiskPolicy = {
  enabledTypes: ["price", "misinformation", "urgency"],
  minConfidenceForMedium: 0.62,
  minConfidenceForHigh: 0.78,
  cooldownMs: 18000,
  useSearchForPriceBaseline: true,
};

const PROACTIVITY_POLICY: ProactivityPolicy = {
  style: "contextual-assist",
  speakOnlyOnHighConfidenceRisk: true,
  avoidNarrationSpam: true,
};

const DEMO_SCENES: DemoScene[] = [
  {
    id: "scene-a-guide",
    label: "Scene A: Form Help",
    mode: "GUIDE",
    sourceLanguage: "kn-IN",
    targetLanguage: "hi-IN",
    requiresSearch: true,
    requiresVision: true,
    scriptHint:
      "Guide mode: catch misinformation risk while explaining a government form. Ask: 'Yeh form kaise bharein? Mujhe kya chahiye?'",
  },
  {
    id: "scene-b-echo",
    label: "Scene B: Announcement",
    mode: "ECHO",
    sourceLanguage: "kn-IN",
    targetLanguage: "hi-IN",
    requiresSearch: false,
    requiresVision: false,
    scriptHint:
      "Echo mode: extract urgency from a Kannada announcement and output clean Hindi translation with action cue.",
  },
  {
    id: "scene-c-bridge",
    label: "Scene C: Conversation",
    mode: "BRIDGE",
    sourceLanguage: "hi-IN",
    targetLanguage: "kn-IN",
    requiresSearch: false,
    requiresVision: false,
    scriptHint:
      "Bridge mode: Hindi <-> Kannada conversation with possible rip-off/overcharge cue detection.",
  },
  {
    id: "scene-shield",
    label: "Scene: Smart Guardian",
    mode: "SHIELD",
    sourceLanguage: "kn-IN",
    targetLanguage: "hi-IN",
    requiresSearch: true,
    requiresVision: true,
    scriptHint:
      "Shield mode: analyse surroundings via camera and mic, flag overcharges, scams, and safety issues proactively.",
  },
  {
    id: "scene-auto",
    label: "Scene: Auto Adapt",
    mode: "AUTO",
    sourceLanguage: "kn-IN",
    targetLanguage: "hi-IN",
    requiresSearch: true,
    requiresVision: true,
    scriptHint:
      "Auto mode: adapts behavior based on what it hears and sees. No manual mode switching needed.",
  },
];

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
    "immediately",
    "urgent",
    "fine",
    "penalty",
    "police",
    "last warning",
    "deadline",
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

function buildModeInstruction(
  mode: NativeMode | null,
  sourceLanguage: LanguageChoice,
  targetLanguage: LanguageChoice,
) {
  if (!mode) {
    return `CURRENT MODE: STANDBY\nOnly respond when asked. Keep output concise and in ${targetLanguage.label}.`;
  }

  const prompts: Record<NativeMode, string> = {
    SPOT: `CURRENT MODE: SPOT\nFocus on camera input. Proactively read visible text and explain what user should do next in ${targetLanguage.label}.\nFor complex visual content (menus, documents, forms, timetables, signs with multiple items), speak a brief audio summary and ALSO call ${FORMATTED_CONTENT_FUNCTION_NAME} with a detailed markdown breakdown translated into ${targetLanguage.label}. Use tables for prices, bullet lists for items, and headers for sections. Always call the function for any content with more than 3 items or structured data.`,
    ECHO: `CURRENT MODE: ECHO\nTranslate incoming speech into ${targetLanguage.label}. Output only translation. Preserve tone. Stay silent for non-speech/silence.`,
    GUIDE: `CURRENT MODE: GUIDE\nUse what you see + what user asks + grounding when needed. Always end with Step 1, Step 2, Step 3 in ${targetLanguage.label}.`,
    BRIDGE: `CURRENT MODE: BRIDGE\nBidirectional interpretation. If speaker uses ${sourceLanguage.label}, translate to ${targetLanguage.label}; if speaker uses ${targetLanguage.label}, translate to ${sourceLanguage.label}. Output translation only.`,
    SHIELD: `CURRENT MODE: SHIELD (Smart Guardian)\nYou are an active guardian analysing the user's surroundings through camera and microphone in real time.\nYour job is to PROTECT the user. Continuously watch and listen for:\n- Overpriced items, tourist traps, hidden charges, inflated fares\n- Scam patterns: pressure tactics, fake authority, misleading claims, bait-and-switch\n- Physical safety concerns: traffic hazards, suspicious behavior, crowded exits\n- Negotiation opportunities: compare with fair market rates, suggest counter-offers\n\nWhen you detect something, call the ${SUGGESTION_FUNCTION_NAME} function with category, title, detail, action, and confidence.\nKeep spoken output minimal and in ${targetLanguage.label} — prefer structured suggestions over long narration.\nOnly speak aloud for HIGH urgency situations. For everything else, emit a suggestion silently.\nWhen asked a question, respond helpfully in ${targetLanguage.label}.`,
    AUTO: `CURRENT MODE: AUTO (Adaptive)\nYou have ALL capabilities active simultaneously. Analyse what you hear and see in real time and automatically choose the best behavior:\n\nBEHAVIOR PROFILES (use whichever fits the current context):\n1. SPOT — When camera shows text, signs, labels, documents, menus → read and explain them in ${targetLanguage.label}.\n2. ECHO — When you hear speech in ${sourceLanguage.label} or another language → translate it into ${targetLanguage.label}. Output only translation.\n3. GUIDE — When user asks a question, needs directions, or wants help with a process → answer with Step 1, Step 2, Step 3 in ${targetLanguage.label}. Use grounding/search when helpful.\n4. BRIDGE — When two people are conversing in different languages → interpret bidirectionally between ${sourceLanguage.label} and ${targetLanguage.label}.\n5. SHIELD — When you detect overpriced items, scam patterns, pressure tactics, safety concerns → call ${SUGGESTION_FUNCTION_NAME} with category, title, detail, action, confidence.\n\nAfter choosing, call ${MODE_SIGNAL_FUNCTION_NAME} with the behavior name so the UI shows what you are doing.\n\nRULES:\n- Seamlessly switch between behaviors as context changes.\n- Do NOT announce mode switches verbally. Just act.\n- Keep all output in ${targetLanguage.label} unless bridging.\n- Always be alert for risks (price, scam, safety) regardless of active behavior.\n- Keep responses short and actionable.`,
  };

  return prompts[mode];
}

function buildSystemPrompt({
  mode,
  sourceLanguage,
  targetLanguage,
  safetyProfile,
  sceneContext,
  riskPolicy,
  proactivityPolicy,
}: PromptContext) {
  const safetyLines = [
    safetyProfile.disallowMedicalLegalAdvice
      ? "SAFETY: Never provide medical or legal diagnosis, prescriptions, verdicts, or legal strategy."
      : "",
    safetyProfile.explainOfficialInstructionsOnly
      ? "SAFETY: You may translate and explain official instructions from documents, notices, staff announcements, and forms in plain language."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const riskTypes = riskPolicy.enabledTypes.join(", ");

  return `You are native, a realtime multimodal local companion for India.

MISSION:
Help internal migrants become local faster by combining seeing, hearing, grounding, and practical next actions.

CORE RULES:
- Preferred output is ${targetLanguage.label} (${targetLanguage.display}), unless BRIDGE mode requires opposite direction.
- Keep outputs short, practical, and actionable.
- Avoid filler narration.

${buildModeInstruction(mode, sourceLanguage, targetLanguage)}

PROACTIVITY POLICY:
- Style: ${proactivityPolicy.style}
- Speak proactively only when confidence is high for meaningful risk or user asks explicitly.
- Avoid narration spam during silence or low-signal context.

LOCAL RISK GUARD:
- Watch for risk types: ${riskTypes}
- If actionable risk is detected, call function ${RISK_FUNCTION_NAME} with cue, reason, one-line action, level, and confidence.
- For price risk, compare stated amount with context and grounding when available.
- For misinformation risk, flag contradictions and suspicious process instructions.
- For urgency risk, flag pressure cues, fines, penalties, or emergency language.

${safetyLines}

LIVE CONTEXT:
- Source language context: ${sourceLanguage.label}
- Target language context: ${targetLanguage.label}
- Current scene focus: ${sceneContext || "General exploration"}`;
}

function buildConfig(
  promptContext: PromptContext,
  voiceName: string,
  searchEnabled: boolean,
  riskGuardEnabled: boolean,
): LiveConnectConfig {
  const isAutoMode = promptContext.mode === "AUTO";
  const tools: Tool[] = [];

  if ((promptContext.mode === "GUIDE" || promptContext.mode === "SHIELD" || isAutoMode) && searchEnabled) {
    tools.push({ googleSearch: {} });
  }

  const fnDeclarations: FunctionDeclaration[] = [];
  if (riskGuardEnabled) {
    fnDeclarations.push(RISK_FUNCTION_DECLARATION);
  }
  if (promptContext.mode === "SHIELD" || isAutoMode) {
    fnDeclarations.push(SUGGESTION_FUNCTION_DECLARATION);
  }
  if (promptContext.mode === "SPOT" || isAutoMode) {
    fnDeclarations.push(FORMATTED_CONTENT_DECLARATION);
  }
  if (isAutoMode) {
    fnDeclarations.push({
      name: MODE_SIGNAL_FUNCTION_NAME,
      description: "Report which behavior profile you are currently using so the UI can display it.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          behavior: {
            type: Type.STRING,
            enum: ["SPOT", "ECHO", "GUIDE", "BRIDGE", "SHIELD"],
            description: "The behavior profile currently active.",
          },
          reason: {
            type: Type.STRING,
            description: "Short reason for choosing this behavior.",
          },
        },
        required: ["behavior", "reason"],
      },
    });
  }
  if (fnDeclarations.length) {
    tools.push({ functionDeclarations: fnDeclarations });
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

  const webcam = useWebcam();
  const screenCapture = useScreenCapture();

  const [activeMode, setActiveMode] = useState<NativeMode | null>("SPOT");
  const [sourceLanguage, setSourceLanguage] =
    useState<LanguageChoice>(DEFAULT_SOURCE_LANGUAGE);
  const [targetLanguage, setTargetLanguage] =
    useState<LanguageChoice>(DEFAULT_TARGET_LANGUAGE);
  const [activeVoice, setActiveVoice] = useState<string>(VOICES[0]);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [selectedSceneId, setSelectedSceneId] = useState<string>(DEMO_SCENES[0].id);
  const [sceneContext, setSceneContext] = useState<string>(DEMO_SCENES[0].scriptHint);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visualSource, setVisualSource] = useState<"camera" | "screen">("camera");
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const [riskGuardEnabled, setRiskGuardEnabled] = useState(true);
  const [currentRisk, setCurrentRisk] = useState<RiskSignal | null>(null);
  const [riskHistory, setRiskHistory] = useState<RiskSignal[]>([]);
  const [suggestions, setSuggestions] = useState<SmartSuggestion[]>([]);
  const [formattedContents, setFormattedContents] = useState<FormattedContent[]>([]);
  const [autoDetectedBehavior, setAutoDetectedBehavior] = useState<string | null>(null);
  const [autoDetectedReason, setAutoDetectedReason] = useState<string | null>(null);

  const [inputDraft, setInputDraft] = useState("");
  const [lastInputTranscript, setLastInputTranscript] = useState("");
  const [lastOutputTranscript, setLastOutputTranscript] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);

  const [sessionHealth, setSessionHealth] = useState<SessionHealth>({
    permissions: { mic: "unknown", vision: "unknown" },
    connected: false,
    reconnecting: false,
    lastError: null,
  });

  const [audioRecorder] = useState(() => new AudioRecorder());

  const { client, connected, connect, disconnect, volume, setConfig, setModel } =
    useLiveAPIContext();

  const activeScene = useMemo(
    () => DEMO_SCENES.find((scene) => scene.id === selectedSceneId) || null,
    [selectedSceneId],
  );

  const promptContext = useMemo<PromptContext>(
    () => ({
      mode: activeMode,
      sourceLanguage,
      targetLanguage,
      safetyProfile: SAFETY_PROFILE,
      sceneContext,
      riskPolicy: RISK_POLICY,
      proactivityPolicy: PROACTIVITY_POLICY,
    }),
    [activeMode, sourceLanguage, targetLanguage, sceneContext],
  );

  const sessionConfig = useMemo(
    () => buildConfig(promptContext, activeVoice, searchEnabled, riskGuardEnabled),
    [promptContext, activeVoice, searchEnabled, riskGuardEnabled],
  );

  const sessionSignature = useMemo(() => JSON.stringify(sessionConfig), [sessionConfig]);

  const riskGuardState = useMemo<RiskGuardState>(
    () => ({
      enabled: riskGuardEnabled,
      currentRisk,
      history: riskHistory,
    }),
    [riskGuardEnabled, currentRisk, riskHistory],
  );

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
    (transcript: string) => {
      if (!riskGuardEnabled) {
        return;
      }
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
    [applyRiskSignal, riskGuardEnabled, sourceLanguage, targetLanguage],
  );

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
        toErrorMessage(
          error,
          "Microphone permission is blocked. Enable it and retry.",
        ),
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
      if (!toolCall.functionCalls?.length) {
        return;
      }

      const functionResponses = toolCall.functionCalls.map((functionCall) => {
        // Handle risk signal
        if (functionCall.name === RISK_FUNCTION_NAME) {
          if (!riskGuardEnabled) {
            return {
              id: functionCall.id,
              name: functionCall.name,
              response: { output: { accepted: false, reason: "Risk guard disabled." } },
            };
          }

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

        // Handle suggestion
        if (functionCall.name === SUGGESTION_FUNCTION_NAME) {
          const args = functionCall.args || {};
          const category = String(args.category || "").trim() as SuggestionCategory;
          const title = String(args.title || "").trim();
          const detail = String(args.detail || "").trim();
          const action = String(args.action || "").trim();
          const confidence = clampConfidence(Number(args.confidence || 0));

          const validCategories: SuggestionCategory[] = ["overspend", "scam", "safety", "negotiation", "general"];
          if (!validCategories.includes(category) || !title || !detail || !action) {
            return {
              id: functionCall.id,
              name: functionCall.name,
              response: { output: { accepted: false, reason: "Malformed suggestion payload." } },
            };
          }

          const suggestion: SmartSuggestion = {
            id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            category,
            title,
            detail,
            action,
            confidence,
            timestamp: new Date().toISOString(),
            source: "model",
          };

          setSuggestions((prev) => [suggestion, ...prev].slice(0, 20));
          return {
            id: functionCall.id,
            name: functionCall.name,
            response: { output: { accepted: true, reason: "Suggestion recorded." } },
          };
        }

        // Handle mode signal (Auto mode)
        if (functionCall.name === MODE_SIGNAL_FUNCTION_NAME) {
          const args = functionCall.args || {};
          const behavior = String(args.behavior || "").trim();
          const reason = String(args.reason || "").trim();
          const validBehaviors = ["SPOT", "ECHO", "GUIDE", "BRIDGE", "SHIELD"];
          if (validBehaviors.includes(behavior)) {
            setAutoDetectedBehavior(behavior);
            setAutoDetectedReason(reason);
          }
          return {
            id: functionCall.id,
            name: functionCall.name,
            response: { output: { accepted: true, reason: "Mode signal received." } },
          };
        }

        // Handle formatted content (Spot mode)
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

        // Unknown function
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
    riskGuardEnabled,
    sourceLanguage,
    targetLanguage,
  ]);

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
        setEntries((previous) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            speaker: "native" as const,
            text,
          },
          ...previous,
        ].slice(0, 24));
        maybeApplyHeuristicRisk(text);
      }
    };

    client.on("content", onContent);
    return () => {
      client.off("content", onContent);
    };
  }, [client, maybeApplyHeuristicRisk]);

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

  const applyScenePreset = useCallback(
    async (sceneId: string): Promise<void> => {
      const scene = DEMO_SCENES.find((item) => item.id === sceneId);
      if (!scene) {
        return;
      }

      setSelectedSceneId(scene.id);
      setSceneContext(scene.scriptHint);
      setActiveMode(scene.mode);
      setSourceLanguage((current) => getLanguage(scene.sourceLanguage, current));
      setTargetLanguage((current) => getLanguage(scene.targetLanguage, current));
      setSearchEnabled(scene.requiresSearch);
      setLastError(null);

      if (!micEnabled) {
        await enableMic();
      }

      if (scene.requiresVision) {
        setVisualSource("camera");
        await turnOnVision("camera");
      } else if (visionEnabled) {
        turnOffVision();
      }
    },
    [
      enableMic,
      micEnabled,
      setLastError,
      turnOffVision,
      turnOnVision,
      visionEnabled,
    ],
  );

  const submitTextPrompt = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = inputDraft.trim();
      if (!trimmed || !connected) {
        return;
      }

      client.send([{ text: trimmed }]);
      setEntries((previous) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          speaker: "you" as const,
          text: trimmed,
        },
        ...previous,
      ].slice(0, 24));
      setInputDraft("");
    },
    [client, connected, inputDraft],
  );

  const liveStatuses = [
    { label: "Listening", active: connected && micEnabled },
    { label: "Seeing", active: connected && visionEnabled },
    {
      label: "Searching",
      active: connected && (activeMode === "GUIDE" || activeMode === "SHIELD" || activeMode === "AUTO") && searchEnabled,
    },
    { label: "Speaking", active: connected && volume > 0.05 },
    { label: "Guarding", active: connected && (activeMode === "SHIELD" || activeMode === "AUTO") },
    ...(activeMode === "AUTO" && autoDetectedBehavior
      ? [{ label: `Behavior: ${autoDetectedBehavior}`, active: true }]
      : []),
  ];

  return (
    <div className="native-app">
      <canvas ref={frameCanvasRef} className="hidden-canvas" />

      <header className="top-rail">
        <div className="brand-block">
          <p className="eyebrow">Local Risk Guard</p>
          <h1>native</h1>
          <p className="tagline">Become local, stay safe, act with confidence.</p>
        </div>

        <div className="rail-controls">
          <div className="chip-group mode-chip-group">
            {(Object.keys(MODE_DETAILS) as NativeMode[]).map((mode) => (
              <button
                key={mode}
                className={cn("rail-chip", { active: activeMode === mode })}
                onClick={() =>
                  setActiveMode((current) => (current === mode ? null : mode))
                }
              >
                {MODE_DETAILS[mode].title}
              </button>
            ))}
          </div>

          <div className="scene-row">
            <label htmlFor="scene-select">Scene</label>
            <select
              id="scene-select"
              value={selectedSceneId}
              onChange={(event) => void applyScenePreset(event.target.value)}
            >
              {DEMO_SCENES.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.label}
                </option>
              ))}
            </select>
            <span className="scene-hint-inline">{activeScene?.scriptHint}</span>
          </div>

          <div className="pair-row">
            <label htmlFor="source-language">Local</label>
            <select
              id="source-language"
              value={sourceLanguage.id}
              onChange={(event) =>
                setSourceLanguage(getLanguage(event.target.value, sourceLanguage))
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>

            <label htmlFor="target-language">Home</label>
            <select
              id="target-language"
              value={targetLanguage.id}
              onChange={(event) =>
                setTargetLanguage(getLanguage(event.target.value, targetLanguage))
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rail-actions">
          <button
            className={cn("session-toggle", {
              connected,
              disabled: sessionHealth.reconnecting,
            })}
            onClick={() => void toggleConnection()}
            disabled={sessionHealth.reconnecting}
          >
            {sessionHealth.reconnecting
              ? "Reconnecting..."
              : connected
                ? "Pause"
                : "Start"}
          </button>

          <button
            className={cn("risk-toggle", { active: riskGuardState.enabled })}
            onClick={() => setRiskGuardEnabled((value) => !value)}
          >
            Risk Guard {riskGuardState.enabled ? "On" : "Off"}
          </button>
        </div>
      </header>

      <main className="command-main">
        <section className="vision-panel">
          <div className="panel-head">
            <strong>Live View</strong>
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
                <span>Enable Camera or Screen for Spot, Guide, and Shield modes.</span>
              </div>
            )}
          </div>

          <div className="control-strip">
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
              className={cn("control-chip", {
                active: searchEnabled,
                disabled: activeMode !== "GUIDE" && activeMode !== "SHIELD" && activeMode !== "AUTO",
              })}
              onClick={() => setSearchEnabled((value) => !value)}
              disabled={activeMode !== "GUIDE" && activeMode !== "SHIELD" && activeMode !== "AUTO"}
            >
              Search {searchEnabled ? "On" : "Off"}
            </button>
          </div>
        </section>

        <section className="risk-panel">
          <div className="panel-head">
            <strong>Local Risk Guard</strong>
            <span className="mode-tag">{activeMode || "Standby"}</span>
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
                <p className="risk-line">Listening for price, misinformation, and urgency cues.</p>
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
                {riskGuardState.currentRisk.baselineReference && (
                  <p className="risk-line">
                    Baseline: {riskGuardState.currentRisk.baselineReference}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="status-grid">
            {liveStatuses.map((status) => (
              <div
                key={status.label}
                className={cn("status-chip", { active: status.active })}
              >
                {status.label}
              </div>
            ))}
          </div>

          <div className="risk-mini-history">
            <p>Recent signals</p>
            {riskGuardState.history.length === 0 ? (
              <span className="history-empty">No signals yet.</span>
            ) : (
              <ul>
                {riskGuardState.history.slice(0, 4).map((risk) => (
                  <li key={risk.id}>
                    <strong>{risk.level}</strong> {risk.type}: {risk.action}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {(activeMode === "SHIELD" || activeMode === "AUTO") && (
          <section className="suggestion-panel">
            <div className="panel-head">
              <strong>🛡️ Smart Guardian</strong>
              <span className="suggestion-count">
                {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
              </span>
            </div>

            {suggestions.length === 0 ? (
              <div className="suggestion-empty">
                <p className="suggestion-empty-title">Guardian is watching</p>
                <p className="suggestion-empty-hint">
                  Enable mic and camera, then connect. Shield will analyse your
                  surroundings and suggest ways to save money, avoid scams, and
                  stay safe.
                </p>
              </div>
            ) : (
              <div className="suggestion-list">
                {suggestions.slice(0, 8).map((sug) => (
                  <div
                    key={sug.id}
                    className={cn("suggestion-card", sug.category)}
                  >
                    <div className="suggestion-card-head">
                      <span className="suggestion-category-badge">
                        {sug.category === "overspend" && "💰"}
                        {sug.category === "scam" && "🚨"}
                        {sug.category === "safety" && "⚠️"}
                        {sug.category === "negotiation" && "🤝"}
                        {sug.category === "general" && "💡"}
                        {" "}{sug.category}
                      </span>
                      <span className="suggestion-confidence">
                        {Math.round(sug.confidence * 100)}%
                      </span>
                    </div>
                    <p className="suggestion-title">{sug.title}</p>
                    <p className="suggestion-detail">{sug.detail}</p>
                    <p className="suggestion-action">
                      <strong>→</strong> {sug.action}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {suggestions.length > 0 && (
              <button
                className="suggestion-clear"
                onClick={() => setSuggestions([])}
              >
                Clear all suggestions
              </button>
            )}
          </section>
        )}

        {/* Formatted Content Panel (Spot / Auto mode) */}
        {(activeMode === "SPOT" || activeMode === "AUTO") && (
          <section className="formatted-content-panel">
            <div className="panel-head">
              <strong>📄 Visual Content</strong>
              <span className="suggestion-count">
                {formattedContents.length} item{formattedContents.length !== 1 ? "s" : ""}
              </span>
            </div>

            {formattedContents.length === 0 ? (
              <div className="suggestion-empty">
                <p className="suggestion-empty-title">Point camera at text</p>
                <p className="suggestion-empty-hint">
                  When Spot sees menus, documents, forms, signs, or tables, it will
                  speak a summary and show a detailed breakdown here.
                </p>
              </div>
            ) : (
              <div className="formatted-content-list">
                {formattedContents.map((fc) => (
                  <div key={fc.id} className="formatted-content-card">
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
            )}

            {formattedContents.length > 0 && (
              <button
                className="suggestion-clear"
                onClick={() => setFormattedContents([])}
              >
                Clear all content
              </button>
            )}
          </section>
        )}
      </main>

      <section className="live-strip">
        <div className="live-cell">
          <span>You hear</span>
          <p>{lastInputTranscript || "..."}</p>
        </div>
        <div className="live-cell">
          <span>native says</span>
          <p>{lastOutputTranscript || "..."}</p>
        </div>
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

          {/* Blind mode hooks intentionally not rendered in production path. */}
          {FEATURE_FLAGS.blindMode ? null : null}
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
