import { useEffect } from "react";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconBell } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { NotificationsPanel } from "./NotificationsPanel";
import { useNotificationHistory } from "./notifications";

export function NotificationsButton() {
  const { history, unreadCount, setPanelOpen, markAllRead, clearHistory, refreshHistory } =
    useNotificationHistory();
  const { open, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();

  // Read state is flushed on close: marking on open would erase the unread marks being read.
  useEffect(() => {
    setPanelOpen(open);
    if (!open) return;

    refreshHistory();
    return () => markAllRead();
  }, [open, setPanelOpen, markAllRead, refreshHistory]);

  const unread = unreadCount > 0;
  const urgent = history.some((entry) => !entry.read_at && entry.variant === "danger");
  const label = unread ? `Notifications (${unreadCount} new)` : "Notifications";

  return (
    <div
      ref={rootRef}
      className={classNames("notifications-button-wrap", open && "notifications-button-wrap--open")}
    >
      <Tooltip content={unread ? `${unreadCount} new notifications` : "Notifications"}>
        <button type="button" className="notifications-button" aria-label={label} {...triggerProps}>
          <Icon icon={iconBell} className="notifications-button__icon" />
          {unread && (
            <span
              className={classNames(
                "notifications-button__dot",
                urgent && "notifications-button__dot--danger",
              )}
              aria-hidden="true"
            />
          )}
        </button>
      </Tooltip>

      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        className="notifications-panel"
        role="group"
        label="Notifications"
      >
        <NotificationsPanel history={history} onClear={clearHistory} />
      </AnchoredLayer>
    </div>
  );
}
