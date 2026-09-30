import type { Gesture, VisionFrame } from "./types";
import type { AvatarHandle } from "../components/Avatar";

export type WebNotchState = { visible: boolean; locked: boolean; scale: number; message: string; cameraReady: boolean };
export const emptyWebNotch = (): WebNotchState => ({ visible: false, locked: false, scale: 1, message: "", cameraReady: false });
/** Coordinates go straight to the scene, without a React render for every camera frame. */
export class WebNotchFeed {
  private listeners = new Set<Pick<AvatarHandle, "draw" | "clear" | "react">>();
  private frame: VisionFrame | null = null;
  subscribe(avatar: Pick<AvatarHandle, "draw" | "clear" | "react">) {
    this.listeners.add(avatar);
    this.replay(avatar);
    return () => { this.listeners.delete(avatar); };
  }
  replay(avatar: Pick<AvatarHandle, "draw" | "clear" | "react">) { if (this.frame) avatar.draw(this.frame); }
  draw(frame: VisionFrame) { this.frame = frame; for (const avatar of this.listeners) avatar.draw(frame); }
  clear() { this.frame = null; for (const avatar of this.listeners) avatar.clear(); }
  react(gesture: Gesture) { for (const avatar of this.listeners) avatar.react(gesture); }
}
