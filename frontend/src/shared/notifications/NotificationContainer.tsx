import { createPortal } from "react-dom";
import { iconCircleAlert, iconCircleCheck, iconTriangleAlert, iconX } from "@/shared/icons";
import type { Notification, NotificationVariant } from "./notifications";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onRemove: (id: string) => void;
}

const variantIcons: Record<NotificationVariant, typeof iconCircleAlert> = {
  danger: iconCircleAlert,
  warning: iconTriangleAlert,
  success: iconCircleCheck,
};

function notificationRole(variant: NotificationVariant): "alert" | "status" {
  return variant === "danger" ? "alert" : "status";
}

export function NotificationContainer({
  notifications,
  onDismiss,
  onRemove,
}: NotificationContainerProps) {
  if (notifications.length === 0) {
    return null;
  }

  return createPortal(
    <div className="notifications" aria-live="polite">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={classNames(
            "notifications__toast",
            `notifications__toast--${notification.variant}`,
            notification.exiting && "notifications__toast--exiting",
          )}
          role={notificationRole(notification.variant)}
          onAnimationEnd={(event) => {
            if (event.currentTarget !== event.target) {
              return;
            }

            if (!notification.exiting) {
              return;
            }

            onRemove(notification.id);
          }}
        >
          <Icon icon={variantIcons[notification.variant]} className="notifications__icon" />
          <span className="notifications__message">{notification.message}</span>
          <button
            type="button"
            className="notifications__dismiss"
            onClick={() => onDismiss(notification.id)}
            aria-label="Dismiss notification"
            disabled={notification.exiting}
          >
            <Icon icon={iconX} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
