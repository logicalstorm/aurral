import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { captureSpotifyOAuthFromLocation } from "./utils/spotifyOAuthHandoff.js";
import "./index.css";

if (!captureSpotifyOAuthFromLocation()) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
