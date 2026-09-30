import { apiEnabled } from "../lib/api";
import { databaseProfiles } from "../lib/profile-db";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";
import { PitchBrand } from "./Landing";
import { EntryScene } from "./EntryScene";
import {
  accountHome,
  cacheAccounts,
  accountInitials,
  listAccounts,
  loadSavedAccount,
  looksLikeEmail,
  resumeAccount,
} from "../lib/account";
import { cloudEnabled, cloudResetPassword, cloudSignIn } from "../lib/cloud";
import "../registration.css";

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Email and password against Supabase; also sends the password reset link. */
function CloudLogin() {
  const [mode, setMode] = useState<"signin" | "reset" | "sent">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // An expired confirmation or reset link returns with the reason in the address.
  const [error, setError] = useState(() => new URLSearchParams(location.hash.slice(1)).get("error_code") === "otp_expired" ? "Ссылка из письма устарела. Войди с паролем или запроси новое письмо." : "");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!looksLikeEmail(cleanEmail)) { setError("Проверь почту: нужен адрес вида you@example.com."); return; }
    if (mode === "signin" && !password) { setError("Введи пароль."); return; }
    setBusy(true);
    try {
      if (mode === "reset") { await cloudResetPassword(cleanEmail); setMode("sent"); }
      else { const { created } = await cloudSignIn(cleanEmail, password); window.location.assign(created ? "/studio?welcome=1" : "/studio"); return; }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось войти."); }
    setBusy(false);
  };
  const toggle = () => { setMode(mode === "reset" ? "signin" : "reset"); setError(""); };
  if (mode === "sent") return <>
    <p className="login-lead" role="status">Если аккаунт с почтой <strong>{email.trim()}</strong> есть, мы отправили на неё ссылку для нового пароля.</p>
    <button className="login-reset" onClick={toggle}>Вернуться ко входу</button>
  </>;
  return <>
    <form onSubmit={submit} noValidate>
      <label htmlFor="login-email">Почта</label>
      <input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setError(""); }} />
      {mode === "signin" && <>
        <label htmlFor="login-password">Пароль</label>
        <input id="login-password" name="password" type="password" autoComplete="current-password" maxLength={72} value={password} onChange={event => { setPassword(event.target.value); setError(""); }} />
      </>}
      {error && <p className="registration-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? (mode === "reset" ? "Отправляем…" : "Входим…") : mode === "reset" ? "Прислать ссылку" : "Войти"} <ArrowRight size={16} /></button>
    </form>
    <button className="login-reset" onClick={toggle}>{mode === "reset" ? "Войти с паролем" : "Забыли пароль?"}</button>
    <a className="entry-secondary-link" href="/register">Нет аккаунта? Зарегистрироваться</a>
  </>;
}

export function LoginPage() {
  const reduced = useReducedMotion();
  const [accounts, setAccounts] = useState(listAccounts);
  const [selected, setSelected] = useState(loadSavedAccount()?.id || accounts[0]?.id || "");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!apiEnabled || cloudEnabled) return;
    let cancelled = false;
    databaseProfiles().then(({ items }) => {
      if (cancelled) return;
      cacheAccounts(items);
      const profiles = listAccounts();
      setAccounts(profiles);
      setSelected(value => value || profiles[0]?.id || "");
    }).catch(() => { /* Browser profiles remain available without the bridge. */ });
    return () => { cancelled = true; };
  }, []);
  const account = accounts.find(item => item.id === selected);
  const continueOn = () => {
    try {
      const resumed = resumeAccount(selected);
      if (resumed) window.location.assign(accountHome(resumed));
      else setError("Выбери сохранённый профиль.");
    } catch { setError("Браузер не разрешает сохранять данные. Проверь настройки сайта."); }
  };

  return <div className="registration-page login-page">
    <header className="registration-header">
      <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <a className="registration-back" href="/"><ArrowLeft size={13} />На главную</a>
    </header>
    <main className="registration-main">
      <motion.section className="registration-copy" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }} aria-labelledby="login-title">
        <span className="registration-eyebrow">{cloudEnabled ? "АККАУНТ PITCHFLOW" : "ПРОФИЛЬ НА ЭТОМ УСТРОЙСТВЕ"}</span>
        <h1 id="login-title" aria-label="Снова на сцену.">
          <span className="entry-line"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .05, ease: heroEase }}>Снова</motion.span></span>
          <span className="entry-line accent"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .14, ease: heroEase }}>на сцену.</motion.span></span>
        </h1>
        {cloudEnabled ? <CloudLogin /> : account ? (<>
          {accounts.length > 1 && <label className="profile-picker">Выбери профиль<select value={selected} onChange={event => setSelected(event.target.value)}>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}{item.email ? ` · ${item.email}` : ""}</option>)}</select></label>}
          <div className="login-account">
            <span className="login-avatar" aria-hidden="true">{accountInitials(account.name)}</span>
            <span className="login-account-copy">
              <strong>{account.name}</strong>
              <small>{account.email || "Профиль без почты"}</small>
            </span>
          </div>
          <button className="login-primary" onClick={continueOn}>
            Продолжить <ArrowRight size={16} />
          </button>
          <a className="login-reset" href="/register"><LogOut size={14} />Создать другой профиль</a>
          <p className="registration-demo-note">Вход возвращает твои презентацию, историю и настройки в этом браузере.</p>
        </>) : (<>
          <p className="login-lead">На этом устройстве ещё нет сохранённых профилей.</p>
          <button className="login-primary" onClick={() => window.location.assign("/register")}>
            Создать профиль <ArrowRight size={16} />
          </button>
        </>)}
        {!cloudEnabled && error && <p className="registration-error" role="alert">{error}</p>}
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <EntryScene action="hello" />
      </motion.aside>
    </main>

  </div>;
}
