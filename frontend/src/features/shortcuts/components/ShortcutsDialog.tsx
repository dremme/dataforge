import { SHORTCUT_GROUPS, SHORTCUTS, type ShortcutDefinition } from "@/shared/lib/shortcuts";
import { Dialog, DialogButton } from "@/shared/ui/Dialog";
import { ShortcutKeys } from "@/shared/ui/ShortcutKeys";

const SHORTCUT_LIST: readonly ShortcutDefinition[] = Object.values(SHORTCUTS);

interface ShortcutsDialogProps {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  return (
    <Dialog
      title="Keyboard shortcuts"
      role="dialog"
      panelClassName="shortcuts-dialog"
      onConfirm={onClose}
      onClose={onClose}
      footer={<DialogButton label="Close" variant="primary" onClick={onClose} />}
    >
      <div className="shortcuts-dialog__groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.id} className="shortcuts-dialog__group" aria-label={group.label}>
            <h3 className="shortcuts-dialog__group-label">{group.label}</h3>
            <dl className="shortcuts-dialog__list">
              {SHORTCUT_LIST.filter((shortcut) => shortcut.group === group.id).map((shortcut) => (
                <div key={shortcut.label} className="shortcuts-dialog__row">
                  <dt className="shortcuts-dialog__label">{shortcut.label}</dt>
                  <dd className="shortcuts-dialog__keys">
                    <ShortcutKeys shortcut={shortcut} announce />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
