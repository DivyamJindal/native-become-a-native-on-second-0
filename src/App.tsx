import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LiveConnectConfig, LiveServerContent, Modality, Tool } from "@google/genai";
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

type NativeMode = "SPOT" | "ECHO" | "GUIDE" | "BRIDGE";
type PermissionFlag = "unknown" | "granted" | "denied" | "prompt";

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

type PromptContext = {
  mode: NativeMode | null;
  sourceLanguage: LanguageChoice;
  targetLanguage: LanguageChoice;
  safetyProfile: SafetyProfile;
  sceneContext: string;
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
    blurb: "What you see + what you ask + live search.",
  },
  BRIDGE: {
    title: "Bridge",
    blurb: "Two-way live conversation interpreter.",
  },
};

const SAFETY_PROFILE: SafetyProfile = {
  disallowMedicalLegalAdvice: true,
  explainOfficialInstructionsOnly: true,
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
      "Point at a government form and ask: 'Yeh form kaise bharein? Mujhe kya chahiye?' Expect: Step 1/2/3 answer in Hindi.",
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
      "Play or speak a Kannada announcement. Expect translation-only Hindi output with no extra commentary.",
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
      "Person A speaks Hindi, Person B speaks Kannada. Native should translate bidirectionally with minimal delay.",
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

function buildModeInstruction(
  mode: NativeMode | null,
  sourceLanguage: LanguageChoice,
  targetLanguage: LanguageChoice,
) {
  if (!mode) {
    return `CURRENT MODE: STANDBY\nOnly respond when asked. Keep output concise and in ${targetLanguage.label}.`;
  }

  const prompts: Record<NativeMode, string> = {
    SPOT: `CURRENT MODE: SPOT\nFocus on camera input. Proactively read visible text and explain what the user should do next in ${targetLanguage.label}.`,
    ECHO: `CURRENT MODE: ECHO\nTranslate incoming speech into ${targetLanguage.label}. Output only translation. Preserve tone. Stay silent during silence and non-speech audio.`,
    GUIDE: `CURRENT MODE: GUIDE\nUse what you see + what user asks + web grounding when needed. Always end with Step 1, Step 2, Step 3 in ${targetLanguage.label}.`,
    BRIDGE: `CURRENT MODE: BRIDGE\nTwo-way interpretation mode. If speaker uses ${sourceLanguage.label}, translate to ${targetLanguage.label}. If speaker uses ${targetLanguage.label}, translate to ${sourceLanguage.label}. Output only translation with no commentary.`,
  };

  return prompts[mode];
}

function buildSystemPrompt({
  mode,
  sourceLanguage,
  targetLanguage,
  safetyProfile,
  sceneContext,
}: PromptContext) {
  const safetyLines = [
    safetyProfile.disallowMedicalLegalAdvice
      ? "SAFETY: Never provide medical or legal diagnosis, prescriptions, or verdicts."
      : "",
    safetyProfile.explainOfficialInstructionsOnly
      ? "SAFETY: You may translate and explain official instructions from documents, announcements, or authorities in plain language."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `You are native, a realtime multimodal local companion for India.

You can see through camera, hear through microphone, use web grounding when needed, and speak naturally.

CORE RULES:
- Primary audience: internal migrants navigating unfamiliar Indian cities.
- Preferred output language is ${targetLanguage.label} (${targetLanguage.display}) unless BRIDGE mode requires the opposite direction.
- Keep responses short, practical, and action-oriented.
- For forms, stations, hospitals, public offices, and transport: explain clearly and safely.
- Do not introduce yourself repeatedly. Be an invisible helper.

${safetyLines}

LIVE CONTEXT:
- Source language context: ${sourceLanguage.label}
- Target language context: ${targetLanguage.label}
- Current demo context: ${sceneContext || "General exploration"}

${buildModeInstruction(mode, sourceLanguage, targetLanguage)}`;
}

function buildConfig(
  promptContext: PromptContext,
  voiceName: string,
  searchEnabled: boolean,
): LiveConnectConfig {
  const tools: Tool[] =
    promptContext.mode === "GUIDE" && searchEnabled
      ? ([{ googleSearch: {} }] as Tool[])
      : [];

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

  const [micEnabled, setMicEnabled] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visualSource, setVisualSource] = useState<"camera" | "screen">("camera");
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

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
    }),
    [activeMode, sourceLanguage, targetLanguage, sceneContext],
  );

  const sessionConfig = useMemo(
    () => buildConfig(promptContext, activeVoice, searchEnabled),
    [promptContext, activeVoice, searchEnabled],
  );

  const sessionSignature = useMemo(
    () => JSON.stringify(sessionConfig),
    [sessionConfig],
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
          setLastError(
            toErrorMessage(error, "Could not start microphone capture."),
          );
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
  }, [
    audioRecorder,
    client,
    connected,
    micEnabled,
    setLastError,
    setPermission,
  ]);

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
        setLastError(
          toErrorMessage(error, "Could not start visual capture."),
        );
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
    const onContent = (content: LiveServerContent) => {
      if (content.inputTranscription?.text) {
        setLastInputTranscript(content.inputTranscription.text);
      }

      if (content.outputTranscription?.text) {
        setLastOutputTranscript(content.outputTranscription.text);
      }

      const text =
        content.modelTurn?.parts
          ?.map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("\n")
          .trim() || "";

      if (text) {
        setEntries((previous) => [
          ...previous.slice(-11),
          {
            id: `${Date.now()}-${Math.random()}`,
            speaker: "native",
            text,
          },
        ]);
      }
    };

    client.on("content", onContent);

    return () => {
      client.off("content", onContent);
    };
  }, [client]);

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
        ...previous.slice(-11),
        { id: `${Date.now()}-${Math.random()}`, speaker: "you", text: trimmed },
      ]);
      setInputDraft("");
    },
    [client, connected, inputDraft],
  );

  const liveStatuses = [
    { label: "Listening", active: connected && micEnabled },
    { label: "Seeing", active: connected && visionEnabled },
    {
      label: "Searching",
      active: connected && activeMode === "GUIDE" && searchEnabled,
    },
    { label: "Speaking", active: connected && volume > 0.05 },
  ];

  return (
    <div className="native-app">
      <canvas ref={frameCanvasRef} className="hidden-canvas" />

      <header className="hero">
        <div>
          <p className="eyebrow">India-first multimodal local companion</p>
          <h1>native</h1>
          <p className="tagline">
            The one app you need to become a local anywhere.
          </p>
        </div>

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
            ? "Pause Session"
            : "Start Session"}
        </button>
      </header>

      <main className="layout">
        <section className="camera-shell">
          <div className="shell-top">
            <strong>What native sees</strong>
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
                <span>Enable Camera or Screen to start Spot and Guide modes.</span>
              </div>
            )}
          </div>

          <div className="toggles">
            <button
              className={cn("feature-toggle", { active: micEnabled })}
              onClick={() => void onMicToggle()}
            >
              {micEnabled ? "Mic On" : "Mic Off"}
            </button>
            <button
              className={cn("feature-toggle", { active: visionEnabled })}
              onClick={() => void onVisualToggle()}
            >
              {visionEnabled ? "Vision On" : "Vision Off"}
            </button>
            <button
              className={cn("feature-toggle", {
                active: searchEnabled,
                disabled: activeMode !== "GUIDE",
              })}
              onClick={() => setSearchEnabled((value) => !value)}
              disabled={activeMode !== "GUIDE"}
            >
              {searchEnabled ? "Search On" : "Search Off"}
            </button>
          </div>

          {activeMode === "GUIDE" && (
            <p className="guide-indicator">
              Guide grounding: <strong>{searchEnabled ? "Enabled" : "Disabled"}</strong>
            </p>
          )}
        </section>

        <section className="control-shell">
          <article className="panel scene-panel">
            <h2>Demo Presets</h2>
            <div className="scene-grid">
              {DEMO_SCENES.map((scene) => (
                <button
                  key={scene.id}
                  className={cn("scene-card", {
                    active: selectedSceneId === scene.id,
                  })}
                  onClick={() => void applyScenePreset(scene.id)}
                >
                  <strong>{scene.label}</strong>
                  <span>{MODE_DETAILS[scene.mode].title}</span>
                </button>
              ))}
            </div>
            <p className="scene-hint">{activeScene?.scriptHint}</p>
          </article>

          <article className="panel">
            <h2>Modes</h2>
            <div className="mode-grid">
              {(Object.keys(MODE_DETAILS) as NativeMode[]).map((mode) => (
                <button
                  key={mode}
                  className={cn("mode-card", { active: activeMode === mode })}
                  onClick={() =>
                    setActiveMode((current) => (current === mode ? null : mode))
                  }
                >
                  <strong>{MODE_DETAILS[mode].title}</strong>
                  <span>{MODE_DETAILS[mode].blurb}</span>
                </button>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>Language</h2>
            <p className="language-label">Home language (output)</p>
            <div className="language-row">
              {LANGUAGES.map((language) => (
                <button
                  key={language.id}
                  className={cn("language-pill", {
                    active: targetLanguage.id === language.id,
                  })}
                  onClick={() => setTargetLanguage(language)}
                >
                  {language.display}
                </button>
              ))}
            </div>

            <div className="voice-row stack">
              <label htmlFor="source-language">Local language context</label>
              <select
                id="source-language"
                value={sourceLanguage.id}
                onChange={(event) =>
                  setSourceLanguage(
                    getLanguage(event.target.value, sourceLanguage),
                  )
                }
              >
                {LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label} ({language.display})
                  </option>
                ))}
              </select>
            </div>

            <div className="voice-row">
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
          </article>

          <article className="panel">
            <h2>Live state</h2>
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

            <div className="permission-grid">
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

            <p className="mode-readout">
              Mode: <strong>{activeMode ? MODE_DETAILS[activeMode].title : "Standby"}</strong>
            </p>
            <p className="mode-readout">
              Pair: <strong>{sourceLanguage.label}</strong> to <strong>{targetLanguage.label}</strong>
            </p>
            <p className="mode-readout">
              Model: <strong>{MODEL_NAME}</strong>
            </p>

            {(sessionHealth.lastError || sessionHealth.reconnecting) && (
              <div className="session-alert">
                <p>{sessionHealth.lastError || "Reconnecting live session..."}</p>
                <button onClick={() => void retrySession()}>Retry Session</button>
              </div>
            )}
          </article>

          <article className="panel transcript-panel">
            <h2>Live transcript</h2>
            <p className="caption-line">
              <strong>You:</strong> {lastInputTranscript || "..."}
            </p>
            <p className="caption-line">
              <strong>native:</strong> {lastOutputTranscript || "..."}
            </p>
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
          </article>
        </section>
      </main>
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
