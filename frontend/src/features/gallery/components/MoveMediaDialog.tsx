import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchFolderChildren, fetchFolderRoots } from "@/features/browse/api/folders";
import {
  folderLeafName,
  folderPathsEqual,
  normalizeFolderPath,
} from "@/features/browse/lib/folderPath";
import { formatApiError } from "@/shared/api/http";
import {
  iconChevronDown,
  iconChevronRight,
  iconFolder,
  iconFolderOpen,
  iconLoader2,
} from "@/shared/icons";
import { useNotify } from "@/shared/notifications/notifications";
import type { FolderChild } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";

interface MoveMediaDialogProps {
  currentFolder: string;
  selectedCount: number;
  busy?: boolean;
  onClose: () => void;
  onSelectDestination: (path: string) => void;
}

interface RootNode {
  name: string;
  /** Display path (normalized separators / drive root form). */
  path: string;
  /** Canonical key for maps / expansion / selection. */
  key: string;
}

interface TreeEntry {
  key: string;
  path: string;
  name: string;
  depth: number;
}

/** Case-insensitive path identity used for tree maps and selection. */
function pathKey(path: string): string {
  return normalizeFolderPath(path).replace(/\\/g, "/").toLowerCase();
}

function isStrictDescendant(path: string, ancestor: string): boolean {
  const child = pathKey(path);
  const parent = pathKey(ancestor);
  if (child === parent) return false;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return child.startsWith(prefix);
}

function sortChildren(entries: FolderChild[]): FolderChild[] {
  return [...entries].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

/** Keep roots unique by path. Nested roots (Home under C:\\) stay — walk skips
 *  a path if it already appeared higher in the tree. */
function dedupeRoots(raw: { name: string; path: string }[]): RootNode[] {
  const seen = new Set<string>();
  const result: RootNode[] = [];

  for (const root of raw) {
    const path = normalizeFolderPath(root.path);
    if (!path) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: root.name, path, key });
  }

  return result;
}

/** Expand from drive root down to the current folder so the tree opens in context. */
function ancestorPathsToExpand(folder: string, roots: RootNode[]): string[] {
  const target = normalizeFolderPath(folder);
  if (!target) return [];

  const targetKey = pathKey(target);
  const owningRoot = roots.find(
    (root) => root.key === targetKey || isStrictDescendant(target, root.path),
  );
  if (!owningRoot) {
    return [target];
  }

  const segments = target
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .filter(Boolean);
  // ["C:", "Photos", "Vacation"] → cumulative C:\, C:\Photos, C:\Photos\Vacation
  const chain: string[] = [];
  if (/^[A-Za-z]:$/i.test(segments[0] ?? "")) {
    let acc = `${segments[0].toUpperCase()}\\`;
    chain.push(normalizeFolderPath(acc));
    for (let i = 1; i < segments.length; i += 1) {
      acc = `${acc.replace(/\\+$/, "")}\\${segments[i]}`;
      chain.push(normalizeFolderPath(acc));
    }
  } else {
    let acc = "";
    for (const segment of segments) {
      acc = acc ? `${acc}/${segment}` : `/${segment}`;
      chain.push(normalizeFolderPath(acc));
    }
  }

  // Only expand ancestors that fall under the owning root (inclusive of root).
  return chain.filter(
    (path) => pathKey(path) === owningRoot.key || isStrictDescendant(path, owningRoot.path),
  );
}

export function MoveMediaDialog({
  currentFolder,
  selectedCount,
  busy = false,
  onClose,
  onSelectDestination,
}: MoveMediaDialogProps) {
  const treeId = useId();
  const notify = useNotify();
  const treeRef = useRef<HTMLDivElement>(null);
  const loadingKeysRef = useRef(new Set<string>());
  const childrenByKeyRef = useRef<Record<string, FolderChild[]>>({});
  const didScrollToCurrentRef = useRef(false);

  const [roots, setRoots] = useState<RootNode[]>([]);
  /** Children keyed by pathKey for stable lookups. */
  const [childrenByKey, setChildrenByKey] = useState<Record<string, FolderChild[]>>({});
  /** Expanded folder keys. */
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  /** Selected destination path (display form), or empty until the user picks. */
  const [selectedPath, setSelectedPath] = useState("");
  const [rootsLoading, setRootsLoading] = useState(true);

  childrenByKeyRef.current = childrenByKey;
  const currentKey = pathKey(currentFolder);

  const markLoading = useCallback((key: string, loading: boolean) => {
    if (loading) {
      loadingKeysRef.current.add(key);
    } else {
      loadingKeysRef.current.delete(key);
    }
    setLoadingKeys(new Set(loadingKeysRef.current));
  }, []);

  const loadChildren = useCallback(
    async (path: string) => {
      const displayPath = normalizeFolderPath(path);
      const key = pathKey(displayPath);
      if (!displayPath || childrenByKeyRef.current[key] !== undefined) {
        return;
      }
      if (loadingKeysRef.current.has(key)) {
        return;
      }

      markLoading(key, true);
      try {
        const response = await fetchFolderChildren(displayPath);
        const children = sortChildren(response.children);
        setChildrenByKey((current) => ({
          ...current,
          [key]: children,
        }));
        // Leaf folders: drop expand state so the chevron goes away immediately.
        if (children.length === 0) {
          setExpandedKeys((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
      } catch (error) {
        setChildrenByKey((current) => ({
          ...current,
          [key]: [],
        }));
        setExpandedKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        notify({ variant: "danger", message: formatApiError(error) });
      } finally {
        markLoading(key, false);
      }
    },
    [markLoading, notify],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setRootsLoading(true);
      try {
        const response = await fetchFolderRoots();
        if (cancelled) return;

        const nextRoots = dedupeRoots(response.roots);
        setRoots(nextRoots);

        const toExpand = ancestorPathsToExpand(currentFolder, nextRoots);
        const expandKeys = new Set(toExpand.map((path) => pathKey(path)));
        setExpandedKeys(expandKeys);

        // Prefetch every expanded node so the tree opens populated.
        await Promise.all(toExpand.map((path) => loadChildren(path)));
      } catch (error) {
        if (!cancelled) {
          notify({ variant: "danger", message: formatApiError(error) });
        }
      } finally {
        if (!cancelled) {
          setRootsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount for the dialog session.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once with initial folder
  }, []);

  const toggleExpanded = useCallback(
    (path: string) => {
      const displayPath = normalizeFolderPath(path);
      const key = pathKey(displayPath);
      if (!displayPath) return;

      setExpandedKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
          void loadChildren(displayPath);
        }
        return next;
      });
    },
    [loadChildren],
  );

  const selectPath = useCallback(
    (path: string) => {
      const displayPath = normalizeFolderPath(path);
      if (!displayPath) return;
      if (folderPathsEqual(displayPath, currentFolder)) return;
      setSelectedPath(displayPath);
    },
    [currentFolder],
  );

  const isDisabledDestination = useCallback(
    (path: string) => folderPathsEqual(path, currentFolder),
    [currentFolder],
  );

  const entries = useMemo((): TreeEntry[] => {
    const result: TreeEntry[] = [];
    const seen = new Set<string>();

    const walk = (path: string, name: string, depth: number) => {
      const displayPath = normalizeFolderPath(path);
      const key = pathKey(displayPath);
      if (!displayPath || seen.has(key)) {
        return;
      }
      seen.add(key);

      result.push({ key, path: displayPath, name, depth });

      if (!expandedKeys.has(key)) {
        return;
      }

      const children = childrenByKey[key];
      if (!children) {
        return;
      }

      for (const child of children) {
        walk(child.path, child.name, depth + 1);
      }
    };

    for (const root of roots) {
      walk(root.path, root.name, 0);
    }

    return result;
  }, [childrenByKey, expandedKeys, roots]);

  const handleConfirm = () => {
    if (busy || !selectedPath || isDisabledDestination(selectedPath)) return;
    onSelectDestination(selectedPath);
  };

  const selectedKey = selectedPath ? pathKey(selectedPath) : "";
  const canMove = Boolean(selectedPath) && !isDisabledDestination(selectedPath) && !busy;

  // After the initial expand+load, scroll the current folder into view once.
  useEffect(() => {
    if (rootsLoading || didScrollToCurrentRef.current) return;
    if (!entries.some((entry) => entry.key === currentKey)) return;

    const frame = window.requestAnimationFrame(() => {
      const node = treeRef.current?.querySelector("[data-current-folder]");
      if (!(node instanceof HTMLElement)) return;
      // jsdom does not implement scrollIntoView; skip quietly in tests.
      if (typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      }
      didScrollToCurrentRef.current = true;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentKey, entries, rootsLoading]);

  return (
    <Dialog
      title="Move to folder"
      description={
        <>
          Choose a destination for{" "}
          {selectedCount === 1 ? "1 selected file" : `${selectedCount} selected files`}.
        </>
      }
      role="dialog"
      panelClassName="move-media-dialog"
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel="Move here"
          busyLabel="Moving..."
          busy={busy}
          confirmDisabled={!canMove}
          onConfirm={handleConfirm}
          onCancel={onClose}
        />
      }
    >
      <div className="dialog__field">
        <div className="dialog__label">Destination</div>
        <div
          className={classNames(
            "move-media-dialog__destination",
            !selectedPath && "move-media-dialog__destination--placeholder",
          )}
          aria-live="polite"
          title={selectedPath || undefined}
        >
          <span>{selectedPath || "Select a folder in the tree"}</span>
        </div>
      </div>

      <div className="dialog__field">
        <div className="dialog__label">Folders</div>
        <div ref={treeRef} className="move-media-dialog__tree" data-scroll-lock-allow id={treeId}>
          {rootsLoading ? (
            <div className="move-media-dialog__tree-status">
              <Icon icon={iconLoader2} spin className="move-media-dialog__tree-status-icon" />
              Loading folders...
            </div>
          ) : (
            <ul className="move-media-dialog__tree-list" role="tree" aria-label="Folder tree">
              {entries.map((entry) => {
                const expanded = expandedKeys.has(entry.key);
                const loading = loadingKeys.has(entry.key);
                const children = childrenByKey[entry.key];
                const hasLoadedChildren = children !== undefined;
                // Show a chevron only before load, while loading, or when subfolders exist.
                // Empty leaves keep a spacer so rows stay aligned (no stuck expand arrow).
                const canExpand = loading || !hasLoadedChildren || (children?.length ?? 0) > 0;
                const selected = entry.key === selectedKey;
                const disabled = isDisabledDestination(entry.path);
                const isCurrent = entry.key === currentKey;

                return (
                  <li
                    key={entry.key}
                    className={classNames(
                      "move-media-dialog__tree-item",
                      selected && "move-media-dialog__tree-item--selected",
                      disabled && "move-media-dialog__tree-item--disabled",
                    )}
                    role="treeitem"
                    aria-expanded={canExpand ? expanded : undefined}
                    aria-selected={selected}
                    data-current-folder={isCurrent ? "" : undefined}
                    style={{ ["--tree-depth" as string]: entry.depth }}
                  >
                    <div className="move-media-dialog__tree-row">
                      {canExpand ? (
                        <button
                          type="button"
                          className="move-media-dialog__tree-toggle"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(entry.path);
                          }}
                          aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                          disabled={busy}
                          tabIndex={-1}
                        >
                          {loading ? (
                            <Icon
                              icon={iconLoader2}
                              spin
                              className="move-media-dialog__tree-icon"
                            />
                          ) : (
                            <Icon
                              icon={expanded ? iconChevronDown : iconChevronRight}
                              className="move-media-dialog__tree-icon"
                            />
                          )}
                        </button>
                      ) : (
                        <span className="move-media-dialog__tree-toggle move-media-dialog__tree-toggle--spacer" />
                      )}

                      <button
                        type="button"
                        className="move-media-dialog__tree-select"
                        onClick={() => selectPath(entry.path)}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          if (canExpand) toggleExpanded(entry.path);
                        }}
                        disabled={busy || disabled}
                        title={disabled ? "Files are already in this folder" : entry.path}
                      >
                        <Icon
                          icon={expanded ? iconFolderOpen : iconFolder}
                          className="move-media-dialog__tree-folder-icon"
                        />
                        <span className="move-media-dialog__tree-name">
                          {entry.name || folderLeafName(entry.path)}
                        </span>
                        {disabled && <span className="move-media-dialog__tree-badge">Current</span>}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
