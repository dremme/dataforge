import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Literal, NamedTuple

from caption_cache import cached_by_stat
from constants import (
    CAPTION_BACKUP_DIR_NAME,
    CAPTION_SIDECAR_EXTENSIONS,
    ISSUE_FIX_SENTINELS,
    ISSUE_SIDECAR_SUFFIX,
    MAX_ISSUE_FIXES,
    MAX_RULE_FINDINGS,
)


def _read_caption_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError:
        return None


def resolve_caption_file_name(stem: str, exists: Callable[[str], bool]) -> str | None:
    for extension in CAPTION_SIDECAR_EXTENSIONS:
        name = f"{stem}{extension}"
        if exists(name):
            return name

    return None


def resolve_caption_file(media_path: Path) -> Path | None:
    folder = media_path.parent
    name = resolve_caption_file_name(
        media_path.stem,
        lambda candidate: (folder / candidate).is_file(),
    )
    if name is None:
        return None
    return folder / name


def load_backup_caption(media_path: Path) -> str | None:
    """This file's caption as stored in the folder's backup, or ``None`` when it has none."""
    backup_dir = media_path.parent / CAPTION_BACKUP_DIR_NAME
    name = resolve_caption_file_name(
        media_path.stem,
        lambda candidate: (backup_dir / candidate).is_file(),
    )
    if name is None:
        return None

    raw = _read_caption_text(backup_dir / name)
    if raw is None:
        return None

    return raw.strip()


def caption_path_for(media_path: Path) -> Path:
    return media_path.parent / f"{media_path.stem}{CAPTION_SIDECAR_EXTENSIONS[0]}"


def _caption_summary_from_raw(raw_content: str | None) -> tuple[str | None, str]:
    """Assumes a sidecar exists, so an unusable one reports ``"empty"`` rather than ``"none"``."""
    if raw_content is not None:
        text = raw_content.strip()
        if text:
            return text, "text"

    return None, "empty"


def caption_summary_from_sidecar(
    sidecar_path: Path,
    mtime_ns: int,
    size: int,
) -> tuple[str | None, str]:
    """:func:`load_caption_summary` for a sidecar the caller has already stat'ed."""

    def load() -> tuple[str | None, str]:
        return _caption_summary_from_raw(_read_caption_text(sidecar_path))

    return cached_by_stat("caption", sidecar_path, mtime_ns, size, load)


class CaptionBundle(NamedTuple):
    description: str | None
    caption_status: str
    caption_path: Path | None


def _load_caption_bundle(media_path: Path) -> CaptionBundle:
    description: str | None = None
    caption_status = "none"

    caption_path = resolve_caption_file(media_path)

    if caption_path is not None:
        description, caption_status = _caption_summary_from_raw(_read_caption_text(caption_path))

    return CaptionBundle(description, caption_status, caption_path)


def load_caption_summary(media_path: Path) -> tuple[str | None, str]:
    bundle = _load_caption_bundle(media_path)
    return (bundle.description, bundle.caption_status)


def media_has_caption_text(media_path: Path) -> bool:
    description, caption_status = load_caption_summary(media_path)
    return description is not None and caption_status == "text"


NO_CAPTION_STATUS = "no_caption"


def load_reference_caption(media_path: Path) -> tuple[str | None, str]:
    """``(text, "ok")`` when the sidecar holds text, else ``(None, status)`` with ``no_caption`` if missing or textless."""
    caption_path = resolve_caption_file(media_path)
    if caption_path is None:
        return None, NO_CAPTION_STATUS

    raw = _read_caption_text(caption_path)
    if raw is None:
        return None, f"read_error: could not read {caption_path.name}"

    text = raw.strip() or None
    if not text:
        return None, NO_CAPTION_STATUS

    return text, "ok"


def build_caption_response(media_path: Path) -> dict[str, object]:
    bundle = _load_caption_bundle(media_path)
    description = bundle.description
    caption_status = bundle.caption_status
    caption_path = bundle.caption_path

    issue = load_issue_summary(media_path)

    return {
        "description": description,
        "has_description": description is not None,
        "has_caption_file": caption_status != "none",
        "caption_status": caption_status,
        "caption_file": str(caption_path) if caption_path else "",
        "issue_fixes": issue.fixes,
        "rule_findings": issue.rules,
        "has_issue_file": issue.has_file,
    }


def _complete_save_response(
    media_path: Path,
    *,
    caption_path: Path,
    resolve_issue: bool,
) -> dict[str, object]:
    if resolve_issue:
        delete_issue_file(media_path)

    response = build_caption_response(media_path)
    response["has_caption_file"] = True
    response["caption_file"] = str(caption_path)
    return response


def save_caption(
    media_path: Path,
    text: str,
    *,
    resolve_issue: bool = False,
    trailing_newline: bool = True,
) -> dict[str, object]:
    caption_path = caption_path_for(media_path)
    normalized = text.strip()
    caption_path.write_text(
        normalized + ("\n" if normalized and trailing_newline else ""),
        encoding="utf-8",
    )

    return _complete_save_response(
        media_path,
        caption_path=caption_path,
        resolve_issue=resolve_issue,
    )


def issue_file_path(media_path: Path) -> Path:
    """``clip.mp4`` -> ``clip.mp4.issue.json``. Named after the whole file so ``clip.mp4`` and ``clip.png`` cannot share one sidecar."""
    return media_path.with_name(media_path.name + ISSUE_SIDECAR_SUFFIX)


def delete_issue_file(media_path: Path) -> None:
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return
    issue_path.unlink()


_TYPOGRAPHIC_QUOTES = str.maketrans({"“": '"', "”": '"', "„": '"', "‟": '"'})


def normalize_issue_text(text: str) -> str:
    text = text.translate(_TYPOGRAPHIC_QUOTES)
    text = re.sub(r'\\+"', '"', text)
    return re.sub(
        r'"([^"]*)"',
        lambda match: '"' + re.sub(r"(?:,\s*)+$", "", match[1]) + '"',
        text,
    ).strip()


def normalize_issue_fixes(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    fixes = []
    for entry in value:
        if not isinstance(entry, str):
            continue
        text = normalize_issue_text(entry)
        if not text or text.lower() in ISSUE_FIX_SENTINELS:
            continue
        fixes.append(text)
        if len(fixes) == MAX_ISSUE_FIXES:
            break

    return fixes


type IssueSource = Literal["fixes", "rules"]


class IssueSummary(NamedTuple):
    fixes: list[str]
    rules: list[str]
    has_file: bool


def _normalize_rule_findings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    findings = [entry.strip() for entry in value if isinstance(entry, str) and entry.strip()]
    return findings[:MAX_RULE_FINDINGS]


_NORMALIZERS: dict[IssueSource, Callable[[object], list[str]]] = {
    "fixes": normalize_issue_fixes,
    "rules": _normalize_rule_findings,
}


def _findings_from_file(issue_path: Path) -> dict[IssueSource, list[str]]:
    """An unreadable sidecar reads as empty; callers still count the file as present."""
    try:
        data = json.loads(issue_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = None

    if not isinstance(data, dict):
        data = {}

    return {source: normalize(data.get(source)) for source, normalize in _NORMALIZERS.items()}


def issue_summary_from_sidecar(issue_path: Path, mtime_ns: int, size: int) -> IssueSummary:
    """:func:`load_issue_summary` for a sidecar the caller has already stat'ed."""
    findings = cached_by_stat(
        "issue",
        issue_path,
        mtime_ns,
        size,
        lambda: {source: tuple(found) for source, found in _findings_from_file(issue_path).items()},
    )
    # Fresh lists per call: the cache hands back the same tuples every time.
    return IssueSummary(list(findings["fixes"]), list(findings["rules"]), True)


def load_issue_summary(media_path: Path) -> IssueSummary:
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return IssueSummary([], [], False)

    findings = _findings_from_file(issue_path)
    return IssueSummary(findings["fixes"], findings["rules"], True)


def save_issue_findings(media_path: Path, source: IssueSource, findings: list[str]) -> None:
    """Replace one source's findings and keep the other's; the sidecar goes once both are empty."""
    issue_path = issue_file_path(media_path)
    stored = _findings_from_file(issue_path)
    stored[source] = _NORMALIZERS[source](findings)
    payload = {key: found for key, found in stored.items() if found}

    if not payload:
        if issue_path.is_file():
            issue_path.unlink()
        return

    issue_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
