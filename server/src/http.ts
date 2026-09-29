import type { IncomingMessage, ServerResponse } from "node:http";

/** An expected refusal; message is short Russian text for the speaker. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Path segments after /api, e.g. ["presentations", id, "notes"]. */
  path: string[];
  /** Absolute origin of this server as the client addressed it. */
  base: string;
};

export type Route = (context: Context) => Promise<boolean>;

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads at most `limit` bytes. A larger body is drained (so the client still
 * gets the 400) up to three times the limit, then the socket is dropped.
 */
export async function readBody(
  req: IncomingMessage,
  limit: number,
  tooLarge: string,
): Promise<Buffer> {
  if (Number(req.headers["content-length"]) > limit * 3) {
    req.destroy();
    throw new HttpError(400, tooLarge);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit * 3) {
      req.destroy();
      break;
    }
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new HttpError(400, tooLarge);
  return Buffer.concat(chunks);
}

/** JSON only: a text/plain form post from another site cannot reach the bridge. */
export async function readJson(req: IncomingMessage, limit = 256 * 1024) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? ""))
    throw new HttpError(415, "Нужен JSON (Content-Type: application/json).");
  const body = await readBody(req, limit, "Слишком большой запрос.");
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Некорректный JSON.");
  }
}
