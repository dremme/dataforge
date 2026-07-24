import { iconLoader2 } from "../icons";
import { Icon } from "./Icon";

export function AppInitialLoading() {
  return (
    <div className="app-initial-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="app-initial-loading__spinner" aria-hidden="true">
        <Icon icon={iconLoader2} spin className="app-initial-loading__icon" />
      </div>
      <p className="app-initial-loading__label">Loading...</p>
    </div>
  );
}
