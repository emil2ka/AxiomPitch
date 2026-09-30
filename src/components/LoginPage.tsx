import { apiEnabled } from "../lib/api";
import { databaseProfiles } from "../lib/profile-db";
import { useEffect, useState } from "react";
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
  resumeAccount,
} from "../lib/account";
import "../registration.css";

const heroEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function LoginPage() {
  const reduced = useReducedMotion();
  const [accounts, setAccounts] = useState(listAccounts);
  const [selected, setSelected] = useState(loadSavedAccount()?.id || accounts[0]?.id || "");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!apiEnabled) return;
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
        <span className="registration-eyebrow">ПРОФИЛЬ НА ЭТОМ УСТРОЙСТВЕ</span>
        <h1 id="login-title" aria-label="Снова на сцену.">
          <span className="entry-line"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .05, ease: heroEase }}>Снова</motion.span></span>
          <span className="entry-line accent"><motion.span initial={reduced ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .14, ease: heroEase }}>на сцену.</motion.span></span>
        </h1>
        {account ? (<>
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
        {error && <p className="registration-error" role="alert">{error}</p>}
      </motion.section>
      <motion.aside className="registration-companion" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}>
        <EntryScene action="hello" />
      </motion.aside>
    </main>

  </div>;
}
