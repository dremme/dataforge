import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from external.comfy_logs import assemble_log_lines


def writes(*fragments: str) -> list[dict[str, str]]:
    """The window's shape: one entry per stdout write, with a timestamp nothing reads."""
    return [{"t": "2026-09-14T18:56:48.651274", "m": fragment} for fragment in fragments]


class AssembleLogLinesTests(unittest.TestCase):
    def test_fragments_join_into_one_line(self) -> None:
        self.assertEqual(assemble_log_lines(writes("hello ", "world", "\n")), ["hello world"])

    def test_a_progress_bar_collapses_to_its_last_paint(self) -> None:
        lines = assemble_log_lines(
            writes(
                "\rEulerSampler:  50%|█████     | 1/2",
                "\rEulerSampler: 100%|██████████| 2/2 [00:07<00:00,  7.24s/it]",
                "\n",
            )
        )

        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("EulerSampler: 100%"))
        self.assertNotIn("50%", lines[0])

    def test_the_unterminated_last_line_is_kept(self) -> None:
        """It is the bar still being drawn, which is the whole point of watching mid-run."""
        self.assertEqual(
            assemble_log_lines(writes("EulerSampler:  37%|███")), ["EulerSampler:  37%|███"]
        )

    def test_ansi_colour_is_stripped(self) -> None:
        # ComfyUI's real sign-off line, which would otherwise render its escapes verbatim.
        lines = assemble_log_lines(
            writes("\x1b[32m[INFO]\x1b[0m \x1b[32mPrompt executed in 00:11:52\x1b[0m", "\n")
        )

        self.assertEqual(lines, ["[INFO] Prompt executed in 00:11:52"])

    def test_an_erase_before_the_newline_keeps_its_line(self) -> None:
        """Pins the ANSI strip ahead of the newline pass; the other order eats the line."""
        self.assertEqual(
            assemble_log_lines(writes("Prompt executed\r\x1b[K\n")), ["Prompt executed"]
        )

    def test_a_carriage_return_newline_does_not_blank_the_line(self) -> None:
        self.assertEqual(assemble_log_lines(writes("loaded model\r\n")), ["loaded model"])

    def test_newline_only_entries_become_blank_lines(self) -> None:
        lines = assemble_log_lines(writes("a", "\n", "\n", "b", "\n"))

        self.assertEqual(lines, ["a", "", "b"])

    def test_trailing_blanks_go_but_interior_ones_stay(self) -> None:
        lines = assemble_log_lines(writes("a", "\n", "\n", "b", "\n", "\n", "\n"))

        self.assertEqual(lines, ["a", "", "b"])

    def test_leading_whitespace_survives_and_trailing_does_not(self) -> None:
        # The phase banners are indented, and a traceback's shape is its indentation.
        lines = assemble_log_lines(writes("  [18:56:55.945]  Phase 3   \n"))

        self.assertEqual(lines, ["  [18:56:55.945]  Phase 3"])

    def test_entries_without_a_string_message_are_ignored(self) -> None:
        entries: list[dict[str, object]] = [{"t": "x"}, {"m": 5}, {"m": "ok\n"}]

        self.assertEqual(assemble_log_lines(entries), ["ok"])

    def test_an_empty_window_says_nothing(self) -> None:
        self.assertEqual(assemble_log_lines([]), [])

    def test_a_window_of_only_newlines_says_nothing(self) -> None:
        self.assertEqual(assemble_log_lines(writes("\n", "\n", "\n")), [])

    def test_the_cap_keeps_the_last_lines(self) -> None:
        entries = writes(*[f"line {index}\n" for index in range(500)])

        lines = assemble_log_lines(entries, limit=200)

        self.assertEqual(len(lines), 200)
        self.assertEqual(lines[-1], "line 499")
        self.assertEqual(lines[0], "line 300")


if __name__ == "__main__":
    unittest.main()
