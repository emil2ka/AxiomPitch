import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useReducedMotion } from "motion/react";
import { StudioSidebar } from "./components/StudioSidebar";
import { loadAccount, loadSavedAccount, markLearned, signOut } from "./lib/account";
import { cloudEnabled, cloudResume, cloudSession, saveCloudProfile, watchCloudSignOut } from "./lib/cloud";
import { CameraProvider } from "./components/CameraProvider";
import { navigateApp } from "./lib/navigation";
import "./speaker-transition.css";
import "./preparation.css";
import "./web-notch.css";
import "./studio.css";

const Landing = lazy(() => import("./components/Landing").then(module => ({ default: module.Landing })));
const Audience = lazy(() => import("./components/Audience").then(module => ({ default: module.Audience })));
const Presenter = lazy(() => import("./Presenter"));
const RegistrationPage = lazy(() => import("./components/RegistrationPage").then(module => ({ default: module.RegistrationPage })));
const LoginPage = lazy(() => import("./components/LoginPage").then(module => ({ default: module.LoginPage })));
const ResetPasswordPage = lazy(() => import("./components/ResetPasswordPage").then(module => ({ default: module.ResetPasswordPage })));
const LearningPage = lazy(() => import("./components/LearningPage").then(module => ({ default: module.LearningPage })));
const CompanionPreview = lazy(() => import("./components/CompanionPreview").then(module => ({ default: module.CompanionPreview })));

export default function App() {
  const [path, setPath] = useState(location.pathname);
  const [studioVisited, setStudioVisited] = useState(location.pathname === "/studio");
  const [handoff, setHandoff] = useState<"leaving" | "arriving" | "native" | null>(null);
  const transitioning = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useReducedMotion();
  useEffect(() => {
    const pendingTimers = timers.current;
    const syncPath = () => { setPath(location.pathname); if (location.pathname === "/studio") setStudioVisited(true); };
    window.addEventListener("popstate", syncPath);
    return () => { window.removeEventListener("popstate", syncPath); pendingTimers.forEach(clearTimeout); };
  }, []);
  // With Supabase the session decides who is signed in; the cached account follows it.
  const [cloudChecked, setCloudChecked] = useState(() => !cloudEnabled || new URLSearchParams(location.search).has("audience"));
  useEffect(() => {
    if (!cloudEnabled || new URLSearchParams(location.search).has("audience")) return;
    let cancelled = false;
    let shown = false;
    let unwatch: (() => void) | undefined;
    const inside = () => location.pathname === "/studio" || location.pathname === "/learn";
    const show = () => { shown = true; setCloudChecked(true); };
    // A slow network never keeps a speaker out: after 3 s the cached account opens the studio.
    const timer = setTimeout(show, 3000);
    void (async () => {
      try {
        const user = await cloudSession();
        const account = loadAccount();
        if (cancelled || user === "offline") return;
        if (!user) {
          if (!account) return;
          signOut();
          if (shown && inside()) location.assign("/login");
          return;
        }
        // An email link has just signed in, or another account took over this browser.
        if (account?.ownerId === user.id || location.pathname === "/reset-password") return;
        const { created } = await cloudResume(user);
        if (cancelled) return;
        if (created && location.pathname !== "/learn") {
          history.replaceState(null, "", "/learn");
          flushSync(() => setPath("/learn"));
          return;
        }
        if (inside()) { if (shown) location.reload(); return; }
        if (location.pathname !== "/login" && location.pathname !== "/register") return;
        history.replaceState(null, "", created ? "/learn" : "/studio");
        flushSync(() => { setPath(created ? "/learn" : "/studio"); if (!created) setStudioVisited(true); });
      } catch (failure) {
        console.warn("Supabase:", failure);
      } finally {
        clearTimeout(timer);
        if (!cancelled) show();
      }
    })();
    void watchCloudSignOut(() => {
      if (!loadAccount()?.ownerId) return;
      signOut();
      if (inside()) location.assign("/login");
    }).then(stop => { if (cancelled) stop(); else unwatch = stop; }).catch(() => undefined);
    return () => { cancelled = true; clearTimeout(timer); unwatch?.(); };
  }, []);
  // Registration -> learning -> studio. The local account drives the funnel.
  useEffect(() => {
    if (!cloudChecked || new URLSearchParams(location.search).has("audience")) return;
    const account = loadAccount();
    if ((path === "/learn" || path === "/studio") && !account) {
      const destination = loadSavedAccount() ? "/login" : "/register";
      history.replaceState(null, "", destination);
      flushSync(() => setPath(destination));
      return;
    }
    if ((path === "/register" || path === "/login") && account) {
      history.replaceState(null, "", "/studio");
      flushSync(() => { setPath("/studio"); setStudioVisited(true); });
    }
  }, [path, cloudChecked]);
  const enterStudio = useCallback((completed: boolean) => {
    if (transitioning.current || location.pathname !== "/learn") return;
    const account = completed ? markLearned() : loadAccount();
    // Learning progress lives in settings, so leaving the lesson is the moment to share it.
    if (account?.ownerId) void saveCloudProfile(account).catch((failure) => console.warn("Supabase:", failure));
    transitioning.current = true;
    const navigate = () => {
      history.pushState(null, "", "/studio");
      flushSync(() => { setPath("/studio"); setStudioVisited(true); });
      window.scrollTo(0, 0);
    };
    const finish = () => { setHandoff(null); transitioning.current = false; };
    if (reduced) { navigate(); finish(); return; }
    if (document.startViewTransition) {
      flushSync(() => setHandoff("native"));
      document.documentElement.classList.add("speaker-handoff");
      const transition = document.startViewTransition(navigate);
      void transition.finished.catch(() => {}).finally(() => {
        document.documentElement.classList.remove("speaker-handoff");
        finish();
      });
    } else {
      setHandoff("leaving");
      timers.current.push(setTimeout(() => {
        navigate();
        setHandoff("arriving");
        timers.current.push(setTimeout(finish, 700));
      }, 340));
    }
  }, [reduced]);
  const page = new URLSearchParams(location.search).has("audience") ? (
    <Audience />
  ) : !cloudChecked && ["/studio", "/learn"].includes(path) ? (
    <div className="companion-loading">Проверяем вход…</div>
  ) : path === "/reset-password" && cloudEnabled ? (
    <Suspense fallback={<div className="companion-loading">Открываем смену пароля…</div>}><ResetPasswordPage /></Suspense>
  ) : path === "/register" ? (
    <Suspense fallback={<div className="companion-loading">Готовим знакомство…</div>}><RegistrationPage /></Suspense>
  ) : path === "/login" ? (
    <Suspense fallback={<div className="companion-loading">Открываем вход…</div>}><LoginPage /></Suspense>
  ) : path === "/learn" ? (
    // Learning always shares the navigation; completing it remains optional.
    (
      <div className="studio studio-learning">
        <StudioSidebar active="learn" />
        <div className="studio-main">
          <Suspense fallback={<div className="companion-loading">Готовим обучение…</div>}><LearningPage onEnterStudio={enterStudio} /></Suspense>
        </div>
      </div>
    )
  ) : path === "/companion" ? (
    <Suspense fallback={<div className="companion-loading">Загружаем персонажа…</div>}><CompanionPreview /></Suspense>
  ) : path === "/studio" ? (
    null
  ) : (
    <Landing />
  );
  const followLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || !["/studio", "/learn"].includes(url.pathname)) return;
    event.preventDefault();
    navigateApp(url.pathname + url.search + url.hash);
  };
  return <CameraProvider scope={cloudChecked && ["/studio", "/learn"].includes(path) && !new URLSearchParams(location.search).has("audience") ? loadAccount()?.id ?? null : null}><div className="app-route" onClick={followLink} data-speaker-handoff={handoff ?? undefined}><Suspense fallback={<div className="companion-loading">Открываем страницу…</div>}>{page}</Suspense>{cloudChecked && ["/studio", "/learn"].includes(path) && !new URLSearchParams(location.search).has("audience") && loadAccount() && (studioVisited || path === "/studio") && <div hidden={path !== "/studio"}><Suspense fallback={<div className="companion-loading">Открываем студию…</div>}><Presenter active={path === "/studio"} /></Suspense></div>}</div></CameraProvider>;
}
