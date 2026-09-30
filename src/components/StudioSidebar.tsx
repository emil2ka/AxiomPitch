import { useState } from "react";
import { GraduationCap, History, PanelLeftClose, PanelLeftOpen, Presentation, ScanLine, SlidersHorizontal } from "lucide-react";
import { PitchBrand } from "./PitchBrand";
import { accountInitials, loadAccount, profileStorage } from "../lib/account";
import type { LocalAccount } from "../lib/account";

export type StudioView = "deck" | "test" | "present" | "settings" | "history" | "profile";
export function StudioSidebar({ active, onNavigate, account: supplied, sessionActive = false }: {
  active: StudioView | "learn";
  onNavigate?: (view: StudioView) => void;
  account?: LocalAccount | null;
  sessionActive?: boolean;
}) {
  const account = supplied ?? loadAccount();
  const storage = profileStorage(account?.id ?? "guest");
  const [collapsed, setCollapsed] = useState(() => storage.getItem("axiompitch-sidebar") === "collapsed");
  const toggle = () => setCollapsed(value => {
    try { storage.setItem("axiompitch-sidebar", value ? "expanded" : "collapsed"); } catch { /* Keep in memory. */ }
    return !value;
  });
  const entries = [
    { id: "deck", label: "Студия", icon: Presentation },
    { id: "test", label: "Тест", icon: ScanLine },
    { id: "history", label: "История", icon: History },
    { id: "learn", label: "Обучение", icon: GraduationCap },
    { id: "settings", label: "Настройки", icon: SlidersHorizontal },
  ] as const;
  const href = (id: StudioView) => id === "deck" ? "/studio" : `/studio?view=${id}`;
  return <aside className={`studio-sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Навигация студии">
    <div className="sidebar-head">
      <a className="sidebar-brand" href="/studio" aria-label="AxiomPitch — в студию" onClick={onNavigate ? event => { event.preventDefault(); onNavigate("deck"); } : undefined}><PitchBrand /></a>
      <button className="sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? "Показать панель" : "Скрыть панель"} title={collapsed ? "Показать панель" : "Скрыть панель"}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
    </div>
    <nav className="sidebar-nav">{entries.map(({ id, label, icon: Icon }) => {
      const props = { className: `sidebar-item ${active === id ? "active" : ""}`, title: label, "aria-label": label, "aria-current": active === id ? "page" as const : undefined };
      return id !== "learn" && onNavigate ? <button key={id} {...props} onClick={() => onNavigate(id)}><Icon size={16} /><span className="sidebar-label">{label}</span></button> :
        <a key={id} {...props} href={id === "learn" ? "/learn" : href(id)} aria-disabled={id === "learn" && sessionActive ? true : undefined}
          onClick={id === "learn" && sessionActive ? event => { event.preventDefault(); onNavigate?.("deck"); } : undefined}><Icon size={16} /><span className="sidebar-label">{label}</span></a>;
    })}</nav>
    <div className="sidebar-account">
      <a className={`sidebar-profile ${active === "profile" ? "active" : ""}`} href={href("profile")} aria-label="Мой профиль" aria-current={active === "profile" ? "page" : undefined}
        onClick={onNavigate ? event => { event.preventDefault(); onNavigate("profile"); } : undefined}>
        <span className="sidebar-avatar" aria-hidden="true">{accountInitials(account?.name || "")}</span>
        <span className="sidebar-account-copy"><strong>{account?.name || "Профиль"}</strong><small>{account?.ownerId ? "Аккаунт" : "На этом устройстве"}</small></span>
      </a>
    </div>
  </aside>;
}
