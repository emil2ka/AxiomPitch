import {
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
  LoaderCircle,
  Check,
  ScanLine,
  ChevronRight,
  Clock3,
  FileUp,
  LockKeyhole,
  Monitor,
  Pause,
  Play,
  Plug,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { StudioSidebar } from "./components/StudioSidebar";
import type { StudioView } from "./components/StudioSidebar";
import { PerformanceScreen } from "./components/PerformanceScreen";
import { TestPage } from "./components/TestPage";
import "./show-modes.css";
import { ProfilePage } from "./components/ProfilePage";
import type { CloudStatus } from "./components/ProfilePage";
import { HistoryPage } from "./components/HistoryPage";
import { Avatar } from "./components/Avatar";
import { CameraPreview } from "./components/CameraPreview";
import { PreparationChecklist } from "./components/PreparationChecklist";
import { bridgeBase, bridgeConfigured } from "./lib/bridge-config";
import { loadWorkspace, saveWorkspace } from "./lib/workspace";
import "./studio.css";
import "./speaker-transition.css";
import "./bridge-controls.css";
import "./workspace-ux.css";
import "./studio-scene.css";

import { SlideView } from "./components/SlideView";
import { useCamera, useCameraPreparation } from "./hooks/useCamera";
import {
  apiBase,
  apiEnabled,
  saveNotes,
  saveSession,
  listSessions,
  request,
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
import { signOut, loadAccount, profileStorage, listAccounts, cacheAccounts, resumeAccount } from "./lib/account";
import { cloudPreferencesChanged, cloudSignOut, mergeHistory, saveCloudProfile, saveCloudSessions, syncCloudHistory } from "./lib/cloud";
import { demoSlides, formatTime, readPdf } from "./lib/deck";
import { GestureEngine } from "./lib/gestures";
import { databaseProfile, databaseProfiles, databasePreferences, syncProfile, linkLegacyData, saveDatabasePreferences, saveDatabaseWorkspace } from "./lib/profile-db";
import { newPreflight, recordPreflight, presentationReadiness, continuationReadiness, readNotchChoice, gesturesReady } from "./lib/preflight";
import { SessionClock } from "./lib/session";
import type {
  Feedback,
  SessionResult,
  Slide,
  VisionFrame,
} from "./lib/types";

type Stage = "idle" | "running" | "paused" | "finished" | "checking";
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
  pitchflow: "AxiomPitch · эта презентация",
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

export default function Presenter({ active }: { active: boolean }) {
  const [account, setAccount] = useState(() => loadAccount());
  const accountId = account?.id;
  const ownerId = account?.ownerId;
  const [cloud, setCloud] = useState<Omit<CloudStatus, "onRetry">>({ state: "syncing", error: "" });
  const [cloudRetry, setCloudRetry] = useState(0);
  const [storage] = useState(() => profileStorage(accountId ?? "guest"));
  const initialPreferences = useRef(Object.fromEntries(databasePreferences.map(key => [key, storage.getItem(key)])));
  const [workspaceReady, setWorkspaceReady] = useState(() => !accountId);
  const [workspaceError, setWorkspaceError] = useState("");
  const [cameraId, setCameraId] = useState(() => storage.getItem("axiompitch-camera") || "");
  type SettingsTab = "camera" | "companion" | "advanced";
  const readSettingsTab = (): SettingsTab => {
    const value = new URLSearchParams(location.search).get("section");
    return value === "companion" || value === "advanced" ? value : "camera";
  };
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(readSettingsTab);
  const [setupOpen, setSetupOpen] = useState(false);
  const [welcome, setWelcome] = useState(() => new URLSearchParams(location.search).has("welcome"));
  const [overlayPreview, setOverlayPreview] = useState(false);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const readView = useCallback((): StudioView => {
    const query = new URLSearchParams(location.search);
    const value = query.get("view");
    return query.has("history") || value === "history" ? "history" : value === "profile" ? "profile" : value === "settings" ? "settings" : value === "test" ? "test" : value === "present" ? "present" : "deck";
  }, []);
  const [slides, setSlides] = useState<Slide[]>(demoSlides);
  const [deckName, setDeckName] = useState("Первый питч");
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"rehearsal" | "live">("rehearsal");
  const [stage, setStage] = useState<Stage>("idle");
  const { preflight, setPreflight } = useCameraPreparation();
  const beforeCheck = useRef<Stage>("idle");
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({
    kind: "idle",
    message: "Включи камеру, чтобы оживить аватара",
  });
  const [duration, setDuration] = useState(0);
  const [target, setTarget] = useState(() => Math.max(1, Math.min(120, Number(storage.getItem("axiompitch-target-duration")) || 5)));
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const restoreFromDatabase = useRef(false);
  const [notchScale, setNotchScale] = useState(() => { const value = Number(storage.getItem("axiompitch-notch-scale")); return [0.85, 1, 1.2].includes(value) ? value : 1; });
  const [lastResult, setResult] = useState<SessionResult | null>(null);
  const [selectedResult, setSelectedResult] = useState<SessionResult | null>(null);
  const result = selectedResult ?? lastResult;
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultArchive, setResultArchive] = useState(false);
  const [history, setHistory] = useState<SessionResult[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        storage.getItem("axiompitch-history") || "[]",
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
      const saved = Number(storage.getItem("axiompitch-sensitivity"));
      return Number.isFinite(saved) && saved >= 0.55 && saved <= 1.15
        ? saved
        : 0.85;
    } catch {
      return 0.85;
    }
  });
  const [view, setView] = useState<StudioView>(() => { const initial = readView(); return initial === "present" ? "deck" : initial; });
  const navigate = useCallback((next: StudioView, section?: SettingsTab) => {
    const url = new URL(location.href);
    url.searchParams.delete("view"); url.searchParams.delete("history"); url.searchParams.delete("welcome");
    url.searchParams.delete("section");
    if (next !== "deck") url.searchParams.set("view", next);
    if (next === "settings") {
      url.searchParams.set("section", section ?? settingsTab);
      if (section) setSettingsTab(section);
    }
    window.history.pushState(null, "", url);
    setView(next);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".studio-main > section:not([hidden]) h1, .studio-main > div:not([hidden]) section h1")?.focus());
  }, [settingsTab]);
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const calibrationRef = useRef<CalibrationState | null>(null);
  const calibrationEngine = useRef(new GestureEngine());
  const calibrationStable = useRef(0);
  const calibrationLast = useRef(0);
  const calibrationPaint = useRef(0);
  const calibrationLogAt = useRef(0);
  const [debugGestures, setDebugGestures] = useState(() => {
    try {
      return storage.getItem("axiompitch-gesture-debug") === "1";
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
      storage.setItem(
        "axiompitch-gesture-debug",
        debugGestures ? "1" : "0",
      );
    } catch {
      // Private mode: keep the flag for this tab only.
    }
  }, [debugGestures, storage]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [localBridgeRequested, setLocalBridgeRequested] = useState(() => { try { return bridgeConfigured || sessionStorage.getItem("axiompitch-local-bridge") === "on"; } catch { return bridgeConfigured; } });
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
  const [notchChoice, setNotchChoice] = useState(() => readNotchChoice(storage.getItem("axiompitch-notch")));
  const notchEnabled = notchChoice === "on";

  const [notchDisplay, setNotchDisplay] = useState<number | null>(() => {
    const saved = storage.getItem("axiompitch-notch-display");
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
  const chooseNotch = (choice: "on" | "off") => {
    setNotchChoice(choice);
    if (choice === "off" && bridge.current?.online) void bridge.current.setOverlay(false).then(state => setOverlayVisible(state.visible)).catch((error: Error) => setNotice(error.message));
  };
  const setNotchEnabled = (enabled: boolean) => chooseNotch(enabled ? "on" : "off");
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
    if (state.stage === "checking") return;
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
      if (current.current.stage === "checking") return;
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
  const logout = async (create = false) => {
    if (["running", "paused", "checking"].includes(current.current.stage)) { setNotice("Сначала заверши выступление."); return; }
    try {
      await persistCurrentWorkspace();
      signOut();
      // The local sign-out comes first, so the Supabase event finds nobody to redirect.
      if (account?.ownerId) await cloudSignOut().catch(() => undefined);
      window.location.assign(create ? "/register" : "/login");
    } catch { setNotice("Не удалось сохранить данные перед выходом. Проверь доступное место и повтори."); }
  };

  const onFrame = useCallback(
    (frame: VisionFrame) => {
      if (location.pathname !== "/studio") return;
      // The notch on the audience screen mirrors the same pose, never the video.
      bridge.current?.publishFrame(frame);
      if (calibrationRef.current) {
        handleCalibration(frame);
        return;
      }
      const state = current.current;
      if (state.stage !== "running" && state.stage !== "checking") return;
      if (state.stage === "checking" && frame.hands.length) setPreflight(previous => previous.hand ? previous : { ...previous, hand: true });
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
        if (state.stage === "checking") {
          const nextLocked = gesture === "toggle" ? !state.locked : state.locked;
          if (gesture === "toggle") applyLock(nextLocked);
          setPreflight(previous => recordPreflight(previous, nextFeedback, nextLocked));
          nextFeedback.message = gesture === "toggle" ? nextLocked ? "Блокировка работает" : "Жесты снова включены" : gesture === "next" ? "Свайп вправо работает" : "Свайп влево работает";
          successUntil.current = frame.time + 1200;
          setFeedback(nextFeedback);
          return;
        }
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
    [goTo, applyLock, handleCalibration, setPreflight],
  );
  const {
    status: cameraStatus,
    phase: cameraPhase,
    error: cameraError,
    fps: cameraFps,
    devices: cameraDevices,
    videoRef,
    start: cameraStart,
    stop: cameraStop,
  } = useCamera(onFrame, cameraId);
  const preparationInput = {
    cameraStatus, preflight, notchChoice, bridgeOnline, shellConnected, notchVisible: overlayVisible,
    displayAvailable: notchDisplay === null || displays.some(display => display.id === notchDisplay),
    workspaceReady, pdfLoading: pdfProgress !== null, hasSlides: slides.length > 0,
    external, externalReady,
  };
  const readiness = presentationReadiness(preparationInput);
  const continuation = continuationReadiness(preparationInput);
  const continuationRef = useRef(continuation);
  useLayoutEffect(() => { continuationRef.current = continuation; }, [continuation]);
  const readinessRef = useRef(readiness);
  useLayoutEffect(() => { readinessRef.current = readiness; }, [readiness]);
  const connectLocalBridge = () => {
    try { sessionStorage.setItem("axiompitch-local-bridge", "on"); } catch { /* Keep in memory. */ }
    setLocalBridgeRequested(true);
    navigate("settings", "companion");
  };

  useEffect(() => {
    try {
      storage.setItem("axiompitch-sensitivity", String(sensitivity));
    } catch {
      // Private mode: keep the value for this tab only.
    }
    engine.current.setSensitivity(sensitivity);
    calibrationEngine.current.setSensitivity(sensitivity);
  }, [sensitivity, storage]);
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
        location.pathname !== "/studio" ||
        (event.target instanceof HTMLElement &&
          /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) ||
        dialogRef.current?.open ||
        (view !== "deck" && view !== "present") ||
        previewDialog.current?.open ||
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
  }, [step, view]);
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
    if (!localBridgeRequested) return;
    const client = new BridgeClient(bridgeBase, "speaker", {
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
  }, [applyTarget, goTo, refreshTargets, localBridgeRequested]);
  useEffect(() => {
    const publish = () => bridge.current?.publishSession({
      stage, mode, index: shownIndex,
      slideCount: Math.max(shownIndex + 1, shownCount ?? 0),
      durationMs: stage === "checking" ? 0 : session.current?.duration ?? 0,
      id: sessionMeta.current.id,
      overlayEnabled: notchEnabled,
      overlayDisplayId: notchDisplay,
      overlayScale: notchScale,
    });
    publish();
    const heartbeat = setInterval(publish, 1000);
    return () => clearInterval(heartbeat);
  }, [stage, mode, shownIndex, shownCount, bridgeOnline, notchEnabled, notchDisplay, notchScale]);
  useEffect(() => {
    try {
      if (notchChoice !== null) storage.setItem("axiompitch-notch", notchChoice);
      storage.setItem("axiompitch-notch-display", notchDisplay === null ? "" : String(notchDisplay));
    } catch { queueMicrotask(() => setWorkspaceError("Браузер не смог сохранить настройки.")); }
  }, [notchChoice, notchDisplay, storage]);
  useEffect(() => {
    if (!bridgeOnline) return;
    let cancelled = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const settings = await bridge.current?.overlaySettings();
        if (!cancelled && settings) { setDisplays(settings.displays); setShellConnected(settings.shellConnected); setOverlayVisible(settings.visible); }
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
    if (!presentationId || !databaseReady) return;
    const timer = setTimeout(() => {
      saveNotes(
        presentationId,
        slides.map((slide) => slide.notes),
      ).catch(error => setDatabaseError(error instanceof Error ? error.message : "Не удалось сохранить заметки в базе."));
    }, 800);
    return () => clearTimeout(timer);
  }, [slides, presentationId, databaseReady]);
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

  useEffect(() => {
    let cancelled = false;
    if (!accountId) return;
    void loadWorkspace(accountId).then(saved => {
      if (cancelled) return;
      restoreFromDatabase.current = !saved;
      if (saved) { setSlides(saved.slides); setDeckName(saved.name); setIndex(saved.index); setPresentationId(saved.presentationId); }
    }).catch(() => { if (!cancelled) setWorkspaceError("Презентация доступна в этой вкладке, но браузер не разрешает сохранять её между открытиями."); })
      .finally(() => { if (!cancelled) setWorkspaceReady(true); });
    return () => { cancelled = true; };
  }, [accountId]);
  const workspaceSnapshot = useRef({ slides, name: deckName, index, presentationId });
  const readyToSave = useRef(false);
  const historySnapshot = useRef(history);
  useLayoutEffect(() => {
    historySnapshot.current = history;
    workspaceSnapshot.current = { slides, name: deckName, index, presentationId };
    readyToSave.current = workspaceReady && !(restoreFromDatabase.current && apiEnabled && bridgeOnline && !databaseReady && !databaseError);
  }, [slides, deckName, index, presentationId, workspaceReady, bridgeOnline, databaseReady, databaseError, history]);
  // Rehearsals from other devices join this history; unsent local ones go up.
  useEffect(() => {
    if (!accountId || !ownerId) return;
    let cancelled = false;
    syncCloudHistory({ id: accountId, ownerId }, historySnapshot.current).then(shared => {
      if (cancelled) return;
      setHistory(previous => {
        const merged = mergeHistory(shared, previous);
        try { storage.setItem("axiompitch-history", JSON.stringify(merged)); } catch { /* The list still shows in this tab. */ }
        return merged;
      });
      setCloud({ state: "synced", error: "" });
    }).catch((failure: Error) => { if (!cancelled) setCloud({ state: "error", error: failure.message }); });
    return () => { cancelled = true; };
  }, [accountId, ownerId, storage, cloudRetry]);
  useEffect(() => {
    if (!apiEnabled || !account || !bridgeOnline || !workspaceReady) return;
    let cancelled = false;
    const snapshot = workspaceSnapshot.current;
    const savedHistory = historySnapshot.current;
    const unchanged = () => workspaceSnapshot.current.slides === snapshot.slides && workspaceSnapshot.current.name === snapshot.name && workspaceSnapshot.current.index === snapshot.index;
    const connect = async () => {
      try {
        await syncProfile(account);
        if (cancelled) return;
        setDatabaseError("");
        await linkLegacyData(account.id, snapshot.presentationId, savedHistory.map(item => item.id));
        const remote = await databaseProfile(account.id);
        if (cancelled) return;
        for (const key of databasePreferences) if (initialPreferences.current[key] === null && remote.preferences[key] !== undefined) storage.setItem(key, remote.preferences[key]);
        const size = Number(storage.getItem("axiompitch-notch-scale"));
        setNotchScale([.85, 1, 1.2].includes(size) ? size : 1);
        setNotchChoice(readNotchChoice(storage.getItem("axiompitch-notch")));
        const display = storage.getItem("axiompitch-notch-display");
        setNotchDisplay(display && Number.isInteger(Number(display)) ? Number(display) : null);
        const range = Number(storage.getItem("axiompitch-sensitivity"));
        setSensitivity(range >= .55 && range <= 1.15 ? range : .85);
        setTarget(Math.max(1, Math.min(120, Number(storage.getItem("axiompitch-target-duration")) || 5)));
        const browserProfiles = await databaseProfiles();
        if (cancelled) return;
        cacheAccounts(browserProfiles.items);
        // Older offline rehearsals join the database once; duplicate IDs are retained.
        for (const item of savedHistory) await saveSession(item, null, account.id).catch(error => { if (!String(error).includes("уже сохранена")) throw error; });
        const sessions = await listSessions(10, 0, account.id);
        if (cancelled) return;
        setHistory(previous => {
          const merged = [...new Map([...sessions.items, ...previous].map(item => [item.id, item])).values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);
          storage.setItem("axiompitch-history", JSON.stringify(merged));
          return merged;
        });
        if (restoreFromDatabase.current && remote.workspace && unchanged()) {
          const workspace = remote.workspace;
          if (workspace.presentationId) {
            setPdfProgress(0);
            try {
              const response = await fetch(`${apiBase}/api/presentations/${encodeURIComponent(workspace.presentationId)}/file?profile=${encodeURIComponent(account.id)}`, { signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error("Не удалось восстановить PDF из базы.");
              const restored = await readPdf(new File([await response.blob()], `${workspace.name}.pdf`, { type: "application/pdf" }), value => { if (!cancelled) setPdfProgress(value); });
              const presentation = await request<{ notes: string[] }>(`/api/presentations/${encodeURIComponent(workspace.presentationId)}`);
              if (!cancelled && unchanged()) {
                setSlides(restored.map((slide, i) => ({ ...slide, notes: presentation?.notes[i] ?? "" })));
                setDeckName(workspace.name); setIndex(Math.min(workspace.index, restored.length - 1)); setPresentationId(workspace.presentationId);
              }
            } finally { if (!cancelled) setPdfProgress(null); }
          } else if (workspace.kind === "demo" || (!workspace.kind && workspace.name === "Первый питч")) { setDeckName(workspace.name); setIndex(Math.min(workspace.index, demoSlides.length - 1)); }
          else { setNotice("Этот PDF был сохранён только в прежнем браузере. Загрузи оригинал снова, чтобы добавить его в базу."); }
          restoreFromDatabase.current = false;
        }
        if (!cancelled) setDatabaseReady(true);
      } catch (failure) {
        if (!cancelled) { setDatabaseReady(false); setDatabaseError(failure instanceof Error ? failure.message : "База недоступна. Данные сохраняются в браузере."); }
      }
    };
    void connect();
    return () => { cancelled = true; };
  }, [account, storage, bridgeOnline, workspaceReady]);
  const persistCurrentWorkspace = async () => {
    if (!accountId || !readyToSave.current) return;
    const snapshot = workspaceSnapshot.current;
    await saveWorkspace(accountId, snapshot);
    if (databaseReady && bridgeOnline) {
      if (snapshot.presentationId) await saveNotes(snapshot.presentationId, snapshot.slides.map(slide => slide.notes));
      await saveDatabaseWorkspace(accountId, { name: snapshot.name, index: snapshot.index, presentationId: snapshot.presentationId, kind: snapshot.slides.some(slide => !!slide.image) ? "pdf" : "demo" });
      await saveDatabasePreferences();
    }
  };
  const switchProfile = async (id: string) => {
    if (isSession || id === accountId) return;
    try { await persistCurrentWorkspace(); if (!resumeAccount(id)) throw new Error("Профиль не найден."); window.location.assign("/studio?view=profile"); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : "Не удалось переключить профиль."); }
  };
  useEffect(() => {
    if (!databaseReady || !bridgeOnline || !accountId || pdfProgress !== null) return;
    const timer = setTimeout(() => { void saveDatabaseWorkspace(accountId, { name: deckName, index, presentationId, kind: slides.some(slide => !!slide.image) ? "pdf" : "demo" }).catch((failure: Error) => setDatabaseError(failure.message)); }, 800);
    return () => clearTimeout(timer);
  }, [databaseReady, bridgeOnline, accountId, deckName, index, presentationId, pdfProgress, slides]);
  useEffect(() => {
    try {
      storage.setItem("axiompitch-notch-scale", String(notchScale));
      storage.setItem("axiompitch-target-duration", String(target));
    } catch { /* Existing browser save status reports storage failures. */ }
    if (!databaseReady || !bridgeOnline) return;
    const timer = setTimeout(() => { void saveDatabasePreferences().catch((failure: Error) => setDatabaseError(failure.message)); }, 500);
    return () => clearTimeout(timer);
  }, [notchScale, target, notchEnabled, notchDisplay, sensitivity, databaseReady, bridgeOnline, storage]);
  // Declared after the effects above, so storage already holds the new values.
  useEffect(() => {
    if (!account?.ownerId || !cloudPreferencesChanged(account)) return;
    const timer = setTimeout(() => { void saveCloudProfile(account).catch((failure: Error) => setCloud(value => ({ ...value, state: "error", error: failure.message }))); }, 800);
    return () => clearTimeout(timer);
  }, [account, notchScale, target, notchEnabled, sensitivity]);
  useEffect(() => {
    if (!workspaceReady || !accountId || (restoreFromDatabase.current && apiEnabled && bridgeOnline && !databaseReady && !databaseError)) return;
    const timer = setTimeout(() => {
      void saveWorkspace(accountId!, workspaceSnapshot.current).catch(() => setWorkspaceError("Не удалось сохранить презентацию и заметки. Они доступны до закрытия вкладки."));
    }, 500);
    return () => clearTimeout(timer);
  }, [workspaceReady, accountId, slides, deckName, index, presentationId, bridgeOnline, databaseReady, databaseError]);
  useEffect(() => {
    const flush = () => {
      if (readyToSave.current && accountId) void saveWorkspace(accountId!, workspaceSnapshot.current).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [accountId]);
  useEffect(() => {
    try { storage.setItem("axiompitch-camera", cameraId); } catch { /* Keep current selection in memory. */ }
  }, [cameraId, storage]);
  useEffect(() => {
    if (overlayPreview) previewDialog.current?.showModal(); else previewDialog.current?.close();
  }, [overlayPreview]);

  const upload = async (file?: File) => {
    if (!file) return;
    restoreFromDatabase.current = false;
    if (["running", "paused", "checking"].includes(stage)) {
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
      if (apiEnabled && account) {
        // A server copy is extra: the deck above is already read locally.
        const token = ++uploadToken.current;
        syncProfile(account).then(() => uploadPresentation(file, account.id))
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
  const resetGestures = useCallback(() => {
    engine.current.reset();
    applyLock(false);
  }, [applyLock]);
  const startCheck = () => {
    if (current.current.stage === "running") return;
    if (cameraStatus !== "ready") { setNotice("Сначала подключи камеру и дождись распознавания."); return; }
    if (current.current.stage === "checking") { setPreflight(newPreflight()); resetGestures(); navigate("test"); return; }
    beforeCheck.current = stage;
    navigate("test");
    if (stage !== "paused") sessionMeta.current = { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
    setPreflight(newPreflight());
    resetGestures();
    setFeedback({ kind: "idle", message: "Покажи ладонь и попробуй оба свайпа" });
    successUntil.current = 0;
    current.current.stage = "checking";
    setStage("checking");
    // Immediately establish ownership before a manual show request.
    bridge.current?.publishSession({ stage: "checking", mode, index: shownIndex, slideCount: Math.max(shownIndex + 1, shownCount ?? 0), durationMs: 0, id: sessionMeta.current.id, overlayEnabled: notchEnabled, overlayDisplayId: notchDisplay, overlayScale: notchScale });
  };
  const finishCheck = useCallback(() => {
    resetGestures();
    current.current.stage = beforeCheck.current;
    setStage(beforeCheck.current);
    setFeedback({ kind: "idle", message: gesturesReady(preflight) ? "Жесты проверены" : "Проверка приостановлена. Заверши оставшиеся шаги перед стартом." });
    // No SessionClock, results, history entry or external slide command.
    bridge.current?.publishSession({ stage: beforeCheck.current, mode, index: shownIndex, slideCount: Math.max(shownIndex + 1, shownCount ?? 0), durationMs: session.current?.duration ?? 0, id: sessionMeta.current.id, overlayEnabled: notchEnabled, overlayDisplayId: notchDisplay, overlayScale: notchScale });
  }, [resetGestures, mode, shownIndex, shownCount, notchEnabled, notchDisplay, notchScale, preflight]);
  const toggleOverlay = () => {
    if (!bridge.current?.online || !shellConnected) { connectLocalBridge(); return; }
    setNotchChoice("on");
    if (!overlayVisible && !["running", "paused", "checking"].includes(stage)) { startCheck(); return; }
    bridge.current.setOverlay(!overlayVisible, notchDisplay, notchScale).then(state => setOverlayVisible(state.visible)).catch((error: Error) => setNotice(error.message));
  };
  const openAudience = () => {
    if (external) { toggleOverlay(); return; }
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
      if (event.data.type === "step" && ["next", "previous"].includes(event.data.direction) && !current.current.external && current.current.stage !== "checking") step(event.data.direction);
      if (event.data.type === "ready")
        channel.current?.postMessage({
          type: "slide",
          slide: current.current.slides[current.current.index],
        });
    };
  };
  const startSession = () => {
    if (["running", "paused", "checking"].includes(current.current.stage)) return;
    if (!readinessRef.current.ready) { setNotice(readinessRef.current.reason); navigate("deck"); return; }
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
    navigate("present");
    if (!external) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const pauseSession = useCallback(() => {
    if (stage === "running") {
      session.current?.pause(performance.now());
      setDuration(session.current?.duration ?? 0);
      setStage("paused");
      current.current.stage = "paused";
      engine.current.reset();
    } else if (current.current.stage === "paused") {
      if (!continuationRef.current.ready) { setNotice(continuationRef.current.reason); navigate("deck"); return; }
      session.current?.resume(performance.now());
      setStage("running");
      current.current.stage = "running";
      navigate("present");
      if (!external) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      engine.current.reset();
    }
  }, [stage, navigate, external]);
  useEffect(() => {
    if (current.current.stage !== "running" || continuation.ready) return;
    session.current?.pause(performance.now());
    setDuration(session.current?.duration ?? 0);
    current.current.stage = "paused";
    setStage("paused");
    engine.current.reset();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    navigate("deck");
    setNotice(`Выступление на паузе. ${continuation.reason}`);
  }, [continuation.ready, continuation.reason, navigate]);
  useEffect(() => {
    if (active) return;
    if (current.current.stage === "running") pauseSession();
    else if (current.current.stage === "checking") finishCheck();
  }, [active, pauseSession, finishCheck]);
  const finishSession = () => {
    if (!session.current) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    navigate("deck");
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
    setSelectedResult(null);
    setResultArchive(false);
    setResult(completed);
    setDuration(completed.duration);
    setStage("finished");
    current.current.stage = "finished";
    setResultsOpen(true);
    const nextHistory = [completed, ...history].slice(0, 10);
    setHistory(nextHistory);
    try {
      storage.setItem("axiompitch-history", JSON.stringify(nextHistory));
    } catch {
      setNotice(
        "Итоги готовы, но браузер не смог сохранить историю на этом устройстве.",
      );
    }
    // Offline results stay in the local history and upload with the next studio visit.
    if (account?.ownerId)
      saveCloudSessions(account, [completed]).catch((error) => console.warn("Supabase:", error));
    // The server keeps a copy; the local history above stays the primary one.
    if (apiEnabled)
      (account ? syncProfile(account) : Promise.resolve()).then(() => saveSession(completed, external && !pdfMatches ? null : presentationId, account?.id)).catch((error) =>
        console.warn("PitchFlow server:", error),
      );
    channel.current?.postMessage({ type: "end" });
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
  const isSession = stage === "running" || stage === "paused" || stage === "checking";
  const progress = Math.min(1, duration / (target * 60000));
  const totalCommands = result
    ? Object.values(result.commands).reduce((a, b) => a + b, 0)
    : 0;
  const statusText = describeTarget(slideTarget, estimated);
  const coachMessage =
    stage === "checking"
      ? cameraStatus !== "ready" ? "Включи камеру — проверим жесты"
        : locked ? "Опусти руку и повтори удержание"
        : !preflight.hand ? "Покажи открытую ладонь"
        : !preflight.next ? "Проведи ладонью вправо"
        : !preflight.previous ? "Теперь ладонью влево"
        : !preflight.lock ? "Удержи ладонь 1,5 секунды"
        : !preflight.unlock ? "Опусти руку и повтори удержание"
        : notchChoice === null ? "Выбери режим чёлки"
        : notchEnabled && (!overlayVisible || !shellConnected || !bridgeOnline) ? "Осталось проверить чёлку"
        : "Всё готово к выходу"
      : stage === "running"
      ? cameraStatus !== "ready" ? "Камера отключена — листай стрелками ← →" : locked
        ? "Жесты на паузе"
        : "Готов к твоему движению"
      : stage === "paused"
        ? "Отдыхаем. Я рядом"
        : stage === "finished"
          ? "Выступление завершено"
          : readiness.ready ? "Готов к выходу" : readiness.reason;
  useEffect(() => {
    const sync = () => {
      const next = readView();
      if (next !== "present" && current.current.stage === "running") pauseSession();
      if (next === "deck" && current.current.stage === "checking") finishCheck();
      if (next !== "present" && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      setView(next === "present" && !["running", "paused"].includes(current.current.stage) ? "deck" : next);
      setSettingsTab(readSettingsTab());
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [readView, pauseSession, finishCheck]);

  return (
    <main className={`studio studio-${stage} ${view === "present" ? "is-presenting" : ""}`} data-workspace-ready={workspaceReady}>
      {view !== "present" && <StudioSidebar
        active={view}
        onNavigate={next => { if (stage === "checking" && next === "deck") finishCheck(); navigate(next); }}
        account={account}
        sessionActive={isSession}
      />}
      <div className="studio-main">
        {isSession && view !== "present" && view !== "test" && <div className="session-return" role="status"><span>{stage === "checking" ? "Идёт проверка" : stage === "paused" ? "Сессия на паузе" : "Идёт выступление"} · {formatTime(duration)}</span><button className="text-button" onClick={() => navigate(stage === "checking" ? "test" : "present")}>{stage === "checking" ? "Вернуться к тесту" : "Вернуться к выступлению"} <ArrowRight size={16} /></button>{stage === "checking" && <button className="text-button" onClick={finishCheck}>Завершить проверку</button>}</div>}
        {notice && <div className="notice" role="alert"><span>{notice}</span><button className="icon-button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}><X size={16} /></button></div>}
        {workspaceError && <p className="workspace-save-error" role="status">{workspaceError}</p>}
        <div className="studio-deck" hidden={view !== "deck"}>
      <div className="workspace-heading">
        <div className="studio-title">
          <h1 tabIndex={-1}>Студия</h1>
          <p>{external ? slideTarget?.label || "Внешний показ" : deckName} · {external ? shownCount ?? "?" : slides.length} {slidesWord(external ? shownCount : slides.length)}</p>
        </div>
        <div className="deck-actions">
          <button className="button primary studio-mobile-session" disabled={pdfProgress !== null || !workspaceReady || (stage !== "running" && stage !== "checking" && !(stage === "paused" ? continuation.ready : readiness.ready))} aria-describedby={!readiness.ready ? "preparation-reason" : undefined} onClick={() => stage === "checking" ? finishCheck() : isSession ? pauseSession() : startSession()}>{stage === "running" ? <Pause size={16} /> : <Play size={16} />}{stage === "checking" ? "Завершить проверку" : stage === "running" ? "Пауза" : stage === "paused" ? "Продолжить" : "Начать"}</button>
          <button
            className={`button secondary ${audienceOpen || overlayVisible ? "selected" : ""}`}
            onClick={openAudience}
            aria-label={external ? overlayVisible ? "Скрыть компаньона" : "Показать компаньона" : audienceOpen ? "Экран открыт" : "Второй экран"}
          >
            <Monitor size={16} />
            <span>{external ? overlayVisible ? "Скрыть компаньона" : "Показать компаньона" : audienceOpen ? "Экран открыт" : "Второй экран"}</span>
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
            disabled={isSession || pdfProgress !== null || !workspaceReady}
          >
            <FileUp size={17} />
            {pdfProgress !== null
              ? `Загрузка ${Math.round(pdfProgress * 100)}%`
              : "Загрузить PDF"}
          </button>
        </div>
      </div>
      {welcome && <section className="welcome-line"><div><strong>Твоё пространство готово</strong><p>Начни с демо или загрузи PDF.</p></div><a className="button secondary" href="/learn" aria-disabled={isSession || undefined} onClick={event => { if (isSession) { event.preventDefault(); setNotice("Сначала заверши выступление, чтобы перейти к обучению."); } }}>Изучить жесты</a><button className="icon-button" aria-label="Скрыть приветствие" onClick={() => { setWelcome(false); const url = new URL(location.href); url.searchParams.delete("welcome"); window.history.replaceState(null, "", url); }}><X size={16} /></button></section>}

      {view === "deck" && !isSession && <PreparationChecklist readiness={readiness} cameraStatus={cameraStatus} cameraPhase={cameraPhase} cameraError={cameraError} notchChoice={notchChoice} connected={bridgeOnline && shellConnected} onCamera={() => { if (cameraStatus === "ready" || cameraStatus === "loading") cameraStop(); else { resetGestures(); void cameraStart(); } }} onNotchChoice={chooseNotch} onConnect={connectLocalBridge} onSettings={() => navigate("settings", "companion")} />}
      <section className="preparation" aria-label="Подготовка к выступлению">
        <div className="studio-quick-tools">
          <button onClick={() => setSetupOpen(value => !value)} aria-expanded={setupOpen} aria-controls="show-setup"><Presentation size={15} /><span>{external ? slideTarget?.label || "Внешний показ" : "Показ в AxiomPitch"}</span><ChevronRight size={14} /></button>
        </div>
        <div id="show-setup" className="show-setup" hidden={!setupOpen}>
          <section className="settings-group"><h2>Презентация</h2><p className="settings-note">Показывай PDF в AxiomPitch или подключи приложение, в котором открыты слайды.</p><button className="button secondary" disabled={isSession || pdfProgress !== null || !workspaceReady} onClick={() => inputRef.current?.click()}><FileUp size={16} />Загрузить PDF</button></section>
            {localBridgeRequested && (
              <section className="settings-group settings-panel settings-panel-wide">
                <span className="settings-label">Где показывать презентацию</span>
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
                      }}>Показывать в AxiomPitch</button>
                      <label className="bridge-setting"><input type="checkbox" checked={pdfMatches} disabled={isSession || !slides[0]?.image} onChange={event => setPdfMatches(event.target.checked)} />PDF соответствует показу</label>
                      {estimated && <label className="bridge-setting">Начальный номер слайда <input aria-label="Начальный номер внешнего слайда" type="number" min={1} max={2000} disabled={isSession} value={externalIndex + 1} onChange={event => {
                        const value = Math.max(0, Math.min(1999, Number(event.target.value) - 1));
                        externalPosition.current = value; setExternalIndex(value);
                      }} /></label>}
                      {isSession && <p className="settings-note">Для смены приложения сначала заверши выступление.</p>}
                    </>}
                  </>
                ) : (
                  <><p className="settings-note">Локальное подключение недоступно. PDF можно показывать здесь.</p><details className="connection-help"><summary>Как подключить приложение на Mac</summary><p>Останови отдельный dev-сервер и запусти из папки проекта <code>npm run studio</code> — сайт и чёлка откроются вместе. Разреши управление приложениями в настройках macOS, если система запросит доступ.</p></details></>
                )}
              </section>
            )}

          {!bridgeOnline && <p className="settings-note">Слайды показываются в AxiomPitch. Внешние приложения доступны с локальным подключением на Mac.</p>}
          <button className="text-button" onClick={openAudience}>{external ? "Компаньон поверх слайдов" : "Открыть экран аудитории"} <Monitor size={16} /></button>
        </div>
      </section>
      <div className={`workspace-grid ${external && !pdfMatches ? "external-without-preview" : ""}`}>
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
                disabled={stage === "checking" || (!external && index === 0)}
                onClick={() => step("previous")}
              >
                <ArrowLeft size={20} />
              </button>
              <button
                className="icon-button"
                title="Следующий слайд (→)"
                aria-label="Следующий слайд"
                disabled={stage === "checking" || (!external && index === slides.length - 1)}
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

        </section>
        <nav className="studio-filmstrip" aria-label="Все слайды презентации" hidden={external && !pdfMatches}>
          <div className="studio-thumbnails">{slides.map((slide, i) => <button key={slide.id} className={`studio-thumbnail ${i === shownIndex ? "active" : ""}`} disabled={external || stage === "checking"} onClick={() => goTo(i)} aria-label={`Перейти к слайду ${i + 1}: ${slide.title.replace(/\n/g, " ")}`} aria-current={i === shownIndex ? "step" : undefined}><SlideView slide={slide} small /><span className="studio-thumbnail-caption"><span>{String(i + 1).padStart(2, "0")}</span>{i === shownIndex && <span className="studio-thumbnail-current" />}</span></button>)}</div>
        </nav>
          {previewAvailable && <div className="below-slide">
            <div className="notes-panel">
              <label htmlFor="speaker-notes">
                <SlidersHorizontal size={16} />
                Заметка к слайду
              </label>
              <textarea
                id="speaker-notes"
                value={slides[index].notes}
                onChange={(event) => updateNote(event.target.value)}
                placeholder="Что важно сказать на этом слайде…"
                rows={3}
              />
            </div>
          </div>}
        </div>
        <div className="studio-control-column"><aside className="control-panel">
          <section className="timer-panel">
            {stage === "checking" ? <div className="studio-preflight">
              <div className="panel-heading"><ScanLine size={17} /><span>Проверка перед выходом</span></div>
              <p className="preflight-note">Без записи в историю. Слайды остаются на месте.</p>
              <div className="preflight-slide" aria-live="polite"><span>Тестовый слайд</span><strong>{preflight.index + 1}<small> / 3</small></strong></div>
              <ul className="preflight-list">
                {[
                  ["Камера", cameraStatus === "ready"],
                  ["Ладонь в кадре", cameraStatus === "ready" && preflight.hand],
                  ["Свайп вправо", preflight.next],
                  ["Свайп влево", preflight.previous],
                  ["Удержание 1,5 с · блокировка", preflight.lock],
                  ["Ещё удержание · включение", preflight.unlock],
                  [notchChoice === "off" ? "Выступление без чёлки" : "Чёлка на экране", notchChoice === "off" || (notchEnabled && bridgeOnline && shellConnected && overlayVisible)],
                ].map(([label, done]) => <li key={String(label)} className={done ? "done" : ""}>{done ? <Check size={14} /> : <span className="preflight-dot" />}<span>{label}</span></li>)}
              </ul>
              <button className="button primary full" disabled={!gesturesReady(preflight) || cameraStatus !== "ready"} onClick={finishCheck}>Завершить проверку</button>
            </div> : <>
            <div className="panel-heading">
              <Clock3 size={17} />
              <span>Выступление</span>
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
                <button className="button secondary" disabled={stage === "paused" && !continuation.ready} onClick={pauseSession}>
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
                disabled={!readiness.ready}
                aria-describedby={!readiness.ready ? "preparation-reason" : undefined}
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
            </>}
            <p className="studio-equipment-status">{cameraStatus === "ready" ? "Камера готова" : "Камера выключена"} · {bridgeOnline && shellConnected ? "Чёлка подключена" : "Чёлка не подключена"}</p>
          </section>
          <section className="camera-panel">
            <div className="panel-heading"><Camera size={15} /><span>Камера</span><small>{cameraStatus === "ready" ? `${cameraFps} FPS` : cameraStatus === "loading" ? "подключение" : "выключена"}</small></div>
            <CameraPreview source={videoRef} status={cameraStatus} />
            <button className="button secondary full" onClick={() => { if (cameraStatus === "ready" || cameraStatus === "loading") cameraStop(); else { resetGestures(); void cameraStart(); } }}>{cameraStatus === "loading" ? <LoaderCircle className="spin" size={15} /> : cameraStatus === "ready" ? <CameraOff size={15} /> : <Camera size={15} />}{cameraStatus === "loading" ? "Отменить" : cameraStatus === "ready" ? "Выключить камеру" : "Включить камеру"}</button>
            {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
            {(stage === "running" || stage === "checking") && cameraStatus === "ready" && <p className={`studio-live-feedback ${feedback.kind}`} role="status">{feedback.message}</p>}
          </section>
        </aside></div>
      </div>
      <footer className="workspace-footer">
        <span>
          <LockKeyhole size={13} />
          Камера и PDF остаются на устройстве
        </span>
        <span>
          {cameraStatus === "ready"
            ? overlayVisible ? "Компаньон виден поверх презентации" : "Зрители видят только презентацию"
            : "Можно начать с демо-слайдов или своего PDF"}
        </span>
      </footer>
        </div>
        {view === "test" && <TestPage onSlide={index => setPreflight(previous => ({ ...previous, index }))} active={stage === "checking"} busy={stage === "running"} ready={workspaceReady && cameraStatus === "ready"} source={videoRef} cameraStatus={cameraStatus} cameraError={cameraError} diagnostic={<>{debugGestures && (
              <div className="studio-debug">
                {gestureDebug ? (<>
                  <span>Руки: {gestureDebug.hands} · открытых: {gestureDebug.open} · ладонь: {(gestureDebug.scale * 100).toFixed(1)}%</span>
                  <span>dx: {gestureDebug.dx >= 0 ? "+" : ""}{gestureDebug.dx.toFixed(2)} · dy: {gestureDebug.dy >= 0 ? "+" : ""}{gestureDebug.dy.toFixed(2)} · t: {(gestureDebug.elapsed / 1000).toFixed(1)} с · порог: {gestureDebug.threshold.toFixed(2)}</span>
                  <span>Движок: {gestureDebug.locked ? "заблокирован" : "активен"} · ответ: {gestureDebug.kind}{gestureDebug.code ? ` · ${gestureDebug.code}` : ""}</span>
                  <div className="studio-debug-log">{debugLog.length ? debugLog.map((entry, i) => <span key={`${entry.code}-${i}`}>{entry.message}</span>) : <span>Журнал пока пуст</span>}</div>
                </>) : <span>Отладка включена. Начни репетицию и покажи ладонь — здесь появятся цифры.</span>}
              </div>
            )}</>} state={preflight} notchChoice={notchChoice} onNotchChoice={chooseNotch} notchConnected={bridgeOnline && shellConnected} notchVisible={overlayVisible} message={coachMessage} onStart={startCheck} onFinish={finishCheck} onCamera={() => { if (cameraStatus === "ready" || cameraStatus === "loading") cameraStop(); else { resetGestures(); void cameraStart(); } }} onNotch={toggleOverlay} onSettings={() => navigate("settings", "companion")} onStudio={() => { if (stage === "checking") finishCheck(); navigate("deck"); }} />}
        {view === "present" && <PerformanceScreen slide={slides[index]} index={shownIndex} count={shownCount ?? null} duration={duration} paused={stage === "paused"} external={external} cameraDisconnected={cameraStatus !== "ready"} onStep={step} onPause={pauseSession} onFinish={finishSession} onStudio={() => { if (stage === "running") pauseSession(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); navigate("deck"); }} />}
        <section className="settings-page" hidden={view !== "settings"} aria-labelledby="settings-title">
          <h1 id="settings-title" tabIndex={-1}>Настройки</h1>
          <p className="page-lead">Настрой один раз — сохраним для твоего профиля.</p>
          <div className="settings-tabs" role="group" aria-label="Разделы настроек">
            <button aria-pressed={settingsTab === "camera"} onClick={() => navigate("settings", "camera")}>Камера и жесты</button>
            <button aria-pressed={settingsTab === "companion"} onClick={() => navigate("settings", "companion")}>Чёлка</button>
            <button aria-pressed={settingsTab === "advanced"} onClick={() => navigate("settings", "advanced")}>Дополнительно</button>
          </div>
          <div className="settings-content" hidden={settingsTab !== "camera"}>
            <section className="settings-group">
              <h2>Твой кадр</h2><p className="settings-note">Ладонь должна помещаться целиком. Голова и плечи для команд не нужны.</p>
              <label className="field-label" htmlFor="camera-source">Камера</label>
              <select id="camera-source" className="settings-select" value={cameraId} disabled={isSession || cameraStatus === "loading"} onChange={event => { cameraStop(); setCameraId(event.target.value); }}>
                <option value="">Камера по умолчанию</option>
                {cameraDevices.filter(device => device.deviceId).map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Камера ${i + 1}`}</option>)}
                {cameraId && !cameraDevices.some(device => device.deviceId === cameraId) && <option value={cameraId}>Выбранная камера недоступна</option>}
              </select>
              <CameraPreview source={videoRef} status={cameraStatus} />
              <button className="button secondary" onClick={() => cameraStatus === "off" || cameraStatus === "error" ? void cameraStart() : cameraStop()}>{cameraStatus === "loading" ? "Отменить подключение" : cameraStatus === "ready" ? "Выключить камеру" : "Включить камеру"}</button>
              {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
              {isSession && <p className="settings-note">Камеру можно сменить после завершения выступления.</p>}
            </section>
            <section className="settings-group">
              <h2>Удобный размах</h2><p className="settings-note">Малый размах — короткое движение. Большой — более заметный жест.</p>
              <label className="sensitivity" htmlFor="sensitivity"><span>Размах жеста <span>{sensitivity < .8 ? "малый" : sensitivity > 1 ? "большой" : "обычный"}</span></span><input id="sensitivity" type="range" min={.55} max={1.15} step={.05} disabled={isSession} value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} /></label>
              <button className="button secondary" disabled={isSession} onClick={startCalibration}>Проверить жесты <ChevronRight size={16} /></button>
              <p className="settings-note">Проверим ладонь, два свайпа и удержание. Подстроим размах, если нужно.</p>
              <a className="studio-learn-link" href="/learn" onClick={event => { if (isSession) { event.preventDefault(); setNotice("Обучение доступно после завершения выступления."); } }}>Открыть обучение <ChevronRight size={16} /></a>
            </section>
          </div>
          <div className="settings-content" hidden={settingsTab !== "companion"}>
            <section className="settings-group notch-settings">
              <h2>Чёлка поверх презентации</h2><div className="preparation-notch-options" role="group" aria-label="Режим чёлки"><button aria-pressed={notchChoice === "on"} onClick={() => chooseNotch("on")}>С чёлкой</button><button aria-pressed={notchChoice === "off"} onClick={() => chooseNotch("off")}>Без чёлки</button></div><p className="settings-note">3D-зеркало твоих движений у верхнего края экрана.</p>
              <p className="companion-status" role="status">{!bridgeOnline ? "Локальное приложение выключено" : !shellConnected ? "Окно чёлки не запущено" : overlayVisible ? "Чёлка видна на экране" : "Чёлка подключена · скрыта"}</p>
              <div className="notch-sample" aria-label="Предпросмотр размера чёлки"><div className="notch-sample-window" style={{ transform: `scale(${notchScale})` }}>{view === "settings" && settingsTab === "companion" && <Avatar locked={false} headStyle="ghost" face="none" />}</div></div>
              <div className="notch-size"><span>Размер чёлки</span><div className="notch-size-options" role="group" aria-label="Размер чёлки">{[[.85, "Компактная"], [1, "Обычная"], [1.2, "Крупная"]].map(([size, label]) => <button key={size} aria-pressed={notchScale === size} onClick={() => setNotchScale(Number(size))}>{label}</button>)}</div></div>
              <label className="field-label" htmlFor="companion-display">На каком экране</label>
              <select className="settings-select" id="companion-display" value={notchDisplay ?? "auto"} disabled={!bridgeOnline || !shellConnected} onChange={event => setNotchDisplay(event.target.value === "auto" ? null : Number(event.target.value))}>
                <option value="auto">Автоматически · экран с вырезом / основной</option>
                {displays.map(display => <option key={display.id} value={display.id}>{display.label}{display.primary ? " · основной" : ""}</option>)}
                {notchDisplay !== null && !displays.some(display => display.id === notchDisplay) && <option value={notchDisplay}>Выбранный экран не подключён</option>}
              </select>
              <label className="preference-switch"><span><strong>Автопоказ чёлки</strong><small>При начале репетиции или выступления</small></span><input type="checkbox" role="switch" checked={notchEnabled} onChange={event => setNotchEnabled(event.target.checked)} /></label>
              <div className="companion-actions"><button className="button primary" disabled={!bridgeOnline || !shellConnected} onClick={toggleOverlay}>{overlayVisible ? "Скрыть с экрана" : "Показать на экране"}</button><button className="text-button" onClick={() => setOverlayPreview(true)}>Пример движений</button></div>
              <p className="settings-note">Крестик скрывает чёлку до следующей сессии. Жесты работают и без неё.</p>
              {!bridgeOnline && <button className="button secondary" onClick={connectLocalBridge}>{localBridgeRequested ? "Повторить подключение" : "Подключить приложение на Mac"}</button>}
              {!shellConnected && <details className="connection-help"><summary>Подключить чёлку на Mac</summary><p>Останови отдельный dev-сервер и запусти <code>npm run studio</code> из папки проекта. Если браузер запросит доступ к локальной сети, разреши его для подключения чёлки.</p></details>}
            </section>
          </div>
          <div className="settings-content" hidden={settingsTab !== "advanced"}>
            <section className="settings-group"><h2>Диагностика</h2><p className="settings-note">Для разбора проблем с распознаванием. Показатели появятся рядом с камерой в студии.</p>
              <label className="preference-switch"><span><strong>Показывать диагностику жестов</strong><small>Координаты, порог и журнал подсказок</small></span><input type="checkbox" role="switch" checked={debugGestures} onChange={event => setDebugGestures(event.target.checked)} /></label>
              <button className="text-button" disabled={isSession} onClick={() => setSensitivity(.85)}>Вернуть обычный размах</button>
            </section>
            <section className="settings-group"><h2>Хранение данных</h2><p className="settings-note">Профиль, PDF, история и настройки связаны в локальной базе. При выключенном приложении работа сохраняется в браузере.</p><button className="text-button" onClick={() => navigate("profile")}>Мой профиль <ChevronRight size={16} /></button></section>
          </div>
        </section>
        <div hidden={view !== "history"}><HistoryPage history={history} onOpen={item => { setResultArchive(true); setSelectedResult(item); setResultsOpen(true); }} onStudio={() => navigate("deck")} /></div>
        <div hidden={view !== "profile"}>{account && <ProfilePage account={account} onSave={setAccount} onLogout={() => void logout()} onCreate={() => void logout(true)} onSwitch={switchProfile} profiles={listAccounts()} sessionActive={isSession} cloud={ownerId ? { ...cloud, onRetry: () => { setCloud({ state: "syncing", error: "" }); setCloudRetry(value => value + 1); } } : null} />}</div>
      </div>

      <dialog ref={previewDialog} className="results-dialog companion-preview-dialog" aria-labelledby="companion-preview-title" onCancel={() => setOverlayPreview(false)} onClose={() => setOverlayPreview(false)}>
        <div className="dialog-header"><h2 id="companion-preview-title">Компаньон на экране</h2><button className="icon-button" aria-label="Закрыть предпросмотр" onClick={() => setOverlayPreview(false)}><X size={18} /></button></div>
        <div className="companion-preview-screen"><span>Твоя презентация</span>{overlayPreview && <div className="companion-preview-notch"><Avatar face="none" headStyle="ghost" locked={false} /><button aria-label="Скрыть окно в предпросмотре" onClick={() => setOverlayPreview(false)}><X size={14} /></button></div>}</div>
        <p className="settings-note">Так выглядит окно у верхнего края экрана. Это предпросмотр в студии; во время сессии аватар повторяет твои движения.</p>
      </dialog>
      <dialog
        ref={dialogRef}
        className="results-dialog"
        aria-labelledby="results-title"
        onCancel={() => setResultsOpen(false)}
        onClose={() => { setResultsOpen(false); setSelectedResult(null); setResultArchive(false); }}
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
                  if (resultArchive) { navigate("deck"); return; }
                  setStage("idle");
                  goTo(0);
                  setDuration(0);
                  session.current = null;
                }}
              >
                <RotateCcw size={16} />{resultArchive ? "В студию" : "К началу"}
              </button>
            </div>
          </>
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

