import { app, BrowserWindow, screen, session } from "electron";
import type { Display } from "electron";

/**
 * The notch on the audience screen: a click-through, never-focused window
 * above full-screen Keynote/PowerPoint. It shows the same Avatar page and has
 * no camera of its own; poses arrive from the speaker tab through the bridge.
 */
const pageOrigin = process.env.PITCHFLOW_ORIGIN ?? "http://localhost:5173";
const bridgeOrigin = process.env.PITCHFLOW_BRIDGE ?? "http://127.0.0.1:8787";
const pageUrl = `${pageOrigin}/?overlay=1&bridge=${encodeURIComponent(bridgeOrigin)}`;
const size = { width: 320, height: 96 };
const topMargin = 10;

let win: BrowserWindow | null = null;
let socket: WebSocket | null = null;
let wanted = { visible: false, displayId: null as number | null };

// Not a second app in the Dock next to the speaker console.
if (process.platform === "darwin") app.setActivationPolicy("accessory");
app.dock?.hide();

/** The chosen display, else the external monitor, else the main one. */
function pickDisplay(id: number | null): Display {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return (
    displays.find((display) => display.id === id) ??
    displays.find((display) => display.id !== primary.id) ??
    primary
  );
}

function place() {
  if (!win) return;
  const { bounds } = pickDisplay(wanted.displayId);
  win.setBounds({
    x: Math.round(bounds.x + (bounds.width - size.width) / 2),
    y: bounds.y + topMargin,
    ...size,
  });
  if (wanted.visible) win.showInactive();
  else win.hide();
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
    if (socket === current) socket = null;
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
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
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
  place();
  connect();
  for (const event of [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ] as const)
    screen.on(event as "display-added", () => {
      report();
      place();
    });
});

app.on("window-all-closed", () => app.quit());
