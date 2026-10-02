import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { folderKey } from "@/features/folder/lib/folderPath";
import {
  folderChildrenQueryOptions,
  folderRootsQueryOptions,
} from "@/features/folder/lib/folderQuery";
import {
  folderLeafName,
  folderPathsEqual,
  normalizeFolderPath,
} from "@/features/folder/lib/folderPath";
import { formatApiError } from "@/shared/api/http";
import {
  iconChevronDown,
  iconChevronRight,
  iconFolder,
  iconFolderOpen,
  iconLoader2,
} from "@/shared/icons";
import { useNotify } from "@/shared/notifications/notifications";
import type { MediaTransferMode } from "@/features/gallery/api/media";
import type { FolderChild } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { Icon } from "@/shared/ui/Icon";

interface TransferMediaDialogProps {
  mode: MediaTransferMode;
  currentFolder: string;
  scope?: DialogScopeInfo;
  selectedCount: number;
  description?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  onSelectDestination: (path: string) => void;
}

const MODE_COPY: Record<MediaTransferMode, { title: string; confirm: string; busy: string }> = {
  move: { title: "Move to folder", confirm: "Move here", busy: "Moving..." },
  copy: { title: "Copy to folder", confirm: "Copy here", busy: "Copying..." },
};

interface RootNode {
  name: string;
  path: string;
  key: string;
}

interface TreeEntry {
  key: string;
  path: string;
  name: string;
  depth: number;
}

function isStrictDescendant(path: string, ancestor: string): boolean {
  const child = folderKey(path);
  const parent = folderKey(ancestor);
  if (child === parent) return false;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return child.startsWith(prefix);
}

function dedupeRoots(raw: { name: string; path: string }[]): RootNode[] {
  const seen = new Set<string>();
  const result: RootNode[] = [];

  for (const root of raw) {
    const path = normalizeFolderPath(root.path);
    if (!path) continue;
    const key = folderKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: root.name, path, key });
  }

  return result;
}

function ancestorPathsToExpand(folder: string, roots: RootNode[]): string[] {
  const target = normalizeFolderPath(folder);
  if (!target) return [];

  const targetKey = folderKey(target);
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
    (path) => folderKey(path) === owningRoot.key || isStrictDescendant(path, owningRoot.path),
  );
}

export function TransferMediaDialog({
  mode,
  currentFolder,
  scope,
  selectedCount,
  description,
  busy = false,
  onClose,
  onSelectDestination,
}: TransferMediaDialogProps) {
  const modeCopy = MODE_COPY[mode];
  const treeId = useId();
  const notify = useNotify();
  const treeRef = useRef<HTMLDivElement>(null);
  const didScrollToCurrentRef = useRef(false);
  const treeItemRefs = useRef(new Map<string, HTMLLIElement>());
  const reportedErrorsRef = useRef(new Set<unknown>());

  // Keyed by folder, each holding the path it was toggled at.
  const [toggled, setToggled] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [selectedPath, setSelectedPath] = useState("");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const currentKey = folderKey(currentFolder);
  const rootsQuery = useQuery(folderRootsQueryOptions());
  const rootsData = rootsQuery.data;
  const roots = useMemo(() => dedupeRoots(rootsData?.roots ?? []), [rootsData]);

  // The tree opens on the current folder; each toggle flips one folder from that.
  const defaultExpanded = useMemo(
    () =>
      new Map(
        rootsData
          ? ancestorPathsToExpand(currentFolder, roots).map((path) => [folderKey(path), path])
          : [],
      ),
    [currentFolder, roots, rootsData],
  );
  const expandedPaths = useMemo(() => {
    const paths = new Map(defaultExpanded);
    for (const [key, path] of toggled) {
      if (paths.has(key)) paths.delete(key);
      else paths.set(key, path);
    }
    return paths;
  }, [defaultExpanded, toggled]);

  // Shared with the breadcrumb menu, so a folder listed there opens here at once.
  const expandedKeyList = [...expandedPaths.keys()];
  const listed = useQueries({
    queries: [...expandedPaths.values()].map((path) => folderChildrenQueryOptions(path)),
    combine: (results) => {
      const childrenByKey: Record<string, FolderChild[]> = {};
      const loadingKeys: Record<string, boolean> = {};
      const errors: unknown[] = [];
      results.forEach((result, index) => {
        const key = expandedKeyList[index];
        if (result.data) {
          childrenByKey[key] = result.data;
        } else if (result.isError) {
          // A folder that cannot be listed shows as a leaf.
          childrenByKey[key] = [];
          errors.push(result.error);
        } else {
          loadingKeys[key] = true;
        }
      });
      return { childrenByKey, loadingKeys, errors };
    },
  });
  const { childrenByKey, loadingKeys } = listed;
  const rootsLoading =
    rootsQuery.isPending || [...defaultExpanded.keys()].some((key) => loadingKeys[key]);

  const rootsError = rootsQuery.error;
  const listErrors = listed.errors;
  useEffect(() => {
    for (const error of [rootsError, ...listErrors]) {
      if (!error || reportedErrorsRef.current.has(error)) continue;
      reportedErrorsRef.current.add(error);
      notify({ variant: "danger", message: formatApiError(error) });
    }
  }, [listErrors, notify, rootsError]);

  const toggleExpanded = useCallback((path: string) => {
    const displayPath = normalizeFolderPath(path);
    if (!displayPath) return;
    const key = folderKey(displayPath);

    setToggled((current) => {
      const next = new Map(current);
      if (next.has(key)) next.delete(key);
      else next.set(key, displayPath);
      return next;
    });
  }, []);

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
      const key = folderKey(displayPath);
      if (!displayPath || seen.has(key)) {
        return;
      }
      seen.add(key);

      result.push({ key, path: displayPath, name, depth });

      if (!expandedPaths.has(key)) {
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
  }, [childrenByKey, expandedPaths, roots]);

  const handleConfirm = () => {
    if (busy || !selectedPath || isDisabledDestination(selectedPath)) return;
    onSelectDestination(selectedPath);
  };

  const selectedKey = selectedPath ? folderKey(selectedPath) : "";
  const canTransfer = Boolean(selectedPath) && !isDisabledDestination(selectedPath) && !busy;

  const hasEntry = (key: string | null) => entries.some((entry) => entry.key === key);
  const tabStopKey = [focusedKey, selectedKey, currentKey].find(hasEntry) ?? entries[0]?.key;

  const canExpandEntry = (key: string) => {
    const children = childrenByKey[key];
    return Boolean(loadingKeys[key]) || children === undefined || children.length > 0;
  };

  const focusEntry = (entry: TreeEntry) => {
    setFocusedKey(entry.key);
    if (!isDisabledDestination(entry.path)) selectPath(entry.path);
    treeItemRefs.current.get(entry.key)?.focus();
  };

  // WAI-ARIA tree pattern: focus moves by row and selection follows it.
  const handleTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (busy || event.ctrlKey || event.metaKey || event.altKey) return;

    const index = entries.findIndex((entry) => entry.key === tabStopKey);
    const entry = entries[index];
    if (!entry) return;

    const expanded = expandedPaths.has(entry.key) && canExpandEntry(entry.key);
    let target: TreeEntry | undefined;

    switch (event.key) {
      case "ArrowDown":
        target = entries[index + 1];
        break;
      case "ArrowUp":
        target = entries[index - 1];
        break;
      case "Home":
        target = entries[0];
        break;
      case "End":
        target = entries[entries.length - 1];
        break;
      case "ArrowRight":
        if (!expanded && canExpandEntry(entry.key)) toggleExpanded(entry.path);
        else if (entries[index + 1]?.depth > entry.depth) target = entries[index + 1];
        break;
      case "ArrowLeft":
        if (expanded) toggleExpanded(entry.path);
        else
          target = entries
            .slice(0, index)
            .reverse()
            .find((row) => row.depth < entry.depth);
        break;
      default:
        return;
    }

    event.preventDefault();
    if (target) focusEntry(target);
  };

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
      title={modeCopy.title}
      scope={scope}
      description={
        description ?? (
          <>
            Choose a destination for{" "}
            {selectedCount === 1 ? "1 selected file" : `${selectedCount} selected files`}.
          </>
        )
      }
      role="dialog"
      panelClassName="transfer-media-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={modeCopy.confirm}
          busyLabel={modeCopy.busy}
          busy={busy}
          confirmDisabled={!canTransfer}
          onConfirm={handleConfirm}
          onCancel={onClose}
        />
      }
    >
      <div className="dialog__field">
        <div className="dialog__label">Destination</div>
        <div
          className={classNames(
            "transfer-media-dialog__destination",
            !selectedPath && "transfer-media-dialog__destination--placeholder",
          )}
          aria-live="polite"
          title={selectedPath || undefined}
        >
          <span>{selectedPath || "Select a folder in the tree"}</span>
        </div>
      </div>

      <div className="dialog__field transfer-media-dialog__tree-field">
        <div className="dialog__label">Folders</div>
        <div
          ref={treeRef}
          className="transfer-media-dialog__tree"
          data-scroll-lock-allow
          id={treeId}
        >
          {rootsLoading ? (
            <div className="transfer-media-dialog__tree-status">
              <Icon icon={iconLoader2} spin className="transfer-media-dialog__tree-status-icon" />
              Loading folders...
            </div>
          ) : (
            <ul
              className="transfer-media-dialog__tree-list"
              role="tree"
              aria-label="Folder tree"
              onKeyDown={handleTreeKeyDown}
            >
              {entries.map((entry) => {
                const expanded = expandedPaths.has(entry.key);
                const loading = Boolean(loadingKeys[entry.key]);
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
                      "transfer-media-dialog__tree-item",
                      selected && "transfer-media-dialog__tree-item--selected",
                      disabled && "transfer-media-dialog__tree-item--disabled",
                    )}
                    ref={(node) => {
                      if (node) treeItemRefs.current.set(entry.key, node);
                      else treeItemRefs.current.delete(entry.key);
                    }}
                    role="treeitem"
                    aria-label={entry.name || folderLeafName(entry.path)}
                    aria-level={entry.depth + 1}
                    aria-expanded={canExpand ? expanded : undefined}
                    aria-selected={selected}
                    tabIndex={entry.key === tabStopKey ? 0 : -1}
                    onFocus={() => setFocusedKey(entry.key)}
                    data-current-folder={isCurrent ? "" : undefined}
                    style={{ ["--tree-depth" as string]: entry.depth }}
                  >
                    <div className="transfer-media-dialog__tree-row">
                      {canExpand ? (
                        <button
                          type="button"
                          className="transfer-media-dialog__tree-toggle"
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
                              className="transfer-media-dialog__tree-icon"
                            />
                          ) : (
                            <Icon
                              icon={expanded ? iconChevronDown : iconChevronRight}
                              className="transfer-media-dialog__tree-icon"
                            />
                          )}
                        </button>
                      ) : (
                        <span className="transfer-media-dialog__tree-toggle transfer-media-dialog__tree-toggle--spacer" />
                      )}

                      <button
                        type="button"
                        className="transfer-media-dialog__tree-select"
                        onClick={() => selectPath(entry.path)}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          if (canExpand) toggleExpanded(entry.path);
                        }}
                        disabled={busy || disabled}
                        tabIndex={-1}
                        title={disabled ? "Files are already in this folder" : entry.path}
                      >
                        <Icon
                          icon={expanded ? iconFolderOpen : iconFolder}
                          className="transfer-media-dialog__tree-folder-icon"
                        />
                        <span className="transfer-media-dialog__tree-name">
                          {entry.name || folderLeafName(entry.path)}
                        </span>
                        {disabled && (
                          <span className="transfer-media-dialog__tree-badge">Current</span>
                        )}
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
