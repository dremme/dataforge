import { iconCircleAlert, iconCircleCheck, iconLoader2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { ServiceProbeResponse } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";

export type ProbeState =
  | { status: "testing" }
  | { status: "done"; result: ServiceProbeResponse }
  | { status: "failed"; message: string };

function describe(state: ProbeState): { tone: "busy" | "ok" | "bad"; text: string } {
  if (state.status === "testing") return { tone: "busy", text: "Testing..." };
  if (state.status === "failed") return { tone: "bad", text: state.message };
  const { reachable, detail, models } = state.result;
  if (!reachable) return { tone: "bad", text: `Not reachable: ${detail ?? "no answer"}` };
  if (models.length === 0) return { tone: "ok", text: "Reachable" };
  const count = `${models.length} ${models.length === 1 ? "model" : "models"}`;
  return { tone: "ok", text: `Reachable, ${count}: ${models.join(", ")}` };
}

export function ConnectionStatus({ state }: { state: ProbeState }) {
  const { tone, text } = describe(state);
  const icon = tone === "busy" ? iconLoader2 : tone === "ok" ? iconCircleCheck : iconCircleAlert;

  return (
    <p
      className={classNames("connection-status", `connection-status--${tone}`)}
      role="status"
      title={text}
    >
      <Icon icon={icon} spin={tone === "busy"} className="connection-status__icon" />
      <span className="connection-status__text">{text}</span>
    </p>
  );
}
