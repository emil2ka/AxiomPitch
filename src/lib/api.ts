import type { SessionResult } from "./types.ts";

// Undefined outside Vite (node:test imports this module too).
const env = import.meta.env as ImportMetaEnv | undefined;
/** Local bridge server. Empty means PitchFlow works fully offline. */
export const apiBase = (env?.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
export const apiEnabled = apiBase !== "";

export type StoredPresentation = {
  id: string;
  name: string;
  url: string;
  pageCount: number;
  notes: string[];
  createdAt: string;
};
export type StoredSession = SessionResult & {
  presentationId: string | null;
  savedAt: string;
};

/** Rejects with the server's short Russian reason when there is one. */
export async function request<T>(
  path: string,
  init: RequestInit = {},
  base = apiBase,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Сервер ответил ${response.status}`,
    );
  return body as T;
}

export const jsonBody = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A copy for the server; the tab still renders the PDF itself via readPdf. */
export function uploadPresentation(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<StoredPresentation>("/api/presentations", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
}

export const listPresentations = () =>
  request<{ items: StoredPresentation[] }>("/api/presentations");

export const saveNotes = (id: string, notes: string[]) =>
  request<{ id: string; notes: string[] }>(
    `/api/presentations/${id}/notes`,
    jsonBody({ notes }, "PATCH"),
  );

/** Adds to the server history; localStorage stays the source on this device. */
export const saveSession = (
  result: SessionResult,
  presentationId?: string | null,
) =>
  request<{ id: string; savedAt: string }>(
    "/api/sessions",
    jsonBody(presentationId ? { ...result, presentationId } : result),
  );

export const listSessions = (limit = 20, offset = 0) =>
  request<{
    items: StoredSession[];
    total: number;
    limit: number;
    offset: number;
  }>(`/api/sessions?limit=${limit}&offset=${offset}`);
