import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createChromeTarget } from "./bridge/chrome.ts";
import { Bridge } from "./bridge/controller.ts";
import { FrontmostTarget } from "./bridge/frontmost.ts";
import { KeynoteTarget } from "./bridge/keynote.ts";
import { macSystem } from "./bridge/osascript.ts";
import type { MacSystem } from "./bridge/osascript.ts";
import { PitchflowTarget } from "./bridge/pitchflow.ts";
import { PowerPointTarget } from "./bridge/powerpoint.ts";
import type { Target } from "./bridge/target.ts";
import { Store } from "./db.ts";
import { HttpError, sendJson } from "./http.ts";
import type { Route } from "./http.ts";
import { controlRoutes } from "./routes/control.ts";
import { presentationRoutes } from "./routes/presentations.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { profileRoutes } from "./routes/profiles.ts";
import { LiveHub } from "./ws.ts";

/** Exact trusted web origins; the bridge still listens only on loopback. */
export const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://axiompitch.vercel.app",
];

export type AppOptions = {
  dataDir: string;
  /** macOS access for the real adapters; tests pass a fake. */
  system?: MacSystem;
  /** Replaces the external adapters (PitchFlow is always present). */
  targets?: Target[];
  origins?: string[];
};

export function createApp(options: AppOptions) {
  const system = options.system ?? macSystem;
  const origins = new Set(options.origins ?? defaultOrigins);
  // Non-browser clients (Electron main, curl) send no Origin at all.
  const allowOrigin = (origin: string | undefined) =>
    origin === undefined || origins.has(origin);
  const store = new Store(options.dataDir);
  const hub = new LiveHub(allowOrigin, {
    onCommand: (command) => {
      void bridge.handleCommand(command.gesture, command.locked);
    },
    onSession: (session) =>
      session.stage !== "checking" && pitchflow.mirror({
        slideIndex: session.index,
        slideCount: session.slideCount,
      }),
  });
  const pitchflow = new PitchflowTarget({
    online: () => hub.online("speaker"),
    step: (gesture) => hub.stepSpeaker(gesture),
  });
  const bridge = new Bridge(
    [
      pitchflow,
      ...(options.targets ?? [
        new KeynoteTarget(system),
        new PowerPointTarget(system),
        createChromeTarget(system),
        new FrontmostTarget(system),
      ]),
    ],
    (status) => hub.broadcast(status),
    "pitchflow",
  );
  const routes: Route[] = [
    profileRoutes(store),
    presentationRoutes(store),
    sessionRoutes(store),
    controlRoutes(bridge, hub, () => system.apps()),
  ];

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader("vary", "Origin");
    // A DNS-rebinding page arrives with a foreign Host header.
    if (!hostAllowed(req.headers.host))
      return sendJson(res, 403, { error: "Неизвестный адрес сервера." });
    if (!allowOrigin(origin))
      return sendJson(res, 403, { error: "Запросы с чужих сайтов запрещены." });
    if (origin) res.setHeader("access-control-allow-origin", origin);
    if (req.method === "OPTIONS") {
      res.setHeader(
        "access-control-allow-methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.setHeader("access-control-allow-headers", "content-type, x-axiom-profile");
      res.setHeader("access-control-max-age", "600");
      res.statusCode = 204;
      return res.end();
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api")
      return sendJson(res, 404, { error: "Не найдено." });
    try {
      const context = {
        req,
        res,
        url,
        path: segments.slice(1).map(decodeURIComponent),
        base: `http://${req.headers.host}`,
      };
      for (const route of routes) if (await route(context)) return;
      sendJson(res, 404, { error: "Не найдено." });
    } catch (error) {
      if (res.headersSent) return void res.destroy();
      if (error instanceof HttpError)
        sendJson(res, error.status, { error: error.message });
      else if (error instanceof URIError)
        sendJson(res, 400, { error: "Некорректный адрес." });
      else {
        console.error(error);
        sendJson(res, 500, { error: "Внутренняя ошибка сервера." });
      }
    }
  });
  server.on("upgrade", (req, socket, head) => {
    if (!hostAllowed(req.headers.host)) return void socket.destroy();
    hub.upgrade(req, socket, head);
  });

  function hostAllowed(host: string | undefined) {
    const port = (server.address() as AddressInfo | null)?.port;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }

  return {
    server,
    store,
    hub,
    bridge,
    /** Loopback only: the bridge types into other apps and must not face the network. */
    listen(port = 8787) {
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve((server.address() as AddressInfo).port);
        });
      });
    },
    close() {
      hub.close();
      server.closeAllConnections();
      return new Promise<void>((resolve) =>
        server.close(() => {
          store.close();
          resolve();
        }),
      );
    },
  };
}
