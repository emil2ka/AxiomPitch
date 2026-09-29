import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

export type CompanionAction = "idle" | "hello" | "point" | "open-palm" | "next" | "previous" | "hold" | "success" | "invite";

export function PixelCompanion({ action = "idle", replay = 0, enabled = true, className = "" }: {
  action?: CompanionAction; replay?: number; enabled?: boolean; className?: string;
}) {
  return <PixelPlayback key={`${action}-${replay}-${enabled}`} action={action} enabled={enabled} className={className} />;
}

/** Native alpha video, with transparent animated WebP when the browser decodes VP9 opaquely. */
function PixelPlayback({ action, enabled, className }: { action: CompanionAction; enabled: boolean; className: string }) {
  const reduced = !!useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState(action);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [format, setFormat] = useState<"checking" | "video" | "webp">("checking");
  const [ready, setReady] = useState(false);
  const running = enabled && visible && foreground && !reduced;
  const base = `/companion/${clip}`;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .1 });
    if (host.current) observer.observe(host.current);
    const onVisibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (running && format !== "webp") void element?.play().catch(() => {});
    else element?.pause();
  }, [running, clip, format]);

  useEffect(() => {
    if (format !== "webp" || !running || clip === "idle") return;
    const timeout = window.setTimeout(() => { setClip("idle"); setReady(false); }, 4000);
    return () => window.clearTimeout(timeout);
  }, [format, running, clip]);

  const loaded = () => {
    const element = video.current;
    if (!element) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { setFormat("webp"); return; }
      context.drawImage(element, 0, 0, 1, 1, 0, 0, 1, 1);
      const transparent = context.getImageData(0, 0, 1, 1).data[3] < 20;
      setFormat(transparent ? "video" : "webp");
      setReady(transparent);
      if (running) void element.play().catch(() => {});
    } catch { setFormat("webp"); setReady(false); }
  };

  return <div ref={host} className={`pixel-companion ${className}`} data-clip={clip} data-format={format} role="img" aria-label="Пиксельный помощник AxiomPitch">
    <img className={`pixel-poster ${enabled && !reduced && ready && (format === "video" || (format === "webp" && running)) ? "concealed" : ""}`} src={`/companion/${enabled ? clip : action}.png`} alt="" width={704} height={512} loading="lazy" />
    {running && format === "webp" && <img key={clip} className={`pixel-animation ${ready ? "ready" : "loading"}`} src={`${base}.webp`} alt="" width={704} height={512} onLoad={() => setReady(true)} />}
    {!reduced && enabled && format !== "webp" && <video key={clip} ref={video} className={`pixel-animation ${ready ? "ready" : "loading"}`}
      src={`${base}.webm`} muted playsInline loop={clip === "idle"} preload={running ? "auto" : "none"}
      onLoadedData={loaded} onError={() => { setFormat("webp"); setReady(false); }} onEnded={() => { setClip("idle"); setReady(false); }} aria-hidden="true" />}
  </div>;
}
