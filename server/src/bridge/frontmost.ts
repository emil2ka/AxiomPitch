import { macSystem } from "./osascript.ts";
import type { AppRef, FrontApp, MacSystem } from "./osascript.ts";
import { TargetError } from "./target.ts";
import type {
  ConnectOptions,
  SlideState,
  Target,
  TargetId,
} from "./target.ts";

/** Never type arrows into the console, a shell, Finder or the notch window. */
const protectedBundles = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "com.apple.finder",
  "com.github.Electron",
]);
const protectedNames = /^(terminal|iterm2?|warp|finder|electron|pitchflow|axiompitch)$/i;
/** The speaker console is a browser tab titled AxiomPitch or PitchFlow. */
const consoleTitle = /pitchflow|axiompitch/i;

export const isProtected = (app: AppRef) =>
  protectedBundles.has(app.bundleId) || protectedNames.test(app.name);

/** Why an arrow must not be sent right now, or null if the connected app is in front. */
export function refuseReason(
  front: FrontApp | null,
  connected: AppRef,
): string | null {
  if (!front) return "Не удалось определить активное приложение.";
  if (isProtected(front))
    return `Впереди ${front.name}: стрелка не отправлена.`;
  const same = front.bundleId
    ? front.bundleId === connected.bundleId
    : front.name === connected.name;
  if (!same)
    return `Впереди ${front.name}, а подключено ${connected.name}: стрелка не отправлена.`;
  if (front.windowTitle === null)
    return "macOS не показал окно приложения: разреши Универсальный доступ для терминала с сервером.";
  if (consoleTitle.test(front.windowTitle))
    return "Впереди окно PitchFlow: стрелка не отправлена.";
  return null;
}

/**
 * Fallback adapter: Right/Left arrow through System Events, only into the
 * process the speaker connected explicitly. There is no slide number to read.
 */
export class FrontmostTarget implements Target {
  readonly id: TargetId;
  private system: MacSystem;
  private fixed: AppRef | null;
  private connected: AppRef | null = null;
  private title: string;
  constructor(
    system: MacSystem = macSystem,
    fixed: AppRef | null = null,
    id: TargetId = "frontmost",
    title = "Другое приложение",
  ) {
    this.system = system;
    this.fixed = fixed;
    this.id = id;
    this.title = title;
  }
  get label() {
    return this.connected && !this.fixed
      ? `${this.connected.name} (стрелки)`
      : this.title;
  }
  async available() {
    if (this.fixed) return this.system.isRunning(this.fixed.bundleId);
    return process.platform === "darwin";
  }
  async connect(options: ConnectOptions = {}) {
    if (this.fixed) {
      if (!(await this.available()))
        throw new TargetError(`${this.fixed.name} не запущен.`);
      this.connected = this.fixed;
      return;
    }
    const wanted = options.process?.trim();
    if (!wanted)
      throw new TargetError("Выбери приложение, в которое отправлять стрелки.");
    const app = (await this.system.apps()).find(
      (candidate) =>
        candidate.bundleId === wanted || candidate.name === wanted,
    );
    if (!app) throw new TargetError(`${wanted} не запущено.`);
    if (isProtected(app))
      throw new TargetError(
        `${app.name} нельзя подключить: стрелки попадут не в слайды.`,
      );
    this.connected = app;
  }
  async disconnect() {
    this.connected = null;
  }
  next() {
    return this.press(124);
  }
  previous() {
    return this.press(123);
  }
  async readState(): Promise<SlideState | null> {
    return null;
  }
  private async press(code: 123 | 124) {
    if (!this.connected)
      throw new TargetError("Приложение для стрелок не подключено.");
    const reason = refuseReason(await this.system.frontmost(), this.connected);
    if (reason) throw new TargetError(reason);
    await this.system.keyCode(code);
  }
}
