import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";

type GeotabApi = {
  call?: (method: string, params: Record<string, unknown>, success: (result: unknown) => void, error?: (error: unknown) => void) => void;
  getSession?: (callback: (session: { userName?: string; database?: string; server?: string } | null) => void) => void;
};
type AddInState = unknown;
type AddInLifecycle = {
  initialize: (api: GeotabApi, state: AddInState, callback: () => void) => void;
  focus: (api: GeotabApi, state: AddInState) => void;
  blur: (api: GeotabApi, state: AddInState) => void;
};

declare global {
  interface Window {
    geotab?: { addin?: Record<string, () => AddInLifecycle> };
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("OPEX_VBM_ROOT_NOT_FOUND");
const reactRoot = createRoot(rootElement);
reactRoot.render(<React.StrictMode><App /></React.StrictMode>);

// MyGeotab custom-page Add-In entry point. MyGeotab supplies the signed-in API
// object and page state to these lifecycle methods. Keep the app usable in a
// standalone browser preview, but always register the required namespace.
window.geotab = window.geotab ?? {};
window.geotab.addin = window.geotab.addin ?? {};
window.geotab.addin.opexVehicleBooking = () => ({
  initialize: (api, state, callback) => {
    document.documentElement.dataset.opexVbm = "initialized";
    window.dispatchEvent(new CustomEvent("opex-vbm:initialize", { detail: { api, state } }));
    callback();
  },
  focus: (api, state) => {
    window.dispatchEvent(new CustomEvent("opex-vbm:focus", { detail: { api, state } }));
  },
  blur: (api, state) => {
    window.dispatchEvent(new CustomEvent("opex-vbm:blur", { detail: { api, state } }));
  }
});
