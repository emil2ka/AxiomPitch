import { Camera, Monitor } from "lucide-react";
import type { NotchChoice, presentationReadiness } from "../lib/preflight";
import type { CameraStatus } from "../hooks/useCamera";
import "../preparation.css";

export function PreparationChecklist({ readiness, cameraStatus, cameraPhase, cameraError, notchChoice, connected, onCamera, onNotchChoice, onConnect, onSettings }: {
  readiness: ReturnType<typeof presentationReadiness>; cameraStatus: CameraStatus; cameraPhase: string; cameraError: string;
  notchChoice: NotchChoice; connected: boolean; onCamera: () => void; onNotchChoice: (choice: "on" | "off") => void; onConnect: () => void; onSettings: () => void;
}) {
  return <section className="preparation-checklist" aria-label="Перед выступлением">
    <span className="preparation-label">Перед стартом</span>
    <button className="text-button" onClick={onCamera}><Camera size={15} />{cameraStatus === "ready" ? "Камера включена" : cameraStatus === "loading" ? "Отменить подключение" : "Включить камеру"}</button>
    <div className="preparation-notch-options" role="group" aria-label="Режим чёлки"><button aria-pressed={notchChoice === "on"} onClick={() => onNotchChoice("on")}>С чёлкой</button><button aria-pressed={notchChoice === "off"} onClick={() => onNotchChoice("off")}>Без чёлки</button></div>
    {notchChoice === "on" && !readiness.checks.find(check => check.id === "notch")?.done && <button className="text-button" onClick={connected ? onSettings : onConnect}><Monitor size={15} />{connected ? "Выбрать экран" : "Подключить чёлку"}</button>}
    {!readiness.ready && <p className="preparation-reason" id="preparation-reason" role="status">{cameraError || (cameraStatus === "loading" ? cameraPhase : readiness.reason)}</p>}
  </section>;
}
