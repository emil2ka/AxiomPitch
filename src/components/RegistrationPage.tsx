import { useState } from "react";
import type { FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PitchBrand } from "./PitchBrand";
import { EntryScene } from "./EntryScene";
import { createAccount, looksLikeEmail } from "../lib/account";
import { cloudEnabled, cloudSignUp } from "../lib/cloud";
import "../registration.css";

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function RegistrationPage() {
  const reduced = useReducedMotion();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  // Without Supabase the profile never leaves this device and has no password.
  const continueForward = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    if (cleanName.length < 2) {
      setError("Напиши имя — хотя бы два символа.");
      return;
    }
    if ((cleanEmail || cloudEnabled) && !looksLikeEmail(cleanEmail)) {
      setError("Проверь почту: нужен адрес вида you@example.com.");
      return;
    }
    if (cloudEnabled) {
      if (password.length < 8) { setError("Пароль — хотя бы 8 символов."); return; }
      setBusy(true);
      try {
        const entry = await cloudSignUp(cleanName, cleanEmail, password);
        if ("confirm" in entry) { setConfirm(entry.confirm); setBusy(false); }
        else window.location.assign("/learn");
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Не удалось создать аккаунт.");
        setBusy(false);
      }
      return;
    }
    try {
      createAccount(cleanName, cleanEmail);
      window.location.assign("/learn");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось сохранить профиль.");
    }
  };

  return <div className="registration-page">
    <header className="registration-header">
      <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <a className="registration-back" href="/"><ArrowLeft size={13} />На главную</a>
    </header>
    <main className="registration-main">
      <motion.section className="registration-copy" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }} aria-labelledby="registration-title">
        <span className="registration-eyebrow">{cloudEnabled ? "АККАУНТ PITCHFLOW" : "ПРОФИЛЬ НА ЭТОМ УСТРОЙСТВЕ"}</span>
        <h1 id="registration-title" aria-label="Твой выход.">
          <span className="entry-line"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .05, ease: heroEase }}>Твой</motion.span></span>
          <span className="entry-line accent"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .14, ease: heroEase }}>выход.</motion.span></span>
        </h1>
        {confirm ? <>
          <p className="login-lead" role="status">Мы отправили письмо на <strong>{confirm}</strong>. Открой ссылку из письма — почта подтвердится, и ты сразу попадёшь на обучение.</p>
          <a className="entry-secondary-link" href="/login">Почта уже подтверждена? Войти</a>
        </> : <>
        <form onSubmit={continueForward} noValidate>
          <label htmlFor="registration-name">Имя</label>
          <input id="registration-name" name="name" autoComplete="given-name" placeholder="Как тебя зовут" maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} />
          <label htmlFor="registration-email">{cloudEnabled ? "Почта" : "Почта · необязательно"}</label>
          <input id="registration-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} />
          {cloudEnabled && <>
            <label htmlFor="registration-password">Пароль · от 8 символов</label>
            <input id="registration-password" name="password" type="password" autoComplete="new-password" maxLength={72} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} />
          </>}
          {error && <p className="registration-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? "Создаём аккаунт…" : cloudEnabled ? "Создать аккаунт" : "Создать профиль"} <ArrowRight size={16} /></button>
        </form>
        <p className="registration-demo-note">{cloudEnabled ? "Профиль, настройки и история репетиций будут доступны на любом устройстве после входа." : "Без пароля и облачной синхронизации. Данные профиля сохраняются на этом устройстве."}</p>
        <a className="entry-secondary-link" href="/login">{cloudEnabled ? "Уже есть аккаунт? Войти" : "Уже есть профиль? Войти"}</a>
        </>}
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <EntryScene action="invite" />
      </motion.aside>
    </main>

  </div>;
}
