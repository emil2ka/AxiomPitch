import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
// oxlint-disable-next-line react/only-export-components -- entrypoint renders the lazy route
const Overlay = lazy(() => import("./components/Overlay.tsx").then(module => ({ default: module.Overlay })));

// ?overlay=1 is the notch window on the audience screen: avatar only, no camera.
const overlay = new URLSearchParams(location.search).has("overlay") || location.pathname === "/overlay";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Suspense fallback={<div className="companion-loading">Открываем приложение…</div>}>{overlay ? <Overlay /> : <App />}</Suspense></StrictMode>,
);
