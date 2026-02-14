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

type NativeMode = "GUIDE" | "BRIDGE";
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
    blurb: "Talk and explore. Camera optional.",
  },
  BRIDGE: {
    title: "Bridge",
    blurb: "Live translation of your surroundings.",
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

  const urgency = ["immediately", "urgent", "fine", "penalty", "police", "last warning", "deadline", "jaldi", "tatkal", "ತಕ್ಷಣ", "ದಂಡ"];
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
  cameraOn: boolean,
) {
  if (mode === "GUIDE") {
    const cameraBlock = cameraOn
      ? `
CAMERA IS ACTIVE — you can see what the user sees.
Additional responsibilities when camera is on:
- Proactively read visible text, signs, labels, menus, notices, timetables, and documents. Explain what they mean and what the user should do, in ${targetLanguage.label}.
- For complex content (menus with prices, timetables, forms, multi-line signs — anything with 3+ items or structured data): speak a brief 2–3 sentence audio summary AND call ${FORMATTED_CONTENT_FUNCTION_NAME} with a full markdown breakdown translated into ${targetLanguage.label}.
- When reading text in another language, translate naturally — do not read the original aloud unless asked.
- For documents and forms: explain each field and what to fill in.
- If you see suspicious pricing, misleading signs, or anything concerning — flag via ${RISK_FUNCTION_NAME}.
- When nothing new is visible, stay silent. Do not re-narrate the same scene.`
      : `
CAMERA IS OFF — audio only.
- Focus entirely on the user's spoken questions.
- If the user describes something visual, ask clarifying questions or suggest they turn on the camera.`;

    return `CURRENT MODE: GUIDE

You are the user's personal voice assistant. They speak to you and you respond in audio.

YOUR JOB:
- Listen to the user's questions and requests.
- Answer in ${targetLanguage.label} with clear, practical guidance.
- Structure complex answers as numbered steps.
- Use Google Search when the question involves local information (routes, timings, procedures, prices, customs) or anything you are not certain about.
- If the user describes a suspicious situation, assess it and advise.
${cameraBlock}

RULES:
- Stay silent during silence.
- Keep responses under 3–4 sentences unless more detail is requested.
- Ignore ambient noise not directed at you.`;
  }

  // BRIDGE mode
  return `CURRENT MODE: BRIDGE

You are a live ambient interpreter. The user's microphone picks up surrounding sound — announcements, conversations, vendor calls, PA systems. Your job is to translate and relay them in ${targetLanguage.label}.

YOUR JOB:
- Auto-detect what language is being spoken around the user.
- Translate all speech into ${targetLanguage.label}.
- Preserve tone, urgency, and intent.
- For announcements (train, bus, PA): extract key info (platform, time, destination, action) and state it clearly.
- For conversations: provide a brief summary, not word-for-word.
- If someone speaks directly to the user, translate what they said and suggest a response.

RULES:
- Output only translations and summaries. No commentary.
- Stay silent during silence or non-speech noise.
- Focus on the loudest or most relevant speaker when multiple people talk.
- Keep translations short and natural.
- If you detect urgency (last call, platform change), emphasize it.
- If you detect risk (overcharge, scam, pressure), flag via ${RISK_FUNCTION_NAME} and still translate.`;
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

function buildSystemPrompt({ mode, targetLanguage, userLocation, cameraOn }: PromptContext) {
  return `You are native — a realtime voice companion for travellers and migrants in India.

IDENTITY:
- You are a trusted local companion. Speak clearly and simply.
- Always respond in ${targetLanguage.label} (${targetLanguage.display}).
- Be concise and actionable. No filler phrases.

${buildModeInstruction(mode, targetLanguage, cameraOn)}

SAFETY:
- No medical diagnoses, legal verdicts, or prescriptions.
- You may translate and explain official documents and notices in plain language.
- If unsure, say so. Do not fabricate information.

RISK AWARENESS (always active):
- Monitor for: price gouging, misinformation, urgency/pressure tactics.
- When detected, call ${RISK_FUNCTION_NAME} with type, level, cue, reason, action, confidence.
${buildLocationBlock(userLocation)}`;
}

/* ─── Config Builder ─── */

function buildConfig(
  promptContext: PromptContext,
  voiceName: string,
): LiveConnectConfig {
  const tools: Tool[] = [];

  if (promptContext.mode === "GUIDE") {
    tools.push({ googleSearch: {} });
  }

  const fnDeclarations: FunctionDeclaration[] = [RISK_FUNCTION_DECLARATION];
  if (promptContext.mode === "GUIDE" && promptContext.cameraOn) {
    fnDeclarations.push(FORMATTED_CONTENT_DECLARATION);
  }
  tools.push({ functionDeclarations: fnDeclarations });

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
    // Bridge mode: camera off
    if (mode === "BRIDGE" && cameraOn) turnOffCamera();
    // Always need mic
    if (!micEnabled) await enableMic();
  }, [cameraOn, turnOffCamera, enableMic, micEnabled, setLastError]);

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
        {cameraOn && activeMode === "GUIDE" ? (
          <div className="camera-feed">
            <video ref={videoRef} autoPlay playsInline className={cn("stream", { hidden: !activeStream })} />
            {!activeStream && <div className="placeholder"><span>Camera starting...</span></div>}
          </div>
        ) : (
          <div className={cn("audio-area", { pulsing: connected && volume > 0.02 })}>
            <div className="ring r1" />
            <div className="ring r2" />
            <span className="area-label">
              {connected
                ? activeMode === "BRIDGE" ? "translating surroundings" : "listening"
                : "tap start"}
            </span>
          </div>
        )}
      </main>

      {activeMode === "GUIDE" && (
        <button
          className={cn("pill-btn camera-toggle", { active: cameraOn })}
          onClick={() => void toggleCamera()}
        >
          {cameraOn ? "camera on" : "camera off"}
        </button>
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
