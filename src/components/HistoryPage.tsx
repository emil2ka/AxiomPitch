import { ChevronRight, History } from "lucide-react";
import { formatTime } from "../lib/deck";
import type { SessionResult } from "../lib/types";
export function HistoryPage({ history, onOpen, onStudio }: { history: SessionResult[]; onOpen: (result: SessionResult) => void; onStudio: () => void }) {
  return <section className="settings-page history-page" aria-labelledby="history-title">
    <h1 id="history-title" tabIndex={-1}>История</h1><p className="page-lead">Последние десять сессий твоего профиля на этом устройстве.</p>
    {history.length === 0 ? <div className="history-empty-state"><History size={30} strokeWidth={1.3} /><h2>Здесь будет твой прогресс</h2><p>Заверши первую репетицию — сохраним время по слайдам, команды и подсказки.</p><button className="button primary" onClick={onStudio}>Перейти в студию <ChevronRight size={16} /></button></div> : <div className="history-list">{history.map(item => <button className="history-item" key={item.id} onClick={() => onOpen(item)}>
      <span><strong>{item.name}</strong><span>{new Date(item.startedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {item.mode === "rehearsal" ? "Репетиция" : "Выступление"}</span></span>
      <span>{formatTime(item.duration)}<ChevronRight size={17} /></span>
    </button>)}</div>}
  </section>;
}
