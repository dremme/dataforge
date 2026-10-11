import { useState, type HTMLAttributes } from "react";
import { useReorderFolderFavorites } from "@/features/folder/hooks/useFolderFavorites";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { FolderFavorite } from "@/shared/types";

/** The dragged row, or the side of a row the dragged one would land on. */
export type FavoriteDragMark = "dragging" | "drop-before" | "drop-after";

/** Drag-and-drop reordering of a favorites list; a dropped row takes its target's place. */
export function useFavoriteDragOrder(favorites: FolderFavorite[]) {
  const { mutate } = useReorderFolderFavorites();
  const notify = useNotify();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const drop = (target: number) => {
    if (dragIndex === null || dragIndex === target) return;
    const next = [...favorites];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    mutate(next, {
      onError: (error) => notify({ variant: "danger", message: formatApiError(error) }),
    });
  };

  const dragProps = (index: number): HTMLAttributes<HTMLElement> & { draggable: true } => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", favorites[index].path);
      setDragIndex(index);
    },
    // Only this list's own drags are accepted; anything else dragged over it is left alone.
    onDragOver: (event) => {
      if (dragIndex === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropIndex(index);
    },
    onDrop: (event) => {
      event.preventDefault();
      drop(index);
      endDrag();
    },
    onDragEnd: endDrag,
  });

  const dragMark = (index: number): FavoriteDragMark | null => {
    if (dragIndex === null) return null;
    if (index === dragIndex) return "dragging";
    if (index !== dropIndex) return null;
    return index < dragIndex ? "drop-before" : "drop-after";
  };

  return { dragProps, dragMark };
}
