import { useState } from "react";
import type { FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PitchBrand } from "./Landing";
import { EntryScene } from "./EntryScene";
import { createAccount, looksLikeEmail } from "../lib/account";
import "../registration.css";

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function RegistrationPage() {
  const reduced = useReducedMotion();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  // Temporary local account: it never leaves this device and has no password.
  const continueForward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    if (cleanName.length < 2) {
      setError("Напиши имя — хотя бы два символа.");
      return;
    }
    if (cleanEmail && !looksLikeEmail(cleanEmail)) {
      setError("Проверь почту: нужен адрес вида you@example.com.");
      return;
    }
    try {
      createAccount(cleanName, cleanEmail);
      window.location.assign("/studio?welcome=1");
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
        <span className="registration-eyebrow">ПРОФИЛЬ НА ЭТОМ УСТРОЙСТВЕ</span>
        <h1 id="registration-title" aria-label="Твой выход.">
          <span className="entry-line"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .05, ease: heroEase }}>Твой</motion.span></span>
          <span className="entry-line accent"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .14, ease: heroEase }}>выход.</motion.span></span>
        </h1>
        <form onSubmit={continueForward} noValidate>
          <label htmlFor="registration-name">Имя</label>
          <input id="registration-name" name="name" autoComplete="given-name" placeholder="Как тебя зовут" maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} />
          <label htmlFor="registration-email">Почта · необязательно</label>
          <input id="registration-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} />
          {error && <p className="registration-error" role="alert">{error}</p>}
          <button type="submit">Создать профиль <ArrowRight size={16} /></button>
        </form>
        <p className="registration-demo-note">Без пароля и облачной синхронизации. Данные профиля сохраняются на этом устройстве.</p>
        <a className="entry-secondary-link" href="/login">Уже есть профиль? Войти</a>
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <EntryScene action="invite" />
      </motion.aside>
    </main>

  </div>;
}
