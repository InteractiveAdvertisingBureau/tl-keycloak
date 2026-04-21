import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

const gw = import.meta.env.VITE_GATEWAY_BASE_URL || "";

function bootstrap() {
  window.AuthSDK.init({
    gatewayBaseUrl: gw,
    auth0Domain: import.meta.env.VITE_AUTH0_DOMAIN || "",
    auth0ClientId: import.meta.env.VITE_AUTH0_CLIENT_ID || "",
    auth0Audience: import.meta.env.VITE_AUTH0_AUDIENCE || "",
    redirectUri:
      import.meta.env.VITE_AUTH0_REDIRECT_URI ||
      (gw ? `${gw}/callback` : ""),
  });
  window.AuthSDK.captureOAuthHash();

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

if (window.AuthSDK) {
  bootstrap();
} else {
  const s = document.createElement("script");
  s.src = `${gw}/sdk/v1/auth-sdk.js`;
  s.async = true;
  s.onload = bootstrap;
  s.onerror = () => {
    document.body.innerHTML =
      "<p>Failed to load Auth SDK. Set VITE_GATEWAY_BASE_URL and ensure the gateway serves /sdk/v1/auth-sdk.js</p>";
  };
  document.head.appendChild(s);
}
