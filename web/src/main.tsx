import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toasty } from "@cloudflare/kumo";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toasty>
      <App />
    </Toasty>
  </StrictMode>
);
