import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Camera } from "lucide-react";
import type { CameraStatus } from "../hooks/useCamera";
/** Shares the existing stream, never opens a second camera. */
export function CameraVideo({ source, status, className, label = "Превью выбранной камеры" }: { source: RefObject<HTMLVideoElement | null>; status: CameraStatus; className?: string; label?: string }) {
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = preview.current;
    if (!video) return;
    video.srcObject = status === "ready" ? source.current?.srcObject ?? null : null;
    if (video.srcObject) void video.play().catch(() => undefined);
    return () => { video.pause(); video.srcObject = null; };
  }, [source, status]);
  return <video ref={preview} className={className} playsInline muted aria-label={label} aria-hidden={status !== "ready"} />;
}
export function CameraPreview({ source, status }: { source: RefObject<HTMLVideoElement | null>; status: CameraStatus }) {
  return <div className={`settings-camera-preview ${status === "ready" ? "is-live" : ""}`}><CameraVideo source={source} status={status} />{status !== "ready" && <div><Camera size={26} strokeWidth={1.4} /><span>{status === "loading" ? "Подключаем камеру…" : "Включи камеру, чтобы проверить кадр"}</span></div>}</div>;
}
