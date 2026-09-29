import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, CameraOff, Hand, LoaderCircle, Pause, Play, ShieldCheck } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Avatar } from "./Avatar";
import type { AvatarHandle } from "./Avatar";
import { PitchBrand } from "./Landing";
import { useCamera } from "../hooks/useCamera";
import { demoHandFrame } from "../lib/hand-demo";
import type { HandDemo } from "../lib/hand-demo";
import type { VisionFrame } from "../lib/types";

const poses: { id: HandDemo; name: string; text: string }[] = [
  { id: "open", name: "Ладони", text: "Пять отдельных пальцев. Расслабленная, естественная поза." },
  { id: "spread", name: "Разведение", text: "Пальцы расходятся в стороны — каждый от своего сустава." },
  { id: "fist", name: "Кулак", text: "Три сустава каждого пальца сгибаются вместе с твоей рукой." },
  { id: "pinch", name: "Большой палец", text: "Большой палец движется поперёк ладони независимо от остальных." },
  { id: "turn", name: "Поворот", text: "Ладонь поворачивается боком и тыльной стороной, сохраняя позу пальцев." },
  { id: "cross", name: "Пересечение", text: "Левая и правая руки сохраняют принадлежность, проходя друг перед другом." },
];

export function CompanionPreview() {
  const avatar = useRef<AvatarHandle>(null);
  const [pose, setPose] = useState<HandDemo>("open");
  const [paused, setPaused] = useState(false);
  const [detected, setDetected] = useState(0);
  const reduce = !!useReducedMotion();
  const onFrame = useCallback((frame: VisionFrame) => {
    avatar.current?.draw(frame);
    setDetected(frame.hands.length);
  }, []);
  const { status, error, videoRef, start, stop } = useCamera(onFrame);
  const cameraOn = status === "ready" || status === "loading";
  const elapsed = useRef(0);
  const selected = poses.find((item) => item.id === pose)!;

  useEffect(() => {
    if (cameraOn) return;
    let id = 0, last = 0, paint = 0;
    const tick = (time: number) => {
      id = requestAnimationFrame(tick);
      if (!document.hidden && time - paint >= 1000 / 24) {
        if (!paused && !reduce && last) elapsed.current += Math.min(time - last, 80) / 1000;
        avatar.current?.draw(demoHandFrame(pose, elapsed.current));
        paint = time;
      }
      last = time;
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [pose, paused, reduce, cameraOn]);

  const toggleCamera = () => {
    avatar.current?.clear();
    if (cameraOn) { stop(); setDetected(0); }
    else void start();
  };
  return <div className="companion-page landing axiom-landing">
    <header className="landing-header"><div className="landing-header-inner">
      <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <a className="companion-back" href="/#companion"><ArrowLeft size={15} />На сайт</a>
      <a className="landing-button light compact" href="/studio">Репетиция <ArrowRight size={14} /></a>
    </div></header>
    <main className="companion-preview">
      <div className="companion-intro"><p className="landing-eyebrow">ТВОЙ ПОМОЩНИК</p><h1>В твоём ритме.</h1><p>Маленький персонаж. Все твои движения.</p></div>
      <div className="companion-workbench">
        <section className="companion-model" aria-label="Просмотр 3D-персонажа">
          <div className={`companion-mode ${cameraOn ? "live" : ""}`}><span />{status === "loading" ? "Подключаем камеру…" : status === "ready" ? "Твои движения · камера включена" : "Пример движений · камера выключена"}</div>
          <div className="companion-stage"><Avatar ref={avatar} locked={false} /></div>
          <div className="companion-model-bottom"><span><Hand size={15} />{cameraOn ? `Рук в кадре: ${detected}` : selected.name}</span><button aria-pressed={paused} aria-label={paused ? "Продолжить движение модели" : "Приостановить движение модели"} disabled={cameraOn || reduce} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={16} /> : <Pause size={16} />}</button></div>
        </section>
        <aside className="companion-controls">
          <span className="companion-control-eyebrow">ПОСМОТРИ В ДВИЖЕНИИ</span><h2>Каждый палец.<br />Каждый поворот.</h2>
          <div className="companion-poses" role="group" aria-label="Примеры движений рук">{poses.map((item) => <button key={item.id} aria-pressed={pose === item.id} disabled={cameraOn} onClick={() => { setPose(item.id); elapsed.current = item.id === "turn" || item.id === "cross" ? 1.4 : 0; }}>{item.name}</button>)}</div>
          <p className="companion-pose-note">{cameraOn ? "Покажи обе ладони. Согни пальцы, поверни кисти и попробуй пересечь руки." : selected.text}</p>
          <div className="companion-camera"><span>А теперь — твои руки.</span><p>Проверь движения через камеру. Лучше, когда ладони целиком в кадре и хорошо освещены.</p>
            <video ref={videoRef} aria-hidden={!cameraOn} className={cameraOn ? "companion-camera-video" : "camera-source"} autoPlay muted playsInline aria-label="Зеркальный вид с камеры" />
            <button className="landing-button light" onClick={toggleCamera}>{status === "loading" ? <LoaderCircle className="spin" size={16} /> : cameraOn ? <CameraOff size={16} /> : <Camera size={16} />}{status === "loading" ? "Отменить подключение" : cameraOn ? "Выключить камеру" : "Попробовать с камерой"}</button>
            {error && <p className="companion-camera-error" role="alert">{error}</p>}
            <span className="companion-privacy"><ShieldCheck size={13} />Видео обрабатывается на устройстве</span>
          </div>
        </aside>
      </div>
    </main>
  </div>;
}
