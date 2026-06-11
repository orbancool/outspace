import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

// Keep the Electron window transparent; web build stays solid black (see styles.css).
if ((window as unknown as { electronAPI?: unknown }).electronAPI) {
  document.documentElement.classList.add("electron");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
