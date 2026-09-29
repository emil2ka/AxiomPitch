import type { FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PitchBrand } from "./Landing";
import { PixelCompanion } from "./PixelCompanion";
import "../registration.css";

export function RegistrationPage() {
  const reduced = useReducedMotion();
  const continueToLearning = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Temporary entry screen: no account, network request or stored credentials.
    window.location.assign("/learn");
  };

  return <div className="registration-page">
    <header className="registration-header">
      <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <a className="registration-back" href="/"><ArrowLeft size={13} />На главную</a>
    </header>
    <main className="registration-main">
      <motion.section className="registration-copy" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }} aria-labelledby="registration-title">
        <span className="registration-eyebrow">РЕГИСТРАЦИЯ</span>
        <h1 id="registration-title">Твой<br /><span>выход.</span></h1>
        <form onSubmit={continueToLearning}>
          <label htmlFor="registration-name">Имя</label>
          <input id="registration-name" name="name" autoComplete="given-name" placeholder="Как тебя зовут" maxLength={80} />
          <label htmlFor="registration-email">Почта</label>
          <input id="registration-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} />
          <button type="submit">Начать <ArrowRight size={16} /></button>
          <p className="registration-demo-note">Демо · без создания аккаунта</p>
        </form>
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <div className="registration-scene">
          <div className="registration-scene-glow" />
          <div className="registration-slide" aria-hidden="true">
            <div className="registration-slide-header"><span>AXIOM / YOUR STORY</span><span>01</span></div>
            <span className="registration-slide-title">Твоя<br />история.</span>
            <div className="registration-slide-orbit"><i /><i /></div>
            <span className="registration-slide-bottom">MAKE IT YOURS.</span>
          </div>
          <PixelCompanion action="invite" />
        </div>
        <p>Всё начинается с твоей презентации.</p>
      </motion.aside>
    </main>
  </div>;
}
