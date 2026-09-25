"""Deterministic caption checks read from the nearest ``.captionrules`` file."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from constants import CAPTION_RULES_FILENAME, MAX_RULE_FINDINGS
from folder_instructions import (
    find_instruction_file,
    read_instruction_file,
    save_instruction_file,
)

STARTER_CAPTION_RULES = """\
# Caption rules for this folder and every folder below it.
# Lint captions records each hit as a caption issue.

# trigger: sample_style
words:
  min: 8
  max: 120
repeated_phrases: 4
flag:
  - match: [float*, hover*, suspended]
    note: check the subject is really off the ground
  - match: [in the background, to the left, to the right]
    note: check the direction against the image
"""

_WORD = re.compile(r"\w+(?:['\u2019]\w+)*")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class WordRange(_Strict):
    min: int | None = Field(default=None, ge=1)
    max: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _check_bounds(self) -> Self:
        if self.min is None and self.max is None:
            raise ValueError("set min, max, or both")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("min is larger than max")
        return self


class FlagRule(_Strict):
    match: list[str] = Field(min_length=1)
    note: str = ""

    @field_validator("match", mode="before")
    @classmethod
    def _accept_a_single_term(cls, value: object) -> object:
        return [value] if isinstance(value, str) else value

    @field_validator("match")
    @classmethod
    def _require_words(cls, terms: list[str]) -> list[str]:
        cleaned = [term.strip() for term in terms]
        if any(not term.rstrip("*").strip() for term in cleaned):
            raise ValueError("every term needs at least one word")
        return cleaned


class CaptionRules(_Strict):
    trigger: str | None = Field(default=None, min_length=1)
    words: WordRange | None = None
    repeated_phrases: int | None = Field(default=None, ge=2)
    flag: list[FlagRule] = Field(default_factory=list)


def _field_label(loc: tuple[int | str, ...]) -> str:
    parts: list[str] = []
    for part in loc:
        if isinstance(part, int):
            parts[-1] = f"{parts[-1]} #{part + 1}"
        else:
            parts.append(part)
    return " > ".join(parts)


def _validation_message(exc: ValidationError) -> str:
    error = exc.errors()[0]
    message = "unknown setting" if error["type"] == "extra_forbidden" else error["msg"]
    message = message.removeprefix("Value error, ")
    label = _field_label(error["loc"])
    return f"{label}: {message}" if label else message


def parse_caption_rules(text: str) -> CaptionRules:
    """Raise ``ValueError`` with a message fit to show beside the editor."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "context_mark", None) or getattr(exc, "problem_mark", None)
        problem = getattr(exc, "problem", None) or "could not be read"
        where = f" on line {mark.line + 1}" if mark is not None else ""
        raise ValueError(f"Not valid YAML{where}: {problem}.") from exc

    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValueError("The rule file must hold settings such as trigger: or flag:, not a list.")

    try:
        rules = CaptionRules.model_validate(data)
    except ValidationError as exc:
        raise ValueError(_validation_message(exc)) from exc

    if not (rules.trigger or rules.words or rules.repeated_phrases or rules.flag):
        raise ValueError("The rule file has no rules to check.")

    return rules


def _term_pattern(term: str) -> str:
    wildcard = term.endswith("*")
    words = term.rstrip("*").split()
    body = r"\s+".join(re.escape(word) for word in words)
    return rf"(?<!\w){body}{r'\w*' if wildcard else ''}(?!\w)"


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _count_non_overlapping(words: list[str], phrase: list[str]) -> int:
    count = 0
    index = 0
    size = len(phrase)
    while index + size <= len(words):
        if words[index : index + size] == phrase:
            count += 1
            index += size
        else:
            index += 1
    return count


class CaptionRuleChecker:
    """Compiles the patterns once so a job can check every caption with them."""

    def __init__(self, rules: CaptionRules) -> None:
        self._rules = rules
        self._flags = [
            (
                re.compile("|".join(_term_pattern(term) for term in rule.match), re.IGNORECASE),
                rule.note,
            )
            for rule in rules.flag
        ]
        self._trigger = (
            None
            if rules.trigger is None
            else (rules.trigger, re.compile(_term_pattern(rules.trigger)))
        )

    def check(self, caption: str) -> list[str]:
        text = caption.strip()
        return [
            *self._check_trigger(text),
            *self._check_words(text),
            *self._check_flags(text),
            *self._check_repeats(text),
        ]

    def _check_trigger(self, text: str) -> list[str]:
        if self._trigger is None:
            return []

        trigger, pattern = self._trigger
        first = pattern.search(text)
        if first is not None and first.start() == 0:
            return []
        if first is not None:
            return [f'Move the trigger "{trigger}" to the start.']
        return [f'Missing the trigger "{trigger}" at the start.']

    def _check_words(self, text: str) -> list[str]:
        bounds = self._rules.words
        if bounds is None:
            return []

        count = len(text.split())
        noun = "word" if count == 1 else "words"
        if bounds.min is not None and count < bounds.min:
            return [f"Too short: {count} {noun}, the rules ask for at least {bounds.min}."]
        if bounds.max is not None and count > bounds.max:
            return [f"Too long: {count} {noun}, the rules allow at most {bounds.max}."]
        return []

    def _check_flags(self, text: str) -> list[str]:
        findings: list[str] = []
        for pattern, note in self._flags:
            seen: set[str] = set()
            for match in pattern.finditer(text):
                phrase = _collapse(match.group(0))
                if phrase.casefold() in seen:
                    continue
                seen.add(phrase.casefold())
                findings.append(f'"{phrase}": {note}' if note else f'Flagged "{phrase}".')
        return findings

    def _check_repeats(self, text: str) -> list[str]:
        size = self._rules.repeated_phrases
        if size is None:
            return []

        tokens = list(_WORD.finditer(text))
        words = [token.group(0).casefold() for token in tokens]
        starts = range(len(words) - size + 1)
        first_start = {tuple(words[start : start + size]): start for start in reversed(starts)}

        findings: list[str] = []
        index = 0
        while index + size <= len(words):
            gram = words[index : index + size]
            repeat = next(
                (start for start in starts[index + size :] if words[start : start + size] == gram),
                None,
            )
            if repeat is None or first_start[tuple(gram)] != index:
                index += 1
                continue

            length = size
            while (
                index + length < repeat
                and repeat + length < len(words)
                and words[index + length] == words[repeat + length]
            ):
                length += 1

            phrase = text[tokens[index].start() : tokens[index + length - 1].end()]
            times = _count_non_overlapping(words, words[index : index + length])
            findings.append(f'"{_collapse(phrase)}" appears {times} times.')
            index += length
        return findings


def cap_rule_findings(findings: list[str]) -> list[str]:
    if len(findings) <= MAX_RULE_FINDINGS:
        return findings

    kept = findings[: MAX_RULE_FINDINGS - 1]
    return [*kept, f"And {len(findings) - len(kept)} more rule hits."]


def load_caption_rules_for(folder: Path) -> CaptionRules:
    path = find_instruction_file(folder, CAPTION_RULES_FILENAME)
    if path is None:
        raise ValueError(f"No {CAPTION_RULES_FILENAME} file in this folder or any folder above it.")

    try:
        text = read_instruction_file(path)
    except OSError as exc:
        raise ValueError(f"Could not read {path}.") from exc

    return parse_caption_rules(text)


def save_caption_rules(folder: Path, text: str) -> None:
    """Validate, then save ``folder``'s own file; blank text removes it."""
    if text.strip():
        parse_caption_rules(text)
    save_instruction_file(folder, CAPTION_RULES_FILENAME, text)
