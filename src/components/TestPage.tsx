import { ArrowLeft, ArrowRight, Camera, CameraOff, Check, LoaderCircle, Monitor, Play, RotateCcw, Square } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { SlideView } from "./SlideView";
import { demoSlides } from "../lib/deck";
import { CameraPreview } from "./CameraPreview";
import type { CameraStatus } from "../hooks/useCamera";
import { gesturesReady } from "../lib/preflight";
import type { NotchChoice, Preflight } from "../lib/preflight";

export function TestPage({ active, busy, ready, diagnostic, source, cameraStatus, cameraError, state, notchChoice, onNotchChoice, notchConnected, notchVisible, message, onStart, onFinish, onCamera, onNotch, onSettings, onStudio, onSlide }: {
  active: boolean; busy: boolean; ready: boolean; diagnostic?: ReactNode; source: RefObject<HTMLVideoElement | null>; cameraStatus: CameraStatus; cameraError: string;
  state: Preflight; notchChoice: NotchChoice; onNotchChoice: (choice: "on" | "off") => void; notchConnected: boolean; notchVisible: boolean; message: string;
  onSlide: (index: number) => void; onStart: () => void; onFinish: () => void; onCamera: () => void; onNotch: () => void; onSettings: () => void; onStudio: () => void;
}) {
  const checks: [string, boolean][] = [
    ["Камера", cameraStatus === "ready"], ["Ладонь в кадре", state.hand && cameraStatus === "ready"],
    ["Свайп вправо", state.next], ["Свайп влево", state.previous], ["Удержание · пауза жестов", state.lock],
    ["Повторное удержание · возврат", state.unlock], [notchChoice === "off" ? "Выступление без чёлки" : "Чёлка на экране", notchChoice === "off" || (notchChoice === "on" && notchConnected && notchVisible)],
  ];
  const done = checks.filter(([, passed]) => passed).length;
  return <section className="test-page" aria-labelledby="test-title">
    <header className="test-heading"><div><span className="test-eyebrow">ПЕРЕД ВЫХОДОМ</span><h1 id="test-title" tabIndex={-1}>Тест</h1><p>Камера, жесты и чёлка. Без записи в историю.</p></div><button className="test-studio" disabled={busy} onClick={onStudio}>В студию<ArrowRight size={16} /></button></header>
    {busy && <p role="status">Сначала заверши выступление. Тест не прерывает текущую сессию.</p>}

    <div className="test-workbench">
      <div className="test-visual">
        <div className="test-presentation" aria-live="polite"><SlideView slide={demoSlides[state.index]} /><div className="test-slide-caption"><div className="test-demo-controls"><button aria-label="Предыдущий демо-слайд" disabled={busy || state.index === 0} onClick={() => onSlide(state.index - 1)}><ArrowLeft size={15} /></button><span>Демо · {state.index + 1} / 3</span><button aria-label="Следующий демо-слайд" disabled={busy || state.index === 2} onClick={() => onSlide(state.index + 1)}><ArrowRight size={15} /></button></div><strong>{active ? message : "Начни тест и попробуй жесты"}</strong></div></div>
        <div className="test-camera"><CameraPreview source={source} status={cameraStatus} /><button disabled={busy} onClick={onCamera}>{cameraStatus === "loading" ? <LoaderCircle size={16} className="spin" /> : cameraStatus === "ready" ? <CameraOff size={16} /> : <Camera size={16} />}{cameraStatus === "ready" ? "Выключить камеру" : cameraStatus === "loading" ? "Отменить подключение" : "Включить камеру"}</button></div>
        {diagnostic}
        {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
      </div>
      <div className="test-readiness"><div className="test-progress-heading"><span>{done === checks.length ? "Всё готово" : "Проверим по порядку"}</span><small>{done} / {checks.length}</small></div><div className="test-progress-track"><i style={{width:`${done / checks.length * 100}%`}} /></div><ul className="test-checks">{checks.map(([label, passed]) => <li className={passed ? "passed" : ""} key={label}>{passed ? <Check size={16} /> : <span className="test-check-dot" />}<span>{label}</span></li>)}</ul>
        <div className="test-actions"><button className="test-primary" disabled={busy || !ready || (active && !gesturesReady(state))} onClick={active ? onFinish : onStart}>{active ? <Square size={14} /> : <Play size={17} />}{active ? "Завершить тест" : "Начать тест"}</button>{active && <button className="test-restart" onClick={onStart}><RotateCcw size={15} />Заново</button>}</div>
        <div className="preparation-notch-options" role="group" aria-label="Режим чёлки"><button disabled={busy} aria-pressed={notchChoice === "on"} onClick={() => onNotchChoice("on")}>С чёлкой</button><button disabled={busy} aria-pressed={notchChoice === "off"} onClick={() => onNotchChoice("off")}>Без чёлки</button></div>
        <button className="test-notch" disabled={busy} onClick={notchConnected ? onNotch : onSettings}><Monitor size={16} />{!notchConnected ? "Подключить чёлку" : notchVisible ? "Скрыть чёлку" : "Показать чёлку"}</button>
        <button className="test-settings" onClick={onSettings}>Размер и экран чёлки<ArrowRight size={14} /></button>
      </div>
    </div>
  </section>;
}
