import type { SessionResult } from "../../../src/lib/types.ts";
import type { Store } from "../db.ts";
import { HttpError, isRecord, readJson, sendJson } from "../http.ts";
import type { Route } from "../http.ts";

/** Correction codes the GestureEngine can emit. */
export const correctionCodes = new Set([
  "frame",
  "lost-hand",
  "palm",
  "edge",
  "horizontal",
  "wider",
  "steady",
]);
const fields = new Set([
  "id",
  "name",
  "startedAt",
  "duration",
  "perSlide",
  "slideTitles",
  "commands",
  "corrections",
  "mode",
  "presentationId",
]);

const bad = (message: string) => new HttpError(400, message);
const isCount = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Accepts a SessionResult as the tab measured it. Times are stored as sent,
 * never recomputed from the server clock; pauses are already excluded.
 */
export function validateSession(body: unknown) {
  if (!isRecord(body)) throw bad("Нужен объект итогов SessionResult.");
  const extra = Object.keys(body).find((key) => !fields.has(key));
  if (extra) throw bad(`Лишнее поле: ${extra}.`);
  const {
    id,
    name,
    startedAt,
    duration,
    perSlide,
    slideTitles,
    commands,
    corrections,
    mode,
    presentationId,
  } = body;
  if (typeof id !== "string" || !id || id.length > 100)
    throw bad("Нужен id сессии.");
  if (typeof name !== "string" || name.length > 200)
    throw bad("name должен быть строкой до 200 символов.");
  if (typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt)))
    throw bad("startedAt должен быть датой ISO.");
  if (mode !== "rehearsal" && mode !== "live")
    throw bad("mode должен быть rehearsal или live.");
  if (
    !Array.isArray(perSlide) ||
    perSlide.length < 1 ||
    perSlide.length > 60 ||
    !perSlide.every(isTime)
  )
    throw bad("perSlide должен содержать от 1 до 60 длительностей в мс.");
  if (
    !Array.isArray(slideTitles) ||
    slideTitles.length !== perSlide.length ||
    !slideTitles.every(
      (title) => typeof title === "string" && title.length <= 300,
    )
  )
    throw bad("slideTitles должен совпадать с perSlide по длине.");
  // Same order as SessionClock, so equal floats compare exactly.
  const total = (perSlide as number[]).reduce((sum, value) => sum + value, 0);
  if (!isTime(duration) || duration !== total)
    throw bad("duration должна быть равна сумме perSlide.");
  if (
    !isRecord(commands) ||
    Object.keys(commands).sort().join() !== "next,previous,toggle" ||
    !Object.values(commands).every(isCount)
  )
    throw bad("commands должен содержать ровно next, previous и toggle.");
  if (!isRecord(corrections)) throw bad("corrections должен быть объектом.");
  for (const [code, count] of Object.entries(corrections)) {
    if (!correctionCodes.has(code))
      throw bad(`Неизвестный код подсказки: ${code}.`);
    if (!isCount(count)) throw bad(`Счётчик ${code} должен быть целым числом.`);
  }
  if (
    presentationId !== undefined &&
    presentationId !== null &&
    typeof presentationId !== "string"
  )
    throw bad("presentationId должен быть строкой.");
  const result: SessionResult = {
    id,
    name,
    startedAt,
    duration,
    perSlide: perSlide as number[],
    slideTitles: slideTitles as string[],
    commands: commands as SessionResult["commands"],
    corrections: corrections as Record<string, number>,
    mode,
  };
  return { result, presentationId: presentationId ?? null };
}

export function sessionRoutes(store: Store): Route {
  return async ({ req, res, url, path }) => {
    if (path[0] !== "sessions" || path.length > 1) return false;
    if (req.method === "POST") {
      const { result, presentationId } = validateSession(await readJson(req));
      if (presentationId && !store.getPresentation(presentationId))
        throw bad("Презентация не найдена.");
      const savedAt = new Date().toISOString();
      if (!store.addSession({ ...result, presentationId, savedAt }))
        throw new HttpError(409, "Эта сессия уже сохранена.");
      sendJson(res, 201, { id: result.id, savedAt });
      return true;
    }
    if (req.method === "GET") {
      const limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("limit")) || 20),
      );
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const { items, total } = store.listSessions(limit, Math.floor(offset));
      sendJson(res, 200, { items, total, limit, offset: Math.floor(offset) });
      return true;
    }
    throw new HttpError(405, "Метод не поддерживается.");
  };
}
