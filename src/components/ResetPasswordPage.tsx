import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PitchBrand } from "./Landing";
import { EntryScene } from "./EntryScene";
import { cloudNewPassword, cloudSession } from "../lib/cloud";
import "../registration.css";

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Opened by the reset email: Supabase reads the one-time session from the address. */
export function ResetPasswordPage() {
  const reduced = useReducedMotion();
  const [state, setState] = useState<"checking" | "ready" | "missing">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    cloudSession()
      .then(user => { if (!cancelled) setState(user && user !== "offline" ? "ready" : "missing"); })
      .catch(() => { if (!cancelled) setState("missing"); });
    return () => { cancelled = true; };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) { setError("Пароль — хотя бы 8 символов."); return; }
    setBusy(true);
    try {
      const { created } = await cloudNewPassword(password);
      window.location.assign(created ? "/studio?welcome=1" : "/studio");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось сменить пароль.");
      setBusy(false);
    }
  };

  return <div className="registration-page">
    <header className="registration-header">
      <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <a className="registration-back" href="/login"><ArrowLeft size={13} />Ко входу</a>
    </header>
    <main className="registration-main">
      <motion.section className="registration-copy" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }} aria-labelledby="reset-title">
        <span className="registration-eyebrow">АККАУНТ PITCHFLOW</span>
        <h1 id="reset-title" aria-label="Новый пароль.">
          <span className="entry-line"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .05, ease: heroEase }}>Новый</motion.span></span>
          <span className="entry-line accent"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .14, ease: heroEase }}>пароль.</motion.span></span>
        </h1>
        {state === "checking" && <p className="login-lead" role="status">Проверяем ссылку…</p>}
        {state === "missing" && <>
          <p className="login-lead" role="alert">Ссылка недействительна или устарела. Запроси новое письмо на странице входа.</p>
          <a className="entry-secondary-link" href="/login">Ко входу</a>
        </>}
        {state === "ready" && <form onSubmit={submit} noValidate>
          <label htmlFor="reset-password">Новый пароль · от 8 символов</label>
          <input id="reset-password" name="password" type="password" autoComplete="new-password" maxLength={72} value={password} onChange={event => { setPassword(event.target.value); setError(""); }} />
          {error && <p className="registration-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить и войти"} <ArrowRight size={16} /></button>
        </form>}
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <EntryScene action="hello" />
      </motion.aside>
    </main>
  </div>;
}
