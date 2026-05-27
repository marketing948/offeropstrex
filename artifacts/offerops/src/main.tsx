import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { reportClientError } from "./lib/error-reporter";
import "./index.css";

window.addEventListener("error", (event) => {
  reportClientError(event.error ?? event.message, {
    source: "window-error",
    requestId: window.sessionStorage.getItem("last_request_id"),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientError(event.reason, {
    source: "window-unhandledrejection",
    requestId: window.sessionStorage.getItem("last_request_id"),
  });
});

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
