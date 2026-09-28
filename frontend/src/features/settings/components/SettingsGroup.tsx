import { useId, type ReactNode } from "react";
import type { AppIcon } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface SettingsGroupProps {
  title: string;
  icon?: AppIcon;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function SettingsGroup({ title, icon, hint, action, children }: SettingsGroupProps) {
  const titleId = useId();

  return (
    <section className="settings-group" aria-labelledby={titleId}>
      <header className="settings-group__header">
        <div className="settings-group__heading">
          <h3 id={titleId} className="settings-group__title">
            {icon && <Icon icon={icon} className="settings-group__icon" />}
            {title}
          </h3>
          {hint && <p className="settings-group__hint">{hint}</p>}
        </div>
        {action && <div className="settings-group__action">{action}</div>}
      </header>
      <div className="settings-group__body">{children}</div>
    </section>
  );
}
