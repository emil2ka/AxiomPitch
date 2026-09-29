import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/src/app.ts";
import type { FrontApp, MacSystem } from "../server/src/bridge/osascript.ts";
import { TargetError } from "../server/src/bridge/target.ts";
import type {
  SlideState,
  Target,
  TargetId,
} from "../server/src/bridge/target.ts";

/** A valid PDF with blank pages, small enough to build in memory. */
export function makePdf(pages: number): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (let i = 0; i < pages; i++) {
    kids.push(`${objects.length + 1} 0 R`);
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] >>");
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let text = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(text);
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text, "latin1"));
}

/** Records every call; moves within its own deck like a real slideshow. */
export class FakeTarget implements Target {
  readonly id: TargetId;
  readonly label = "Fake";
  calls: string[] = [];
  state: SlideState | null;
  failure: string | null = null;
  constructor(
    id: TargetId = "keynote",
    state: SlideState | null = { slideIndex: 0, slideCount: 5 },
  ) {
    this.id = id;
    this.state = state;
  }
  count(call: string) {
    return this.calls.filter((name) => name === call).length;
  }
  async available() {
    return true;
  }
  async connect() {
    this.calls.push("connect");
  }
  async disconnect() {
    this.calls.push("disconnect");
  }
  async next() {
    this.move("next", 1);
  }
  async previous() {
    this.move("previous", -1);
  }
  async readState() {
    return this.state && { ...this.state };
  }
  private move(call: string, delta: number) {
    this.calls.push(call);
    if (this.failure) throw new TargetError(this.failure);
    if (this.state)
      this.state = {
        ...this.state,
        slideIndex: Math.max(
          0,
          Math.min(this.state.slideCount - 1, this.state.slideIndex + delta),
        ),
      };
  }
}

export type FakeSystem = MacSystem & {
  keys: number[];
  scripts: string[];
  front: FrontApp | null;
  reply: string;
};

/** macOS without macOS: frontmost app and AppleScript replies are set by the test. */
export function fakeSystem(front: FrontApp | null = null): FakeSystem {
  const system: FakeSystem = {
    keys: [],
    scripts: [],
    front,
    reply: "",
    async run(source) {
      system.scripts.push(source);
      return system.reply;
    },
    async isRunning() {
      return true;
    },
    async frontmost() {
      return system.front;
    },
    async apps() {
      return [
        { name: "Preview", bundleId: "com.apple.Preview" },
        { name: "Terminal", bundleId: "com.apple.Terminal" },
      ];
    },
    async keyCode(code) {
      system.keys.push(code);
    },
  };
  return system;
}

export async function startServer(
  targets: Target[] = [],
  system: MacSystem = fakeSystem(),
) {
  const dataDir = mkdtempSync(join(tmpdir(), "pitchflow-test-"));
  const app = createApp({ dataDir, targets, system });
  const port = await app.listen(0);
  return {
    app,
    port,
    base: `http://127.0.0.1:${port}`,
    async stop() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
