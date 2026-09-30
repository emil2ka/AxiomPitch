import "../landing-story.css";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { PitchStory } from "./PitchStory";
import { PixelCompanion } from "./PixelCompanion";
import { accountHome, loadAccount, loadSavedAccount } from "../lib/account";

export function PitchBrand() {
  return <span className="pitch-brand"><span className="pitch-mark" aria-hidden="true"><img src="/brand/companion-mark.svg" alt="" width={36} height={32} /></span><span>AXIOM<span className="pitch-brand-suffix">PITCH</span></span></span>;
}

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];
const HERO_LINES = ["Выступление,", "которое следует", "за тобой"];

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = !!useReducedMotion();
  return (
    <motion.div className={className}
      initial={reduce ? false : { opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.75, delay, ease: heroEase }}>
      {children}
    </motion.div>
  );
}

export function Landing() {
  const reduce = !!useReducedMotion();
  const account = loadAccount();
  const startHref = account ? accountHome(account) : loadSavedAccount() ? "/login" : "/register";
  return (
    <div className="landing axiom-landing">
      <header className="landing-header"><div className="landing-header-inner">
        <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
        <nav aria-label="Навигация по сайту"><a href="#journey">Как это работает</a><a href="#companion">Помощник</a></nav>
        <div className="landing-header-actions">
          {account ? (
            <a className="landing-button light compact" href={startHref}>Продолжить</a>
          ) : (<>
            <a className="landing-header-login" href="/login">Войти</a>
            <a className="landing-button light compact" href="/register">Начать</a>
          </>)}
        </div>
      </div></header>
      <main>
        <section className="axiom-hero">
          <div className="axiom-hero-field" aria-hidden="true">
            <div className="axiom-hero-light" />
            <div className="axiom-hero-art">
              <motion.svg viewBox="0 0 1536 1024" aria-hidden="true" focusable="false"
                initial={reduce ? false : { scale: 1.07 }} animate={{ scale: 1 }} transition={{ duration: 1.6, ease: heroEase }}>
                <defs>
                  <clipPath id="hero-head-clip"><path d="M460 0H1536V599H1121L1029 710H490V580L460 480Z" /></clipPath>
                  <clipPath id="hero-wave-clip"><path d="M0 0H460V480L490 580V1024H0Z" /></clipPath>
                  <clipPath id="hero-palm-clip"><path d="M1121 599H1536V1024H950V710H1029Z" /></clipPath>
                </defs>
                <g className="hero-mascot-head"><image href="/images/pitch-companion.png" width="1536" height="1024" clipPath="url(#hero-head-clip)" /></g>
                <g className="hero-mascot-wave"><image href="/images/pitch-companion.png" width="1536" height="1024" clipPath="url(#hero-wave-clip)" /></g>
                <g className="hero-mascot-palm"><image href="/images/pitch-companion.png" width="1536" height="1024" clipPath="url(#hero-palm-clip)" /></g>
              </motion.svg>
            </div>
          </div>
          <div className="axiom-hero-copy">
            <h1 aria-label="Выступление, которое следует за тобой">
              {HERO_LINES.map((line, i) => (
                <span key={line} className="hero-line" aria-hidden="true">
                  <motion.span initial={reduce ? false : { y: "112%" }} animate={{ y: "0%" }} transition={{ duration: 0.9, delay: 0.1 + i * 0.1, ease: heroEase }}>{line}</motion.span>
                </span>
              ))}
            </h1>
            <motion.p className="hero-description" initial={reduce ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.5, ease: heroEase }}>Рассказывай свою историю.<br />Мы поможем держать её в движении.</motion.p>
            <motion.div className="hero-actions" initial={reduce ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.6, ease: heroEase }}><a className="landing-button light" href={startHref}>{account ? "Открыть студию" : "Создать профиль"} <ArrowRight size={16} /></a><a className="landing-button outline" href="#journey">Посмотреть демо</a></motion.div>
            {!account && <motion.p className="hero-login" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.75 }}>Уже есть профиль? <a href="/login">Войти</a></motion.p>}
          </div>
        </section>
        <section className="landing-section axiom-companion companion-introduction" id="companion" aria-labelledby="companion-title">
          <Reveal className="companion-copy"><p className="landing-eyebrow">НА СЦЕНЕ ТЫ НЕ ОДИН</p><h2 id="companion-title">Ты рассказываешь.<br /><span>Он помогает.</span></h2><p>3D-зеркало повторяет движения. Помощник показывает жесты.</p><a className="landing-text-link companion-preview-link" href="/companion">Посмотреть 3D-зеркало в движении <ArrowRight size={15} /></a></Reveal>
          <Reveal className="companion-intro-visual" delay={0.12}>
            <div className="companion-welcome"><PixelCompanion action="hello" /><div><p>Покажу, как всё работает.<br />Просто листай дальше.</p></div></div>
          </Reveal>
        </section>
        <section className="axiom-journey" id="journey"><div className="landing-section">
          <Reveal className="story-introduction"><p className="landing-eyebrow">ПРОЖИВИ СВОЁ ВЫСТУПЛЕНИЕ</p><h2>Листай вниз.<br /><span>История уже в движении.</span></h2><p className="axiom-journey-description">Листай — помощник всё покажет.</p></Reveal>
          <PitchStory />
        </div></section>
        <section className="landing-cta axiom-cta story-final" id="your-turn"><Reveal className="axiom-cta-inner"><PixelCompanion action="invite" /><p className="landing-eyebrow">ТЕПЕРЬ ТВОЙ ВЫХОД</p><h2>Теперь<br />попробуй сам.</h2><p>Загрузи свою презентацию.<br />Дальше — в твоих руках.</p><div className="hero-actions"><a href={startHref} className="landing-button light">{account ? "Открыть студию" : "Создать профиль"} <ArrowRight size={16} /></a><a href="#journey" className="landing-button outline">Ещё раз посмотреть демо</a></div><span className="story-final-note"><ShieldCheck size={12} /> Камера и PDF остаются на устройстве</span></Reveal></section>
      </main>
      <footer className="landing-footer axiom-footer"><span>Камера и PDF остаются на устройстве.</span><span>AxiomPitch · Motion Hackathon 2026</span></footer>
    </div>
  );
}
