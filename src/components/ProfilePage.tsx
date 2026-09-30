import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, LogOut, Database, Users } from "lucide-react";
import { accountInitials, looksLikeEmail, updateAccount } from "../lib/account";
import type { LocalAccount } from "../lib/account";
export function ProfilePage({ account, onSave, onLogout, sessionActive, profiles, onSwitch, onCreate, databaseStatus, databaseError, stats, onRetry, browserOnlyPdf }: {
  browserOnlyPdf: boolean; onCreate: () => void; profiles: LocalAccount[]; onSwitch: (id: string) => Promise<void>; databaseStatus: "connected" | "offline" | "error" | "connecting"; databaseError: string; stats: { sessions: number; duration: number; presentations: number } | null; onRetry: () => void;
  account: LocalAccount; onSave: (account: LocalAccount) => void; onLogout: () => void; sessionActive: boolean;
}) {
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const [switching, setSwitching] = useState(false);
  const [selected, setSelected] = useState(account.id);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const dirty = name.trim() !== account.name || email.trim() !== account.email;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || (email.trim() && !looksLikeEmail(email))) {
      setError(true); setMessage(name.trim().length < 2 ? "Напиши имя — хотя бы два символа." : "Проверь адрес почты."); return;
    }
    try { onSave(updateAccount(account.id, name, email)); setError(false); setMessage("Изменения сохранены."); }
    catch (failure) { setError(true); setMessage(failure instanceof Error ? failure.message : "Не удалось сохранить профиль."); }
  };
  return <section className="settings-page profile-page" aria-labelledby="profile-title">
    <h1 id="profile-title" tabIndex={-1}>Мой профиль</h1>
    <p className="page-lead">Твоё рабочее пространство на этом устройстве.</p>
    <div className="profile-intro"><span className="profile-avatar">{accountInitials(account.name)}</span><div><strong>{account.name}</strong><p>Локальный профиль · без пароля</p></div></div>
    <form className="profile-form" onSubmit={submit} noValidate>
      <label htmlFor="profile-name">Имя</label><input id="profile-name" autoComplete="given-name" maxLength={80} value={name} onChange={event => { setName(event.target.value); setMessage(""); }} />
      <label htmlFor="profile-email">Почта <span>необязательно</span></label><input id="profile-email" type="email" autoComplete="email" maxLength={254} value={email} placeholder="you@example.com" onChange={event => { setEmail(event.target.value); setMessage(""); }} />
      <p className="settings-note">Почта — подпись профиля. Письма не отправляются.</p>
      <button className="button primary" disabled={!dirty} type="submit">Сохранить изменения <ArrowRight size={16} /></button>
      {message && <p className={`profile-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{message}</p>}
    </form>
    <section className="profile-database"><h2><Database size={17} />Твоя база</h2><p role="status">{databaseStatus === "connected" ? "Профиль подключён к базе на этом компьютере" : databaseStatus === "connecting" ? "Подключаем профиль…" : databaseStatus === "offline" ? "База выключена · сохраняем в браузере" : "Не удалось подключить базу"}</p>
      {databaseStatus === "connected" && stats && <dl className="profile-statistics"><div><dt>Презентации</dt><dd>{stats.presentations}</dd></div><div><dt>Сессии</dt><dd>{stats.sessions}</dd></div><div><dt>На сцене</dt><dd>{Math.round(stats.duration / 60000)} мин</dd></div></dl>}
      {databaseStatus === "error" && <><p className="profile-message error">{databaseError}</p><button className="text-button" onClick={onRetry}>Повторить подключение</button></>}
      {databaseStatus === "connected" && browserOnlyPdf && <p className="settings-note">Этот PDF пока только в браузере. Загрузить его снова — сохранить копию в базе.</p>}
      <p className="settings-note">PDF, результаты и настройки связаны с твоим профилем. Выход их не удаляет.</p>
    </section>
    <section className="profile-switch"><h2><Users size={17} />Профили на компьютере</h2><label htmlFor="switch-profile">Выбери профиль</label><select id="switch-profile" value={selected} disabled={sessionActive || switching} onChange={event => setSelected(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === account.id ? " · текущий" : ""}</option>)}</select>
      <button className="button secondary" disabled={sessionActive || switching || selected === account.id} onClick={() => { setSwitching(true); void onSwitch(selected).finally(() => setSwitching(false)); }}>{switching ? "Сохраняем работу…" : "Переключить профиль"}</button>
      <a className="text-button" href="/register" aria-disabled={sessionActive || undefined} onClick={event => { event.preventDefault(); if (!sessionActive) onCreate(); }}>Создать другой профиль</a>
    </section>
    <button className="text-button" disabled={sessionActive} onClick={onLogout}><LogOut size={16} />Выйти из профиля</button>
    {sessionActive && <p className="settings-note">Сначала заверши выступление, чтобы выйти.</p>}
  </section>;
}
