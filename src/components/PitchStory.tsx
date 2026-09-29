import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, FileText, Hand, LockKeyhole, RotateCcw, Upload, UnlockKeyhole } from "lucide-react";
import { Metric } from "./PitchShowcase";
import { PixelCompanion } from "./PixelCompanion";
import type { CompanionAction } from "./PixelCompanion";
import { demoSlides as baseDemoSlides } from "../lib/deck";

const demoTitles = ["Твоя история. Твоя сцена.", "Свобода движения.", "Один жест. Следующий слайд.", "Помощник рядом.", "В твоём ритме."];
const demoSlides = baseDemoSlides.map((slide, index) => ({ ...slide, title: demoTitles[index], image: `/demo-deck/slide-${index + 1}.jpg` }));

const chapters = [
  { id: "story-deck", label: "Презентация", title: "Твоя презентация.", caption: "Слайды — зрителям. Заметки — тебе.", action: "point" as CompanionAction },
  { id: "story-gestures", label: "Жесты", title: "Листай рукой.", caption: "Вправо — следующий слайд.", action: "next" as CompanionAction },
  { id: "story-coaching", label: "Подсказки", title: "Попробуй ещё.", caption: "Проведи ладонью чуть дальше.", action: "open-palm" as CompanionAction },
  { id: "story-results", label: "Итоги", title: "Получилось!", caption: "Посмотрим на твой ритм?", action: "success" as CompanionAction },
];
const seconds = [52, 68, 44, 72, 36];
type DemoCommand = "next" | "previous" | "hold" | "open-palm";
const gestureCaptions: Record<DemoCommand, string> = {
  next: "Вправо — дальше.", previous: "Влево — назад.",
  hold: "Удержи ладонь 1,5 секунды.", "open-palm": "Пять пальцев. Ладонь к камере.",
};

function useMobileStory() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

function StoryDeck({ index, direction = 1, reduced }: { index: number; direction?: number; reduced: boolean }) {
  const slide = demoSlides[index];
  return <div className="story-canvas story-pdf-canvas" aria-label={`Слайд ${index + 1} из 5`}>
    <AnimatePresence initial={false} custom={direction}>
      <motion.article key={slide.id} custom={direction} className="story-canvas-slide"
        variants={{ enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 100 }), exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : -d * 80 }) }}
        initial="enter" animate={{ opacity: 1, x: 0 }} exit="exit" transition={{ duration: reduced ? 0 : .55, ease: [.22, 1, .36, 1] }}>
        <img className="story-pdf-page" src={slide.image} alt={slide.title} width={1376} height={768} draggable={false} decoding="async" />
      </motion.article>
    </AnimatePresence>
  </div>;
}

function SlideTimeline({ index }: { index: number }) {
  return <div className="story-slide-timeline" aria-label="Положение в презентации">{demoSlides.map((slide, i) => <div key={slide.id} className={i === index ? "current" : i < index ? "visited" : ""}><i /><span>0{i + 1}</span></div>)}</div>;
}

function PresentationScene({ reduced }: { reduced: boolean }) {
  return <div className="story-upload-scene">
    <div className="story-import-stage">
      <div className="story-paper-stack" aria-hidden="true">
        {[2, 1].map(i => <motion.div key={i} className="story-paper-back" initial={reduced ? false : { y: 0, rotate: 0 }} animate={{ y: -i * 16, rotate: i === 2 ? -5 : 3 }} transition={{ duration: .9, delay: .2 }} />)}
      </div>
      <motion.div className="story-import-preview" initial={reduced ? false : { y: 40, opacity: 0, scale: .94 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ duration: .9, ease: [.22, 1, .36, 1] }}><StoryDeck index={0} reduced={reduced} /></motion.div>
      <motion.div className="story-file-token" initial={reduced ? false : { y: 25, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: reduced ? 0 : .65, duration: .6 }}><span className="story-file-icon"><FileText size={23} /></span><span>Axiompitch.pdf</span><motion.span initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: reduced ? 0 : 1.2 }}><Check size={18} /></motion.span></motion.div>
    </div>
    <div className="story-import-bottom"><Upload size={17} /><div>{demoSlides.map((slide, i) => <motion.i key={slide.id} initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: reduced ? 0 : .5 + i * .12, duration: .4 }} />)}</div></div>
  </div>;
}

/** A visible gesture path connects the hand movement to the slide change. */
function GestureTrace({ command, running, replay, reduced, short = false }: { command: DemoCommand; running: boolean; replay: number; reduced: boolean; short?: boolean }) {
  const stationary = command === "hold" || command === "open-palm";
  const start = command === "previous" ? 95 : -95;
  const end = command === "previous" ? -95 : short ? -55 : 95;
  return <div className={`story-gesture-trace ${running ? "running" : ""}`} aria-hidden="true">
    <ArrowLeft size={15} className="trace-end" /><i className="trace-path" /><ArrowRight size={15} className="trace-end" />
    <motion.div key={`${command}-${replay}-${running}`} className="trace-hand" initial={reduced || stationary || !running ? false : { x: start }} animate={{ x: reduced || stationary || !running ? 0 : end }} transition={{ duration: 1.25, ease: [.4, 0, .2, 1] }}>
      {command === "hold" && running && <svg viewBox="0 0 60 60" className="trace-hold"><motion.circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : 1.5, ease: "linear" }} /></svg>}
      <Hand size={26} strokeWidth={1.3} />
    </motion.div>
  </div>;
}

function GestureScene({ active, reduced, onAction }: { active: boolean; reduced: boolean; onAction: (action: CompanionAction) => void }) {
  const [slide, setSlide] = useState(1);
  const [direction, setDirection] = useState(1);
  const [locked, setLocked] = useState(false);
  const [command, setCommand] = useState<DemoCommand>("next");
  const [attempt, setAttempt] = useState(0);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState("Попробуй жест");
  const perform = useCallback((next: DemoCommand) => { setCommand(next); setAttempt(v => v + 1); onAction(next); }, [onAction]);
  useEffect(() => {
    if (!active || reduced) return;
    const timer = window.setTimeout(() => perform("next"), 1100);
    return () => window.clearTimeout(timer);
  }, [active, reduced, perform]);
  useEffect(() => {
    if (!active || !attempt) return;
    setMoving(true);
    setNotice(gestureCaptions[command]);
    const apply = () => {
      if (command === "hold") {
        setLocked(v => !v);
        setNotice(locked ? "Жесты включены" : "Жесты на паузе");
      } else if (command === "next" || command === "previous") {
        const delta = command === "next" ? 1 : -1;
        setDirection(delta); setSlide(v => (v + delta + 5) % 5);
        setNotice(command === "next" ? "Следующий слайд" : "Предыдущий слайд");
      }
    };
    if (reduced) { apply(); setMoving(false); return; }
    const applyTimer = window.setTimeout(apply, command === "hold" ? 1500 : 1250);
    const endTimer = window.setTimeout(() => setMoving(false), 2100);
    return () => { clearTimeout(applyTimer); clearTimeout(endTimer); setMoving(false); };
    // The lock state is captured when the command starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, active, reduced]);
  return <div className="story-gesture-scene">
    <div className="story-workspace-heading"><span><Hand size={16} />Управляй движением</span></div>
    <StoryDeck index={slide} direction={direction} reduced={reduced} /><SlideTimeline index={slide} />
    <div className="story-motion-feedback"><GestureTrace command={command} running={moving} replay={attempt} reduced={reduced} /><div className={`story-command-status ${locked ? "locked" : ""}`} aria-live="polite"><span>{moving ? "ДВИЖЕНИЕ" : "РЕЗУЛЬТАТ"}</span><p>{notice}</p></div></div>
    <div className="story-command-controls" aria-label="Попробовать команды в демо">
      <button className={command === "previous" ? "selected" : ""} onClick={() => perform("previous")} disabled={moving || locked} aria-label="Показать жест: предыдущий слайд"><ArrowLeft size={19} /></button>
      <button className={command === "next" ? "selected" : ""} onClick={() => perform("next")} disabled={moving || locked} aria-label="Показать жест: следующий слайд"><ArrowRight size={19} /></button>
      <button className={command === "hold" ? "selected" : ""} onClick={() => perform("hold")} disabled={moving} aria-label={locked ? "Показать жест: включить управление" : "Показать жест: заблокировать управление"}>{locked ? <UnlockKeyhole size={18} /> : <LockKeyhole size={18} />}</button>
      <button onClick={() => perform("open-palm")} disabled={moving} aria-label="Раскрыть ладонь"><Hand size={19} /></button>
    </div>
  </div>;
}

function ResultsScene({ reduced }: { reduced: boolean }) {
  return <div className="story-results-scene">
    <div className="story-workspace-heading"><span><Check size={16} />Репетиция завершена</span><span>Axiompitch.pdf</span></div>
    <div className="story-result-title"><h4>Время<br /><span>по слайдам</span></h4><div className="story-total"><Metric value={272} time reduced={reduced} /><span>время выступления</span></div></div>
    <div className="story-chart" aria-label="Время по слайдам: 52, 68, 44, 72 и 36 секунд">{seconds.map((value, index) => <div key={index}><span>{value} с</span><div><motion.i initial={{ height: reduced ? `${value / 72 * 100}%` : 0 }} animate={{ height: `${value / 72 * 100}%` }} transition={{ duration: .9, delay: index * .12, ease: [.22, 1, .36, 1] }} className={index === 3 ? "peak" : ""} /></div><span>Слайд 0{index + 1}</span></div>)}</div>
    <div className="story-result-metrics"><span><Metric value={8} reduced={reduced} /><span>точных команд</span></span><span><Metric value={2} reduced={reduced} /><span>подсказки</span></span><span><strong>05</strong><span>слайдов</span></span></div>
    <p className="story-result-insight">Слайд 04 — оставь одну главную мысль.</p>
  </div>;
}

function CoachingScene({ active, reduced, onAction }: { active: boolean; reduced: boolean; onAction: (action: CompanionAction) => void }) {
  const [phase, setPhase] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [slide, setSlide] = useState(2);
  useEffect(() => {
    if (!active || reduced) return;
    // Keep the supplied four-second companion clips intact across each demonstration.
    if (phase !== 1) onAction(phase === 3 ? "success" : phase === 2 ? "next" : "open-palm");
    const accepted = phase === 2 ? window.setTimeout(() => setSlide(3), 1250) : undefined;
    const timer = window.setTimeout(() => { setPhase(v => (v + 1) % 4); if (phase === 3) { setCycle(v => v + 1); setSlide(2); } }, [1400, 2800, 4000, 4000][phase]);
    return () => { clearTimeout(timer); clearTimeout(accepted); };
  }, [active, reduced, phase, cycle, onAction]);
  const shown = reduced ? 1 : phase;
  const fixed = shown === 3 || (shown === 2 && slide === 3);
  const caption = fixed ? "Отлично. Слайд переключён." : shown === 2 ? "Вот так — чуть шире." : "Проведи ладонью дальше вправо.";
  return <div className="story-coaching-scene">
    <div className="story-coach-stage">
      <div className="story-coach-preview"><StoryDeck index={fixed ? 3 : 2} reduced={reduced} /></div>
      <div className={`story-swipe-strip swipe-${fixed ? 3 : shown}`} aria-label="Демонстрация движения руки в кадре камеры">
        <span className="story-swipe-trail" aria-hidden="true" />
        <span className={`story-swipe-hand ${fixed ? "accepted" : ""}`} aria-hidden="true"><Hand strokeWidth={1.3} /></span>
      </div>
      <div className="story-coach-space">
        <AnimatePresence mode="wait"><motion.div key={fixed ? "accepted" : "hint"} className={`story-hint ${fixed ? "accepted" : ""}`} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .3 }} aria-live="polite"><small>{fixed ? "ПОЛУЧИЛОСЬ" : "ПОДСКАЗКА"}</small><p>{caption}</p></motion.div></AnimatePresence>
      </div>
    </div>
  </div>;
}

function StoryScreen({ chapter, active, reduced, onAction }: { chapter: number; active: boolean; reduced: boolean; onAction: (action: CompanionAction) => void }) {
  return <div className="story-window" data-story-screen={chapter}>
    {chapter === 0 && <PresentationScene reduced={reduced} />}
    {chapter === 1 && <GestureScene active={active} reduced={reduced} onAction={onAction} />}
    {chapter === 2 && <CoachingScene active={active} reduced={reduced} onAction={onAction} />}
    {chapter === 3 && <ResultsScene reduced={reduced} />}
  </div>;
}

export function PitchStory() {
  const [active, setActive] = useState(0);
  const [reaction, setReaction] = useState<{ chapter: number; action: CompanionAction; replay: number }>({ chapter: 0, action: "point", replay: 0 });
  const [replay, setReplay] = useState(0);
  const reduced = !!useReducedMotion();
  const mobile = useMobileStory();
  const root = useRef<HTMLDivElement>(null);
  const onGesture = useCallback((action: CompanionAction) => setReaction(v => ({ chapter: active, action, replay: v.replay + 1 })), [active]);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const elements = root.current?.querySelectorAll<HTMLElement>("[data-story-chapter]");
      if (!elements?.length) return;
      const line = window.innerHeight * (mobile ? .25 : .48);
      let closest = Infinity, selected = 0;
      elements.forEach((element, index) => { const rect = element.getBoundingClientRect(); const distance = rect.top > line ? rect.top - line : rect.bottom < line ? line - rect.bottom : 0; if (distance < closest) { closest = distance; selected = index; } });
      setActive(v => v === selected ? v : selected);
    };
    const scroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); window.addEventListener("scroll", scroll, { passive: true }); window.addEventListener("resize", scroll);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll); };
  }, [mobile]);
  const jump = (index: number) => document.getElementById(chapters[index].id)?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
  const current = chapters[active];
  const renderCopy = (index: number) => {
    const chapter = chapters[index];
    const reacting = reaction.chapter === index;
    const action = reacting ? reaction.action : chapter.action;
    const caption = reacting && index === 1 ? gestureCaptions[action as DemoCommand] : reacting && index === 2 && action === "success" ? "Вот так! Получилось." : chapter.caption;
    return <div className="story-chapter-copy">
      <p className="story-chapter-number"><span>0{index + 1}</span> / {chapter.label.toUpperCase()}</p>
      <h3>{chapter.title.split("\n").map(line => <span key={line}>{line}</span>)}</h3>
      <div className="story-guide"><PixelCompanion action={action} replay={replay + (reacting ? reaction.replay : 0)} enabled={active === index} /><div><p>{caption}</p><button onClick={() => setReplay(v => v + 1)} disabled={active !== index} aria-label={`Повторить анимацию: ${chapter.label}`}><RotateCcw size={15} /></button></div></div>
    </div>;
  };
  return <div className="pitch-story" id="demo-panel" ref={root}>
    <div className="story-navigation" aria-label="Этапы демонстрации">{chapters.map((chapter, index) => <button key={chapter.id} onClick={() => jump(index)} aria-current={active === index ? "step" : undefined} className={active === index ? "active" : ""}><span>0{index + 1}</span>{chapter.label}<i /></button>)}</div>
    {mobile ? <div className="story-mobile-sections">{chapters.map((chapter, index) => <article key={chapter.id} id={chapter.id} className="story-chapter" data-story-chapter={index}>{renderCopy(index)}<StoryScreen chapter={index} active={active === index} reduced={reduced || active !== index} onAction={onGesture} /></article>)}</div> : <div className="story-scroll-track">
      <div className="story-sticky-stage"><div className="story-stage-layout">
        <AnimatePresence mode="wait" initial={false}><motion.div key={active} initial={reduced ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -18 }} transition={{ duration: reduced ? 0 : .35 }}>{renderCopy(active)}</motion.div></AnimatePresence>
        <AnimatePresence mode="wait" initial={false}><motion.div key={active} className="story-stage-visual" initial={reduced ? false : { opacity: 0, y: 30, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : -24 }} transition={{ duration: reduced ? 0 : .45, ease: [.22, 1, .36, 1] }}><StoryScreen chapter={active} active reduced={reduced} onAction={onGesture} /></motion.div></AnimatePresence>
      </div><div className="story-stage-progress"><div>{chapters.map((chapter, i) => <button key={chapter.id} onClick={() => jump(i)} aria-label={`Перейти: ${chapter.label}`} aria-current={active === i ? "step" : undefined}><i className={active === i ? "current" : i < active ? "done" : ""} /></button>)}</div><span>0{active + 1} / 04 · {current.label}</span></div></div>
      <div className="story-scroll-anchors">{chapters.map((chapter, index) => <div key={chapter.id} id={chapter.id} className="story-scroll-anchor" data-story-chapter={index} aria-hidden="true" />)}</div>
    </div>}
  </div>;
}
