import type { Slide } from "./types";

export const demoSlides: Slide[] = [
  {
    id: "demo-1",
    title: "Твоя история.\nТвоя сцена.",
    eyebrow: "AXIOMPITCH / 01",
    body: "Презентации, которые следуют за тобой.",
    notes:
      "Представься аудитории. Объясни, какую проблему решает твой проект. Начни с одного понятного примера.",
  },
  {
    id: "demo-2",
    title: "Свобода\nдвижения.",
    eyebrow: "ПРОБЛЕМА / 02",
    body: "Ноутбук далеко. Кликер потерялся. Мысль не должна прерываться.",
    notes:
      "Опиши ситуацию, знакомую выступающим. Не читай текст с экрана — добавь собственный пример.",
  },
  {
    id: "demo-3",
    title: "Один жест.\nСледующий слайд.",
    eyebrow: "РЕШЕНИЕ / 03",
    body: "Камера становится твоим пультом.",
    items: ["Вправо — дальше", "Влево — назад", "Ладонь — блокировка"],
    notes:
      "Покажи переключение рукой. Затем удержи открытую ладонь, чтобы отключить команды и свободно жестикулировать.",
  },
  {
    id: "demo-4",
    title: "Маленькая чёлка.\nБольшой контроль.",
    eyebrow: "ОБРАТНАЯ СВЯЗЬ / 04",
    body: "Синяя тень повторяет движения. Короткий импульс подтверждает команду.",
    notes:
      "Покажи синюю тень в чёлке. Расскажи, что камера обрабатывается в браузере, а зрители видят только слайды.",
  },
  {
    id: "demo-5",
    title: "Теперь\nтвой выход.",
    eyebrow: "ФИНАЛ / 05",
    body: "Загрузи свою презентацию и расскажи историю.",
    notes:
      "Повтори главную мысль в одном предложении. Поблагодари аудиторию и заверши выступление.",
  },
];

export async function readPdf(
  file: File,
  onProgress: (value: number) => void,
): Promise<Slide[]> {
  if (file.size > 30 * 1024 * 1024)
    throw new Error("Выбери PDF размером до 30 МБ.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  task.onPassword = () => {
    void task.destroy();
  };
  try {
    const doc = await task.promise;
    if (doc.numPages > 60)
      throw new Error("Для MVP поддерживаются презентации до 60 слайдов.");
    const slides: Slide[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 1440 / natural.width, 1080 / natural.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const text = await page.getTextContent();
      const title =
        text.items
          .filter((item) => "str" in item)
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim()
          .slice(0, 90) || `Слайд ${i}`;
      slides.push({
        id: `pdf-${i}`,
        title,
        image: canvas.toDataURL("image/jpeg", 0.9),
        notes: "",
      });
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      onProgress(i / doc.numPages);
    }
    return slides;
  } catch (error) {
    if (error instanceof Error && /password|destroyed/i.test(error.message))
      throw new Error(
        "Этот PDF защищён паролем. Экспортируй копию без пароля.",
      );
    throw error;
  } finally {
    await task.destroy();
  }
}

export const formatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
