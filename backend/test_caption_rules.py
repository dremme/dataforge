from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from caption_rules import (
    STARTER_CAPTION_RULES,
    CaptionRuleChecker,
    cap_rule_findings,
    parse_caption_rules,
)
from constants import MAX_RULE_FINDINGS


def _check(rules_text: str, caption: str) -> list[str]:
    return CaptionRuleChecker(parse_caption_rules(rules_text)).check(caption)


class ParseCaptionRulesTests(unittest.TestCase):
    def test_the_starter_template_is_valid(self) -> None:
        rules = parse_caption_rules(STARTER_CAPTION_RULES)

        self.assertTrue(rules.flag)

    def test_an_empty_file_has_no_rules_to_check(self) -> None:
        with self.assertRaisesRegex(ValueError, "no rules"):
            parse_caption_rules("# only a comment\n")

    def test_a_yaml_error_names_the_line(self) -> None:
        with self.assertRaisesRegex(ValueError, "line 2"):
            parse_caption_rules("words:\n  min: [8\n")

    def test_an_unknown_setting_is_named(self) -> None:
        with self.assertRaisesRegex(ValueError, "colour: unknown setting"):
            parse_caption_rules("colour: blue\n")

    def test_a_field_error_names_the_rule_by_its_position(self) -> None:
        with self.assertRaisesRegex(ValueError, "flag #2 > match"):
            parse_caption_rules("flag:\n  - match: [lake]\n  - note: no terms\n")

    def test_the_top_level_must_be_a_mapping(self) -> None:
        with self.assertRaisesRegex(ValueError, "settings"):
            parse_caption_rules("- lake\n- river\n")

    def test_a_single_match_term_may_be_written_without_a_list(self) -> None:
        rules = parse_caption_rules("flag:\n  - match: lake\n")

        self.assertEqual(rules.flag[0].match, ["lake"])

    def test_a_bare_wildcard_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "flag #1 > match"):
            parse_caption_rules("flag:\n  - match: ['*']\n")

    def test_the_word_range_must_not_be_inverted(self) -> None:
        with self.assertRaisesRegex(ValueError, "words"):
            parse_caption_rules("words: {min: 20, max: 10}\n")


class FlagRuleTests(unittest.TestCase):
    def test_matches_whole_words_only(self) -> None:
        rules = "flag:\n  - match: [hover]\n"

        self.assertEqual(_check(rules, "A hovercraft on the lake."), [])
        self.assertEqual(_check(rules, "Birds Hover above the lake."), ['Flagged "Hover".'])

    def test_a_trailing_wildcard_matches_the_rest_of_the_word(self) -> None:
        rules = "flag:\n  - match: [float*]\n    note: check the subject is off the ground\n"

        self.assertEqual(
            _check(rules, "A balloon floating over the hills."),
            ['"floating": check the subject is off the ground'],
        )

    def test_a_phrase_matches_across_a_line_break(self) -> None:
        rules = "flag:\n  - match: [in the background]\n"

        self.assertEqual(
            _check(rules, "A red car, trees in the\nbackground."),
            ['Flagged "in the background".'],
        )

    def test_each_distinct_match_is_reported_once(self) -> None:
        rules = "flag:\n  - match: [float*, hover*]\n"

        self.assertEqual(
            _check(rules, "Floating lanterns, a hovering drone, more floating lanterns."),
            ['Flagged "Floating".', 'Flagged "hovering".'],
        )

    def test_punctuation_in_a_term_is_matched_literally(self) -> None:
        rules = "flag:\n  - match: [3d render]\n"

        self.assertEqual(_check(rules, "A 3D render of a bridge."), ['Flagged "3D render".'])


class TriggerRuleTests(unittest.TestCase):
    rules = "trigger: sample_style\n"

    def test_a_caption_starting_with_the_trigger_passes(self) -> None:
        self.assertEqual(_check(self.rules, "sample_style, a bridge at dusk."), [])

    def test_a_missing_trigger_is_reported(self) -> None:
        self.assertEqual(
            _check(self.rules, "A bridge at dusk."),
            ['Missing the trigger "sample_style" at the start.'],
        )

    def test_a_longer_word_does_not_count_as_the_trigger(self) -> None:
        self.assertEqual(
            _check(self.rules, "sample_style2, a bridge at dusk."),
            ['Missing the trigger "sample_style" at the start.'],
        )

    def test_a_trigger_elsewhere_in_the_caption_is_reported_as_misplaced(self) -> None:
        self.assertEqual(
            _check(self.rules, "A bridge at dusk, sample_style."),
            ['Move the trigger "sample_style" to the start.'],
        )


class WordRangeTests(unittest.TestCase):
    rules = "words: {min: 4, max: 6}\n"

    def test_a_caption_inside_the_range_passes(self) -> None:
        self.assertEqual(_check(self.rules, "A bridge over the river."), [])

    def test_a_short_caption_is_reported(self) -> None:
        self.assertEqual(
            _check(self.rules, "A bridge."),
            ["Too short: 2 words, the rules ask for at least 4."],
        )

    def test_a_long_caption_is_reported(self) -> None:
        self.assertEqual(
            _check(self.rules, "A stone bridge over the wide river at dusk."),
            ["Too long: 9 words, the rules allow at most 6."],
        )


class RepeatedPhraseTests(unittest.TestCase):
    rules = "repeated_phrases: 4\n"

    def test_a_repeated_phrase_is_reported_at_its_full_length(self) -> None:
        self.assertEqual(
            _check(
                self.rules,
                "The old stone bridge over the river, and the old stone bridge over the river.",
            ),
            ['"The old stone bridge over the river" appears 2 times.'],
        )

    def test_counts_every_occurrence(self) -> None:
        self.assertEqual(
            _check(self.rules, "a red car parked, a red car parked, a red car parked"),
            ['"a red car parked" appears 3 times.'],
        )

    def test_shorter_repeats_pass(self) -> None:
        self.assertEqual(_check(self.rules, "a red car and a red bus and a red van"), [])

    def test_overlapping_words_are_not_a_repeat(self) -> None:
        self.assertEqual(_check("repeated_phrases: 2\n", "far far far"), [])


class FindingOrderTests(unittest.TestCase):
    def test_findings_follow_the_order_of_the_rule_file(self) -> None:
        rules = (
            "trigger: sample_style\n"
            "words: {min: 20}\n"
            "repeated_phrases: 2\n"
            "flag:\n"
            "  - match: [lake]\n"
        )

        self.assertEqual(
            _check(rules, "A lake, a lake."),
            [
                'Missing the trigger "sample_style" at the start.',
                "Too short: 4 words, the rules ask for at least 20.",
                'Flagged "lake".',
                '"A lake" appears 2 times.',
            ],
        )


class CapRuleFindingsTests(unittest.TestCase):
    def test_a_short_list_is_kept(self) -> None:
        findings = [f"Hit {index}." for index in range(MAX_RULE_FINDINGS)]

        self.assertEqual(cap_rule_findings(findings), findings)

    def test_the_overflow_is_summarized_in_the_last_slot(self) -> None:
        findings = [f"Hit {index}." for index in range(MAX_RULE_FINDINGS + 3)]

        capped = cap_rule_findings(findings)

        self.assertEqual(len(capped), MAX_RULE_FINDINGS)
        self.assertEqual(capped[:-1], findings[: MAX_RULE_FINDINGS - 1])
        self.assertEqual(capped[-1], "And 4 more rule hits.")


if __name__ == "__main__":
    unittest.main()
