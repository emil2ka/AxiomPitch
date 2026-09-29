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
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileUp,
  Hand,
  History,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Pause,
  Play,
  Plug,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  Square,
  UnlockKeyhole,
  Waves,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Audience } from "./components/Audience";
import { Avatar } from "./components/Avatar";
import type { AvatarHandle } from "./components/Avatar";
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
  TargetId,
  TargetInfo,
  TargetStatus,
} from "./lib/bridge-client";
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

type Stage = "idle" | "running" | "paused" | "finished";
const steps = [
  "Проверим кадр",
  "Следующий слайд",
  "Предыдущий слайд",
  "Блокировка жестов",
  "Всё готово",
];
const instructions = [
  "Встань так, чтобы камера видела голову и оба плеча. Подожди секунду.",
  "Подними открытую ладонь до плеча и проведи вправо. Затем опусти руку.",
  "Снова подними открытую ладонь и проведи влево. Затем опусти руку.",
  "Подними открытую ладонь и держи неподвижно 1,5 секунды.",
  "Три команды проверены. Можно начинать выступление.",
];
const correctionNames: Record<string, string> = {
  frame: "Голова и плечи вне кадра",
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
function describeTarget(status: TargetStatus | null, estimated: boolean) {
  if (!status?.connected || !status.app)
    return "Цель не подключена: листается колода PitchFlow.";
  if (status.app === "pitchflow") return "Листается колода PitchFlow.";
  const label = status.label ?? targetNames[status.app];
  if (status.slideIndex !== null && status.slideCount !== null)
    return `${label} · слайд ${status.slideIndex + 1} из ${status.slideCount}`;
  return estimated
    ? `${label} · номер слайда оценочный, приложение его не сообщает`
    : `${label} · подключено`;
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
  const [tutorial, setTutorial] = useState(0);
  const [tutorialVisible, setTutorialVisible] = useState(true);
  const [calibration, setCalibration] = useState(0);
  const [duration, setDuration] = useState(0);
  const [target, setTarget] = useState(5);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const [sensitivity, setSensitivity] = useState(0.85);
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
  const external = bridgeOnline && isExternal(slideTarget);
  const bridge = useRef<BridgeClient | null>(null);
  const uploadToken = useRef(0);
  const avatar = useRef<AvatarHandle>(null);
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
  const calibrationStart = useRef<number | null>(null);
  const successUntil = useRef(0);
  const correctionLast = useRef<Record<string, number>>({});
  const current = useRef({
    slides,
    index,
    locked,
    tutorial,
    tutorialVisible,
    stage,
    mode,
    external,
  });
  useLayoutEffect(() => {
    current.current = {
      slides,
      index,
      locked,
      tutorial,
      tutorialVisible,
      stage,
      mode,
      external,
    };
  }, [slides, index, locked, tutorial, tutorialVisible, stage, mode, external]);
  const reducedMotion = useReducedMotion();

  const goTo = useCallback((next: number) => {
    const state = current.current;
    const safe = Math.max(0, Math.min(state.slides.length - 1, next));
    session.current?.changeSlide(safe, performance.now());
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
      if (current.current.external && client?.online) {
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
      const move = followTarget(
        status,
        current.current.index,
        current.current.slides.length,
      );
      if (!move) return;
      setEstimated(move.estimated);
      if (move.index !== current.current.index) goTo(move.index);
    },
    [goTo],
  );

  const onFrame = useCallback(
    (frame: VisionFrame) => {
      avatar.current?.draw(frame);
      // The notch on the audience screen mirrors the same pose, never the video.
      bridge.current?.publishFrame(frame);
      const state = current.current;
      if (state.tutorialVisible && state.tutorial === 0) {
        const pose = frame.pose;
        const valid =
          pose.length > 12 &&
          (pose[11].visibility ?? 0) > 0.6 &&
          (pose[12].visibility ?? 0) > 0.6 &&
          pose[0].y > 0.04 &&
          pose[0].y < 0.65 &&
          pose[11].x > 0.06 &&
          pose[11].x < 0.94 &&
          pose[12].x > 0.06 &&
          pose[12].x < 0.94;
        if (valid) {
          calibrationStart.current ??= frame.time;
          const p = Math.min(1, (frame.time - calibrationStart.current) / 1400);
          setCalibration(p);
          setFeedback({
            kind: "progress",
            message: "Кадр хороший · держись на месте",
            progress: p,
          });
          if (p === 1) {
            setTutorial(1);
            current.current.tutorial = 1;
            engine.current.reset();
            setFeedback({
              kind: "success",
              message: "Кадр готов · попробуй движение вправо",
            });
            successUntil.current = frame.time + 1000;
          }
        } else {
          calibrationStart.current = null;
          setCalibration(0);
          setFeedback({
            kind: "idle",
            message: "Покажи голову и оба плеча · отойди немного назад",
          });
        }
        return;
      }
      const nextFeedback = engine.current.update(
        frame.pose,
        frame.hands,
        frame.time,
        state.locked,
      );
      if (nextFeedback.kind === "success" && nextFeedback.gesture) {
        const gesture = nextFeedback.gesture;
        if (state.tutorialVisible && state.tutorial > 0 && state.tutorial < 4) {
          const expected = (["next", "previous", "toggle"] as Gesture[])[
            state.tutorial - 1
          ];
          if (gesture !== expected) {
            setFeedback({
              kind: "idle",
              message: `Сейчас попробуй: ${steps[state.tutorial].toLowerCase()}`,
            });
            return;
          }
          setTutorial(state.tutorial + 1);
          current.current.tutorial = state.tutorial + 1;
        }
        if (gesture === "toggle") {
          // Toggle only locks gestures here; it is never sent to the slide app.
          applyLock(!state.locked);
          nextFeedback.message = state.locked
            ? "Жесты включены"
            : "Жесты заблокированы";
        } else if (state.stage !== "finished" && state.stage !== "paused") {
          const next = state.index + (gesture === "next" ? 1 : -1);
          if (state.external && bridge.current?.publishCommand(gesture, false))
            nextFeedback.message =
              gesture === "next" ? "Следующий слайд" : "Предыдущий слайд";
          else if (next < 0 || next >= state.slides.length)
            nextFeedback.message =
              next < 0 ? "Это первый слайд" : "Это последний слайд";
          else {
            goTo(next);
            bridge.current?.publishCommand(gesture, false);
          }
        } else
          nextFeedback.message =
            state.stage === "paused"
              ? "Выступление на паузе"
              : "Выступление завершено";
        if (state.stage === "running" && session.current)
          session.current.commands[gesture]++;
        avatar.current?.react(gesture);
        setPulse({ id: Date.now(), gesture });
        successUntil.current = frame.time + 1200;
        setFeedback(nextFeedback);
        return;
      }
      if (
        nextFeedback.kind === "error" &&
        nextFeedback.code &&
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
            !state.tutorialVisible &&
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
    [goTo, applyLock],
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
    if (cameraStatus !== "ready") avatar.current?.clear();
  }, [cameraStatus]);
  useEffect(() => {
    engine.current.setSensitivity(sensitivity);
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
        historyDialogRef.current?.open
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
        setSlideTarget(status);
        setTargetList(targets);
        setRunningApps(apps);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!apiEnabled) return;
    const client = new BridgeClient(apiBase, "speaker", {
      online: (online) => {
        setBridgeOnline(online);
        if (online) refreshTargets();
      },
      hello: (hello) => setOverlayVisible(hello.overlay.visible),
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
    // For the notch only the fact of a live session matters; no timer there.
    bridge.current?.publishSession({
      stage,
      mode,
      index,
      slideCount: slides.length,
      durationMs: session.current?.duration ?? 0,
    });
  }, [stage, mode, index, slides.length, bridgeOnline]);
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
      setNotice(
        error instanceof Error
          ? error.message
          : "Не удалось прочитать PDF. Попробуй другой файл.",
      );
    } finally {
      setPdfProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const openAudience = () => {
    const client = bridge.current;
    if (client?.online) {
      // With an external app the button toggles the notch over its show.
      const visible = !(external && overlayVisible);
      client
        .setOverlay(visible)
        .then((state) => {
          setOverlayVisible(state.visible);
          if (state.visible && !state.shellConnected)
            setNotice(
              "Запусти npm run overlay, чтобы чёлка появилась на экране аудитории.",
            );
        })
        .catch((error: Error) => setNotice(error.message));
    }
    // Keynote or PowerPoint is itself the audience screen: no popup over it.
    if (external) return;
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
    const clock = new SessionClock(slides.length, index, performance.now());
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
    channel.current?.postMessage({ type: "slide", slide: slides[index] });
    setTutorialVisible(false);
  };
  const pauseSession = () => {
    if (stage === "running") {
      session.current?.pause(performance.now());
      setDuration(session.current?.duration ?? 0);
      setStage("paused");
    } else {
      session.current?.resume(performance.now());
      setStage("running");
    }
  };
  const finishSession = () => {
    if (!session.current) return;
    const completed = session.current.result(
      {
        ...sessionMeta.current,
        name: deckName,
        slideTitles: slides.map((slide) => slide.title.replace(/\n/g, " ")),
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
      saveSession(completed, presentationId).catch((error) =>
        console.warn("PitchFlow server:", error),
      );
    channel.current?.postMessage({ type: "end" });
  };
  const restartTutorial = () => {
    setTutorialVisible(true);
    setTutorial(0);
    current.current.tutorial = 0;
    setCalibration(0);
    calibrationStart.current = null;
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

  return (
    <main className="workspace">
      <video
        ref={videoRef}
        className="camera-source"
        playsInline
        muted
        aria-hidden="true"
      />
      <div
        className={`notch ${cameraStatus === "ready" ? "is-live" : ""} ${locked ? "is-locked" : ""}`}
      >
        <div className="notch-content">
          <Avatar ref={avatar} locked={locked} />
          {cameraStatus !== "ready" && (
            <div className="notch-caption">
              {cameraStatus === "loading" ? (
                <LoaderCircle className="spin" size={11} />
              ) : (
                <span className="notch-caption-dot" />
              )}
              <span>
                {cameraStatus === "loading"
                  ? "Подключаю камеру"
                  : "Камера выключена"}
              </span>
            </div>
          )}
          {cameraStatus === "ready" && (
            <span className="notch-lock">
              {locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}
            </span>
          )}
          {pulse && !reducedMotion && (
            <motion.div
              key={pulse.id}
              className={`notch-pulse ${pulse.gesture}`}
              initial={{
                opacity: 0.9,
                x:
                  pulse.gesture === "next"
                    ? -110
                    : pulse.gesture === "previous"
                      ? 110
                      : 0,
                scaleX: pulse.gesture === "toggle" ? 0.3 : 1,
              }}
              animate={{
                opacity: 0,
                x:
                  pulse.gesture === "next"
                    ? 110
                    : pulse.gesture === "previous"
                      ? -110
                      : 0,
                scaleX: 1,
              }}
              transition={{ duration: 0.38 }}
            />
          )}
        </div>
        {cameraStatus === "ready" && (
          <div className={`notch-feedback ${feedback.kind}`} aria-live="polite">
            <span>{feedback.message}</span>
            {feedback.kind === "progress" && (
              <div className="notch-progress">
                <span style={{ width: `${(feedback.progress ?? 0) * 100}%` }} />
              </div>
            )}
          </div>
        )}
      </div>
      <header className="app-header">
        <a className="brand" href="/" aria-label="AxiomPitch">
          <Waves size={25} aria-hidden="true" />
          Axiom<span>Pitch</span>
        </a>
        <div className="header-actions">
          <button
            className="icon-button"
            title="История выступлений"
            aria-label="История выступлений"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={19} />
          </button>
          <button
            className={`button secondary ${audienceOpen || overlayVisible ? "selected" : ""}`}
            onClick={openAudience}
          >
            <Monitor size={17} />
            <span>
              {audienceOpen || overlayVisible
                ? "Экран открыт"
                : "Экран аудитории"}
            </span>
          </button>
        </div>
      </header>
      <div className="workspace-heading">
        <div>
          <div className="section-eyebrow">
            ТВОЁ ПРОСТРАНСТВО ДЛЯ ВЫСТУПЛЕНИЙ
          </div>
          <h2>{deckName}</h2>
          <p>
            {slides.length} слайдов <span>·</span>{" "}
            {slides[0]?.image
              ? "Твоя презентация"
              : "Демонстрационная презентация"}
          </p>
        </div>
        <div className="deck-actions">
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
      <div className="workspace-grid">
        <section className="stage-panel" aria-label="Презентация">
          <div className="stage-label">
            <span>ТЕКУЩИЙ СЛАЙД</span>
            <span
              className="slide-counter"
              title={
                external && estimated
                  ? "Приложение не сообщает номер слайда: позиция оценочная"
                  : undefined
              }
            >
              {external && estimated ? "≈ " : ""}
              {String(index + 1).padStart(2, "0")}{" "}
              <span>/ {String(slides.length).padStart(2, "0")}</span>
            </span>
          </div>
          <motion.div
            key={slides[index].id}
            initial={reducedMotion ? false : { opacity: 0.5, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <SlideView slide={slides[index]} />
          </motion.div>
          <div className="slide-transport">
            <div className="transport-buttons">
              <button
                className="icon-button"
                aria-label="Предыдущий слайд"
                disabled={!external && index === 0}
                onClick={() => step("previous")}
              >
                <ArrowLeft size={20} />
              </button>
              <div className="slide-dots" aria-label="Слайды">
                {slides
                  .slice(
                    Math.max(0, index - 3),
                    Math.min(slides.length, index + 4),
                  )
                  .map((slide, local) => {
                    const i = Math.max(0, index - 3) + local;
                    return (
                      <button
                        key={slide.id}
                        className={`slide-dot ${i === index ? "active" : ""}`}
                        aria-label={`Слайд ${i + 1}`}
                        aria-current={i === index ? "step" : undefined}
                        // An external app cannot jump; it only steps.
                        disabled={external}
                        onClick={() => goTo(i)}
                      />
                    );
                  })}
              </div>
              <button
                className="icon-button"
                aria-label="Следующий слайд"
                disabled={!external && index === slides.length - 1}
                onClick={() => step("next")}
              >
                <ArrowRight size={20} />
              </button>
            </div>
            <span className="keyboard-tip">← → для ручного управления</span>
          </div>
          <div className="below-slide">
            <div className="notes-panel">
              <label htmlFor="speaker-notes">
                <SlidersHorizontal size={16} />
                Заметки спикера
              </label>
              <textarea
                id="speaker-notes"
                value={slides[index].notes}
                onChange={(event) => updateNote(event.target.value)}
                placeholder="Твоя главная мысль на этом слайде…"
                rows={3}
              />
            </div>
            <div className="next-slide-panel">
              <span className="panel-caption">ДАЛЕЕ</span>
              {slides[index + 1] ? (
                <button className="next-preview" onClick={() => step("next")}>
                  <SlideView slide={slides[index + 1]} small />
                  <span>
                    {slides[index + 1].title.replace(/\n/g, " ")}
                    <ChevronRight size={15} />
                  </span>
                </button>
              ) : (
                <div className="last-slide">
                  <Check size={22} />
                  <span>Финальный слайд</span>
                </div>
              )}
            </div>
          </div>
        </section>
        <aside className="control-panel">
          <section className="timer-panel">
            <div className="panel-heading">
              <Clock3 size={17} />
              <span>Время выступления</span>
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
                {stage === "finished" ? "Начать снова" : "Начать выступление"}
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
          {apiEnabled && (
            <section className="target-panel">
              <div className="panel-heading">
                <Presentation size={17} />
                <span>Где листать слайды</span>
                <span
                  className={`bridge-state ${bridgeOnline ? "online" : ""}`}
                >
                  {bridgeOnline ? "МОСТ" : "НЕТ МОСТА"}
                </span>
              </div>
              {bridgeOnline ? (
                <>
                  <div className="target-row">
                    <select
                      aria-label="Приложение со слайдами"
                      value={chosenTarget}
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
                      <select
                        aria-label="Приложение для стрелок"
                        value={chosenApp}
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
                    )}
                    <button
                      className="button secondary"
                      disabled={chosenTarget === "frontmost" && !chosenApp}
                      onClick={() => {
                        bridge.current
                          ?.connectTarget(
                            chosenTarget,
                            chosenTarget === "frontmost"
                              ? chosenApp
                              : undefined,
                          )
                          .then(refreshTargets)
                          .catch((error: Error) => setNotice(error.message));
                      }}
                    >
                      <Plug size={16} />
                      Подключить
                    </button>
                  </div>
                  <p
                    className={`target-status ${slideTarget?.error ? "error" : ""}`}
                  >
                    {slideTarget?.error ??
                      describeTarget(slideTarget, estimated)}
                  </p>
                </>
              ) : (
                <p className="target-status">
                  Запусти npm run server, чтобы листать Keynote, PowerPoint или
                  Google Slides. Колода PitchFlow работает и без него.
                </p>
              )}
            </section>
          )}
          <section className="camera-panel">
            <div className="panel-heading">
              <Camera size={17} />
              <span>Камера и жесты</span>
              {cameraStatus === "ready" && (
                <span className="camera-fps">{cameraFps} FPS</span>
              )}
            </div>
            <p className="camera-description">
              3D-аватар в чёлке повторит движения головы и ладоней. Камера
              обрабатывается на устройстве.
            </p>
            <button
              className={`button ${cameraStatus === "ready" ? "secondary" : "primary"} full`}
              onClick={() => {
                if (cameraStatus === "ready" || cameraStatus === "loading")
                  cameraStop();
                else {
                  restartTutorial();
                  void cameraStart();
                }
              }}
            >
              {cameraStatus === "loading" ? (
                <LoaderCircle className="spin" size={17} />
              ) : cameraStatus === "ready" ? (
                <CameraOff size={17} />
              ) : (
                <Camera size={17} />
              )}
              {cameraStatus === "loading"
                ? "Отменить подключение"
                : cameraStatus === "ready"
                  ? "Выключить камеру"
                  : "Включить камеру"}
            </button>
            {cameraError && (
              <p className="camera-error" role="alert">
                {cameraError}
              </p>
            )}
            {cameraStatus === "ready" && (
              <>
                <div className="camera-live-label">
                  <span className="status-light" />
                  Камера подключена
                  <button
                    className="icon-button mini"
                    aria-label="Повторить обучение"
                    onClick={restartTutorial}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
                {tutorialVisible && (
                  <div className="tutorial">
                    <div className="tutorial-top">
                      <span>БЫСТРОЕ ОБУЧЕНИЕ</span>
                      <span>{Math.min(tutorial + 1, 4)} / 4</span>
                    </div>
                    <h3>{steps[tutorial]}</h3>
                    <p>{instructions[tutorial]}</p>
                    <div className="tutorial-track">
                      <span
                        style={{
                          width: `${tutorial === 0 ? calibration * 25 : tutorial * 25}%`,
                        }}
                      />
                    </div>
                    {tutorial === 4 ? (
                      <button
                        className="text-button"
                        onClick={() => {
                          setTutorialVisible(false);
                          applyLock(false);
                          engine.current.reset();
                        }}
                      >
                        <Check size={15} />
                        Готово
                      </button>
                    ) : (
                      <button
                        className="text-button muted"
                        onClick={() => {
                          setTutorialVisible(false);
                          engine.current.reset();
                        }}
                      >
                        Пропустить обучение
                      </button>
                    )}
                  </div>
                )}
                <label className="sensitivity" htmlFor="sensitivity">
                  <span>
                    Размах жеста{" "}
                    <span>
                      {sensitivity < 0.8
                        ? "малый"
                        : sensitivity > 1
                          ? "большой"
                          : "обычный"}
                    </span>
                  </span>
                  <input
                    id="sensitivity"
                    type="range"
                    min={0.55}
                    max={1.15}
                    step={0.05}
                    value={sensitivity}
                    onChange={(event) =>
                      setSensitivity(Number(event.target.value))
                    }
                  />
                </label>
                <button
                  className="button secondary full"
                  onClick={() => {
                    applyLock(!locked);
                    engine.current.reset();
                  }}
                >
                  {locked ? (
                    <UnlockKeyhole size={16} />
                  ) : (
                    <LockKeyhole size={16} />
                  )}
                  {locked ? "Включить жесты" : "Заблокировать жесты"}
                </button>
              </>
            )}
            <div className="gesture-guide">
              <div>
                <ArrowRight size={16} />
                <span>Ладонь вправо</span>
                <span>Далее</span>
              </div>
              <div>
                <ArrowLeft size={16} />
                <span>Ладонь влево</span>
                <span>Назад</span>
              </div>
              <div>
                <Hand size={16} />
                <span>Ладонь 1,5 сек.</span>
                <span>Блок</span>
              </div>
            </div>
            <p className="gesture-tip">
              <CircleHelp size={14} />
              Подними руку до плеча. После команды опусти её.
            </p>
          </section>
        </aside>
      </div>
      <footer className="workspace-footer">
        <span>
          <LockKeyhole size={13} />
          Камера и PDF остаются на устройстве
        </span>
        <span>
          {overlayVisible
            ? "Чёлка видна и на экране аудитории"
            : cameraStatus === "ready"
              ? "Чёлка видна только на экране спикера"
              : "Можно начать с демо-слайдов или своего PDF"}
        </span>
      </footer>
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
    </main>
  );
}

export default function App() {
  return new URLSearchParams(location.search).has("audience") ? (
    <Audience />
  ) : (
    <Presenter />
  );
}
