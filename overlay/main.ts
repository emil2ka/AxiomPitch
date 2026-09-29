import { app, BrowserWindow, screen, session } from "electron";
import type { Display } from "electron";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { notchBounds, notchSize, overClose } from "./geometry.ts";

/**
 * The notch on the audience screen: a click-through, never-focused window
 * above full-screen Keynote/PowerPoint. It shows the same Avatar page and has
 * no camera of its own; poses arrive from the speaker tab through the bridge.
 */
const pageOrigin = process.env.PITCHFLOW_ORIGIN ?? "http://localhost:5173";
const bridgeOrigin = process.env.PITCHFLOW_BRIDGE ?? "http://127.0.0.1:8787";
const pageUrl = `${pageOrigin}/?overlay=1&bridge=${encodeURIComponent(bridgeOrigin)}`;
const size = notchSize;
let geometry: { id: number; safeTop: number; center: number }[] = [];
let pointerTimer: ReturnType<typeof setInterval> | undefined;

let win: BrowserWindow | null = null;
let socket: WebSocket | null = null;
let wanted = { visible: false, displayId: null as number | null };

// Not a second app in the Dock next to the speaker console.
if (process.platform === "darwin") app.setActivationPolicy("accessory");
app.dock?.hide();

/** Default to the Mac's physical notch, with an explicit display override. */
function pickDisplay(id: number | null): Display {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return (
    displays.find((display) => display.id === id) ??
    displays.find((display) => geometry.some(item => item.id === display.id && item.safeTop > 0)) ??
    displays.find((display) => display.internal) ??
    primary
  );
}

function place() {
  if (!win) return;
  const display = pickDisplay(wanted.displayId);
  const { bounds } = display;
  const native = geometry.find(item => item.id === display.id);
  win.setBounds(notchBounds(bounds, native?.safeTop, native?.center));
  if (process.env.PITCHFLOW_OVERLAY_DEBUG === "1") console.info("[overlay]", JSON.stringify({ bounds: win.getBounds(), safeTop: native?.safeTop ?? 0, visible: wanted.visible }));
  if (wanted.visible) win.showInactive();
  else win.hide();
}

function refreshGeometry() {
  if (process.platform !== "darwin") return place();
  execFile(fileURLToPath(new URL("../work/overlay/screen-geometry", import.meta.url)), [], { timeout: 3000 }, (error, stdout) => {
    if (!error) {
      try { geometry = JSON.parse(stdout); } catch { /* Retain last known geometry. */ }
    }
    place();
  });
}

function displays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `${display.size.width}×${display.size.height}`,
    primary: display.id === primary,
    width: display.size.width,
    height: display.size.height,
  }));
}

function report() {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "displays", displays: displays() }));
}

function connect() {
  const url = `${bridgeOrigin.replace(/^http/, "ws")}/live?role=shell`;
  const current = new WebSocket(url);
  socket = current;
  current.addEventListener("open", report);
  current.addEventListener("message", (event) => {
    let message: {
      type?: string;
      overlay?: unknown;
      visible?: unknown;
      displayId?: unknown;
    };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const overlay = (
      message.type === "hello"
        ? message.overlay
        : message.type === "overlay"
          ? message
          : null
    ) as { visible?: unknown; displayId?: unknown } | null;
    if (!overlay) return;
    wanted = {
      visible: overlay.visible === true,
      displayId:
        typeof overlay.displayId === "number" ? overlay.displayId : null,
    };
    place();
  });
  current.addEventListener("close", () => {
    if (socket === current) {
      socket = null;
      wanted.visible = false;
      place();
    }
    setTimeout(connect, 1500);
  });
  current.addEventListener("error", () => current.close());
}

function createWindow() {
  win = new BrowserWindow({
    ...size,
    // NSPanel: can float over another app's full-screen Space.
    type: "panel",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Frameless + this flag: macOS keeps the exact frame instead of pushing
    // the window below the menu bar.
    enableLargerThanScreen: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setFocusable(false);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  // Keep the avatar click-through. Only the close button receives clicks;
  // polling also works when the cursor arrives from another full-screen app.
  pointerTimer = setInterval(() => {
    if (win && !win.isDestroyed())
      win.setIgnoreMouseEvents(!win.isVisible() || !overClose(screen.getCursorScreenPoint(), win.getBounds()));
  }, 50);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  // Vite may start after the notch: keep retrying instead of showing an error page.
  win.webContents.on(
    "did-fail-load",
    (_event, _code, _text, _url, mainFrame) => {
      if (mainFrame)
        setTimeout(() => win?.loadURL(pageUrl).catch(() => undefined), 2000);
    },
  );
  win.loadURL(pageUrl).catch(() => undefined);
}

void app.whenReady().then(() => {
  // The only camera belongs to the speaker tab; the notch may not open another.
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  createWindow();
  refreshGeometry();
  connect();
  for (const event of [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ] as const)
    screen.on(event as "display-added", () => {
      report();
      refreshGeometry();
    });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => clearInterval(pointerTimer));
