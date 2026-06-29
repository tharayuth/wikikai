import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
import { PublicView } from "./components/PublicView";
import { store } from "./store";
import "./styles/theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// `/share/<token>` → isolated public read-only viewer (no store, no auth).
// Everything else → the full authenticated app.
const shareMatch = /^\/share\/([a-f0-9]+)\/?$/.exec(window.location.pathname);

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {shareMatch ? (
      <PublicView token={shareMatch[1]} />
    ) : (
      <Provider store={store}>
        <App />
      </Provider>
    )}
  </React.StrictMode>,
);
