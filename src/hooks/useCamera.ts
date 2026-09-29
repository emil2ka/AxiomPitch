import { useCallback, useEffect, useRef, useState } from "react";
import type { VisionFrame, VisionMessage } from "../lib/types";

export type CameraStatus = "off" | "loading" | "ready" | "error";

/**
 * Chrome and Edge hand out camera frames straight from the track. Unlike
 * requestAnimationFrame this keeps running while the tab is hidden behind a
 * full-screen Keynote or Google Slides, so gestures keep working there.
 */
type TrackProcessor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};
const TrackProcessor = (
  globalThis as { MediaStreamTrackProcessor?: TrackProcessor }
).MediaStreamTrackProcessor;

export function useCamera(onFrame: (frame: VisionFrame) => void) {
  const [status, setStatus] = useState<CameraStatus>("off");
  const [error, setError] = useState("");
  const [fps, setFps] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameId = useRef(0);
  const readerRef = useRef<ReadableStreamDefaultReader<VideoFrame> | null>(
    null,
  );
  const generation = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const frameCallback = useRef(onFrame);
  useEffect(() => {
    frameCallback.current = onFrame;
  }, [onFrame]);

  const cleanup = useCallback(() => {
    generation.current++;
    clearTimeout(timeoutRef.current);
    cancelAnimationFrame(frameId.current);
    readerRef.current?.cancel().catch(() => undefined);
    readerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);
  const stop = useCallback(() => {
    cleanup();
    setStatus("off");
    setFps(0);
    setError("");
  }, [cleanup]);
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    cleanup();
    const run = generation.current;
    setStatus("loading");
    setError("");
    const fail = (message: string) => {
      if (generation.current !== run) return;
      clearTimeout(timeoutRef.current);
      cleanup();
      setError(message);
      setStatus("error");
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext)
        throw new Error(
          "Камера доступна на HTTPS или localhost. Открой приложение по защищённому адресу.",
        );
      if (typeof OffscreenCanvas === "undefined")
        throw new Error(
          "Для камеры нужен современный Chrome или Edge с поддержкой OffscreenCanvas.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
      if (generation.current !== run) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Не удалось открыть камеру.");
      video.srcObject = stream;
      await video.play();
      if (generation.current !== run) return;
      const worker = new Worker(
        new URL("../workers/vision.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      let busy = false,
        lastTime = -1,
        lastSent = 0,
        sampleStart = performance.now(),
        samples = 0;
      const tick = async (time: number) => {
        if (generation.current !== run) return;
        frameId.current = requestAnimationFrame(tick);
        if (
          busy ||
          video.readyState < 2 ||
          video.currentTime === lastTime ||
          time - lastSent < 33
        )
          return;
        busy = true;
        lastTime = video.currentTime;
        lastSent = time;
        try {
          const bitmap = await createImageBitmap(video);
          if (generation.current !== run) {
            bitmap.close();
            return;
          }
          worker.postMessage({ type: "frame", bitmap, time }, [bitmap]);
        } catch {
          fail("Не удалось получить кадр. Выключи и снова включи камеру.");
        }
      };
      const pump = async (reader: ReadableStreamDefaultReader<VideoFrame>) => {
        while (generation.current === run) {
          let next: ReadableStreamReadResult<VideoFrame>;
          try {
            next = await reader.read();
          } catch {
            return;
          }
          if (next.done) return;
          const frame = next.value;
          const time = performance.now();
          // Unused frames must be closed at once, or the camera stalls.
          if (busy || time - lastSent < 33 || generation.current !== run) {
            frame.close();
            continue;
          }
          busy = true;
          lastSent = time;
          worker.postMessage({ type: "frame", bitmap: frame, time }, [frame]);
        }
      };
      const capture = () => {
        if (TrackProcessor)
          try {
            const reader = new TrackProcessor({
              track: stream.getVideoTracks()[0],
            }).readable.getReader();
            readerRef.current = reader;
            void pump(reader);
            return;
          } catch {
            // Fall back to painting frames while the tab is visible.
          }
        frameId.current = requestAnimationFrame(tick);
      };
      worker.onmessage = (event: MessageEvent<VisionMessage>) => {
        if (generation.current !== run) return;
        if (event.data.type === "ready") {
          clearTimeout(timeoutRef.current);
          setStatus("ready");
          capture();
        } else if (event.data.type === "error") {
          console.error("Vision:", event.data.message);
          fail(
            "Не удалось запустить распознавание. Попробуй Chrome или Edge и проверь, что модели загрузились.",
          );
        } else {
          busy = false;
          samples++;
          const now = performance.now();
          if (now - sampleStart >= 1500) {
            setFps(Math.round((samples * 1000) / (now - sampleStart)));
            samples = 0;
            sampleStart = now;
          }
          frameCallback.current(event.data);
        }
      };
      worker.onerror = () =>
        fail(
          "Модуль камеры не загрузился. Обнови страницу и попробуй ещё раз.",
        );
      timeoutRef.current = setTimeout(
        () =>
          fail(
            "Модели загружаются слишком долго. Проверь соединение и повтори запуск.",
          ),
        60000,
      );
      worker.postMessage({
        type: "init",
        base: new URL(`${import.meta.env.BASE_URL}vision`, location.origin)
          .href,
      });
      stream.getVideoTracks()[0].onended = () =>
        fail("Камера отключена. Подключи её и повтори запуск.");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      fail(
        name === "NotAllowedError"
          ? "Разреши доступ к камере в настройках браузера, затем попробуй снова."
          : name === "NotFoundError"
            ? "Камера не найдена. Подключи веб-камеру."
            : name === "NotReadableError"
              ? "Камера занята другим приложением. Закрой его и повтори."
              : err instanceof Error
                ? err.message
                : "Не удалось включить камеру.",
      );
    }
  }, [cleanup]);
  return { status, error, fps, videoRef, start, stop };
}
