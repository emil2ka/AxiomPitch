import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, LogOut, Users, Cloud } from "lucide-react";
import { accountInitials, looksLikeEmail, updateAccount } from "../lib/account";
import type { LocalAccount } from "../lib/account";
import { saveCloudProfile } from "../lib/cloud";
export type CloudStatus = { state: "syncing" | "synced" | "error"; error: string; onRetry: () => void };
export function ProfilePage({ account, onSave, onLogout, sessionActive, profiles, onSwitch, onCreate, cloud }: {
  cloud: CloudStatus | null; onCreate: () => void; profiles: LocalAccount[]; onSwitch: (id: string) => Promise<void>;
  account: LocalAccount; onSave: (account: LocalAccount) => void; onLogout: () => void; sessionActive: boolean;
}) {
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const [switching, setSwitching] = useState(false);
  const [selected, setSelected] = useState(account.id);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== account.name || email.trim() !== account.email;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || (email.trim() && !looksLikeEmail(email))) {
      setError(true); setMessage(name.trim().length < 2 ? "Напиши имя — хотя бы два символа." : "Проверь адрес почты."); return;
    }
    // The account keeps its name on the server first, so every device shows the same one.
    if (account.ownerId) {
      setSaving(true);
      try { await saveCloudProfile({ ...account, name: name.trim() }); }
      catch (failure) { setError(true); setMessage(failure instanceof Error ? failure.message : "Не удалось сохранить профиль."); return; }
      finally { setSaving(false); }
    }
    try { onSave(updateAccount(account.id, name, email)); setError(false); setMessage("Изменения сохранены."); }
    catch (failure) { setError(true); setMessage(failure instanceof Error ? failure.message : "Не удалось сохранить профиль."); }
  };
  return <section className="settings-page profile-page" aria-labelledby="profile-title">
    <h1 id="profile-title" tabIndex={-1}>Мой профиль</h1>
    <p className="page-lead">Твоё рабочее пространство на этом устройстве.</p>
    <div className="profile-intro"><span className="profile-avatar">{accountInitials(account.name)}</span><div><strong>{account.name}</strong><p>{account.ownerId ? `Аккаунт · ${account.email}` : "Локальный профиль · без пароля"}</p></div></div>
    <form className="profile-form" onSubmit={submit} noValidate>
      <label htmlFor="profile-name">Имя</label><input id="profile-name" autoComplete="given-name" maxLength={80} value={name} onChange={event => { setName(event.target.value); setMessage(""); }} />
      <label htmlFor="profile-email">Почта {!account.ownerId && <span>необязательно</span>}</label><input id="profile-email" type="email" autoComplete="email" maxLength={254} value={email} placeholder="you@example.com" readOnly={!!account.ownerId} onChange={event => { setEmail(event.target.value); setMessage(""); }} />
      <p className="settings-note">{account.ownerId ? "Почта — логин аккаунта, здесь её не сменить." : "Почта — подпись профиля. Письма не отправляются."}</p>
      <button className="button primary" disabled={!dirty || saving} type="submit">{saving ? "Сохраняем…" : "Сохранить изменения"} <ArrowRight size={16} /></button>
      {message && <p className={`profile-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{message}</p>}
    </form>
    {cloud && <section className="profile-database"><h2><Cloud size={17} />Облако</h2><p role="status">{cloud.state === "synced" ? "Профиль, настройки и история репетиций сохранены в аккаунте" : cloud.state === "syncing" ? "Синхронизируем с аккаунтом…" : "Не удалось связаться с облаком · сохраняем в браузере"}</p>
      {cloud.state === "error" && <><p className="profile-message error">{cloud.error}</p><button className="text-button" onClick={cloud.onRetry}>Повторить</button></>}
      <p className="settings-note">После входа на другом устройстве там будут те же имя, настройки и последние репетиции. PDF хранится только на этом компьютере.</p>
    </section>}
    {!account.ownerId && <section className="profile-switch"><h2><Users size={17} />Профили на компьютере</h2><label htmlFor="switch-profile">Выбери профиль</label><select id="switch-profile" value={selected} disabled={sessionActive || switching} onChange={event => setSelected(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === account.id ? " · текущий" : ""}</option>)}</select>
      <button className="button secondary" disabled={sessionActive || switching || selected === account.id} onClick={() => { setSwitching(true); void onSwitch(selected).finally(() => setSwitching(false)); }}>{switching ? "Сохраняем работу…" : "Переключить профиль"}</button>
      <a className="text-button" href="/register" aria-disabled={sessionActive || undefined} onClick={event => { event.preventDefault(); if (!sessionActive) onCreate(); }}>Создать другой профиль</a>
    </section>}
    <button className="text-button" disabled={sessionActive} onClick={onLogout}><LogOut size={16} />{account.ownerId ? "Выйти из аккаунта" : "Выйти из профиля"}</button>
    {sessionActive && <p className="settings-note">Сначала заверши выступление, чтобы выйти.</p>}
  </section>;
}
