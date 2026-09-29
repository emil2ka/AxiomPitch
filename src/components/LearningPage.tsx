import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Camera, CameraOff, Check, Hand, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { Avatar } from "./Avatar";
import { PixelCompanion } from "./PixelCompanion";
import type { CompanionAction } from "./PixelCompanion";
import type { AvatarHandle } from "./Avatar";
import { PitchBrand } from "./Landing";
import { useCamera } from "../hooks/useCamera";
import { GestureEngine, isOpenPalm, isVisibleHand } from "../lib/gestures";
import { advanceAfterSuccess, applyPracticeGesture, createPractice, expectedGesture, goodLearningHands, lessons } from "../lib/learning";
import type { AdvanceGate, Practice } from "../lib/learning";
import type { Feedback, VisionFrame } from "../lib/types";
import "../learning.css";

const slideTitles = ["Твоя история.", "Твой ритм.", "Твоя сцена."];
const successMessages = ["Ладонь вижу. Всё готово!", "Получилось. Слайд переключён.", "Отлично. Мы вернулись назад.", "Жесты выключены. Руки свободны.", "Снова в деле. Жесты включены.", "Ты справился. Можно на сцену."];

export function LearningPage({ onEnterStudio }: { onEnterStudio: () => void }) {
  const [step, setStep] = useState(0);
  const [practice, setPractice] = useState<Practice>(() => createPractice(0));
  const [active, setActive] = useState(false);
  const [sessionRunning, setRunning] = useState(false);
  const [verified, setVerified] = useState<Set<number>>(() => new Set());
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle", message: "Сначала познакомимся. Потом попробуем вместе." });
  const [replay, setReplay] = useState(0);
  const [demoSlide, setDemoSlide] = useState(0);
  const [handDetected, setHandDetected] = useState(false);
  const avatar = useRef<AvatarHandle>(null);
  const engine = useRef(new GestureEngine());
  const current = useRef({ step: 0, practice: createPractice(0), active: false });
  const calibration = useRef<number | null>(null);
  const pendingPractice = useRef(false);
  const miniSuccessUntil = useRef(0);
  const runningRef = useRef(false);
  const demoUntil = useRef(0);
  const advanceGate = useRef<AdvanceGate | null>(null);
  const reduced = !!useReducedMotion();
  const lesson = lessons[step];

  useEffect(() => {
    // Only a completed course auto-enters; browsing the last example does not.
    if (step !== 6 || ![0, 1, 2, 3, 4, 5].every(stage => verified.has(stage))) return;
    const timer = setTimeout(onEnterStudio, 1800);
    return () => clearTimeout(timer);
  }, [step, verified, onEnterStudio]);

  const moveToStep = useCallback((nextStep: number, autoplay = false) => {
    const next = createPractice(nextStep);
    current.current = { step: nextStep, practice: next, active: false };
    pendingPractice.current = false;
    calibration.current = null;
    advanceGate.current = null;
    engine.current.reset();
    setStep(nextStep);
    setPractice(next);
    setActive(false);
    setDemoSlide(nextStep === 2 ? 1 : 0);
    demoUntil.current = autoplay && nextStep < 6 ? performance.now() + 4600 : 0;
    if (nextStep === 6) { runningRef.current = false; setRunning(false); }
    setFeedback({ kind: "idle", message: autoplay ? "Сначала покажу. Затем твой ход — без кнопок." : "Посмотри движение. Потом повторим вместе." });
    avatar.current?.clear();
  }, []);

  const finish = useCallback((next: Practice, atStep: number, time: number, hands: VisionFrame["hands"]) => {
    current.current.practice = next;
    setPractice(next);
    if (next.passed) {
      advanceGate.current = { completedAt: time, releasedAt: null, releaseY: hands.find(isOpenPalm)?.[9].y };
      setVerified(previous => new Set(previous).add(atStep));
      setFeedback({ kind: "success", message: `${successMessages[atStep]} ${atStep === 0 ? "Идём дальше." : atStep === 3 || atStep === 4 ? "Расслабь пальцы или немного опусти ладонь — продолжим." : "Сейчас покажу следующий жест."}` });
      avatar.current?.setExpression("happy");
    }
  }, []);

  const onFrame = useCallback((frame: VisionFrame) => {
    setHandDetected(frame.hands.some(isVisibleHand));
    if (runningRef.current && demoUntil.current) {
      if (frame.time < demoUntil.current) return;
      demoUntil.current = 0;
      current.current.active = true;
      setActive(true);
      setFeedback({ kind: "idle", message: "Твой ход. Повтори движение." });
      avatar.current?.clear();
    }
    const { step: atStep, practice: state, active: practicing } = current.current;
    if (!practicing) return;
    avatar.current?.draw(frame);
    if (state.passed) {
      if (!advanceGate.current) return;
      const transition = advanceAfterSuccess(advanceGate.current, frame.hands, frame.time, atStep === 3 || atStep === 4);
      advanceGate.current = transition.gate;
      if (transition.ready) moveToStep(atStep + 1, true);
      return;
    }
    if (atStep === 0) {
      if (!goodLearningHands(frame.hands)) {
        calibration.current = null;
        setFeedback({ kind: "idle", message: "Покажи открытую ладонь целиком. Можно сидеть близко к камере.", progress: 0 });
        return;
      }
      calibration.current ??= frame.time;
      const progress = Math.min(1, (frame.time - calibration.current) / 800);
      if (progress === 1) finish({ ...state, passed: true }, 0, frame.time, frame.hands);
      else setFeedback({ kind: "progress", message: "Хорошо. Останься так на секунду.", progress });
      return;
    }
    const result = engine.current.update(frame.pose, frame.hands, frame.time, state.locked);
    if (result.kind === "success" && result.gesture) {
      const next = applyPracticeGesture(atStep, state, result.gesture);
      if (next === state) {
        setFeedback({ kind: "idle", message: expectedGesture(atStep, state.sequence) === "next" ? "Сейчас попробуй провести ладонью вправо." : expectedGesture(atStep, state.sequence) === "previous" ? "Сейчас попробуй провести ладонью влево." : "Сейчас удержи открытую ладонь 1,5 секунды." });
        return;
      }
      avatar.current?.react(result.gesture);
      finish(next, atStep, frame.time, frame.hands);
      if (!next.passed) {
        miniSuccessUntil.current = frame.time + 1400;
        setFeedback({ kind: "success", message: `Есть! ${next.sequence} из 3. Продолжай следующим движением.` });
      }
    } else if (frame.time >= miniSuccessUntil.current) {
      setFeedback(result);
      if (result.kind === "error") avatar.current?.setExpression("hint");
      else avatar.current?.setExpression("calm");
    }
  }, [finish, moveToStep]);
  const { status: cameraStatus, error: cameraError, videoRef, start: cameraStart, stop: cameraStop } = useCamera(onFrame);
  const cameraOn = cameraStatus === "ready" || cameraStatus === "loading";
  const running = sessionRunning && cameraStatus === "ready";

  const activatePractice = useCallback(() => {
    const atStep = current.current.step;
    if (atStep === 6) return;
    runningRef.current = true;
    setRunning(true);
    demoUntil.current = 0;
    advanceGate.current = null;
    const next = createPractice(atStep);
    current.current = { step: atStep, practice: next, active: true };
    setPractice(next);
    setActive(true);
    calibration.current = null;
    miniSuccessUntil.current = 0;
    engine.current.reset();
    avatar.current?.clear();
    avatar.current?.setExpression("calm");
    setFeedback({ kind: "idle", message: atStep === 0 ? "Покажи открытую ладонь." : "Повтори движение ладонью." });
  }, []);

  useEffect(() => {
    if (cameraStatus === "ready" && pendingPractice.current) {
      pendingPractice.current = false;
      activatePractice();
    } else if (cameraStatus === "off" || cameraStatus === "error") {
      pendingPractice.current = false;
      demoUntil.current = 0;
      runningRef.current = false;
      if (current.current.active) {
        current.current.active = false;
        setActive(false);
        setFeedback({ kind: "idle", message: "Практика остановлена. Можно посмотреть пример или подключить камеру снова." });
      }
    }
  }, [cameraStatus, activatePractice]);

  useEffect(() => {
    if (active || reduced || (step !== 1 && step !== 2)) return;
    let flipped = false;
    const interval = window.setInterval(() => {
      flipped = !flipped;
      setDemoSlide(step === 1 ? Number(flipped) : Number(!flipped));
    }, 2300);
    return () => window.clearInterval(interval);
  }, [step, active, reduced, replay]);

  const chooseStep = (nextStep: number) => moveToStep(nextStep, runningRef.current);
  const pausePractice = () => {
    runningRef.current = false;
    setRunning(false);
    demoUntil.current = 0;
    pendingPractice.current = false;
    current.current.active = false;
    setActive(false);
    avatar.current?.clear();
    setFeedback({ kind: "idle", message: "Пауза. Камера остаётся включённой." });
  };
  const begin = () => {
    if (cameraStatus === "ready") activatePractice();
    else if (cameraStatus === "loading") { pendingPractice.current = false; cameraStop(); }
    else { pendingPractice.current = true; void cameraStart(); }
  };
  const showExample = () => {
    demoUntil.current = runningRef.current ? performance.now() + 4600 : 0;
    advanceGate.current = null;
    engine.current.reset();
    current.current.active = false;
    setActive(false);
    const next = createPractice(step);
    current.current.practice = next;
    setPractice(next);
    avatar.current?.clear();
    setReplay(value => value + 1);
    setDemoSlide(step === 2 ? 1 : 0);
    setFeedback({ kind: "idle", message: "Посмотри ещё раз. Потом повторим вместе." });
  };
  const visibleSlide = active || practice.passed ? practice.slide : demoSlide;
  const passed = practice.passed;
  const holdStep = step === 3 || step === 4;
  const motionMode = active ? null : passed ? "success" : lesson.motion;

  const companionAction: CompanionAction = passed ? "success" : active ? "point" : (["hello", "next", "previous", "hold", "open-palm", "invite", "success"] as const)[step];
  const shortExplanation = [
    "Привет! Достаточно показать ладонь. Включи камеру — дальше я поведу тебя сам.",
    "Проведи открытой ладонью вправо — и слайд сменится. ",
    "Ладонь влево — возвращаемся на предыдущий слайд.",
    "Замри с открытой ладонью на 1,5 секунды. Теперь можно жестикулировать свободно.",
    "Раскрой и удержи ладонь — управление вернётся.",
    "Давай вместе: два раза вперёд, один назад. Руку можно оставлять в кадре.",
    "Ты готов. Загружай презентацию в студии — я буду рядом.",
  ][step];

  return <div className="learning-page">
    <header className="learning-header">
      <a className="learning-brand" href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <span className="learning-header-title">Знакомство с жестами</span>
      <a className="learn-exit" href="/studio" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onEnterStudio(); } }}>В студию <ArrowRight size={14} /></a>
    </header>
    <main className="learning-main">
      <section className="learning-stage" aria-label="Демонстрация жеста">
        <aside className={`learning-camera ${cameraOn ? "on" : ""}`} aria-label="Твой кадр">
          <div className="learning-camera-header"><span><i />{cameraStatus === "ready" ? handDetected ? "РУКУ ВИЖУ" : "ПОКАЖИ ЛАДОНЬ" : cameraStatus === "loading" ? "ПОДКЛЮЧАЕМ" : "ТВОЙ КАДР"}</span>{cameraOn && <button onClick={() => { pendingPractice.current = false; cameraStop(); }} aria-label="Выключить камеру"><CameraOff size={13} /></button>}</div>
          <div className="learning-camera-view">
            <video ref={videoRef} className={cameraStatus === "ready" ? "visible" : ""} muted playsInline aria-hidden={cameraStatus !== "ready"} aria-label="Зеркальное превью камеры" />
            <div className="learning-frame-guide" aria-hidden="true"><svg viewBox="0 0 180 120"><path d="M62 95V54Q62 47 68 47Q74 47 74 54V28Q74 20 80 20Q86 20 86 28V53V19Q86 11 92 11Q98 11 98 19V54V27Q98 19 104 19Q110 19 110 27V58V42Q110 35 116 35Q122 35 122 42V84Q122 106 102 109H87Q73 108 62 95L49 77Q43 67 50 63Q57 60 62 68Z" /></svg></div>
            {cameraStatus !== "ready" && <button onClick={begin} aria-label={cameraStatus === "loading" ? "Отменить подключение камеры" : "Включить камеру"}>{cameraStatus === "loading" ? <LoaderCircle className="spin" size={18} /> : <Camera size={18} />}<span>{cameraStatus === "loading" ? "Подключаем…" : "Включить камеру"}</span></button>}
          </div>
          {cameraError ? <p className="learning-camera-error" role="alert">{cameraError}</p> : <span className="learning-privacy">Только на твоём устройстве</span>}
        </aside>
        <div className={`learning-avatar ${holdStep ? "is-hold" : ""}`}>
          <Avatar transitionName="speaker" key={replay} ref={avatar} locked={practice.locked} face="none" headStyle="ghost" lesson={motionMode} />
          {holdStep && <svg className="learning-hold-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="none" stroke="#91c4ef12" strokeWidth="1" /><motion.circle key={`${step}-${active}`} cx="50" cy="50" r="45" fill="none" stroke="#a4d3f4" strokeWidth="1.5" strokeLinecap="round" style={{ rotate: -90, transformOrigin: "50px 50px" }} initial={false} animate={{ pathLength: active ? feedback.progress ?? 0 : passed ? 1 : reduced ? .65 : [0, 1, 1, 0] }} transition={{ duration: active ? .12 : passed || reduced ? 0 : 4.6, times: active || passed || reduced ? undefined : [0, .33, .75, 1], repeat: active || passed || reduced ? 0 : Infinity }} /></svg>}
          {!active && !passed && (step === 1 || step === 2) && <div className={`learning-direction ${step === 2 ? "backward" : ""}`} aria-hidden="true"><span /><motion.i animate={reduced ? { x: 0 } : { x: [-50, -50, 70, 70, -50] }} transition={{ duration: 4.6, times: [0, .2, .5, .73, 1], repeat: Infinity, ease: "easeInOut" }}><ArrowRight size={19} /></motion.i></div>}
        </div>
        <aside className="learning-companion">
          <PixelCompanion action={companionAction} replay={replay + step} />
          <span className="learning-companion-name">ТВОЙ КОМПАНЬОН</span>
          <motion.p key={step} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>{passed ? successMessages[step] : shortExplanation}</motion.p>
        </aside>
        <div className="learning-cue"><span className="learn-status-dot" />{passed ? "Получилось — идём дальше" : active ? "Повторяем вместе" : running ? "Сначала покажу движение" : lesson.cue}<button onClick={showExample} disabled={step === 6} aria-label="Повторить движение"><RotateCcw size={13} /></button></div>
      </section>
      <section className="learning-presentation" aria-label="Учебная презентация">
        <div className="learning-slide">
          <div className="learning-slide-top"><span>AXIOM / YOUR STORY</span><span>0{visibleSlide + 1} — 03</span></div>
          <motion.div className="learning-slide-copy" key={visibleSlide} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}><h2>{slideTitles[visibleSlide]}</h2><p>{["Всё начинается с одной идеи.", "Двигайся так, как тебе удобно.", "Рассказывай. Мы рядом."][visibleSlide]}</p></motion.div>
          <div className={`learning-slide-art slide-art-${visibleSlide}`} aria-hidden="true"><i /><i /><i /></div>
          <div className="learning-slide-bottom"><span>MAKE IT YOURS.</span><div className="learn-slide-dots">{slideTitles.map((title, i) => <i key={title} className={i === visibleSlide ? "selected" : ""} />)}</div></div>
        </div>
        {step === 5 && <div className="learning-sequence" aria-label="Последовательность мини-репетиции">{["Вперёд", "Вперёд", "Назад"].map((label, i) => <span key={i} className={i < practice.sequence ? "done" : i === practice.sequence ? "current" : ""}>{i < practice.sequence ? <Check size={12} /> : i === 2 ? <ArrowLeft size={12} /> : <ArrowRight size={12} />}{label}</span>)}</div>}
        <div className={`learning-feedback ${feedback.kind}`} role="status" aria-live="polite" aria-atomic="true">{running || active || passed ? feedback.message : ""}{active && feedback.progress !== undefined && <div><span style={{ width: `${feedback.progress * 100}%` }} /></div>}</div>
        <div className="learning-actions">
          {step < 6 ? <>
            <button className="learn-secondary" onClick={showExample}><Play size={13} />Пример</button>
            {!running && <button className="learn-primary" onClick={begin}>{cameraStatus === "loading" ? <LoaderCircle size={14} className="spin" /> : <Hand size={14} />}{cameraStatus === "loading" ? "Отменить" : cameraStatus === "ready" ? "Продолжить" : "Начать с камерой"}</button>}
            {running && <button className="learn-next-example" onClick={pausePractice}>Пауза</button>}
          </> : <><button className="learn-secondary" onClick={() => { setVerified(new Set()); chooseStep(0); }}><RotateCcw size={13} />Ещё раз</button><a className="learn-primary" href="/studio" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onEnterStudio(); } }}>В студию <ArrowRight size={14} /></a></>}
        </div>
      </section>
      <div className="learning-toolbar">
        <h1>{lesson.label}</h1>
        {running && <span className="learning-autopilot">Дальше — автоматически</span>}
        <nav className="learning-steps" aria-label="Этапы обучения">
          {lessons.map((item, i) => <button key={item.label} className={`${i === step ? "current" : ""} ${verified.has(i) ? "verified" : ""}`} onClick={() => chooseStep(i)} aria-label={`${String(i + 1).padStart(2, "0")} ${item.label}`} title={item.label} aria-current={i === step ? "step" : undefined}>{verified.has(i) ? <Check size={12} /> : String(i + 1).padStart(2, "0")}</button>)}
        </nav>
      </div>
    </main>
  </div>;
}
