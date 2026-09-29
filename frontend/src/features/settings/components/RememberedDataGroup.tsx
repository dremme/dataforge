import { useEffect, useState } from "react";
import { clearRecentFolders, readRecentFolderPaths } from "@/features/folder/lib/folderPreferences";
import { forgetCachedDisplayModes } from "@/features/gallery/preferences/galleryDisplayPreferences";
import {
  clearRecentActions,
  readRecentActionIds,
} from "@/features/quickAction/lib/quickActionHistory";
import { formatApiError, isAbortError } from "@/shared/api/http";
import { iconEraser } from "@/shared/icons";
import { formatCount } from "@/shared/lib/format";
import { useNotify } from "@/shared/notifications/notifications";
import type { RememberedDataResponse } from "@/shared/types";
import { fetchRememberedData, forgetRememberedData } from "../api/settings";
import { SettingsActionButton } from "./SettingsActionButton";
import { SettingsGroup } from "./SettingsGroup";

interface Row {
  id: string;
  label: string;
  unit: [string, string];
  count: number | null;
  clear: () => Promise<void>;
}

const counted = (count: number | null, [one, many]: [string, string]) =>
  count === null ? "Counting..." : `${formatCount(count)} ${count === 1 ? one : many}`;

interface RememberedDataGroupProps {
  /** Counting asks the server, so it waits until the section is first shown. */
  visible: boolean;
  disabled: boolean;
}

export function RememberedDataGroup({ visible, disabled }: RememberedDataGroupProps) {
  const notify = useNotify();
  const [server, setServer] = useState<RememberedDataResponse | null>(null);
  const [recentFolders, setRecentFolders] = useState(() => readRecentFolderPaths().length);
  const [recentActions, setRecentActions] = useState(() => readRecentActionIds().length);
  const [clearing, setClearing] = useState<string | null>(null);
  const loaded = server !== null;

  useEffect(() => {
    if (!visible || loaded) return;
    const controller = new AbortController();
    fetchRememberedData(controller.signal).then(setServer, (error: unknown) => {
      if (!isAbortError(error)) notify({ variant: "danger", message: formatApiError(error) });
    });
    return () => controller.abort();
  }, [visible, loaded, notify]);

  const rows: Row[] = [
    {
      id: "recent-folders",
      label: "Recent folders",
      unit: ["folder", "folders"],
      count: recentFolders,
      clear: async () => {
        clearRecentFolders();
        setRecentFolders(0);
      },
    },
    {
      id: "recent-actions",
      label: "Recent quick actions",
      unit: ["action", "actions"],
      count: recentActions,
      clear: async () => {
        clearRecentActions();
        setRecentActions(0);
      },
    },
    {
      id: "job-options",
      label: "Job options per folder",
      unit: ["folder", "folders"],
      count: server?.job_option_folders ?? null,
      clear: async () => setServer(await forgetRememberedData("job-options")),
    },
    {
      id: "display-modes",
      label: "Display modes per folder",
      unit: ["folder", "folders"],
      count: server?.display_mode_folders ?? null,
      clear: async () => {
        forgetCachedDisplayModes();
        setServer(await forgetRememberedData("display-modes"));
      },
    },
  ];

  const handleClear = async (row: Row) => {
    setClearing(row.id);
    try {
      await row.clear();
      notify({ variant: "success", message: `${row.label} cleared.` });
    } catch (error) {
      notify({ variant: "danger", message: formatApiError(error) });
    } finally {
      setClearing(null);
    }
  };

  return (
    <SettingsGroup
      title="Remembered data"
      icon={iconEraser}
      hint="What DataForge remembers to save you clicks. Job options keep your latest choices as the starting point."
    >
      <ul className="remembered-data">
        {rows.map((row) => (
          <li key={row.id} className="remembered-data__row">
            <span className="remembered-data__text">
              <span className="remembered-data__label">{row.label}</span>
              <span className="remembered-data__count">{counted(row.count, row.unit)}</span>
            </span>
            <SettingsActionButton
              label="Clear"
              icon={iconEraser}
              busy={clearing === row.id}
              disabled={disabled || !row.count}
              onClick={() => void handleClear(row)}
            />
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}
