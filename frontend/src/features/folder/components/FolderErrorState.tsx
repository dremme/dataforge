import { BACKEND_UNREACHABLE, FOLDER_NOT_FOUND, type FolderError } from "@/shared/api/http";
import { iconCircleAlert } from "@/shared/icons";
import { EmptyState } from "@/shared/ui/EmptyState";

type FolderErrorStateProps = {
  error: FolderError;
};

export function FolderErrorState({ error }: FolderErrorStateProps) {
  if (error.kind === "folder-not-found") {
    return (
      <EmptyState
        icon={iconCircleAlert}
        title={FOLDER_NOT_FOUND.title}
        description={FOLDER_NOT_FOUND.description}
        variant="error"
        role="alert"
      />
    );
  }

  if (error.kind === "backend-unreachable") {
    return (
      <EmptyState
        icon={iconCircleAlert}
        title={BACKEND_UNREACHABLE.title}
        description={BACKEND_UNREACHABLE.description}
        variant="error"
        role="alert"
      />
    );
  }

  return (
    <EmptyState
      icon={iconCircleAlert}
      title="Something went wrong"
      description={error.message}
      variant="error"
      role="alert"
    />
  );
}
