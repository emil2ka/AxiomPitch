import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { Overlay } from "./components/Overlay.tsx";

// ?overlay=1 is the notch window on the audience screen: avatar only, no camera.
const overlay = new URLSearchParams(location.search).has("overlay");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{overlay ? <Overlay /> : <App />}</StrictMode>,
);
