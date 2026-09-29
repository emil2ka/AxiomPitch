import { execFile } from "node:child_process";
import { TargetError } from "./target.ts";

export type AppRef = { name: string; bundleId: string };
/** windowTitle is null when macOS denies access to window names. */
export type FrontApp = AppRef & { windowTitle: string | null };

/** Everything the adapters need from macOS, so tests can swap it out. */
export type MacSystem = {
  run: (source: string) => Promise<string>;
  isRunning: (bundleId: string) => Promise<boolean>;
  frontmost: () => Promise<FrontApp | null>;
  apps: () => Promise<AppRef[]>;
  /** 123 is Left arrow, 124 is Right arrow. */
  keyCode: (code: 123 | 124) => Promise<void>;
};

function exec(file: string, args: string[], timeout = 4000) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(String(stdout).trim());
    });
  });
}

/** Turns macOS privacy refusals into advice the speaker can act on. */
export function explainAppleScriptError(message: string): string {
  if (/-1743|not authori[sz]ed to send apple events/i.test(message))
    return "macOS запретил управление приложением: разреши его в Настройки → Конфиденциальность → Автоматизация.";
  if (
    /-1719|-25211|assistive access|not allowed to send keystrokes/i.test(
      message,
    )
  )
    return "Нужен Универсальный доступ: добавь терминал с сервером в Настройки → Конфиденциальность → Универсальный доступ.";
  if (/-1712|timed out/i.test(message))
    return "Приложение не ответило вовремя. Попробуй ещё раз.";
  return "Приложение не приняло команду. Проверь, что показ слайдов открыт.";
}

export async function osascript(source: string): Promise<string> {
  if (process.platform !== "darwin")
    throw new TargetError("Управление приложениями работает только на macOS.");
  try {
    return await exec("osascript", ["-e", source]);
  } catch (error) {
    throw new TargetError(
      explainAppleScriptError(error instanceof Error ? error.message : ""),
    );
  }
}

const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

/** Parses `lsappinfo list` into regular (Dock) apps. */
export function parseAppList(text: string): AppRef[] {
  const apps: AppRef[] = [];
  for (const block of text.split(/\n(?=\s*\d+\) ")/)) {
    const name = /^\s*\d+\) "([^"]+)"/.exec(block)?.[1];
    const bundleId = /bundleID="([^"]+)"/.exec(block)?.[1];
    if (name && bundleId && /type="Foreground"/.test(block))
      apps.push({ name: name.replace(/^\u200e/, ""), bundleId });
  }
  return apps;
}

export const macSystem: MacSystem = {
  run: osascript,
  async isRunning(bundleId) {
    try {
      return (
        (await osascript(`application id ${quote(bundleId)} is running`)) ===
        "true"
      );
    } catch {
      // Not installed: AppleScript cannot resolve the bundle id.
      return false;
    }
  },
  async frontmost() {
    if (process.platform !== "darwin") return null;
    // lsappinfo needs no privacy permission, so the process check always works.
    const asn = await exec("lsappinfo", ["front"]).catch(() => "");
    if (!asn) return null;
    const info = await exec("lsappinfo", [
      "info",
      "-only",
      "name,bundleid",
      asn,
    ]).catch(() => "");
    const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1];
    const bundleId = /"CFBundleIdentifier"="([^"]*)"/.exec(info)?.[1] ?? "";
    if (!name) return null;
    let windowTitle: string | null = null;
    try {
      windowTitle = await exec("osascript", [
        "-e",
        'tell application "System Events" to tell (first application process whose frontmost is true) to return name of front window',
      ]);
    } catch {
      windowTitle = null;
    }
    return { name: name.replace(/^\u200e/, ""), bundleId, windowTitle };
  },
  async apps() {
    if (process.platform !== "darwin") return [];
    return parseAppList(await exec("lsappinfo", ["list"]).catch(() => ""));
  },
  async keyCode(code) {
    await osascript(`tell application "System Events" to key code ${code}`);
  },
};
