import { useEffect, useState } from "react";
import { iconBellOff } from "@/shared/icons";
import { formatRelativeTime } from "@/shared/lib/format";
import { classNames } from "@/shared/lib/classNames";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Icon } from "@/shared/ui/Icon";
import { variantIcons, type NotificationRecord } from "./notifications";

const RETICK_MS = 30_000;

interface NotificationsPanelProps {
  history: NotificationRecord[];
  onClear: () => void;
}

function useTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}

export function NotificationsPanel({ history, onClear }: NotificationsPanelProps) {
  const nowMs = useTicker(RETICK_MS);

  if (history.length === 0) {
    return (
      <div className="notifications-panel__empty">
        <EmptyState
          icon={iconBellOff}
          title="No notifications"
          description="Job results and errors show up here."
          variant="muted"
        />
      </div>
    );
  }

  return (
    <>
      <div className="notifications-panel__header">
        <h2 className="notifications-panel__title">Notifications</h2>
        <button type="button" className="notifications-panel__clear" onClick={onClear}>
          Clear all
        </button>
      </div>

      <ul className="notifications-panel__list">
        {history.map((entry) => (
          <li
            key={entry.id}
            className={classNames(
              "notifications-panel__row",
              `notifications-panel__row--${entry.variant}`,
              !entry.read_at && "notifications-panel__row--unread",
            )}
          >
            <Icon icon={variantIcons[entry.variant]} className="notifications-panel__row-icon" />
            <div className="notifications-panel__row-body">
              <p className="notifications-panel__row-message">{entry.message}</p>
              <span className="notifications-panel__row-meta">
                {formatRelativeTime(entry.created_at, nowMs)}
                {entry.count > 1 && (
                  <span className="notifications-panel__row-count">{`×${entry.count}`}</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
