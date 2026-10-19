import { useQuery } from "@tanstack/react-query";
import { systemSpecsQueryOptions } from "@/features/automation/lib/automationQueries";
import { formatApiError } from "@/shared/api/http";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { iconCopy, iconFolder, iconInfo } from "@/shared/icons";
import { formatFileSize } from "@/shared/lib/format";
import type { AboutResponse, AppSettingsResponse, SystemSpecs } from "@/shared/types";
import { fetchAbout, settingsKeys } from "../api/settings";
import { SettingsActionButton } from "./SettingsActionButton";
import { SettingsGroup } from "./SettingsGroup";

const FFMPEG_SOURCES = {
  setup: "installed by setup",
  path: "from PATH",
  bundled: "bundled",
} as const;

function ffmpegText(about: AboutResponse): string {
  if (!about.ffmpeg_path || !about.ffmpeg_source)
    return "Not found: video frames and audio captioning need it";
  return `${about.ffmpeg_path} (${FFMPEG_SOURCES[about.ffmpeg_source]})`;
}

function gpuText(specs: SystemSpecs | null): string {
  if (!specs?.gpu_available || !specs.gpu_name) return "None detected";
  return specs.gpu_memory_bytes
    ? `${specs.gpu_name} (${formatFileSize(specs.gpu_memory_bytes)})`
    : specs.gpu_name;
}

/** Plain text for a bug report. The API key stays out: only whether one is set. */
function diagnosticsText(
  about: AboutResponse,
  specs: SystemSpecs | null,
  settings: AppSettingsResponse | null,
): string {
  const lines = [
    `DataForge ${about.version}`,
    `Python ${about.python_version} on ${about.platform}`,
    `ffmpeg: ${ffmpegText(about)}`,
    `GPU: ${gpuText(specs)}`,
    `.env: ${about.env_file ?? "none loaded"}`,
    `Database: ${about.database_path}`,
    `Thumbnail cache: ${about.thumbnail_cache_dir}`,
    `Workflows: ${about.workflows_dir}`,
  ];
  if (settings) {
    lines.push(
      `Vision server: ${settings.vision_base_url.value} (model ${settings.vision_model.value}, key ${settings.vision_api_key.is_set ? "set" : "not set"})`,
      `ComfyUI: ${settings.comfy_base_url.value}`,
      `AI-Toolkit: ${settings.ai_toolkit_base_url.value}`,
    );
  }
  return lines.join("\n");
}

interface AboutSectionProps {
  settings: AppSettingsResponse | null;
  /** Probing ffmpeg and the GPU takes a moment, so it waits until the section is first shown. */
  visible: boolean;
}

export function AboutSection({ settings, visible }: AboutSectionProps) {
  const { copyLabel, copyText } = useCopyFeedback();

  // An installation does not change while the app runs, so once read it stays read.
  const aboutQuery = useQuery({
    queryKey: settingsKeys.about,
    queryFn: ({ signal }) => fetchAbout(signal),
    enabled: visible,
    staleTime: Infinity,
  });
  // The same specs the workspace system panel reads; the GPU line waits when they are missing.
  const specsQuery = useQuery({ ...systemSpecsQueryOptions(), enabled: visible, retry: false });

  if (aboutQuery.isError) {
    return (
      <p className="dialog__error" role="alert">
        {formatApiError(aboutQuery.error)}
      </p>
    );
  }

  const about: AboutResponse | null = aboutQuery.data ?? null;
  const specs: SystemSpecs | null = specsQuery.data ?? null;
  const pending = "...";

  return (
    <>
      <SettingsGroup
        title="Installation"
        icon={iconInfo}
        action={
          <SettingsActionButton
            label={copyLabel === "Copy" ? "Copy diagnostics" : copyLabel}
            icon={iconCopy}
            disabled={!about}
            onClick={() => {
              if (about) void copyText(diagnosticsText(about, specs, settings));
            }}
          />
        }
      >
        <dl className="settings-facts">
          <dt>Version</dt>
          <dd>{about ? `DataForge ${about.version}` : pending}</dd>
          <dt>Python</dt>
          <dd>{about ? `${about.python_version} on ${about.platform}` : pending}</dd>
          <dt>ffmpeg</dt>
          <dd className={about && !about.ffmpeg_path ? "settings-facts__warning" : undefined}>
            {about ? ffmpegText(about) : pending}
          </dd>
          <dt>GPU</dt>
          <dd>{about ? gpuText(specs) : pending}</dd>
        </dl>
      </SettingsGroup>

      <SettingsGroup title="Locations" icon={iconFolder}>
        <dl className="settings-paths">
          <dt>Database</dt>
          <dd>
            <span>{about?.database_path ?? pending}</span>
          </dd>
          <dt>Cache folder</dt>
          <dd>
            <span>{about?.thumbnail_cache_dir ?? pending}</span>
          </dd>
          <dt>Workflows</dt>
          <dd>
            <span>{about?.workflows_dir ?? pending}</span>
          </dd>
          <dt>.env file</dt>
          <dd>
            <span>{about ? (about.env_file ?? "None loaded") : pending}</span>
          </dd>
        </dl>
      </SettingsGroup>
    </>
  );
}
