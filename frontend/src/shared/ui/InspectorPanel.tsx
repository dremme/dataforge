import { useContext, type CSSProperties, type ReactNode, type RefObject } from "react";
import { DialogSuspendedContext } from "./dialogSuspendedContext";

interface InspectorPanelProps {
  block: string;
  label?: string;
  style?: CSSProperties;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/** A docked inspector participates in the page's focus order and never acquires modality. */
export function InspectorPanel({ block, label, style, panelRef, children }: InspectorPanelProps) {
  const suspended = useContext(DialogSuspendedContext);
  return (
    <aside
      className={`${block} ${block}--inline`}
      aria-label={label}
      style={style}
      aria-hidden={suspended || undefined}
      inert={suspended}
    >
      <div ref={panelRef} className={`${block}__panel`} tabIndex={-1}>
        {children}
      </div>
    </aside>
  );
}
