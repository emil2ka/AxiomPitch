import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  ChevronRight,
  Clock3,
  FileUp,
  Hand,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Monitor,
  Pause,
  Play,
  Plug,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  Square,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Audience } from "./components/Audience";
import { flushSync } from "react-dom";
import { Landing } from "./components/Landing";
import { PixelCompanion } from "./components/PixelCompanion";
import type { CompanionAction } from "./components/PixelCompanion";
import { StudioSidebar } from "./components/StudioSidebar";
import "./studio.css";
import "./speaker-transition.css";
import "./bridge-controls.css";

import { SlideView } from "./components/SlideView";
import { useCamera } from "./hooks/useCamera";
import {
  apiBase,
  apiEnabled,
  saveNotes,
  saveSession,
  uploadPresentation,
} from "./lib/api";
import { BridgeClient, followTarget, isExternal } from "./lib/bridge-client";
import type {
  AppRef,
  DisplayInfo,
  TargetId,
  TargetInfo,
  TargetStatus,
} from "./lib/bridge-client";
import { clearAccount, loadAccount, markLearned } from "./lib/account";
import { demoSlides, formatTime, readPdf } from "./lib/deck";
import { GestureEngine } from "./lib/gestures";
import { SessionClock } from "./lib/session";
import type {
  Feedback,
  Gesture,
  SessionResult,
  Slide,
  VisionFrame,
} from "./lib/types";

const RegistrationPage = lazy(() => import("./components/RegistrationPage").then(module => ({ default: module.RegistrationPage })));
const LoginPage = lazy(() => import("./components/LoginPage").then(module => ({ default: module.LoginPage })));
const LearningPage = lazy(() => import("./components/LearningPage").then(module => ({ default: module.LearningPage })));
const CompanionPreview = lazy(() => import("./components/CompanionPreview").then(module => ({ default: module.CompanionPreview })));

type Stage = "idle" | "running" | "paused" | "finished";
type GestureDebug = {
  hands: number;
  open: number;
  scale: number;
  dx: number;
  dy: number;
  elapsed: number;
  threshold: number;
  locked: boolean;
  kind: string;
  code: string;
};
type GestureDebugEntry = { message: string; code: string; kind: string };
type CalibrationState = {
  step: 0 | 1 | 2 | 3 | 4;
  feedback: string;
  kind: string;
  progress: number;
};
const calibrationSteps = ["Ладонь", "Вправо", "Влево", "Удержание"];
const calibrationMessages = [
  "Покажи открытую ладонь на удобном расстоянии",
  "Проведи ладонью вправо, как на выступлении",
  "Теперь влево",
  "Задержи ладонь на месте на полторы секунды",
];
const correctionNames: Record<string, string> = {
  frame: "Ладонь вне кадра",
  "lost-hand": "Ладонь потерялась в движении",
  palm: "Ладонь не раскрыта",
  edge: "Рука у края кадра",
  horizontal: "Движение по диагонали",
  wider: "Недостаточное движение",
  steady: "Ладонь двигалась при удержании",
};
const targetNames: Record<TargetId, string> = {
  pitchflow: "PitchFlow (эта колода)",
  keynote: "Keynote",
  powerpoint: "PowerPoint",
  chrome: "Google Slides в Chrome",
  frontmost: "Другое приложение (стрелки)",
};
function slidesWord(count: number | null | undefined) {
  if (count === null || count === undefined) return "слайдов";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "слайд";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "слайда";
  return "слайдов";
}
function describeTarget(status: TargetStatus | null, estimated: boolean) {
  if (!status?.connected || !status.app || status.app === "pitchflow")
    return "";
  const label = status.label ?? targetNames[status.app];
  if (status.slideIndex !== null && status.slideCount !== null)
    return `${label} · слайд ${status.slideIndex + 1} из ${status.slideCount}`;
  return estimated ? `${label} · номер оценочный` : `${label} · подключено`;
}

function Presenter() {
  const [slides, setSlides] = useState<Slide[]>(demoSlides);
  const [deckName, setDeckName] = useState("Первый питч");
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"rehearsal" | "live">("rehearsal");
  const [stage, setStage] = useState<Stage>("idle");
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({
    kind: "idle",
    message: "Включи камеру, чтобы оживить аватара",
  });
  const [duration, setDuration] = useState(0);
  const [target, setTarget] = useState(5);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(
    () => new URLSearchParams(location.search).get("history") === "1",
  );
  const [history, setHistory] = useState<SessionResult[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("axiompitch-history") || "[]",
      );
      return Array.isArray(saved)
        ? saved
            .filter(
              (item) =>
                typeof item.id === "string" &&
                Array.isArray(item.perSlide) &&
                Array.isArray(item.slideTitles) &&
                item.commands &&
                item.corrections,
            )
            .slice(0, 10)
        : [];
    } catch {
      return [];
    }
  });
  const [pdfProgress, setPdfProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [sensitivity, setSensitivity] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("axiompitch-sensitivity"));
      return Number.isFinite(saved) && saved >= 0.55 && saved <= 1.15
        ? saved
        : 0.85;
    } catch {
      return 0.85;
    }
  });
  const [view, setView] = useState<"deck" | "settings">(() =>
    new URLSearchParams(location.search).get("view") === "settings"
      ? "settings"
      : "deck",
  );
  const [account] = useState(() => loadAccount());
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const calibrationRef = useRef<CalibrationState | null>(null);
  const calibrationEngine = useRef(new GestureEngine());
  const calibrationStable = useRef(0);
  const calibrationLast = useRef(0);
  const calibrationPaint = useRef(0);
  const calibrationLogAt = useRef(0);
  const [debugGestures, setDebugGestures] = useState(() => {
    try {
      return localStorage.getItem("axiompitch-gesture-debug") === "1";
    } catch {
      return false;
    }
  });
  const [gestureDebug, setGestureDebug] = useState<GestureDebug | null>(null);
  const [debugLog, setDebugLog] = useState<GestureDebugEntry[]>([]);
  const calibrationDialogRef = useRef<HTMLDialogElement>(null);
  const debugGesturesRef = useRef(debugGestures);
  const debugPaint = useRef(0);
  const debugLogAt = useRef(0);
  const debugLastMessage = useRef("");
  useEffect(() => {
    debugGesturesRef.current = debugGestures;
    try {
      localStorage.setItem(
        "axiompitch-gesture-debug",
        debugGestures ? "1" : "0",
      );
    } catch {
      // Private mode: keep the flag for this tab only.
    }
  }, [debugGestures]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [pulse, setPulse] = useState<{ id: number; gesture: Gesture } | null>(
    null,
  );
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [slideTarget, setSlideTarget] = useState<TargetStatus | null>(null);
  const [targetList, setTargetList] = useState<TargetInfo[]>([]);
  const [runningApps, setRunningApps] = useState<AppRef[]>([]);
  const [chosenTarget, setChosenTarget] = useState<TargetId>("pitchflow");
  const [chosenApp, setChosenApp] = useState("");
  const [estimated, setEstimated] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [externalIndex, setExternalIndex] = useState(0);
  const [pdfMatches, setPdfMatches] = useState(false);
  const [notchEnabled, setNotchEnabled] = useState(() => localStorage.getItem("axiompitch-notch") !== "off");
  const [notchDisplay, setNotchDisplay] = useState<number | null>(() => {
    const saved = localStorage.getItem("axiompitch-notch-display");
    return saved && Number.isSafeInteger(Number(saved)) ? Number(saved) : null;
  });
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [shellConnected, setShellConnected] = useState(false);
  // Preserve the selected source during an outage instead of stepping the PDF.
  const external = Boolean(slideTarget?.app && slideTarget.app !== "pitchflow");
  const externalPosition = useRef(0);
  const previewAvailable = !external || (pdfMatches && externalIndex < slides.length);
  const shownIndex = external ? externalIndex : index;
  const shownCount = external ? slideTarget?.slideCount : slides.length;
  const externalReady = bridgeOnline && Boolean(slideTarget?.connected && !slideTarget.error);
  const bridge = useRef<BridgeClient | null>(null);
  const uploadToken = useRef(0);
  const engine = useRef(new GestureEngine());
  const session = useRef<SessionClock | null>(null);
  const sessionMeta = useRef<{ id: string; startedAt: string }>({
    id: "",
    startedAt: "",
  });
  const channel = useRef<BroadcastChannel | null>(null);
  const audienceWindow = useRef<Window | null>(null);
  const audienceSession = useRef(crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const historyDialogRef = useRef<HTMLDialogElement>(null);
  const successUntil = useRef(0);
  const correctionLast = useRef<Record<string, number>>({});
  const current = useRef({
    slides,
    index,
    locked,
    stage,
    mode,
    external,
    externalReady,
  });
  useLayoutEffect(() => {
    current.current = {
      slides,
      index,
      locked,
          stage,
      mode,
      external,
      externalReady,
    };
  }, [slides, index, locked, stage, mode, external, externalReady]);
  const reducedMotion = useReducedMotion();

  const goTo = useCallback((next: number) => {
    const state = current.current;
    const safe = Math.max(0, Math.min(state.slides.length - 1, next));
    if (!state.external) session.current?.changeSlide(safe, performance.now());
    current.current.index = safe;
    setIndex(safe);
  }, []);
  /** Lock is local to the tab; the bridge and the notch only hear about it. */
  const applyLock = useCallback((value: boolean) => {
    if (current.current.locked === value) return;
    current.current.locked = value;
    setLocked(value);
    bridge.current?.publishCommand("toggle", value);
  }, []);
  /** Keyboard and buttons: into the connected app, else through the deck. */
  const step = useCallback(
    (gesture: "next" | "previous") => {
      const client = bridge.current;
      if (current.current.external) {
        if (!client?.online || !current.current.externalReady) { setNotice("Внешний показ недоступен. Проверь подключение и приложение."); return; }
        // Manual steps ignore the gesture lock; the new position arrives as `target`.
        client
          .control(gesture, false)
          .catch((error: Error) => setNotice(error.message));
        return;
      }
      goTo(current.current.index + (gesture === "next" ? 1 : -1));
    },
    [goTo],
  );
  const applyTarget = useCallback(
    (status: TargetStatus) => {
      if (current.current.external && ["running", "paused"].includes(current.current.stage) &&
          (!status.app || status.app === "pitchflow")) {
        setSlideTarget(previous => previous && { ...previous, connected: false, error: "Мост потерял внешнюю цель. Заверши сеанс и подключи презентацию заново." });
        return;
      }
      setSlideTarget(status);
      if (status.error) {
        setNotice(status.error);
        setFeedback({ kind: "error", message: status.error });
        successUntil.current = performance.now() + 2500;
        return;
      }
      if (!isExternal(status)) {
        setEstimated(false);
        return;
      }
      setEstimated(status.slideIndex === null);
      const move = followTarget(
        status,
        externalPosition.current,
      );
      if (!move) return;
      setEstimated(move.estimated);
      if (status.slideCount) session.current?.ensureSlides(status.slideCount);
      if (move.index !== externalPosition.current) {
        session.current?.changeSlide(move.index, performance.now());
        externalPosition.current = move.index;
        setExternalIndex(move.index);
      }
    },
    [],
  );

  const updateCalibration = useCallback((next: CalibrationState | null) => {
    calibrationRef.current = next;
    setCalibration(next);
  }, []);
  const handleCalibration = useCallback(
    (frame: VisionFrame) => {
      const state = calibrationRef.current;
      if (!state) return;
      const engine = calibrationEngine.current;
      const feedback = engine.update(frame.pose, frame.hands, frame.time, false, frame.aspect);
      let next: CalibrationState = {
        ...state,
        feedback: feedback.message,
        kind: feedback.kind,
        progress: feedback.progress ?? 0,
      };
      if (state.step === 0) {
        const dt = calibrationLast.current
          ? Math.min(120, frame.time - calibrationLast.current)
          : 0;
        calibrationLast.current = frame.time;
        calibrationStable.current =
          engine.debug.open > 0 ? calibrationStable.current + dt : 0;
        next.progress = Math.min(1, calibrationStable.current / 1200);
        next.feedback =
          engine.debug.open > 0
            ? "Ладонь вижу — держи ещё немного"
            : "Покажи открытую ладонь";
        if (calibrationStable.current >= 1200) {
          engine.reset();
          calibrationLast.current = 0;
          next = {
            ...next,
            step: 1,
            progress: 0,
            feedback: "Теперь проведи рукой",
          };
        }
      } else if (feedback.kind === "success") {
        if (state.step === 1 && feedback.gesture === "next") {
          engine.reset();
          next = { ...next, step: 2, progress: 0, feedback: "Хорошо. Проведи влево" };
        } else if (state.step === 2 && feedback.gesture === "previous") {
          engine.reset();
          next = { ...next, step: 3, progress: 0, feedback: "Осталось удержание" };
        } else if (state.step === 3 && feedback.gesture === "toggle") {
          next = { ...next, step: 4, progress: 1, feedback: "Жесты настроены" };
        } else if (feedback.gesture === "toggle") {
          // An accidental hold during a swipe step only re-arms the practice.
          engine.reset();
          next.feedback = "Сначала проведи рукой, удержание — в конце";
        }
      } else if (
        feedback.kind === "error" &&
        feedback.code === "wider" &&
        frame.time - calibrationLogAt.current > 1200
      ) {
        calibrationLogAt.current = frame.time;
        // "Wider" means the swipe fell short: ask for a smaller one.
        setSensitivity((value) =>
          Math.max(0.55, Math.round((value - 0.08) * 100) / 100),
        );
        next.feedback = "Порог ослаблен — попробуй ещё раз";
      }
      if (
        next.step !== state.step ||
        frame.time - calibrationPaint.current > 160
      ) {
        calibrationPaint.current = frame.time;
        updateCalibration(next);
      }
    },
    [updateCalibration],
  );
  const startCalibration = () => {
    if (isSession) {
      setNotice("Сначала заверши выступление — калибровка доступна в покое.");
      return;
    }
    calibrationEngine.current.reset();
    calibrationStable.current = 0;
    calibrationLast.current = 0;
    updateCalibration({
      step: 0,
      feedback: "Покажи открытую ладонь",
      kind: "idle",
      progress: 0,
    });
  };
  const closeCalibration = () => {
    calibrationEngine.current.reset();
    updateCalibration(null);
  };
  const logout = () => {
    clearAccount();
    window.location.assign("/register");
  };

  const onFrame = useCallback(
    (frame: VisionFrame) => {
      // The notch on the audience screen mirrors the same pose, never the video.
      bridge.current?.publishFrame(frame);
      if (calibrationRef.current) {
        handleCalibration(frame);
        return;
      }
      const state = current.current;
      if (state.stage !== "running") return;
      const nextFeedback = engine.current.update(
        frame.pose,
        frame.hands,
        frame.time,
        state.locked,
        frame.aspect,
      );
      if (debugGesturesRef.current) {
        if (frame.time - debugPaint.current > 220) {
          debugPaint.current = frame.time;
          setGestureDebug({
            ...engine.current.debug,
            kind: nextFeedback.kind,
            code: nextFeedback.code ?? "",
          });
        }
        if (
          (nextFeedback.kind === "success" || nextFeedback.kind === "error") &&
          (nextFeedback.message !== debugLastMessage.current ||
            frame.time - debugLogAt.current > 1500)
        ) {
          debugLogAt.current = frame.time;
          debugLastMessage.current = nextFeedback.message;
          setDebugLog((previous) =>
            [
              {
                message: nextFeedback.message,
                code: nextFeedback.code ?? nextFeedback.gesture ?? "",
                kind: nextFeedback.kind,
              },
              ...previous,
            ].slice(0, 5),
          );
        }
      }
      if (nextFeedback.kind === "success" && nextFeedback.gesture) {
        const gesture = nextFeedback.gesture;
        if (gesture === "toggle") {
          // Toggle only locks gestures here; it is never sent to the slide app.
          const nextLocked = !state.locked;
          applyLock(nextLocked);
          nextFeedback.message = nextLocked ? "Жесты заблокированы" : "Жесты включены";
        } else {
          const next = state.index + (gesture === "next" ? 1 : -1);
          if (state.external) {
            if (state.externalReady && bridge.current?.publishCommand(gesture, false))
              nextFeedback.message = gesture === "next" ? "Команда: следующий слайд" : "Команда: предыдущий слайд";
            else { setFeedback({ kind: "error", message: "Нет связи с внешним показом" }); return; }
          } else if (next < 0 || next >= state.slides.length)
            nextFeedback.message =
              next < 0 ? "Это первый слайд" : "Это последний слайд";
          else {
            goTo(next);
            bridge.current?.publishCommand(gesture, false);
          }
        }
        if (state.stage === "running" && session.current)
          session.current.commands[gesture]++;
        setPulse({ id: Date.now(), gesture });
        successUntil.current = frame.time + 1200;
        setFeedback(nextFeedback);
        return;
      }
      if (
        nextFeedback.kind === "error" &&
        nextFeedback.code &&
        !state.locked &&
        state.stage === "running" &&
        session.current &&
        frame.time - (correctionLast.current[nextFeedback.code] ?? -5000) > 3500
      ) {
        session.current.corrections[nextFeedback.code] =
          (session.current.corrections[nextFeedback.code] || 0) + 1;
        correctionLast.current[nextFeedback.code] = frame.time;
      }
      if (frame.time > successUntil.current)
        setFeedback(
          state.mode === "live" &&
            nextFeedback.kind === "idle"
            ? {
                ...nextFeedback,
                message: state.locked
                  ? "Жесты заблокированы"
                  : "Управление активно",
              }
            : nextFeedback,
        );
    },
    [goTo, applyLock, handleCalibration],
  );
  const {
    status: cameraStatus,
    error: cameraError,
    fps: cameraFps,
    videoRef,
    start: cameraStart,
    stop: cameraStop,
  } = useCamera(onFrame);

  useEffect(() => {
    try {
      localStorage.setItem("axiompitch-sensitivity", String(sensitivity));
    } catch {
      // Private mode: keep the value for this tab only.
    }
    engine.current.setSensitivity(sensitivity);
    calibrationEngine.current.setSensitivity(sensitivity);
  }, [sensitivity]);
  useEffect(() => {
    if (stage !== "running") return;
    const timer = setInterval(() => {
      session.current?.tick(performance.now());
      setDuration(session.current?.duration ?? 0);
    }, 250);
    return () => clearInterval(timer);
  }, [stage]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target instanceof HTMLElement &&
          /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) ||
        dialogRef.current?.open ||
        historyDialogRef.current?.open ||
        calibrationDialogRef.current?.open
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step("next");
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step("previous");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [step]);
  const refreshTargets = useCallback(() => {
    bridge.current
      ?.targets()
      .then(({ current: status, targets, apps }) => {
        applyTarget(status);
        setTargetList(targets);
        setRunningApps(apps);
      })
      .catch(() => undefined);
  }, [applyTarget]);
  useEffect(() => {
    if (!apiEnabled) return;
    const client = new BridgeClient(apiBase, "speaker", {
      online: (online) => {
        setBridgeOnline(online);
        if (!online) { setShellConnected(false); setOverlayVisible(false); }
        if (online) refreshTargets();
      },
      hello: (hello) => {
        setOverlayVisible(hello.overlay.visible);
        // A reconnect must preserve the studio lock, including manual changes.
        client.publishCommand("toggle", current.current.locked);
      },
      target: applyTarget,
      overlay: (state) => setOverlayVisible(state.visible),
      // POST /api/control on the PitchFlow deck: step as the arrows would.
      control: (gesture) =>
        goTo(current.current.index + (gesture === "next" ? 1 : -1)),
    });
    bridge.current = client;
    client.start();
    return () => {
      client.stop();
      bridge.current = null;
    };
  }, [applyTarget, goTo, refreshTargets]);
  useEffect(() => {
    const publish = () => bridge.current?.publishSession({
      stage, mode, index: shownIndex,
      slideCount: Math.max(shownIndex + 1, shownCount ?? 0),
      durationMs: session.current?.duration ?? 0,
      id: sessionMeta.current.id,
      overlayEnabled: notchEnabled,
      overlayDisplayId: notchDisplay,
    });
    publish();
    const heartbeat = setInterval(publish, 1000);
    return () => clearInterval(heartbeat);
  }, [stage, mode, shownIndex, shownCount, bridgeOnline, notchEnabled, notchDisplay]);
  useEffect(() => {
    localStorage.setItem("axiompitch-notch", notchEnabled ? "on" : "off");
    localStorage.setItem("axiompitch-notch-display", notchDisplay === null ? "" : String(notchDisplay));
  }, [notchEnabled, notchDisplay]);
  useEffect(() => {
    if (!bridgeOnline) return;
    let cancelled = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const settings = await bridge.current?.overlaySettings();
        if (!cancelled && settings) { setDisplays(settings.displays); setShellConnected(settings.shellConnected); }
        if (external) {
          const status = await bridge.current?.state();
          if (!cancelled && status) applyTarget(status);
        }
      } catch { /* WebSocket online state reports connection loss. */ }
      finally { busy = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [bridgeOnline, external, applyTarget]);
  useEffect(() => {
    if (external && pdfMatches && externalIndex < slides.length) goTo(externalIndex);
  }, [external, pdfMatches, externalIndex, slides.length, goTo]);
  useEffect(() => {
    if (!presentationId) return;
    const timer = setTimeout(() => {
      saveNotes(
        presentationId,
        slides.map((slide) => slide.notes),
      ).catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [slides, presentationId]);
  useEffect(() => {
    channel.current?.postMessage({ type: "slide", slide: slides[index] });
  }, [slides, index]);
  useEffect(
    () => () => {
      channel.current?.close();
      audienceWindow.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!audienceOpen) return;
    const timer = setInterval(() => {
      if (audienceWindow.current?.closed) {
        setAudienceOpen(false);
        channel.current?.close();
        channel.current = null;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [audienceOpen]);
  useEffect(() => {
    if (resultsOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [resultsOpen]);
  useEffect(() => {
    if (historyOpen) historyDialogRef.current?.showModal();
    else historyDialogRef.current?.close();
  }, [historyOpen]);
  useEffect(() => {
    const dialog = calibrationDialogRef.current;
    if (!dialog) return;
    if (calibration && !dialog.open) dialog.showModal();
    if (!calibration && dialog.open) dialog.close();
  }, [calibration]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const upload = async (file?: File) => {
    if (!file) return;
    if (stage === "running" || stage === "paused") {
      setNotice("Сначала заверши текущее выступление.");
      return;
    }
    setPdfProgress(0);
    setNotice("");
    try {
      const deck = await readPdf(file, setPdfProgress);
      setSlides(deck);
      setPdfMatches(false);
      setDeckName(file.name.replace(/\.pdf$/i, ""));
      setIndex(0);
      setStage("idle");
      session.current = null;
      setDuration(0);
      engine.current.reset();
      setPresentationId(null);
      if (apiEnabled) {
        // A server copy is extra: the deck above is already read locally.
        const token = ++uploadToken.current;
        uploadPresentation(file)
          .then((stored) => {
            if (uploadToken.current === token) setPresentationId(stored.id);
          })
          .catch((error) => console.warn("PitchFlow server:", error));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice(
        /[а-яё]/i.test(message)
          ? message
          : "Не удалось прочитать PDF. Проверь файл и попробуй ещё раз.",
      );
    } finally {
      setPdfProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const openAudience = () => {
    const client = bridge.current;
    if (external) {
      if (!notchEnabled) { setNotice("Чёлка отключена в настройках. Внешним показом можно управлять без неё."); return; }
      if (stage !== "running" && stage !== "paused") { setNotice("Чёлка появится при начале выступления."); return; }
      if (!client?.online) { setNotice("Нет связи с локальным мостом."); return; }
      client.setOverlay(!overlayVisible, notchDisplay).then(state => {
        setOverlayVisible(state.visible);
        if (state.visible && !state.shellConnected) setNotice("Окно чёлки не запущено. Управление слайдами продолжает работать.");
      }).catch((error: Error) => setNotice(error.message));
      return;
    }
    if (audienceWindow.current && !audienceWindow.current.closed) {
      audienceWindow.current.focus();
      return;
    }
    const url = new URL(location.href);
    url.search = `?audience=1&session=${audienceSession.current}`;
    const popup = window.open(
      url.href,
      "axiompitch-audience",
      "popup,width=1280,height=800",
    );
    if (!popup) {
      setNotice(
        "Браузер заблокировал окно. Разреши всплывающие окна для экрана аудитории.",
      );
      return;
    }
    audienceWindow.current = popup;
    setAudienceOpen(true);
    channel.current?.close();
    channel.current = new BroadcastChannel(
      `axiompitch-${audienceSession.current}`,
    );
    channel.current.onmessage = (event) => {
      if (event.data.type === "ready")
        channel.current?.postMessage({
          type: "slide",
          slide: current.current.slides[current.current.index],
        });
    };
  };
  const startSession = () => {
    if (external && (!bridgeOnline || !slideTarget?.connected || slideTarget.error)) {
      setNotice(slideTarget?.error || "Сначала восстанови подключение к внешнему показу.");
      return;
    }
    const clock = new SessionClock(external ? Math.max(externalIndex + 1, slideTarget?.slideCount ?? 1) : slides.length, shownIndex, performance.now());
    session.current = clock;
    sessionMeta.current = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
    correctionLast.current = {};
    setDuration(0);
    setStage("running");
    current.current.stage = "running";
    applyLock(false);
    engine.current.reset();
    bridge.current?.publishCommand("toggle", false);
    channel.current?.postMessage({ type: "slide", slide: slides[index] });
  };
  const pauseSession = () => {
    if (stage === "running") {
      session.current?.pause(performance.now());
      setDuration(session.current?.duration ?? 0);
      setStage("paused");
      current.current.stage = "paused";
      engine.current.reset();
    } else {
      session.current?.resume(performance.now());
      setStage("running");
      current.current.stage = "running";
      engine.current.reset();
    }
  };
  const finishSession = () => {
    if (!session.current) return;
    const completed = session.current.result(
      {
        ...sessionMeta.current,
        name: external ? `${slideTarget?.label || "Внешний показ"}${pdfMatches ? ` · ${deckName}` : ""}` : deckName,
        slideTitles: external
          ? session.current.perSlide.map((_, i) => pdfMatches && slides[i] ? slides[i].title.replace(/\n/g, " ") : `Слайд ${i + 1}`)
          : slides.map((slide) => slide.title.replace(/\n/g, " ")),
        mode,
      },
      performance.now(),
    );
    setResult(completed);
    setDuration(completed.duration);
    setStage("finished");
    current.current.stage = "finished";
    setResultsOpen(true);
    const nextHistory = [completed, ...history].slice(0, 10);
    setHistory(nextHistory);
    try {
      localStorage.setItem("axiompitch-history", JSON.stringify(nextHistory));
    } catch {
      setNotice(
        "Итоги готовы, но браузер не смог сохранить историю на этом устройстве.",
      );
    }
    // The server keeps a copy; the local history above stays the primary one.
    if (apiEnabled)
      saveSession(completed, external && !pdfMatches ? null : presentationId).catch((error) =>
        console.warn("PitchFlow server:", error),
      );
    channel.current?.postMessage({ type: "end" });
  };
  const resetGestures = () => {
    engine.current.reset();
    applyLock(false);
  };
  const downloadResult = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `AxiomPitch-${result.startedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const updateNote = (text: string) =>
    setSlides((previous) =>
      previous.map((slide, i) =>
        i === index ? { ...slide, notes: text } : slide,
      ),
    );
  const isSession = stage === "running" || stage === "paused";
  const progress = Math.min(1, duration / (target * 60000));
  const totalCommands = result
    ? Object.values(result.commands).reduce((a, b) => a + b, 0)
    : 0;
  const statusText = describeTarget(slideTarget, estimated);
  // The companion reflects the live gesture state instead of standing still.
  const coachAction: CompanionAction =
    stage === "finished"
      ? "success"
      : pulse
        ? pulse.gesture === "toggle"
          ? "hold"
          : pulse.gesture
        : feedback.code === "palm"
          ? "open-palm"
          : feedback.code
            ? "point"
            : feedback.kind === "progress"
              ? "hold"
              : cameraStatus === "ready"
                ? "hello"
                : "idle";
  const coachMessage =
    stage === "running"
      ? locked
        ? "Слайды на паузе — удержи ладонь, чтобы вернуть управление."
        : "Слушаю жест: ладонь вправо — дальше, влево — назад."
      : stage === "paused"
        ? "Пауза. Продолжим, когда будешь готов."
        : stage === "finished"
          ? "Готово. Открой итоги — там время и команды."
          : cameraStatus === "ready"
            ? "Камера видит тебя. Начни репетицию — я подскажу жест."
            : "Включи камеру — и я стану твоим пультом.";
  const coachProgress =
    stage === "running" && feedback.progress !== undefined
      ? feedback.progress
      : null;

  return (
    <main className={`studio studio-${stage}`}>
      <StudioSidebar
        active={view}
        onNavigate={setView}
        onHistory={() => setHistoryOpen(true)}
      />
      <div className="studio-main">
        <div className="studio-deck" hidden={view !== "deck"}>
      <div className="workspace-heading">
        <div className="studio-title">
          <h1>{external ? slideTarget?.label || "Внешний показ" : deckName}</h1>
          <p>{external ? `${shownCount ?? "?"} ${slidesWord(shownCount)} · Внешнее приложение` : `${slides.length} ${slidesWord(slides.length)} · ${slides[0]?.image ? "Твой PDF" : "Демо-презентация"}`}</p>
        </div>
        <div className="deck-actions">
          <button
            className={`button secondary ${audienceOpen || overlayVisible ? "selected" : ""}`}
            onClick={openAudience}
            aria-label={external ? overlayVisible ? "Скрыть чёлку" : "Показать чёлку" : audienceOpen ? "Экран открыт" : "Экран аудитории"}
          >
            <Monitor size={16} />
            <span>{external ? overlayVisible ? "Скрыть чёлку" : "Показать чёлку" : audienceOpen ? "Экран открыт" : "Экран аудитории"}</span>
          </button>
          <input
            type="file"
            accept="application/pdf,.pdf"
            ref={inputRef}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
            }}
            hidden
          />
          <button
            className="button secondary"
            onClick={() => inputRef.current?.click()}
            disabled={isSession || pdfProgress !== null}
          >
            <FileUp size={17} />
            {pdfProgress !== null
              ? `Загрузка ${Math.round(pdfProgress * 100)}%`
              : "Загрузить PDF"}
          </button>
        </div>
      </div>
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Закрыть сообщение"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className={`workspace-grid ${external && !pdfMatches ? "external-without-preview" : ""}`}>
        <div className="stage-left">
          <section className="timer-panel">
            <div className="panel-heading">
              <Clock3 size={17} />
              <span>Твой ритм</span>
              <span className={`session-state ${stage}`}>
                {stage === "running"
                  ? "ИДЁТ"
                  : stage === "paused"
                    ? "ПАУЗА"
                    : stage === "finished"
                      ? "ИТОГИ"
                      : "ГОТОВ"}
              </span>
            </div>
            <div
              className={`timer ${duration > target * 60000 ? "overtime" : ""}`}
            >
              {formatTime(duration)}
              <span>/ {String(target).padStart(2, "0")}:00</span>
            </div>
            <div className="timer-track">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="timer-settings">
              <label htmlFor="target-time">Лимит, минут</label>
              <input
                id="target-time"
                type="number"
                min={1}
                max={120}
                value={target}
                disabled={isSession}
                onChange={(event) =>
                  setTarget(
                    Math.max(1, Math.min(120, Number(event.target.value) || 1)),
                  )
                }
              />
            </div>
            <div className="mode-switch" aria-label="Режим выступления">
              <button
                aria-pressed={mode === "rehearsal"}
                disabled={isSession}
                className={mode === "rehearsal" ? "active" : ""}
                onClick={() => setMode("rehearsal")}
              >
                Репетиция
              </button>
              <button
                aria-pressed={mode === "live"}
                disabled={isSession}
                className={mode === "live" ? "active" : ""}
                onClick={() => setMode("live")}
              >
                Выступление
              </button>
            </div>
            {isSession ? (
              <div className="session-buttons">
                <button className="button secondary" onClick={pauseSession}>
                  {stage === "running" ? (
                    <Pause size={17} />
                  ) : (
                    <Play size={17} />
                  )}
                  {stage === "running" ? "Пауза" : "Продолжить"}
                </button>
                <button className="button primary" onClick={finishSession}>
                  <Square size={14} />
                  Завершить
                </button>
              </div>
            ) : (
              <button
                className="button primary full"
                onClick={startSession}
                disabled={pdfProgress !== null}
              >
                <Play size={17} />
                {stage === "finished" ? "Попробовать ещё раз" : mode === "rehearsal" ? "Начать репетицию" : "Начать выступление"}
              </button>
            )}
            {stage === "finished" && (
              <button
                className="text-button"
                onClick={() => setResultsOpen(true)}
              >
                Посмотреть итоги <ChevronRight size={15} />
              </button>
            )}
          </section>
        </div>
        <div className="stage-column">
        <section className="stage-panel" aria-label="Презентация">
          {previewAvailable ? <motion.div
            className="slide-frame"
            key={slides[index].id}
            initial={reducedMotion ? false : { opacity: 0.5, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <SlideView slide={slides[index]} />
          </motion.div> : <div className="external-show-placeholder slide-frame">
            <Presentation size={32} />
            <strong>{slideTarget?.label || "Внешний показ"} · {estimated ? "≈ " : ""}слайд {externalIndex + 1}</strong>
            <p>{pdfMatches ? "Для этого слайда нет страницы в загруженном PDF." : "Презентация открыта во внешнем приложении. Загрузи соответствующий PDF, если нужны превью и заметки."}</p>
          </div>}
          <div className="slide-transport">
            <div className="transport-buttons">
              <button
                className="icon-button"
                title="Предыдущий слайд (←)"
                aria-label="Предыдущий слайд"
                disabled={!external && index === 0}
                onClick={() => step("previous")}
              >
                <ArrowLeft size={20} />
              </button>
              <button
                className="icon-button"
                title="Следующий слайд (→)"
                aria-label="Следующий слайд"
                disabled={!external && index === slides.length - 1}
                onClick={() => step("next")}
              >
                <ArrowRight size={20} />
              </button>
            </div>
            <span className="slide-counter" title={external && estimated ? "Оценочный номер: приложение не сообщает позицию" : undefined}>
              {external && estimated ? "≈ " : ""}
              {String(shownIndex + 1).padStart(2, "0")}{" "}
              <span>/ {shownCount === null || shownCount === undefined ? "?" : String(shownCount).padStart(2, "0")}</span>
            </span>
          </div>
          {previewAvailable && <div className="below-slide">
            <div className="notes-panel">
              <label htmlFor="speaker-notes">
                <SlidersHorizontal size={16} />
                Твоя главная мысль
              </label>
              <textarea
                id="speaker-notes"
                value={slides[index].notes}
                onChange={(event) => updateNote(event.target.value)}
                placeholder="Твоя главная мысль на этом слайде…"
                rows={3}
              />
            </div>
          </div>}
        </section>
        <nav className="studio-filmstrip" aria-label="Все слайды презентации" hidden={external && !pdfMatches}>
          <div className="studio-thumbnails">{slides.map((slide, i) => <button key={slide.id} className={`studio-thumbnail ${i === shownIndex ? "active" : ""}`} disabled={external} onClick={() => goTo(i)} aria-label={`Перейти к слайду ${i + 1}: ${slide.title.replace(/\n/g, " ")}`} aria-current={i === shownIndex ? "step" : undefined}><SlideView slide={slide} small /><span className="studio-thumbnail-caption"><span>{String(i + 1).padStart(2, "0")}</span>{i === shownIndex && <span className="studio-thumbnail-current" />}</span></button>)}</div>
        </nav>
        </div>
        <aside className="control-panel">
          <div className="studio-coach">
            <PixelCompanion action={coachAction} replay={pulse?.id ?? 0} />
            <div className="coach-copy">
              <p>{coachMessage}</p>
              {coachProgress !== null && <span className="coach-progress"><i style={{ width: `${Math.round(coachProgress * 100)}%` }} /></span>}
            </div>
          </div>
          {apiEnabled && (
            <section className="show-line">
              <div className="panel-heading"><Presentation size={15} strokeWidth={1.6} /><span>Показ</span></div>
              <p
                className={`show-status ${slideTarget?.error ? "error" : ""}`}
                title={
                  external &&
                  (slideTarget?.app === "chrome" ||
                    slideTarget?.app === "frontmost")
                    ? "Окно презентации должно быть впереди, иначе стрелки не уйдут"
                    : undefined
                }
              >
                {external
                  ? slideTarget?.error ?? statusText
                  : bridgeOnline
                    ? "Слайды листаются в этой вкладке"
                    : "Мост не запущен"}
              </p>
              <button className="text-button" onClick={() => setView("settings")}>
                {external ? "Настроить внешний показ" : "Подключить внешний показ"} <ChevronRight size={15} />
              </button>
            </section>
          )}

          <section className="camera-panel">
            <div className="panel-heading"><Camera size={15} strokeWidth={1.6} /><span>Камера</span><small>{cameraStatus === "ready" ? `${cameraFps} FPS` : cameraStatus === "loading" ? "подключение" : "выключена"}</small></div>
            <div className={`studio-camera-preview ${cameraStatus === "ready" ? "is-live" : ""}`}>
              <video ref={videoRef} playsInline muted aria-hidden={cameraStatus !== "ready"} aria-label="Зеркальное превью камеры" />
              {cameraStatus !== "ready" && <div className="studio-camera-placeholder"><Camera size={22} strokeWidth={1.2} /><span>{cameraStatus === "loading" ? "Подключаем камеру…" : "Включи камеру, чтобы управлять жестами"}</span></div>}
              {cameraStatus === "ready" && <span className="studio-camera-live">{locked ? "Жесты на паузе" : stage === "running" ? "Управление активно" : "Камера готова"}</span>}
            </div>
            <button className="button secondary full" onClick={() => {
              if (cameraStatus === "ready" || cameraStatus === "loading") cameraStop();
              else { resetGestures(); void cameraStart(); }
            }}>{cameraStatus === "loading" ? <LoaderCircle className="spin" size={15} /> : cameraStatus === "ready" ? <CameraOff size={15} /> : <Camera size={15} />}{cameraStatus === "loading" ? "Отменить" : cameraStatus === "ready" ? "Выключить камеру" : "Включить камеру"}</button>
            {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
            {stage === "running" && cameraStatus === "ready" && <p className={`studio-live-feedback ${feedback.kind}`} role="status">{feedback.message}</p>}
            {debugGestures && (
              <div className="studio-debug">
                {gestureDebug ? (<>
                  <span>Руки: {gestureDebug.hands} · открытых: {gestureDebug.open} · ладонь: {(gestureDebug.scale * 100).toFixed(1)}%</span>
                  <span>dx: {gestureDebug.dx >= 0 ? "+" : ""}{gestureDebug.dx.toFixed(2)} · dy: {gestureDebug.dy >= 0 ? "+" : ""}{gestureDebug.dy.toFixed(2)} · t: {(gestureDebug.elapsed / 1000).toFixed(1)} с · порог: {gestureDebug.threshold.toFixed(2)}</span>
                  <span>Движок: {gestureDebug.locked ? "заблокирован" : "активен"} · ответ: {gestureDebug.kind}{gestureDebug.code ? ` · ${gestureDebug.code}` : ""}</span>
                  <div className="studio-debug-log">{debugLog.length ? debugLog.map((entry, i) => <span key={`${entry.code}-${i}`}>{entry.message}</span>) : <span>Журнал пока пуст</span>}</div>
                </>) : <span>Отладка включена. Начни репетицию и покажи ладонь — здесь появятся цифры.</span>}
              </div>
            )}
          </section>
        </aside>
      </div>
      <footer className="workspace-footer">
        <span>
          <LockKeyhole size={13} />
          Камера и PDF остаются на устройстве
        </span>
        <span>
          {cameraStatus === "ready"
            ? overlayVisible ? "Зрители видят презентацию и чёлку" : "Зрители видят только презентацию"
            : "Можно начать с демо-слайдов или своего PDF"}
        </span>
      </footer>
        </div>
        <section className="settings-page" hidden={view !== "settings"} aria-labelledby="settings-title">
          <h1 id="settings-title">Настройки</h1>
          <p className="settings-page-note">Камера, жесты, чёлка и аккаунт. Всё остаётся на этом устройстве.</p>
          <div className="settings-grid">
            {apiEnabled && (
              <section className="settings-group settings-panel settings-panel-wide">
                <span className="settings-label">Внешний показ</span>
                {bridgeOnline ? (
                  <>
                    <div className="target-row">
                      <select
                        aria-label="Приложение со слайдами"
                        value={chosenTarget}
                        disabled={isSession}
                        onFocus={refreshTargets}
                        onChange={(event) =>
                          setChosenTarget(event.target.value as TargetId)
                        }
                      >
                        {(targetList.length
                          ? targetList
                          : [{ id: "pitchflow" as const, available: true }]
                        ).map((item) => (
                          <option key={item.id} value={item.id}>
                            {targetNames[item.id]}
                            {item.available ? "" : " · не запущено"}
                          </option>
                        ))}
                      </select>
                      {chosenTarget === "frontmost" && (
                        <label className="target-app">
                          <span>ПРИЛОЖЕНИЕ</span>
                          <select
                            aria-label="Приложение для стрелок"
                            value={chosenApp}
                            disabled={isSession}
                            onFocus={refreshTargets}
                            onChange={(event) => setChosenApp(event.target.value)}
                          >
                            <option value="">Выбери приложение</option>
                            {runningApps.map((app) => (
                              <option key={app.bundleId} value={app.bundleId}>
                                {app.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button
                        className="button secondary full"
                        disabled={isSession || (chosenTarget === "frontmost" && !chosenApp)}
                        onClick={() => {
                          bridge.current
                            ?.connectTarget(
                              chosenTarget,
                              chosenTarget === "frontmost"
                                ? chosenApp
                                : undefined,
                            )
                            .then(status => {
                              externalPosition.current = status.slideIndex ?? 0;
                              setExternalIndex(externalPosition.current);
                              setEstimated(status.slideIndex === null);
                              setPdfMatches(false);
                              applyTarget(status);
                              refreshTargets();
                            })
                            .catch((error: Error) => setNotice(error.message));
                        }}
                      >
                        <Plug size={16} />
                        Подключить
                      </button>
                    </div>
                    {(slideTarget?.error || statusText) && (
                      <p
                        className={`target-status ${slideTarget?.error ? "error" : ""}`}
                        title={
                          external &&
                          (slideTarget?.app === "chrome" ||
                            slideTarget?.app === "frontmost")
                            ? "Окно презентации должно быть впереди, иначе стрелки не уйдут"
                            : undefined
                        }
                      >
                        {slideTarget?.error ?? statusText}
                      </p>
                    )}
                    {external && <>
                      <button className="text-button" disabled={isSession} onClick={() => {
                        bridge.current?.disconnectTarget().then(status => { applyTarget(status); refreshTargets(); }).catch((error: Error) => setNotice(error.message));
                      }}>Вернуться к колоде PitchFlow</button>
                      <label className="bridge-setting"><input type="checkbox" checked={pdfMatches} disabled={isSession || !slides[0]?.image} onChange={event => setPdfMatches(event.target.checked)} />PDF соответствует показу</label>
                      {estimated && <label className="bridge-setting">Начальный номер слайда <input aria-label="Начальный номер внешнего слайда" type="number" min={1} max={2000} disabled={isSession} value={externalIndex + 1} onChange={event => {
                        const value = Math.max(0, Math.min(1999, Number(event.target.value) - 1));
                        externalPosition.current = value; setExternalIndex(value);
                      }} /></label>}
                      {isSession && <p className="settings-note">Для смены приложения сначала заверши выступление.</p>}
                    </>}
                  </>
                ) : (
                  <p className="settings-note">Мост не запущен — запусти npm run server, чтобы листать Keynote, PowerPoint и Google Slides.</p>
                )}
              </section>
            )}
            <section className="settings-group settings-panel">
              <span className="settings-label">Камера и жесты</span>
              <label className="sensitivity" htmlFor="sensitivity"><span>Размах жеста <span>{sensitivity < .8 ? "малый" : sensitivity > 1 ? "большой" : "обычный"}</span></span><input id="sensitivity" type="range" min={.55} max={1.15} step={.05} value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} /></label>
              <button className="text-button" onClick={startCalibration}><SlidersHorizontal size={15} />Калибровка жестов</button>
              <button className="text-button" onClick={() => { applyLock(!locked); engine.current.reset(); }}>{locked ? <UnlockKeyhole size={15} /> : <LockKeyhole size={15} />}{locked ? "Включить жесты" : "Заблокировать жесты"}</button>
              <label className="bridge-setting"><input type="checkbox" checked={debugGestures} onChange={event => setDebugGestures(event.target.checked)} />Показывать отладку жестов</label>
            </section>
            <section className="settings-group settings-panel">
              <span className="settings-label">Чёлка и экран</span>
              <label className="bridge-setting"><input type="checkbox" checked={notchEnabled} onChange={event => setNotchEnabled(event.target.checked)} />Использовать чёлку macOS</label>
              {notchEnabled && <>
                <label className="bridge-setting bridge-setting-column">Экран чёлки <select aria-label="Экран чёлки" value={notchDisplay ?? "auto"} onChange={event => setNotchDisplay(event.target.value === "auto" ? null : Number(event.target.value))}>
                  <option value="auto">MacBook / основной экран</option>
                  {displays.map(display => <option key={display.id} value={display.id}>{display.label}{display.primary ? " · основной" : ""}</option>)}
                </select></label>
                <p className="settings-note">{shellConnected ? "Чёлка появится при начале выступления. Крестик скрывает её до следующего." : "Окно чёлки не запущено — студия работает и без него."}</p>
              </>}
            </section>
            <section className="settings-group settings-panel">
              <span className="settings-label">Памятка</span>
              <div className="gesture-guide"><div><ArrowRight size={14} /><span>Ладонь вправо</span><span>Далее</span></div><div><ArrowLeft size={14} /><span>Ладонь влево</span><span>Назад</span></div><div><Hand size={14} /><span>Удержать 1,5 сек.</span><span>Блокировка</span></div></div>
              <a className="studio-learn-link" href="/learn" onClick={event => { if (isSession) { event.preventDefault(); setNotice("Сначала заверши выступление, чтобы перейти к обучению."); } }}>Пройти обучение <ChevronRight size={16} /></a>
            </section>
            <section className="settings-group settings-panel">
              <span className="settings-label">Аккаунт</span>
              <p className="settings-account"><strong>{account?.name || "Гость"}</strong><small>{account?.email || "Локальный аккаунт не создан"}</small></p>
              <button className="text-button" onClick={logout}><LogOut size={15} />Выйти из аккаунта</button>
            </section>
          </div>
        </section>
      </div>
      <dialog
        ref={dialogRef}
        className="results-dialog"
        aria-labelledby="results-title"
        onCancel={() => setResultsOpen(false)}
        onClose={() => setResultsOpen(false)}
      >
        {result && (
          <>
            <div className="dialog-header">
              <div>
                <span className="section-eyebrow">ВЫСТУПЛЕНИЕ ЗАВЕРШЕНО</span>
                <h2 id="results-title">Твоя история рассказана.</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Закрыть итоги"
                onClick={() => setResultsOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="result-name">{result.name}</p>
            <div className="result-metrics">
              <div>
                <span>Общее время</span>
                <strong>{formatTime(result.duration)}</strong>
              </div>
              <div>
                <span>Команды жестами</span>
                <strong>{totalCommands}</strong>
              </div>
              <div>
                <span>Подсказки</span>
                <strong>
                  {Object.values(result.corrections).reduce((a, b) => a + b, 0)}
                </strong>
              </div>
            </div>
            <h3>Время по слайдам</h3>
            <div className="slide-times">
              {result.perSlide.map((time, i) => (
                <div key={i}>
                  <span className="result-slide-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="result-slide-title">
                    {result.slideTitles[i]}
                  </span>
                  <div className="result-bar">
                    <span
                      style={{
                        width: `${Math.max(0, (time / Math.max(...result.perSlide, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{formatTime(time)}</span>
                </div>
              ))}
            </div>
            {Object.keys(result.corrections).length > 0 && (
              <>
                <h3>Что можно сделать точнее</h3>
                <div className="corrections-list">
                  {Object.entries(result.corrections).map(([code, count]) => (
                    <p key={code}>
                      <span>{correctionNames[code] || code}</span>
                      <span>{count} раз</span>
                    </p>
                  ))}
                </div>
              </>
            )}
            <div className="dialog-actions">
              <button className="button secondary" onClick={downloadResult}>
                <ArrowDownToLine size={17} />
                Скачать итоги
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setResultsOpen(false);
                  setStage("idle");
                  goTo(0);
                  setDuration(0);
                  session.current = null;
                }}
              >
                <RotateCcw size={16} />К началу
              </button>
            </div>
          </>
        )}
      </dialog>
      <dialog
        ref={historyDialogRef}
        className="results-dialog"
        aria-labelledby="history-title"
        onCancel={() => setHistoryOpen(false)}
        onClose={() => setHistoryOpen(false)}
      >
        <div className="dialog-header">
          <div>
            <span className="section-eyebrow">НА ЭТОМ УСТРОЙСТВЕ</span>
            <h2 id="history-title">Последние выступления</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть историю"
            onClick={() => setHistoryOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        {history.length === 0 ? (
          <p className="history-empty">
            После первого выступления здесь появятся итоги.
          </p>
        ) : (
          history.map((item) => (
            <button
              className="history-item"
              key={item.id}
              onClick={() => {
                setHistoryOpen(false);
                setResult(item);
                setResultsOpen(true);
              }}
            >
              <span>
                <strong>{item.name}</strong>
                <span>
                  {new Date(item.startedAt).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {item.mode === "rehearsal" ? "Репетиция" : "Выступление"}
                </span>
              </span>
              <span>
                {formatTime(item.duration)}
                <ChevronRight size={17} />
              </span>
            </button>
          ))
        )}
      </dialog>
      <dialog
        ref={calibrationDialogRef}
        className="results-dialog calibration-dialog"
        aria-labelledby="calibration-title"
        onCancel={() => closeCalibration()}
        onClose={() => closeCalibration()}
      >
        {calibration && (
          <>
            <div className="dialog-header">
              <div>
                <span className="section-eyebrow">КАЛИБРОВКА ЖЕСТОВ</span>
                <h2 id="calibration-title">
                  {calibration.step === 4 ? "Готово." : "Настроим под тебя."}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Закрыть калибровку"
                onClick={closeCalibration}
              >
                <X size={20} />
              </button>
            </div>
            {cameraStatus !== "ready" ? (
              <>
                <p className="calibration-lead">Сначала включи камеру.</p>
                <p className="calibration-note">
                  Жесты проверяются сразу, искать и сохранять ничего не нужно.
                </p>
                <div className="calibration-actions">
                  <button className="text-button" onClick={closeCalibration}>Позже</button>
                  <button className="button primary" onClick={() => { resetGestures(); void cameraStart(); }}>Включить камеру</button>
                </div>
              </>
            ) : calibration.step === 4 ? (
              <>
                <p className="calibration-lead">
                  Жесты ловятся. Размах: {sensitivity < .8 ? "малый" : sensitivity > 1 ? "большой" : "обычный"}.
                </p>
                <p className="calibration-note">
                  Значение сохранилось. Повторить калибровку можно в любой момент:
                  «Настройки» → «Камера и жесты».
                </p>
                <div className="calibration-actions">
                  <span className="calibration-hint">Готово к репетиции</span>
                  <button className="button primary" onClick={closeCalibration}>Продолжить</button>
                </div>
              </>
            ) : (
              <>
                <div className="calibration-steps">
                  {calibrationSteps.map((label, i) => (
                    <span
                      key={label}
                      className={i < calibration.step ? "done" : i === calibration.step ? "active" : ""}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <p className="calibration-lead">{calibrationMessages[calibration.step]}</p>
                <div className="calibration-track">
                  <span style={{ width: `${Math.round(calibration.progress * 100)}%` }} />
                </div>
                <p className={`calibration-feedback ${calibration.kind}`} role="status">
                  {calibration.feedback}
                </p>
                <div className="calibration-actions">
                  <button className="text-button" onClick={closeCalibration}>Отмена</button>
                  <span className="calibration-hint">Шаг {calibration.step + 1} из 4</span>
                </div>
              </>
            )}
          </>
        )}
      </dialog>
    </main>
  );
}

export default function App() {
  const [path, setPath] = useState(location.pathname);
  const [handoff, setHandoff] = useState<"leaving" | "arriving" | "native" | null>(null);
  const transitioning = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useReducedMotion();
  useEffect(() => {
    const pendingTimers = timers.current;
    const syncPath = () => setPath(location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => { window.removeEventListener("popstate", syncPath); pendingTimers.forEach(clearTimeout); };
  }, []);
  // Registration -> learning -> studio. The local account drives the funnel.
  useEffect(() => {
    if (new URLSearchParams(location.search).has("audience")) return;
    const account = loadAccount();
    if ((path === "/learn" || path === "/studio") && !account) {
      history.replaceState(null, "", "/register");
      flushSync(() => setPath("/register"));
      return;
    }
    if (path === "/register" && account) {
      history.replaceState(null, "", "/login");
      flushSync(() => setPath("/login"));
      return;
    }
    if (path === "/studio" && account && !account.learnedAt) {
      history.replaceState(null, "", "/learn");
      flushSync(() => setPath("/learn"));
    }
  }, [path]);
  const enterStudio = useCallback(() => {
    if (transitioning.current || location.pathname !== "/learn") return;
    markLearned();
    transitioning.current = true;
    const navigate = () => {
      history.pushState(null, "", "/studio");
      flushSync(() => setPath("/studio"));
      window.scrollTo(0, 0);
    };
    const finish = () => { setHandoff(null); transitioning.current = false; };
    if (reduced) { navigate(); finish(); return; }
    if (document.startViewTransition) {
      flushSync(() => setHandoff("native"));
      document.documentElement.classList.add("speaker-handoff");
      const transition = document.startViewTransition(navigate);
      void transition.finished.catch(() => {}).finally(() => {
        document.documentElement.classList.remove("speaker-handoff");
        finish();
      });
    } else {
      setHandoff("leaving");
      timers.current.push(setTimeout(() => {
        navigate();
        setHandoff("arriving");
        timers.current.push(setTimeout(finish, 700));
      }, 340));
    }
  }, [reduced]);
  const page = new URLSearchParams(location.search).has("audience") ? (
    <Audience />
  ) : path === "/register" ? (
    <Suspense fallback={<div className="companion-loading">Готовим знакомство…</div>}><RegistrationPage /></Suspense>
  ) : path === "/login" ? (
    <Suspense fallback={<div className="companion-loading">Открываем вход…</div>}><LoginPage /></Suspense>
  ) : path === "/learn" ? (
    // First-run learning is a clean full-screen course; revisits live in the
    // studio shell so the sidebar navigation is always at hand.
    loadAccount()?.learnedAt ? (
      <div className="studio studio-learning">
        <StudioSidebar active="learn" />
        <div className="studio-main">
          <Suspense fallback={<div className="companion-loading">Готовим обучение…</div>}><LearningPage onEnterStudio={enterStudio} /></Suspense>
        </div>
      </div>
    ) : (
      <Suspense fallback={<div className="companion-loading">Готовим обучение…</div>}><LearningPage onEnterStudio={enterStudio} /></Suspense>
    )
  ) : path === "/companion" ? (
    <Suspense fallback={<div className="companion-loading">Загружаем персонажа…</div>}><CompanionPreview /></Suspense>
  ) : path === "/studio" ? (
    <Presenter />
  ) : (
    <Landing />
  );
  return <div className="app-route" data-speaker-handoff={handoff ?? undefined}>{page}</div>;
}
