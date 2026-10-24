"""Caption sidecars: the one reader that tells missing, empty, text and unreadable apart, and
the one writer, which only replaces the revision its caller read.

A revision is a hash of the file's bytes, so it catches an edit from another tab, a job or another
program alike; ``None`` stands for "no file". Same-stem media share one caption file, so bulk jobs
group their media by :func:`caption_targets` and change each caption once.
"""

import hashlib
import json
import os
import re
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Literal, NamedTuple

from api_errors import ConflictError
from caption_cache import cached_by_stat
from constants import (
    CAPTION_BACKUP_DIR_NAME,
    CAPTION_CLAIM_WAIT_SECONDS,
    CAPTION_SIDECAR_EXTENSIONS,
    ISSUE_FIX_SENTINELS,
    ISSUE_SIDECAR_SUFFIX,
    MAX_ISSUE_FIXES,
    MAX_RULE_FINDINGS,
)
from file_write import write_text_atomic
from media_claims import claim
from schemas import CaptionReadError, CaptionStatus


class CaptionConflictError(ConflictError):
    """The caption is no longer the revision the writer read; nothing was written."""

    code = "caption_conflict"


class CaptionRead(NamedTuple):
    status: CaptionStatus
    #: Stripped, and only for ``"text"``.
    text: str | None
    #: ``None`` when there is no file, or when it could not be opened.
    revision: str | None
    read_error: CaptionReadError | None


NO_CAPTION_FILE = CaptionRead("none", None, None, None)
_INACCESSIBLE = CaptionRead("unreadable", None, None, "access")


def caption_revision(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:16]


def _caption_from_bytes(raw: bytes) -> CaptionRead:
    revision = caption_revision(raw)
    try:
        # Universal newlines, as text-mode reads give: a search spanning lines matches CRLF files.
        text = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").strip()
    except UnicodeDecodeError:
        return CaptionRead("unreadable", None, revision, "encoding")
    if not text:
        return CaptionRead("empty", None, revision, None)
    return CaptionRead("text", text, revision, None)


def read_caption_file(path: Path) -> CaptionRead:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return NO_CAPTION_FILE
    except OSError:
        return _INACCESSIBLE
    return _caption_from_bytes(raw)


def caption_path_for(media_path: Path) -> Path:
    return media_path.parent / f"{media_path.stem}{CAPTION_SIDECAR_EXTENSIONS[0]}"


def read_caption(media_path: Path) -> CaptionRead:
    return read_caption_file(caption_path_for(media_path))


def caption_from_sidecar(sidecar_path: Path, mtime_ns: int, size: int) -> CaptionRead:
    """:func:`read_caption_file` for a sidecar the caller has already stat'ed.

    A file that cannot be opened is not remembered, so the next listing tries again.
    """
    return cached_by_stat(
        "caption",
        sidecar_path,
        mtime_ns,
        size,
        lambda: _caption_from_bytes(sidecar_path.read_bytes()),
        lambda: _INACCESSIBLE,
    )


def is_blank_caption_file(path: Path) -> bool:
    """Whitespace only. An unreadable file is not blank: its text may still be worth keeping."""
    return read_caption_file(path).status == "empty"


def resolve_caption_file_name(stem: str, exists: Callable[[str], bool]) -> str | None:
    for extension in CAPTION_SIDECAR_EXTENSIONS:
        name = f"{stem}{extension}"
        if exists(name):
            return name

    return None


def load_backup_caption(media_path: Path) -> str | None:
    """This file's caption as stored in the folder's backup, or ``None`` when it has none."""
    backup_dir = media_path.parent / CAPTION_BACKUP_DIR_NAME
    name = resolve_caption_file_name(
        media_path.stem,
        lambda candidate: (backup_dir / candidate).is_file(),
    )
    if name is None:
        return None

    backup = read_caption_file(backup_dir / name)
    if backup.status == "unreadable":
        return None
    return backup.text or ""


class CaptionTarget(NamedTuple):
    caption: Path
    #: Every given media file that reads this caption, in the order given.
    media: tuple[Path, ...]

    @property
    def primary(self) -> Path:
        """The file a job reports and, where it looks at pixels, looks at."""
        return self.media[0]

    @property
    def shared_with(self) -> list[str]:
        return [path.name for path in self.media[1:]]


def caption_targets(media_files: Iterable[Path]) -> list[CaptionTarget]:
    """One entry per caption file, so a caption same-stem media share is changed once."""
    grouped: dict[str, tuple[Path, list[Path]]] = {}
    for media in media_files:
        caption = caption_path_for(media)
        grouped.setdefault(os.path.normcase(caption), (caption, []))[1].append(media)
    return [CaptionTarget(caption, tuple(media)) for caption, media in grouped.values()]


NO_CAPTION_STATUS = "no_caption"
CAPTION_READ_ERROR = "read_error"
#: A write refused because the caption or its file changed after it was read.
CAPTION_CHANGED_STATUS = "caption_changed"


class ReferenceCaption(NamedTuple):
    """What a job reads before it changes a caption, and the revision to write back against."""

    text: str | None
    #: ``"ok"``, :data:`NO_CAPTION_STATUS` (missing or textless) or :data:`CAPTION_READ_ERROR`.
    status: str
    revision: str | None


def load_reference_caption(media_path: Path) -> ReferenceCaption:
    read = read_caption(media_path)
    if read.status == "unreadable":
        return ReferenceCaption(None, CAPTION_READ_ERROR, read.revision)
    if read.status == "text":
        return ReferenceCaption(read.text, "ok", read.revision)
    return ReferenceCaption(None, NO_CAPTION_STATUS, read.revision)


def build_caption_response(media_path: Path) -> dict[str, object]:
    read = read_caption(media_path)
    issue = load_issue_summary(media_path)

    return {
        "description": read.text,
        "has_description": read.text is not None,
        "has_caption_file": read.status != "none",
        "caption_status": read.status,
        "caption_revision": read.revision,
        "caption_read_error": read.read_error,
        "caption_file": str(caption_path_for(media_path)) if read.status != "none" else "",
        "issue_fixes": issue.fixes,
        "rule_findings": issue.rules,
        "has_issue_file": issue.has_file,
    }


def save_caption(
    media_path: Path,
    text: str,
    *,
    base_revision: str | None,
    resolve_issue: bool = False,
    trailing_newline: bool = True,
) -> dict[str, object]:
    """Write ``text`` over the caption only while it is still ``base_revision``.

    Raises :class:`CaptionConflictError` when the caption changed since it was read, or the media
    is gone, and ``OSError`` when the current caption cannot be opened to compare, so a file
    another program holds is never overwritten blind.
    """
    caption_path = caption_path_for(media_path)
    with claim([caption_path], "caption", wait_s=CAPTION_CLAIM_WAIT_SECONDS):
        if not media_path.is_file():
            raise CaptionConflictError(f"{media_path.name} was moved or deleted")
        current = read_caption_file(caption_path)
        if current.read_error == "access":
            raise PermissionError(f"{caption_path.name} could not be read, so it was not replaced")
        if current.revision != base_revision:
            raise CaptionConflictError(
                f"The caption of {media_path.name} changed since it was loaded"
            )

        normalized = text.strip()
        write_text_atomic(
            caption_path,
            normalized + ("\n" if normalized and trailing_newline else ""),
        )
        if resolve_issue:
            delete_issue_file(media_path)
        return build_caption_response(media_path)


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


def _findings_from_json(raw: bytes | None) -> dict[IssueSource, list[str]]:
    """An unusable sidecar reads as empty; callers still count the file as present."""
    try:
        data = json.loads(raw) if raw is not None else None
    except ValueError:
        data = None

    if not isinstance(data, dict):
        data = {}

    return {source: normalize(data.get(source)) for source, normalize in _NORMALIZERS.items()}


def _findings_from_file(issue_path: Path) -> dict[IssueSource, list[str]]:
    try:
        raw = issue_path.read_bytes()
    except OSError:
        raw = None
    return _findings_from_json(raw)


def _frozen(findings: dict[IssueSource, list[str]]) -> dict[IssueSource, tuple[str, ...]]:
    return {source: tuple(found) for source, found in findings.items()}


def issue_summary_from_sidecar(issue_path: Path, mtime_ns: int, size: int) -> IssueSummary:
    """:func:`load_issue_summary` for a sidecar the caller has already stat'ed."""
    findings = cached_by_stat(
        "issue",
        issue_path,
        mtime_ns,
        size,
        lambda: _frozen(_findings_from_json(issue_path.read_bytes())),
        lambda: _frozen(_findings_from_json(None)),
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

    write_text_atomic(issue_path, json.dumps(payload, indent=2) + "\n")
