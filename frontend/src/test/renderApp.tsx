import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { expect } from "vitest";
import App from "@/app/App";
import "../styles/main.scss";

export function renderApp() {
  const utils = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  const appShell = utils.container.querySelector(".app");
  expect(appShell).toBeTruthy();

  return utils;
}
