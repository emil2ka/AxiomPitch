import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Avatar } from "./Avatar";
import type { AvatarHandle } from "./Avatar";
import type { WebNotchFeed, WebNotchState } from "../lib/web-notch";

export function WebNotch({ feed, state, onHide }: { feed: WebNotchFeed; state: WebNotchState; onHide?: () => void }) {
  const avatar = useRef<AvatarHandle>(null);
  useEffect(() => {
    if (!state.visible || !avatar.current) return;
    return feed.subscribe(avatar.current);
  }, [feed, state.visible]);
  if (!state.visible) return null;
  return <aside className="web-notch" style={{ "--notch-scale": state.scale } as CSSProperties} aria-label="Чёлка в браузере">
    <div className="web-notch-avatar"><Avatar ref={avatar} locked={state.locked} face="none" headStyle="ghost" onReady={() => { if (avatar.current) feed.replay(avatar.current); }} /></div>
    {state.cameraReady && state.message && <p role="status">{state.message}</p>}
    {onHide && <button className="web-notch-close" aria-label="Скрыть чёлку до следующего выступления" onClick={onHide}><X size={14} /></button>}
  </aside>;
}
