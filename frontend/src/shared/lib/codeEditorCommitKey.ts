import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * Claims Mod-Enter, with or without Shift, so a host can commit on it; CodeMirror's default
 * inserts a blank line.
 */
export const leaveModEnterToHost = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: () => true },
    { key: "Shift-Mod-Enter", run: () => true },
  ]),
);
