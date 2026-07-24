import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { expect } from "vitest";
import App from "@/app/App";
import "../styles/main.scss";

/**
 * Renders the full application for integration tests.
 *
 * Includes a smoke assertion that the app shell mounted.
 * The outer .app div is rendered unconditionally by AppContent.
 * If a top-level render error occurs in providers, hooks, or missing module
 * exports that prevent the tree from mounting (the "white screen of death"
 * case in the browser), this expect will fail (or render() itself will throw),
 * causing the integration test to fail clearly.
 */
export function renderApp() {
  const utils = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // The .app wrapper is always present if AppContent rendered its return.
  // Absence here means the app failed to load its root UI.
  const appShell = utils.container.querySelector(".app");
  expect(appShell).toBeTruthy();

  return utils;
}
