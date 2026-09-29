import { TargetError } from "./target.ts";
import type { ConnectOptions, Target, TargetId } from "./target.ts";

export type Step = "next" | "previous";
export type Gesture = Step | "toggle";

/** What the bridge tells clients after each connect and each step. */
export type TargetStatus = {
  type: "target";
  app: TargetId | null;
  label: string | null;
  connected: boolean;
  /** Zero-based and straight from the app. null means unknown, never a guess. */
  slideIndex: number | null;
  slideCount: number | null;
  gesture?: Step;
  error?: string;
};

export type TargetInfo = {
  id: TargetId;
  label: string;
  available: boolean;
  connected: boolean;
};

const explain = (error: unknown) =>
  error instanceof TargetError
    ? error.message
    : "Приложение не приняло команду.";

/**
 * Routes steps to the connected app. The browser has already recognised the
 * gesture; the bridge only honours the lock and moves the slide once.
 */
export class Bridge {
  /** Lock state from the latest command the speaker tab sent. */
  locked = false;
  private targets: Map<TargetId, Target>;
  private current: Target | null = null;
  private publish: (status: TargetStatus) => void;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    targets: Target[],
    publish: (status: TargetStatus) => void = () => {},
    initial?: TargetId,
  ) {
    this.targets = new Map(targets.map((target) => [target.id, target]));
    this.publish = publish;
    this.current = (initial && this.targets.get(initial)) || null;
  }

  get app(): TargetId | null {
    return this.current?.id ?? null;
  }

  has(id: unknown): id is TargetId {
    return typeof id === "string" && this.targets.has(id as TargetId);
  }

  list(): Promise<TargetInfo[]> {
    return Promise.all(
      [...this.targets.values()].map(async (target) => ({
        id: target.id,
        label: target.label,
        available: await target.available().catch(() => false),
        connected: target === this.current,
      })),
    );
  }

  connect(id: TargetId, options?: ConnectOptions) {
    return this.serial(async () => {
      const target = this.targets.get(id);
      if (!target) throw new TargetError("Неизвестная цель.");
      // A failed connect keeps the previous app connected.
      await target.connect(options);
      if (this.current && this.current !== target)
        await this.current.disconnect().catch(() => undefined);
      this.current = target;
      const status = await this.snapshot();
      this.publish(status);
      return status;
    });
  }

  disconnect() {
    return this.serial(async () => {
      await this.current?.disconnect().catch(() => undefined);
      this.current = null;
      const status = this.idle();
      this.publish(status);
      return status;
    });
  }

  /** A command the speaker tab published over WebSocket. */
  handleCommand(gesture: Gesture, locked: boolean) {
    this.locked = locked;
    // Toggle is the gesture lock itself and never reaches the slide app.
    if (gesture === "toggle" || locked) return Promise.resolve(null);
    // The tab already moved its own deck; the mirror follows its session.
    if (!this.current || this.current.id === "pitchflow")
      return Promise.resolve(null);
    return this.step(gesture);
  }

  /** POST /api/control: refuses while locked instead of stepping anyway. */
  async control(gesture: Step, locked?: boolean) {
    if (locked ?? this.locked)
      throw new TargetError("Жесты заблокированы: слайд не переключён.");
    if (!this.current) throw new TargetError("Цель не подключена.");
    return this.step(gesture);
  }

  state() {
    return this.serial(() => this.snapshot());
  }

  private step(gesture: Step) {
    return this.serial(async () => {
      const target = this.current;
      if (!target) return this.idle();
      let error: string | undefined;
      try {
        await (gesture === "next" ? target.next() : target.previous());
      } catch (caught) {
        error = explain(caught);
      }
      const status: TargetStatus = {
        ...(await this.snapshot()),
        gesture,
        ...(error ? { error } : {}),
      };
      this.publish(status);
      return status;
    });
  }

  private async snapshot(): Promise<TargetStatus> {
    const target = this.current;
    if (!target) return this.idle();
    const state = await target.readState().catch(() => null);
    return {
      type: "target",
      app: target.id,
      label: target.label,
      connected: true,
      slideIndex: state?.slideIndex ?? null,
      slideCount: state?.slideCount ?? null,
    };
  }

  private idle(): TargetStatus {
    return {
      type: "target",
      app: null,
      label: null,
      connected: false,
      slideIndex: null,
      slideCount: null,
    };
  }

  /** osascript calls must not overlap, or two steps could land out of order. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
