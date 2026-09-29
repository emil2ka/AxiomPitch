import type { Bridge } from "../bridge/controller.ts";
import { isProtected } from "../bridge/frontmost.ts";
import type { AppRef } from "../bridge/osascript.ts";
import { TargetError } from "../bridge/target.ts";
import { HttpError, isRecord, readJson, sendJson } from "../http.ts";
import type { Route } from "../http.ts";
import type { LiveHub } from "../ws.ts";

const refused = (error: unknown) =>
  error instanceof TargetError ? new HttpError(409, error.message) : error;

async function body(req: Parameters<typeof readJson>[0]) {
  const value = await readJson(req);
  if (!isRecord(value)) throw new HttpError(400, "Нужен JSON-объект.");
  return value;
}

/** Targets, gesture steps and the notch window. */
export function controlRoutes(
  bridge: Bridge,
  hub: LiveHub,
  apps: () => Promise<AppRef[]>,
): Route {
  return async ({ req, res, path }) => {
    const [section, action, ...rest] = path;
    if (rest.length) return false;

    if (section === "targets") {
      if (action === undefined && req.method === "GET") {
        const [current, targets, running] = await Promise.all([
          bridge.state(),
          bridge.list(),
          apps().catch(() => []),
        ]);
        // Candidates for the frontmost adapter, minus shells and the console.
        const choices = running.filter((app) => !isProtected(app));
        sendJson(res, 200, { current, targets, apps: choices });
        return true;
      }
      if (action === "connect" && req.method === "POST") {
        const { app, process } = await body(req);
        if (!bridge.has(app)) throw new HttpError(400, "Неизвестная цель.");
        if (process !== undefined && typeof process !== "string")
          throw new HttpError(400, "process должен быть строкой.");
        try {
          sendJson(res, 200, await bridge.connect(app, { process }));
        } catch (error) {
          throw refused(error);
        }
        return true;
      }
      if (action === "current" && req.method === "DELETE") {
        sendJson(res, 200, await bridge.disconnect());
        return true;
      }
      return false;
    }

    if (section === "control") {
      if (action === undefined && req.method === "POST") {
        const { gesture, locked } = await body(req);
        if (gesture === "toggle")
          throw new HttpError(
            400,
            "toggle — это блокировка жестов, в приложение она не отправляется.",
          );
        if (gesture !== "next" && gesture !== "previous")
          throw new HttpError(400, "gesture должен быть next или previous.");
        if (locked !== undefined && typeof locked !== "boolean")
          throw new HttpError(400, "locked должен быть true или false.");
        let status;
        try {
          status = await bridge.control(gesture, locked);
        } catch (error) {
          throw refused(error);
        }
        // An app that refused the step is reported, not passed off as success.
        sendJson(res, status.error ? 409 : 200, status);
        return true;
      }
      if (action === "state" && req.method === "GET") {
        const status = await bridge.state();
        sendJson(res, 200, { ...status, locked: bridge.locked });
        return true;
      }
      return false;
    }

    if (section === "overlay" && action === undefined) {
      if (req.method === "GET") {
        sendJson(res, 200, {
          visible: hub.overlay.visible,
          displayId: hub.overlay.displayId,
          displays: hub.displays,
          shellConnected: hub.online("shell"),
        });
        return true;
      }
      if (req.method === "POST") {
        const { visible, displayId } = await body(req);
        if (typeof visible !== "boolean")
          throw new HttpError(400, "visible должен быть true или false.");
        if (
          displayId !== undefined &&
          displayId !== null &&
          !Number.isInteger(displayId)
        )
          throw new HttpError(400, "displayId должен быть числом.");
        if (
          typeof displayId === "number" &&
          hub.displays.length &&
          !hub.displays.some((display) => display.id === displayId)
        )
          throw new HttpError(400, "Такого дисплея нет.");
        const overlay = hub.setOverlay(
          visible,
          displayId === undefined ? hub.overlay.displayId : typeof displayId === "number" ? displayId : null,
        );
        sendJson(res, 200, {
          visible: overlay.visible,
          displayId: overlay.displayId,
          shellConnected: hub.online("shell"),
        });
        return true;
      }
    }
    return false;
  };
}
