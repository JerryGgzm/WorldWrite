import React from "react";
import { createRoot } from "react-dom/client";
import { OptionsPage } from "./options-page";
import "./options.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <OptionsPage />
    </React.StrictMode>,
  );
}
