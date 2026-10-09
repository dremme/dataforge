import { useEffect } from "react";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconBell, iconBellRing } from "@/shared/icons";
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
  const unreadVariants = new Set(history.filter((entry) => !entry.read_at).map((e) => e.variant));
  const urgent = unreadVariants.has("danger");
  const warning = !urgent && unreadVariants.has("warning");
  const label = unread ? `Notifications (${unreadCount} new)` : "Notifications";

  return (
    <div
      ref={rootRef}
      className={classNames("notifications-button-wrap", open && "notifications-button-wrap--open")}
    >
      <Tooltip content={unread ? `${unreadCount} new notifications` : "Notifications"}>
        <button
          type="button"
          className={classNames(
            "notifications-button",
            unread && "notifications-button--unread",
            urgent && "notifications-button--urgent",
            warning && "notifications-button--warning",
          )}
          aria-label={label}
          {...triggerProps}
        >
          {/* Keyed by the count so each new arrival replays the ring. */}
          <Icon
            key={unreadCount}
            icon={unread ? iconBellRing : iconBell}
            className="notifications-button__icon"
          />
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
