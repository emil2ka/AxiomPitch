import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Maximize, Minimize, Pause, Play, Square } from "lucide-react";
import { SlideView } from "./SlideView";
import { formatTime } from "../lib/deck";
import type { Slide } from "../lib/types";

export function PerformanceScreen({ slide, index, count, duration, paused, external, onStep, onPause, onFinish, onStudio }: {
  slide: Slide; index: number; count: number | null; duration: number; paused: boolean; external: boolean;
  onStep: (direction: "next" | "previous") => void; onPause: () => void; onFinish: () => void; onStudio: () => void;
}) {
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = () => {
    setControls(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setControls(false), 2800);
  };
  useEffect(() => {
    const change = () => { setFullscreen(!!document.fullscreenElement); reveal(); };
    document.addEventListener("fullscreenchange", change);
    timer.current = setTimeout(() => setControls(false), 2800);
    return () => { document.removeEventListener("fullscreenchange", change); if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code !== "Space" || (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName))) return;
      event.preventDefault(); onPause();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onPause]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  return <section className={`performance-screen ${controls || paused ? "controls-visible" : "controls-hidden"}`} aria-label="Экран выступления" onPointerMove={reveal} onPointerDown={reveal}>
    <div className="performance-slide">{external ? <div className="performance-external"><span>Внешний показ</span><h1>Слайд {index + 1}</h1><p>Презентация открыта в подключённом приложении.</p></div> : <SlideView slide={slide} />}</div>
    <div className="performance-controls">
      <button onClick={onStudio} className="performance-back"><ArrowLeft size={16} />В студию</button>
      <div className="performance-position"><button aria-label="Предыдущий слайд" disabled={index === 0} onClick={() => onStep("previous")}><ArrowLeft size={18} /></button><span>{String(index + 1).padStart(2, "0")}<small> / {count ?? "?"}</small></span><button aria-label="Следующий слайд" disabled={count !== null && index + 1 >= count} onClick={() => onStep("next")}><ArrowRight size={18} /></button></div>
      <span className="performance-time">{formatTime(duration)}{paused && <small>На паузе</small>}</span>
      <button onClick={onPause} aria-label={paused ? "Продолжить выступление" : "Пауза выступления"}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
      <button onClick={toggleFullscreen} aria-label={fullscreen ? "Выйти из полного экрана" : "На весь экран"}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
      <button onClick={onFinish} className="performance-finish"><Square size={13} />Завершить</button>
    </div>
  </section>;
}
