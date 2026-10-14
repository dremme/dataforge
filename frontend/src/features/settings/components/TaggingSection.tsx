import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatApiError } from "@/shared/api/http";
import { iconTag } from "@/shared/icons";
import { formatCount } from "@/shared/lib/format";
import type { TaggingState } from "@/shared/types";
import { taggingStatusQueryOptions } from "@/features/tagging/api/tagging";
import { SettingsGroup } from "./SettingsGroup";

/** Often enough to watch a folder being worked through, while the section is open. */
const STATUS_REFRESH_MS = 3000;

const STATE_LABELS: Record<TaggingState, string> = {
  unavailable: "Not installed",
  idle: "Up to date",
  loading: "Loading the model",
  tagging: "Tagging",
  failed: "Stopped",
};

interface TaggingSectionProps {
  visible: boolean;
  children: ReactNode;
}

export function TaggingSection({ visible, children }: TaggingSectionProps) {
  const statusQuery = useQuery({
    ...taggingStatusQueryOptions(),
    enabled: visible,
    refetchInterval: visible ? STATUS_REFRESH_MS : false,
  });

  const status = statusQuery.data ?? null;
  const checking = status ? null : "Checking...";

  return (
    <SettingsGroup
      title="Background tagging"
      icon={iconTag}
      hint="Tags below the minimum confidence are hidden from cards and search. Lower it to find more, at the cost of more wrong guesses."
    >
      {statusQuery.isError ? (
        <p className="dialog__error" role="alert">
          {formatApiError(statusQuery.error)}
        </p>
      ) : (
        <>
          <dl className="settings-stats" role="status">
            <div className="settings-stats__tile">
              <dt>Status</dt>
              <dd>{status ? STATE_LABELS[status.state] : checking}</dd>
            </div>
            <div className="settings-stats__tile">
              <dt>Waiting</dt>
              <dd>{status ? formatCount(status.pending) : checking}</dd>
            </div>
            <div className="settings-stats__tile">
              <dt>Vocabulary</dt>
              <dd>{status ? `${formatCount(status.vocabulary_size)} terms` : checking}</dd>
            </div>
          </dl>
          {status?.detail && (
            <p
              className={status.state === "failed" ? "dialog__error" : "settings-modal__status"}
              role={status.state === "failed" ? "alert" : undefined}
            >
              {status.detail}
            </p>
          )}
        </>
      )}
      {children}
    </SettingsGroup>
  );
}
