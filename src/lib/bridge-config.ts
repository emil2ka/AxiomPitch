import { apiBase } from "./api.ts";
const env = import.meta.env as ImportMetaEnv | undefined;
/** The desktop bridge always lives on this device, independently of cloud APIs. */
export const isLocalBridge = (value: string) => /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(value);
const configured = (env?.VITE_BRIDGE_BASE_URL ?? "").replace(/\/+$/, "");
export const bridgeBase = isLocalBridge(configured) ? configured : isLocalBridge(apiBase) ? apiBase : "http://127.0.0.1:8787";
export const bridgeConfigured = isLocalBridge(configured) || isLocalBridge(apiBase);
