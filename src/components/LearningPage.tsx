import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Camera, CameraOff, Check, Hand, LoaderCircle, RotateCcw } from "lucide-react";
import { Avatar } from "./Avatar";
import { TeachingCompanion } from "./TeachingCompanion";
import type { AvatarHandle } from "./Avatar";
import { PitchBrand } from "./Landing";
import { useCamera } from "../hooks/useCamera";
import { GestureEngine, isOpenPalm, isVisibleHand } from "../lib/gestures";
import { advanceAfterSuccess, applyPracticeGesture, createPractice, expectedGesture, goodLearningHands, lessons, practiceFeedback } from "../lib/learning";
import type { AdvanceGate, Practice } from "../lib/learning";
import type { Feedback, VisionFrame } from "../lib/types";
import "../learning.css";

const slideTitles = ["Твоя история. Твоя сцена.", "Свобода движения.", "Один жест. Следующий слайд.", "Помощник рядом.", "В твоём ритме."];
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
  const [demoSequence, setDemoSequence] = useState(0);
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
    setDemoSequence(0);
    demoUntil.current = autoplay && nextStep < 6 ? performance.now() + (nextStep === 5 ? 13800 : 4600) : 0;
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
      if (transition.ready && frame.time - advanceGate.current.completedAt >= 2400) moveToStep(atStep + 1, true);
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
        setFeedback(practiceFeedback(atStep, state.sequence, result));
        return;
      }
      avatar.current?.react(result.gesture);
      finish(next, atStep, frame.time, frame.hands);
      if (!next.passed) {
        miniSuccessUntil.current = frame.time + 1400;
        setFeedback({ kind: "success", message: `Есть! ${next.sequence} из 3. Продолжай следующим движением.` });
      }
    } else if (frame.time >= miniSuccessUntil.current) {
      setFeedback(practiceFeedback(atStep, state.sequence, result));
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
    if (active || practice.passed || reduced || ![1, 2, 5].includes(step)) return;
    let phase = 0;
    const interval = window.setInterval(() => {
      phase = (phase + 1) % (step === 5 ? 6 : 2);
      if (step === 5) {
        setDemoSequence(Math.floor(phase / 2));
        setDemoSlide([0, 1, 1, 2, 2, 1][phase]);
      } else setDemoSlide(step === 1 ? phase : 1 - phase);
    }, 2300);
    return () => window.clearInterval(interval);
  }, [step, active, practice.passed, reduced, replay]);

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
    demoUntil.current = runningRef.current ? performance.now() + (step === 5 ? 13800 : 4600) : 0;
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
    setDemoSequence(0);
    setFeedback({ kind: "idle", message: "Посмотри ещё раз. Потом повторим вместе." });
  };
  const visibleSlide = active || practice.passed ? practice.slide : demoSlide;
  const passed = practice.passed;
  const holdStep = step === 3 || step === 4;

  const coursePassed = [0, 1, 2, 3, 4, 5].every(stage => verified.has(stage));
  const titles = ["Покажи открытую ладонь", "Переключи слайд вперёд", "Верни предыдущий слайд", "Выключи управление жестами", "Включи управление снова", "Попробуй три движения подряд", coursePassed ? "Обучение пройдено" : "Все жесты в одном месте"];
  const instructions = [
    ["Открой ладонь к камере.", "Держи всю кисть в кадре около секунды."],
    ["Раскрой ладонь.", "Проведи вправо → одним движением."],
    ["Раскрой ладонь.", "Проведи влево ← одним движением."],
    ["Открой ладонь и замри на 1,5 секунды.", "После подтверждения расслабь пальцы."],
    ["Снова раскрой ладонь на 1,5 секунды.", "После подтверждения расслабь пальцы."],
    ["Вправо → ещё раз вправо → влево.", "Руку можно оставлять в кадре."],
    [coursePassed ? "Все упражнения выполнены." : "Примеры не заменяют практику.", "Продолжи в студии."],
  ][step];
  const phase = passed ? "Получилось" : active ? "Твой ход" : step === 6 ? "Итоги" : "Смотри пример";
  const expected = expectedGesture(step, active || passed ? practice.sequence : demoSequence);
  const exampleHint = step === 0 ? "Открой ладонь к камере. Кисть целиком в кадре."
    : holdStep ? "Замри на 1,5 секунды. После сигнала расслабь пальцы."
    : step === 5 ? `Движение ${demoSequence + 1} из 3: ${expected === "previous" ? "ладонь влево ←" : "ладонь вправо →"}.`
    : expected === "previous" ? "Открытая ладонь влево ←. Слайд вернётся назад."
    : "Открытая ладонь вправо →. Слайд переключится вперёд.";
  const guidance = cameraError || (passed || active ? feedback.message : step === 6 ? "Продолжай в своём темпе." : exampleHint);
  const holdProgress = active ? feedback.progress ?? 0 : passed ? 1 : 0;

  const primaryAction = step < 6 ? <button className="learn-primary" onClick={passed ? () => moveToStep(step + 1, runningRef.current) : begin}>{passed ? <Check size={17} /> : cameraStatus === "loading" ? <LoaderCircle className="spin" size={17} /> : <Hand size={17} />}{passed ? "Следующее упражнение" : cameraStatus === "loading" ? "Отменить подключение" : active ? "Начать попытку заново" : cameraStatus === "ready" ? "Теперь мой ход" : "Попробовать с камерой"}</button> : <button className="learn-primary" onClick={onEnterStudio}>Перейти в студию <ArrowRight size={17} /></button>;

  return <div className="learning-page">
    <header className="learning-header">
      <a className="learning-brand" href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <span className="learning-header-title">Обучение жестам</span>
      <a className="learn-exit" href="/studio" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onEnterStudio(); } }}>В студию <ArrowRight size={16} /></a>
    </header>
    <main className="learning-main">
      <div className="learning-course-heading"><span>6 ПРОСТЫХ УПРАЖНЕНИЙ</span><span>{verified.size} из 6 выполнено</span></div>
      <nav className="learning-steps" aria-label="Этапы обучения">
        {lessons.slice(0, 6).map((item, i) => <button key={item.label} className={`${i === step ? "current" : ""} ${verified.has(i) ? "verified" : ""}`} onClick={() => chooseStep(i)} aria-label={`Этап ${i + 1}: ${item.label}${verified.has(i) ? ", выполнен" : ""}`} aria-current={i === step ? "step" : undefined}><span>{verified.has(i) ? <Check size={15} /> : i + 1}</span><strong>{["Ладонь", "Вперёд", "Назад", "Пауза жестов", "Вернуть жесты", "Мини-питч"][i]}</strong></button>)}
      </nav>
      <div className="learning-title-row"><div><span className="learning-eyebrow">{step < 6 ? `ЭТАП ${step + 1} ИЗ 6` : "МОЖНО ПРОДОЛЖАТЬ"}</span><h1>{titles[step]}</h1></div><span className={`learning-mode ${active ? "practice" : passed ? "done" : ""}`}>{phase}</span></div>
      <div className="learning-mobile-action">{primaryAction}</div>
      <div className="learning-workspace">
        <section className="learning-stage" aria-label="Демонстрация жеста">
          <div className={`learning-feedback ${cameraError ? "error" : feedback.kind}`} role="status" aria-live="polite" aria-atomic="true"><span className="learning-feedback-icon">{passed ? <Check size={19} /> : feedback.kind === "error" || cameraError ? <Hand size={19} /> : <span className="learn-status-dot" />}</span><div><strong>{cameraError ? "Камера не подключилась" : passed ? "Жест принят" : active ? "Твой ход" : "Пример"}</strong><p>{guidance}</p>{active && feedback.progress !== undefined && <div className="learning-feedback-progress"><span style={{ width: `${holdProgress * 100}%` }} /></div>}</div></div>
          <div className="learning-avatar"><Avatar transitionName="speaker" key={replay} ref={avatar} locked={practice.locked} face="none" headStyle="ghost" /></div>
          <div className="learning-stage-bottom">
            <aside className={`learning-camera ${cameraOn ? "on" : ""}`} aria-label="Твой кадр"><div className="learning-camera-header"><span><i />{cameraStatus === "ready" ? handDetected ? "Ладонь в кадре" : "Покажи ладонь" : "Твой кадр"}</span>{cameraOn && <button onClick={() => { pendingPractice.current = false; cameraStop(); }} aria-label="Выключить камеру"><CameraOff size={14} /></button>}</div><div className="learning-camera-view"><video ref={videoRef} className={cameraStatus === "ready" ? "visible" : ""} muted playsInline aria-hidden={cameraStatus !== "ready"} aria-label="Зеркальное превью камеры" />{cameraStatus !== "ready" && <button onClick={begin} aria-label={cameraStatus === "loading" ? "Отменить подключение камеры" : "Включить камеру"}>{cameraStatus === "loading" ? <LoaderCircle className="spin" size={20} /> : <Camera size={20} />}<span>{cameraStatus === "loading" ? "Подключаем…" : "Включить камеру"}</span></button>}</div></aside>
            <div className="learning-presentation" aria-label="Учебная презентация"><span className="learning-preview-label">{practice.locked ? "Жесты выключены" : "Твоя презентация"}</span><div className="learning-slide"><motion.img key={visibleSlide} src={`/demo-deck/slide-${visibleSlide + 1}.jpg`} alt={slideTitles[visibleSlide]} initial={reduced ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} /></div><span className="learning-slide-count">{visibleSlide + 1} / {slideTitles.length}</span></div>
          </div>
        </section>
        <aside className="learning-instructions" aria-label="Как выполнить упражнение"><TeachingCompanion key={`${step}-${replay}-${demoSequence}`} gesture={expected} playing={!active && !passed && step < 6} /><div className="learning-instruction-heading"><span>{step < 6 ? "КАК СДЕЛАТЬ" : "ЧТО ДАЛЬШЕ"}</span><span>{holdStep ? "1,5 сек." : "Одна ладонь"}</span></div><ol>{instructions.map((instruction, i) => <li key={`${step}-${i}`}><span>{i + 1}</span><p>{instruction}</p></li>)}</ol>
          {step === 5 && <div className="learning-sequence" aria-label="Последовательность мини-репетиции">{["Вперёд", "Вперёд", "Назад"].map((label, i) => <span key={i} className={i < practice.sequence ? "done" : i === (active || passed ? practice.sequence : demoSequence) ? "current" : ""}>{i < practice.sequence ? <Check size={14} /> : i === 2 ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}{label}</span>)}</div>}
          <div className="learning-actions">{step < 6 ? <>{primaryAction}<button className="learn-secondary" onClick={showExample}><RotateCcw size={15} />Повторить пример</button>{running && <button className="learn-next-example" onClick={pausePractice}>Приостановить практику</button>}</> : <><button className="learn-primary" onClick={onEnterStudio}>Перейти в студию <ArrowRight size={17} /></button><button className="learn-secondary" onClick={() => { setVerified(new Set()); chooseStep(0); }}>Пройти ещё раз</button></>}</div><p className="learning-privacy">Камера остаётся на устройстве.</p>
        </aside>
      </div>
    </main>
  </div>;
}
