import { SHORTCUT_GROUPS, SHORTCUTS, type ShortcutDefinition } from "@/shared/lib/shortcuts";
import { Modal } from "@/shared/ui/Modal";
import { ShortcutKeys } from "@/shared/ui/ShortcutKeys";

const SHORTCUT_LIST: readonly ShortcutDefinition[] = Object.values(SHORTCUTS);

interface ShortcutsModalProps {
  onClose: () => void;
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <Modal
      title="Keyboard shortcuts"
      role="dialog"
      panelClassName="shortcuts-modal"
      onClose={onClose}
    >
      <div className="shortcuts-modal__groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.id} className="shortcuts-modal__group" aria-label={group.label}>
            <h3 className="shortcuts-modal__group-label">{group.label}</h3>
            <dl className="shortcuts-modal__list">
              {SHORTCUT_LIST.filter((shortcut) => shortcut.group === group.id).map((shortcut) => (
                <div key={shortcut.label} className="shortcuts-modal__row">
                  <dt className="shortcuts-modal__label">{shortcut.label}</dt>
                  <dd className="shortcuts-modal__keys">
                    <ShortcutKeys shortcut={shortcut} announce />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
