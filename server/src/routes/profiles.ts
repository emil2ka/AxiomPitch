import type { Store } from "../db.ts";
import { HttpError, isRecord, readJson, sendJson } from "../http.ts";
import type { Context, Route } from "../http.ts";
import { looksLikeEmail } from "../../../src/lib/account.ts";

export const validProfileId = (id: unknown): id is string => typeof id === "string" && (id === "legacy" || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id));
/** Profile scope organizes local data; it is not a password/authentication system. */
export function profileScope(store: Store, { req, url }: Context): string | null {
  const id = req.headers["x-axiom-profile"] ?? url.searchParams.get("profile");
  if (id === undefined || id === null) return null;
  if (!validProfileId(id)) throw new HttpError(400, "Некорректный профиль.");
  if (!store.getProfile(id)) throw new HttpError(409, "Сначала подключи профиль к базе.");
  return id;
}
const allowedPreferences = new Set(["axiompitch-notch", "axiompitch-notch-display", "axiompitch-notch-scale", "axiompitch-sensitivity", "axiompitch-guide-enabled", "axiompitch-target-duration", "axiompitch-learning-progress"]);
export function profileRoutes(store: Store): Route {
  return async ({ req, res, path }) => {
    if (path[0] !== "profiles") return false;
    const [, id, action] = path;
    if (path.length > 3) throw new HttpError(404, "Не найдено.");
    if (!id && req.method === "GET") { sendJson(res, 200, { items: store.listProfiles() }); return true; }
    if (!validProfileId(id)) throw new HttpError(400, "Некорректный профиль.");
    if (!action && req.method === "PUT") {
      const body = await readJson(req);
      if (!isRecord(body) || body.id !== id || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.length > 80 || typeof body.email !== "string" || body.email.length > 254 || (body.email && !looksLikeEmail(body.email)) || typeof body.createdAt !== "string" || !Number.isFinite(Date.parse(body.createdAt)) || (body.learnedAt !== undefined && (typeof body.learnedAt !== "string" || !Number.isFinite(Date.parse(body.learnedAt)))))
        throw new HttpError(400, "Проверь имя, почту и даты профиля.");
      sendJson(res, 200, store.putProfile({ id, name: body.name.trim(), email: body.email.trim(), createdAt: body.createdAt, learnedAt: body.learnedAt as string | undefined }));
      return true;
    }
    const profile = store.getProfile(id);
    if (!profile) throw new HttpError(404, "Профиль не найден.");
    if (!action && req.method === "GET") { sendJson(res, 200, profile); return true; }
    if (req.method === "PATCH" && action === "preferences") {
      const body = await readJson(req);
      if (!isRecord(body) || Object.entries(body).some(([key, value]) => !allowedPreferences.has(key) || typeof value !== "string" || value.length > 200)) throw new HttpError(400, "Некорректные настройки.");
      store.putPreferences(id, { ...profile.preferences, ...body } as Record<string, string>);
      sendJson(res, 200, { saved: true }); return true;
    }
    if (req.method === "PUT" && action === "workspace") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.name !== "string" || body.name.length > 200 || !Number.isInteger(body.index) || Number(body.index) < 0 || Number(body.index) > 1999 || (body.presentationId !== null && typeof body.presentationId !== "string")) throw new HttpError(400, "Некорректная презентация.");
      if (body.kind !== undefined && body.kind !== "demo" && body.kind !== "pdf") throw new HttpError(400, "Некорректный тип презентации.");
      if (body.presentationId && !store.getPresentation(String(body.presentationId), id)) throw new HttpError(404, "Презентация этого профиля не найдена.");
      store.putWorkspace(id, { name: body.name, index: Number(body.index), presentationId: body.presentationId as string | null, ...(body.kind ? { kind: body.kind as "demo" | "pdf" } : {}) });
      sendJson(res, 200, { saved: true }); return true;
    }
    if (req.method === "POST" && action === "migrate") {
      const body = await readJson(req);
      if (!isRecord(body) || (body.presentationId !== null && typeof body.presentationId !== "string") || !Array.isArray(body.sessionIds) || body.sessionIds.length > 10 || !body.sessionIds.every(value => typeof value === "string" && value.length <= 100)) throw new HttpError(400, "Некорректные ссылки на старые данные.");
      store.linkLegacy(id, body.presentationId as string | null, body.sessionIds as string[]);
      sendJson(res, 200, { saved: true }); return true;
    }
    throw new HttpError(405, "Метод не поддерживается.");
  };
}
