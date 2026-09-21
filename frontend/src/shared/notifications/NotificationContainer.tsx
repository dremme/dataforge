import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { iconX } from "@/shared/icons";
import { variantIcons, type NotificationVariant, type Toast } from "./notifications";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface NotificationContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onRemove: (id: string) => void;
  onPauseAutoDismiss: (id: string) => void;
  onResumeAutoDismiss: (id: string) => void;
}

function notificationRole(variant: NotificationVariant): "alert" | "status" {
  return variant === "danger" ? "alert" : "status";
}

function NotificationToast({
  toast,
  onDismiss,
  onRemove,
  onPauseAutoDismiss,
  onResumeAutoDismiss,
}: { toast: Toast } & Omit<NotificationContainerProps, "toasts">) {
  const [paused, setPaused] = useState(false);

  const hold = () => {
    if (toast.exiting) return;
    setPaused(true);
    onPauseAutoDismiss(toast.id);
  };

  const release = () => {
    if (toast.exiting) return;
    setPaused(false);
    onResumeAutoDismiss(toast.id);
  };

  return (
    <div
      className={classNames(
        "notifications__toast",
        `notifications__toast--${toast.variant}`,
        toast.exiting && "notifications__toast--exiting",
        paused && "notifications__toast--paused",
      )}
      role={notificationRole(toast.variant)}
      style={{ "--toast-duration": `${toast.durationMs}ms` } as CSSProperties}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
      onAnimationEnd={(event) => {
        // The countdown bar finishes on a child and bubbles; only the toast's own exit unmounts it.
        if (event.currentTarget !== event.target) return;
        if (!toast.exiting) return;

        onRemove(toast.id);
      }}
    >
      <Icon icon={variantIcons[toast.variant]} className="notifications__icon" />
      <span className="notifications__message">{toast.message}</span>
      {toast.count > 1 && (
        <span className="notifications__count" aria-label={`Repeated ${toast.count} times`}>
          {`×${toast.count}`}
        </span>
      )}
      <button
        type="button"
        className="notifications__dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        disabled={toast.exiting}
      >
        <Icon icon={iconX} />
      </button>
      {!toast.exiting && (
        <span className="notifications__progress" aria-hidden="true">
          <span key={toast.count} className="notifications__progress-fill" />
        </span>
      )}
    </div>
  );
}

export function NotificationContainer({ toasts, ...handlers }: NotificationContainerProps) {
  if (toasts.length === 0) {
    return null;
  }

  return createPortal(
    <div className="notifications" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <NotificationToast key={toast.id} toast={toast} {...handlers} />
      ))}
    </div>,
    document.body,
  );
}
