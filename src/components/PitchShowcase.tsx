import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, CheckCheck, FileText, Hand, Pause, Play, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { demoSlides } from "../lib/deck";
import { sweepHandFrame } from "../lib/hand-demo";
import { Avatar } from "./Avatar";
import type { AvatarHandle } from "./Avatar";

const steps = [
  { label: "Презентация", title: "Любая история начинается с первого слайда.", text: "Презентация и главные мысли к ней — в одном пространстве. Дальше остаётся только выйти на сцену.", icon: FileText, tag: "СОБЕРИ СВОЮ ИСТОРИЮ" },
  { label: "Жесты", title: "Один жест. И история движется дальше.", text: "Смотри: помощник сам показывает движение. Вправо — дальше, влево — назад, удержание ладони освобождает руки.", icon: Hand, tag: "ТЫ УПРАВЛЯЕШЬ РИТМОМ" },
  { label: "Подсказки", title: "Не получилось? Уже знаешь, что поправить.", text: "Короткое движение превращается в понятную подсказку — и следующая попытка получается точной.", icon: Sparkles, tag: "ОБРАТНАЯ СВЯЗЬ, КОТОРАЯ ПОМОГАЕТ" },
  { label: "Итоги", title: "У каждого выступления есть свой ритм.", text: "Посмотри, на какие слайды ушло больше времени. Следующую репетицию можно построить ещё точнее.", icon: CheckCheck, tag: "ТВОЙ ПРОГРЕСС В ДЕТАЛЯХ" },
];
const durations = [52, 68, 44, 72, 36];

export function DemoDeck({ index, direction = 1, reduced = false }: { index: number; direction?: number; reduced?: boolean }) {
  const slide = demoSlides[index];
  return <div className="lab-deck">
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.article key={slide.id} custom={direction}
        variants={{ enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 38, scale: reduced ? 1 : .97 }), exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * -38, scale: reduced ? 1 : .97 }) }}
        initial="enter" animate={{ opacity: 1, x: 0, scale: 1 }} exit="exit"
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }} className="lab-deck-content">
        <div className="lab-deck-top"><span>AXIOM<span>PITCH</span></span><span>0{index + 1} / 05</span></div>
        <div><span className="lab-deck-eyebrow">{slide.eyebrow}</span><h4>{slide.title}</h4><p>{slide.body}</p></div>
        <div className="lab-deck-bottom"><span>ТВОЯ ИСТОРИЯ В ДВИЖЕНИИ</span><ArrowRight size={17} /></div>
      </motion.article>
    </AnimatePresence>
  </div>;
}

export function Metric({ value, time = false, reduced }: { value: number; time?: boolean; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return;
    const animation = animate(0, value, { duration: 1.1, ease: "easeOut", onUpdate: (current) => setShown(Math.round(current)) });
    return () => animation.stop();
  }, [value, reduced]);
  const number = reduced ? value : shown;
  return <strong>{time ? `${Math.floor(number / 60).toString().padStart(2, "0")}:${(number % 60).toString().padStart(2, "0")}` : number}</strong>;
}

type StageGate = "rest" | "short" | "hint" | "sweep" | "fixed";

/** A live replica of the product: the black notch with the real 3D character
 * driving itself with synthetic landmarks, and a slide that follows. */
export function GestureStage({ mode, slide, direction, active, reduced, onSweep }: {
  mode: "next" | "hint";
  slide: number;
  direction: number;
  active: boolean;
  reduced: boolean;
  onSweep: () => void;
}) {
  const avatar = useRef<AvatarHandle>(null);
  const [gate, setGate] = useState<StageGate>(mode === "hint" ? "hint" : "rest");
  const sweepRef = useRef(onSweep);
  useEffect(() => {
    sweepRef.current = onSweep;
  }, [onSweep]);

  useEffect(() => {
    const handle = avatar.current;
    if (reduced) {
      handle?.clear();
      return;
    }
    if (!active) return;
    const script: Array<{ kind: "rest" | "short" | "sweep"; ms: number; enter?: () => void; end?: () => void }> = mode === "hint"
      ? [
          { kind: "rest", ms: 700, enter: () => { setGate("rest"); handle?.setExpression("calm"); } },
          { kind: "short", ms: 1000, enter: () => setGate("short") },
          { kind: "rest", ms: 1000, enter: () => { setGate("rest"); handle?.setExpression("sorry"); } },
          { kind: "rest", ms: 1700, enter: () => { setGate("hint"); handle?.setExpression("hint"); } },
          { kind: "sweep", ms: 1400, enter: () => setGate("sweep"), end: () => { handle?.react("next"); sweepRef.current(); } },
          { kind: "rest", ms: 1700, enter: () => { setGate("fixed"); handle?.setExpression("happy"); } },
        ]
      : [
          { kind: "rest", ms: 900 },
          { kind: "sweep", ms: 1400, end: () => { handle?.react("next"); sweepRef.current(); } },
          { kind: "rest", ms: 1500 },
        ];
    let raf = 0;
    let index = 0;
    let started = performance.now();
    let lastDraw = 0;
    script[0].enter?.();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const phase = script[index];
      if (now - lastDraw > 33) {
        lastDraw = now;
        if (phase.kind === "rest") handle?.clear();
        else handle?.draw(sweepHandFrame((now - started) / 1000, phase.kind === "sweep" ? 1 : 0.18));
      }
      if (now - started >= phase.ms) {
        phase.end?.();
        index = (index + 1) % script.length;
        started = now;
        script[index].enter?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); handle?.clear(); };
  }, [active, reduced, mode]);

  const shownGate = reduced ? (mode === "hint" ? "hint" : "rest") : gate;
  const card = mode === "hint" && (shownGate === "hint" || shownGate === "sweep" || shownGate === "fixed") ? (shownGate === "fixed" ? "fixed" : "hint") : null;

  return <div className="lab-stage">
    <div className={`lab-stage-notch ${mode === "hint" ? "mini" : ""}`}>
      <Avatar ref={avatar} locked={false} face="none" />
      <span className="lab-stage-notch-caption">{mode === "next" ? "Ладонь вправо — следующий слайд" : "3D-зеркало повторяет движение спикера"}</span>
    </div>
    <div className="lab-stage-slide"><DemoDeck index={slide} direction={direction} reduced={reduced} /></div>
    <AnimatePresence>
      {card && <motion.div key={card} className={`lab-stage-card ${card}`}
        initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 8 }}
        transition={{ duration: reduced ? 0 : .3, ease: [.22, 1, .36, 1] }}>
        <span>{card === "fixed" ? <><Check size={15} /> КОМАНДА ПРИНЯТА</> : <><Sparkles size={15} /> ПОПРОБУЙ ЧУТЬ ТОЧНЕЕ</>}</span>
        <h4>{card === "fixed" ? "Вот так. Следующий слайд!" : "Проведи рукой дальше вправо"}</h4>
        <p>{card === "fixed" ? "Ладонь открыта, движение горизонтальное и достаточно широкое." : "Увеличь размах за одно движение, сохраняя ладонь на одной высоте."}</p>
      </motion.div>}
    </AnimatePresence>
  </div>;
}

export function PitchShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const reduce = !!useReducedMotion();
  const autoplay = !paused && !manual;
  const playing = autoplay && !hovered && !focused && !reduce && visible;
  const staged = !paused && !reduce && visible;
  const step = steps[active];
  const StepIcon = step.icon;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .2 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % steps.length), 9000);
    return () => window.clearTimeout(timer);
  }, [active, playing]);
  const select = (index: number) => { setActive(index); setManual(true); };
  const toggleAutoplay = () => {
    if (autoplay) setPaused(true);
    else { setPaused(false); setManual(false); }
  };
  const advance = () => { setDirection(1); setSlide((value) => (value + 1) % demoSlides.length); };
  const restart = () => { setSlide(0); setDirection(1); select(0); };

  return <div className="pitch-showcase pitch-lab" id="demo-panel" ref={ref} data-motion={staged} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="lab-navigation">
      <div className="showcase-tabs" role="tablist" aria-label="Демо работы AxiomPitch">
        {steps.map((item, index) => <button key={item.label} role="tab" id={`demo-tab-${index}`} aria-selected={active === index} aria-controls="demo-scene"
          onClick={() => select(index)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % steps.length : event.key === "ArrowLeft" ? (index - 1 + steps.length) % steps.length : event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
            if (next !== null) { event.preventDefault(); select(next); document.getElementById(`demo-tab-${next}`)?.focus(); }
          }} tabIndex={active === index ? 0 : -1} className={active === index ? "active" : ""}>
          {active === index && <motion.span layoutId="lab-tab" className="lab-tab-background" transition={{ duration: reduce ? 0 : .28 }} />}
          <span className="lab-tab-number">0{index + 1}</span><span className="lab-tab-label">{item.label}</span>
        </button>)}
      </div>
      <button className="lab-autoplay" aria-pressed={!autoplay} onClick={toggleAutoplay} aria-label={autoplay ? "Приостановить автопоказ" : "Включить автопоказ"}>{autoplay ? <Pause size={14} /> : <Play size={14} />}</button>
    </div>
    <div className={`showcase-window lab-window lab-scene-${active}`}>
      <div className="lab-window-top"><span><span className="lab-live-dot" /> ИНТЕРАКТИВНОЕ ДЕМО</span><span>0{active + 1} <span>/ 0{steps.length}</span></span></div>
      <div id="demo-scene" role="tabpanel" aria-labelledby={`demo-tab-${active}`} className="showcase-scene">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={active} initial={reduce ? false : { opacity: 0, y: 16, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduce ? 0 : -12 }} transition={{ duration: reduce ? 0 : .3, ease: [.22, 1, .36, 1] }} className="showcase-scene-inner lab-scene-inner">
            <div className="lab-layout">
              <div className="lab-visual" data-scene={active}>
                {active === 0 && <div className="lab-presentation-visual">
                  <div className="lab-deck-stack"><span className="lab-stack-back back-two" /><span className="lab-stack-back back-one" /><motion.div initial={reduce ? false : { y: 24, rotate: -3, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} transition={{ delay: .1, duration: .65, ease: [.22, 1, .36, 1] }}><DemoDeck index={0} reduced={reduce} /></motion.div></div>
                  <motion.div className="lab-upload-card" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .45 }}><span className="lab-file-icon"><FileText size={22} /></span><span><strong>Первый питч.pdf</strong><span>5 слайдов · готово к выступлению</span></span><span className="lab-check"><Check size={15} /></span><motion.i initial={{ scaleX: reduce ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: .85, delay: .2 }} /></motion.div>
                </div>}
                {active === 1 && <GestureStage mode="next" slide={slide} direction={direction} active={staged && active === 1} reduced={reduce} onSweep={advance} />}
                {active === 2 && <GestureStage mode="hint" slide={slide} direction={direction} active={staged && active === 2} reduced={reduce} onSweep={advance} />}
                {active === 3 && <div className="lab-results-visual"><div className="lab-results-header"><span>ТВОЙ РИТМ</span><span><Check size={12} /> Репетиция завершена</span></div><div className="lab-result-total"><Metric value={272} time reduced={reduce || !visible} /><span>минут в истории</span></div><div className="lab-chart" aria-label="Время на слайдах: 52, 68, 44, 72 и 36 секунд">{durations.map((seconds, i) => <div key={i}><span>{seconds} с</span><div><motion.i initial={{ height: reduce ? `${seconds / 72 * 100}%` : 0 }} animate={{ height: `${seconds / 72 * 100}%` }} transition={{ duration: .9, delay: i * .1, ease: [.22, 1, .36, 1] }} className={i === 3 ? "peak" : ""} /></div><span>0{i + 1}</span></div>)}</div><div className="lab-chart-insight"><span className="lab-insight-dot" />Больше всего времени — на четвёртом слайде.</div></div>}
              </div>
              <div className="lab-copy"><span className="lab-feature-icon"><StepIcon size={21} strokeWidth={1.4} /></span><p className="landing-eyebrow">{step.tag}</p><motion.h3 key={`title-${active}`} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .45, delay: reduce ? 0 : .06, ease: [.22, 1, .36, 1] }}>{step.title}</motion.h3><motion.p key={`text-${active}`} className="lab-description" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .45, delay: reduce ? 0 : .14, ease: [.22, 1, .36, 1] }}>{step.text}</motion.p>
                {active === 0 && <><div className="lab-benefit"><Check size={14} /> Слайды и заметки всегда рядом</div><a className="landing-button light compact" href="/studio">Добавить свой PDF <ArrowRight size={14} /></a></>}
                {active === 1 && <div className="lab-benefit"><Hand size={14} /> Вправо — дальше. Влево — назад.</div>}
                {active === 2 && <div className="lab-benefit"><Check size={14} /> Подсказка появляется сама — прямо на экране спикера.</div>}
                {active === 3 && <><div className="lab-copy-metrics"><span><Metric value={8} reduced={reduce || !visible} />Успешных команд</span><span><Metric value={2} reduced={reduce || !visible} />Подсказки</span></div><button className="landing-text-link" onClick={restart}><RotateCcw size={14} />Повторить демо</button></>}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="lab-window-bottom"><span><ShieldCheck size={13} /> Демо-данные · камера не включается</span><span className="lab-next-label">{active === steps.length - 1 ? "ТЕПЕРЬ ТВОЙ ВЫХОД" : `ДАЛЕЕ — ${steps[active + 1].label.toUpperCase()}`}</span><button onClick={() => select((active + 1) % steps.length)} aria-label="Следующий этап демо"><ArrowRight size={16} /></button></div>
      {playing && <motion.div key={active} className="lab-autoplay-progress" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 9, ease: "linear" }} />}
    </div>
  </div>;
}
