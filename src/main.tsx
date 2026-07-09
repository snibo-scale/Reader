import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Workspace from "./components/Workspace";
import "./styles.css";

// A dedicated ?workspace=<id> window shows just the Notes + AI screen for one
// paper; everything else boots the full app.
const workspaceId = new URLSearchParams(window.location.search).get("workspace");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{workspaceId ? <Workspace id={workspaceId} /> : <App />}</React.StrictMode>
);
