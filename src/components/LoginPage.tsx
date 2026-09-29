import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";
import { PitchBrand } from "./Landing";
import { EntryScene } from "./EntryScene";
import {
  accountHome,
  accountInitials,
  clearAccount,
  loadAccount,
} from "../lib/account";
import "../registration.css";

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function LoginPage() {
  const reduced = useReducedMotion();
  const account = loadAccount();
  const continueOn = () => window.location.assign(accountHome(account));
  const resetAccount = () => {
    clearAccount();
    window.location.assign("/register");
  };

  return <div className="registration-page login-page">
    <header className="registration-header">
      <a href="/" aria-label="AxiomPitch — на главную"><PitchBrand /></a>
      <a className="registration-back" href="/"><ArrowLeft size={13} />На главную</a>
    </header>
    <main className="registration-main">
      <motion.section className="registration-copy" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }} aria-labelledby="login-title">
        <span className="registration-eyebrow">ВХОД</span>
        <h1 id="login-title" aria-label="Снова на сцену.">
          <span className="entry-line"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .05, ease: heroEase }}>Снова</motion.span></span>
          <span className="entry-line accent"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .14, ease: heroEase }}>на сцену.</motion.span></span>
        </h1>
        {account ? (<>
          <div className="login-account">
            <span className="login-avatar" aria-hidden="true">{accountInitials(account.name)}</span>
            <span className="login-account-copy">
              <strong>{account.name}</strong>
              <small>{account.email}</small>
            </span>
          </div>
          <button className="login-primary" onClick={continueOn}>
            Продолжить <ArrowRight size={16} />
          </button>
          <button className="login-reset" onClick={resetAccount}>
            <LogOut size={14} />Это не я
          </button>
        </>) : (<>
          <p className="login-lead">Аккаунта на этом устройстве пока нет.</p>
          <button className="login-primary" onClick={() => window.location.assign("/register")}>
            Создать аккаунт <ArrowRight size={16} />
          </button>
        </>)}
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <EntryScene action="hello" />
      </motion.aside>
    </main>
  </div>;
}
