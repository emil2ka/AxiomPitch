import { profileScope } from "./profiles.ts";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import type { Presentation, Store } from "../db.ts";
import { HttpError, isRecord, readBody, readJson, sendJson } from "../http.ts";
import type { Context, Route } from "../http.ts";
import { inspectPdf, maxPdfBytes, PdfRejected } from "../pdf.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const tooLarge = "PDF больше 30 МБ. Сожми файл или раздели его.";

const view = (base: string, presentation: Presentation, profileId: string | null = null) => ({
  id: presentation.id,
  name: presentation.name,
  url: `${base}/api/presentations/${presentation.id}/file${profileId ? `?profile=${encodeURIComponent(profileId)}` : ""}`,
  pageCount: presentation.pageCount,
  notes: presentation.notes,
  createdAt: presentation.createdAt,
});

const cleanName = (fileName: string) =>
  fileName
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Презентация";

async function upload(store: Store, { req, res, base }: Context, profileId: string | null) {
  const type = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data/i.test(type))
    throw new HttpError(400, "Отправь PDF в поле file (multipart/form-data).");
  // Multipart framing adds a little on top of the file itself.
  const body = await readBody(req, maxPdfBytes + 64 * 1024, tooLarge);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw new HttpError(400, "Не удалось разобрать загрузку.");
  }
  const file = form.get("file");
  if (!(file instanceof Blob))
    throw new HttpError(400, "Нет файла в поле file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pageCount: number;
  try {
    ({ pageCount } = await inspectPdf(bytes));
  } catch (error) {
    if (error instanceof PdfRejected) throw new HttpError(400, error.message);
    throw error;
  }
  const presentation: Presentation = {
    id: randomUUID(),
    name: cleanName(file instanceof File ? file.name : ""),
    pageCount,
    size: bytes.length,
    notes: Array<string>(pageCount).fill(""),
    createdAt: new Date().toISOString(),
  };
  const path = store.filePath(presentation.id);
  await writeFile(path, bytes);
  try {
    store.addPresentation(presentation, profileId);
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
  sendJson(res, 201, view(base, presentation, profileId));
}

function sendFile(store: Store, presentation: Presentation, context: Context) {
  const { req, res } = context;
  // The PDF is personal: only this machine may read it back.
  if (!loopback.has(req.socket.remoteAddress ?? ""))
    throw new HttpError(403, "Файл доступен только с этого компьютера.");
  const stream = createReadStream(store.filePath(presentation.id));
  stream.once("error", () => {
    if (!res.headersSent) sendJson(res, 404, { error: "Файл не найден." });
    else res.destroy();
  });
  stream.once("open", () => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-length", presentation.size);
    res.setHeader(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(presentation.name)}.pdf`,
    );
    stream.pipe(res);
  });
}

async function saveNotes(
  store: Store,
  presentation: Presentation,
  { req, res }: Context,
) {
  const body = await readJson(req, 2 * 1024 * 1024);
  const notes = isRecord(body) ? body.notes : undefined;
  if (
    !Array.isArray(notes) ||
    !notes.every((note) => typeof note === "string" && note.length <= 20000)
  )
    throw new HttpError(400, "notes должен быть массивом строк.");
  if (notes.length !== presentation.pageCount)
    throw new HttpError(
      400,
      `Нужно ${presentation.pageCount} заметок: по одной на страницу.`,
    );
  store.setNotes(presentation.id, notes as string[]);
  sendJson(res, 200, { id: presentation.id, notes });
}

export function presentationRoutes(store: Store): Route {
  return async (context) => {
    const { req, res, path, base } = context;
    if (path[0] !== "presentations") return false;
    const [, id, action] = path;
    const profileId = profileScope(store, context);
    if (id === undefined) {
      if (req.method === "POST") await upload(store, context, profileId);
      else if (req.method === "GET")
        sendJson(res, 200, {
          items: store.listPresentations(profileId).map((item) => view(base, item, profileId)),
        });
      else throw new HttpError(405, "Метод не поддерживается.");
      return true;
    }
    const presentation = uuid.test(id) ? store.getPresentation(id, profileId) : null;
    if (!presentation || path.length > 3)
      throw new HttpError(404, "Презентация не найдена.");
    if (action === undefined && req.method === "GET")
      sendJson(res, 200, view(base, presentation, profileId));
    else if (action === "file" && req.method === "GET")
      sendFile(store, presentation, context);
    else if (action === "notes" && req.method === "PATCH")
      await saveNotes(store, presentation, context);
    else throw new HttpError(404, "Не найдено.");
    return true;
  };
}
