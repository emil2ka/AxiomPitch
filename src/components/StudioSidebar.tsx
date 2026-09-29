import { useState } from "react";
import type { ReactNode } from "react";
import {
  GraduationCap,
  History,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { PitchBrand } from "./Landing";
import { accountInitials, clearAccount, loadAccount } from "../lib/account";

export type StudioView = "deck" | "settings";

/** The single navigation block for the studio and revisited learning. */
export function StudioSidebar({
  active,
  onNavigate,
  onHistory,
}: {
  active: StudioView | "learn";
  onNavigate?: (view: StudioView) => void;
  onHistory?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("axiompitch-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const account = loadAccount();
  const toggle = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(
          "axiompitch-sidebar",
          value ? "expanded" : "collapsed",
        );
      } catch {
        // Private mode: keep the state for this tab only.
      }
      return !value;
    });
  };
  const logout = () => {
    clearAccount();
    window.location.assign("/register");
  };
  const view = (id: StudioView, label: string, icon: ReactNode) => {
    const className = `sidebar-item ${active === id ? "active" : ""}`;
    const current = active === id ? "page" : undefined;
    return onNavigate ? (
      <button className={className} title={label} aria-current={current} onClick={() => onNavigate(id)}>
        {icon}<span className="sidebar-label">{label}</span>
      </button>
    ) : (
      <a
        className={className}
        title={label}
        aria-current={current}
        href={id === "deck" ? "/studio" : "/studio?view=settings"}
      >
        {icon}<span className="sidebar-label">{label}</span>
      </a>
    );
  };

  return (
    <aside className={`studio-sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Навигация студии">
      <div className="sidebar-head">
        <a className="sidebar-brand" href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
        <button
          className="sidebar-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Показать панель" : "Скрыть панель"}
          title={collapsed ? "Показать панель" : "Скрыть панель"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="sidebar-nav">
        {view("deck", "Репетиция", <Play size={16} />)}
        <a
          className={`sidebar-item ${active === "learn" ? "active" : ""}`}
          title="Обучение"
          aria-current={active === "learn" ? "page" : undefined}
          href="/learn"
        >
          <GraduationCap size={16} /><span className="sidebar-label">Обучение</span>
        </a>
        {view("settings", "Настройки", <SlidersHorizontal size={16} />)}
        {onHistory ? (
          <button className="sidebar-item" title="История" onClick={onHistory}>
            <History size={16} /><span className="sidebar-label">История</span>
          </button>
        ) : (
          <a className="sidebar-item" title="История" href="/studio?history=1">
            <History size={16} /><span className="sidebar-label">История</span>
          </a>
        )}
      </nav>
      <div className="sidebar-account">
        <span className="sidebar-avatar" aria-hidden="true">{account ? accountInitials(account.name) : "A"}</span>
        <span className="sidebar-account-copy">
          <strong>{account?.name || "Гость"}</strong>
          <small>{account?.email || "Аккаунт не создан"}</small>
        </span>
        <button className="sidebar-logout" onClick={logout} title="Выйти" aria-label="Выйти из аккаунта">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
